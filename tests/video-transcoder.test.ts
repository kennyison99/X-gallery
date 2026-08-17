import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execSync } from 'node:child_process';
import {
  ConcurrencyLimiter,
  resolvePreset,
  validateTranscodeOutput,
  transcodeVideoFile,
  VIDEO_TRANSCODE_MIN_SAVINGS_RATIO,
} from '../scripts/video-transcoder.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'x-gallery-transcode-test-'));
}

test('ConcurrencyLimiter strictly throttles concurrent tasks', async () => {
  const limiter = new ConcurrencyLimiter(2);
  let active = 0;
  let maxActive = 0;

  const tasks = Array.from({ length: 6 }, (_, i) => async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    return i;
  });

  const results = await Promise.all(tasks.map((t) => limiter.run(t)));
  assert.equal(maxActive <= 2, true, `Max concurrent tasks was ${maxActive}, expected <= 2`);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
});

test('resolvePreset returns valid presets and falls back safely', () => {
  assert.equal(resolvePreset('medium'), 'medium');
  assert.equal(resolvePreset('fast'), 'fast');
  assert.equal(resolvePreset('slow'), 'slow');
  assert.equal(resolvePreset('unknown_preset'), 'medium');
  assert.equal(resolvePreset('; rm -rf /'), 'medium');
  assert.equal(resolvePreset(undefined), 'medium');
});

test('validateTranscodeOutput enforces duration, codec, and size sanity', () => {
  const orig = { isValid: true, duration: 100.0, width: 1920, height: 1080, codec: 'h264', size: 50_000_000 };

  // 1. Valid matching transcode
  const validTranscode = { isValid: true, duration: 99.8, width: 1920, height: 1080, codec: 'h264', size: 30_000_000 };
  assert.equal(validateTranscodeOutput(orig, validTranscode).valid, true);

  // 2. Truncated duration (e.g. 70s instead of 100s)
  const truncated = { isValid: true, duration: 70.0, width: 1920, height: 1080, codec: 'h264', size: 20_000_000 };
  const truncatedRes = validateTranscodeOutput(orig, truncated);
  assert.equal(truncatedRes.valid, false);
  assert.match(truncatedRes.reason, /Duration mismatch/);

  // 3. Wrong codec (e.g. mpeg4 instead of h264)
  const wrongCodec = { isValid: true, duration: 100.0, width: 1920, height: 1080, codec: 'mpeg4', size: 30_000_000 };
  assert.equal(validateTranscodeOutput(orig, wrongCodec).valid, false);

  // 4. Corrupted 0-byte or tiny file
  const tinyFile = { isValid: true, duration: 100.0, width: 1920, height: 1080, codec: 'h264', size: 500 };
  assert.equal(validateTranscodeOutput(orig, tinyFile).valid, false);
});

test('transcodeVideoFile: skips videos below minFileSizeBytes threshold', async () => {
  const tempDir = createTempDir();
  const smallInputPath = path.join(tempDir, 'small_clip.mp4');

  try {
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v libx264 -crf 30 -pix_fmt yuv420p "${smallInputPath}"`,
      { stdio: 'ignore' }
    );

    const limiter = new ConcurrencyLimiter(1);
    const result = await transcodeVideoFile(smallInputPath, {
      minFileSizeBytes: 5 * 1000 * 1000, // 5 MB threshold
      limiter,
    });

    assert.equal(result.transcoded, false);
    assert.equal(result.chosenPath, smallInputPath);
    assert.match(result.reason, /below 5.0MB/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('transcodeVideoFile: saves > 15% on high-bitrate video, returns transcoded path', async () => {
  const tempDir = createTempDir();
  const rawInputPath = path.join(tempDir, 'sample_high_bitrate.mp4');

  try {
    // Generate a 1-second synthetic video with high entropy / low CRF (CRF 12)
    execSync(
      `ffmpeg -y -f lavfi -i "nullsrc=s=320x240:d=1,geq=random(1)*255:128:128" -c:v libx264 -crf 12 -preset ultrafast -pix_fmt yuv420p "${rawInputPath}"`,
      { stdio: 'ignore' }
    );

    const origSize = fs.statSync(rawInputPath).size;
    assert.ok(origSize > 0, 'Synthetic input file must exist');

    const limiter = new ConcurrencyLimiter(1);
    const result = await transcodeVideoFile(rawInputPath, {
      crf: 28,
      minSavingsRatio: 0.15,
      minFileSizeBytes: 0, // Allow test fixture through
      preset: 'ultrafast',
      limiter,
    });

    assert.equal(result.transcoded, true, 'Should successfully transcode');
    assert.ok(fs.existsSync(result.chosenPath), 'Chosen path must exist');
    assert.match(result.chosenPath, /\.transcoded\.mp4$/);

    const finalSize = fs.statSync(result.chosenPath).size;
    assert.ok(finalSize <= origSize * (1 - VIDEO_TRANSCODE_MIN_SAVINGS_RATIO), 'Must satisfy size savings threshold');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('transcodeVideoFile: skips and retains original when savings < 15% (Size Guard)', async () => {
  const tempDir = createTempDir();
  const rawInputPath = path.join(tempDir, 'sample_low_bitrate.mp4');

  try {
    // Generate an already heavily compressed 1-second synthetic video
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v libx264 -crf 35 -pix_fmt yuv420p "${rawInputPath}"`,
      { stdio: 'ignore' }
    );

    const origSize = fs.statSync(rawInputPath).size;
    const origContent = fs.readFileSync(rawInputPath);

    const limiter = new ConcurrencyLimiter(1);
    // Setting required savings to 80% to intentionally trigger Size Guard rejection
    const result = await transcodeVideoFile(rawInputPath, {
      minSavingsRatio: 0.80,
      minFileSizeBytes: 0,
      preset: 'ultrafast',
      limiter,
    });

    assert.equal(result.transcoded, false, 'Should be rejected by Size Guard');
    assert.equal(result.chosenPath, rawInputPath, 'Chosen path must be original path');
    assert.ok(fs.existsSync(rawInputPath), 'Original file must still exist');
    assert.equal(fs.statSync(rawInputPath).size, origSize, 'Original size must match exactly');
    assert.deepEqual(fs.readFileSync(rawInputPath), origContent, 'Original file content must remain completely intact');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('transcodeVideoFile: non-destructive fallback when FFmpeg fails on corrupted file', async () => {
  const tempDir = createTempDir();
  const corruptInputPath = path.join(tempDir, 'corrupted_video.mp4');

  try {
    // Write fake/corrupted non-video binary data
    const fakeData = Buffer.from('NOT_A_REAL_VIDEO_HEADER_DATA_1234567890');
    fs.writeFileSync(corruptInputPath, fakeData);

    const limiter = new ConcurrencyLimiter(1);
    const result = await transcodeVideoFile(corruptInputPath, {
      timeoutMs: 5000,
      minFileSizeBytes: 0,
      limiter,
    });

    assert.equal(result.transcoded, false, 'Should fail gracefully');
    assert.equal(result.chosenPath, corruptInputPath, 'Should return original path');
    assert.ok(fs.existsSync(corruptInputPath), 'Original corrupted file must not be destroyed');
    assert.deepEqual(fs.readFileSync(corruptInputPath), fakeData, 'Original content must remain intact');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
