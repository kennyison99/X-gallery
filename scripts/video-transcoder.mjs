import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Video Transcoding Configuration
// ---------------------------------------------------------------------------

export const VIDEO_TRANSCODE_CRF = 22;
export const VIDEO_TRANSCODE_MAXRATE = '3000k';
export const VIDEO_TRANSCODE_BUFSIZE = '6000k';
export const VIDEO_TRANSCODE_MIN_INPUT_BYTES = 5 * 1024 * 1024;
export const VIDEO_TRANSCODE_MIN_SAVINGS_RATIO = 0.15; // Must save >= 15% to justify lossy generation
export const VIDEO_TRANSCODE_TIMEOUT_MS = 180_000; // 3 minutes timeout per video
export const DEFAULT_TRANSCODE_CONCURRENCY = 1; // Limit concurrent CPU-heavy FFmpeg processes

const ALLOWED_PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
]);

export function resolvePreset(envPreset = process.env.VIDEO_TRANSCODE_PRESET) {
  const normalized = (envPreset ?? 'medium').trim().toLowerCase();
  return ALLOWED_PRESETS.has(normalized) ? normalized : 'medium';
}

export function shouldTranscodeInput(inputBytes) {
  return inputBytes >= VIDEO_TRANSCODE_MIN_INPUT_BYTES;
}

// ---------------------------------------------------------------------------
// Async Concurrency Limiter (Semaphore)
// ---------------------------------------------------------------------------

export class ConcurrencyLimiter {
  constructor(concurrency = DEFAULT_TRANSCODE_CONCURRENCY) {
    this.concurrency = Math.max(1, concurrency);
    this.running = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.running >= this.concurrency) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.();
      }
    }
  }
}

export const globalTranscodeLimiter = new ConcurrencyLimiter(
  parseInt(process.env.VIDEO_TRANSCODE_CONCURRENCY ?? '', 10) || DEFAULT_TRANSCODE_CONCURRENCY
);

// ---------------------------------------------------------------------------
// Spawn Helper with Timeout and Error Buffer Capping
// ---------------------------------------------------------------------------

export function runProcess(command, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // Guard against unbounded memory allocation
      if (stdout.length > 10 * 1024 * 1024) {
        stdout = stdout.slice(-10 * 1024 * 1024);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 512 * 1024) {
        stderr = stderr.slice(-512 * 1024);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }
      if (code !== 0) {
        const lastStderrLines = stderr.trim().split('\n').slice(-10).join('\n');
        return reject(
          new Error(`${command} exited with code ${code}: ${lastStderrLines || 'Unknown error'}`)
        );
      }
      resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Video Probing & Integrity Validation via ffprobe
// ---------------------------------------------------------------------------

export async function probeVideo(filePath, timeoutMs = 15_000) {
  try {
    const { stdout } = await runProcess(
      'ffprobe',
      [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-of', 'json',
        filePath,
      ],
      { timeoutMs }
    );
    const parsed = JSON.parse(stdout);
    const videoStream = (parsed.streams || []).find((s) => s.codec_type === 'video');
    const format = parsed.format || {};

    const duration = parseFloat(videoStream?.duration || format.duration || '0');
    const width = parseInt(videoStream?.width || '0', 10);
    const height = parseInt(videoStream?.height || '0', 10);
    const codec = (videoStream?.codec_name || '').toLowerCase();

    return {
      isValid: Boolean(videoStream && duration > 0 && width > 0 && height > 0),
      duration,
      width,
      height,
      codec,
      size: parseInt(format.size || '0', 10) || (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0),
    };
  } catch (err) {
    return {
      isValid: false,
      duration: 0,
      width: 0,
      height: 0,
      codec: '',
      size: 0,
      error: err.message,
    };
  }
}

export function validateTranscodeOutput(origMeta, transcodeMeta) {
  if (!transcodeMeta.isValid) {
    return { valid: false, reason: `Output metadata is invalid: ${transcodeMeta.error || 'missing video stream/duration'}` };
  }

  if (transcodeMeta.codec !== 'h264') {
    return { valid: false, reason: `Expected h264 codec, but got ${transcodeMeta.codec}` };
  }

  if (transcodeMeta.size < 1024) {
    return { valid: false, reason: `Output file size (${transcodeMeta.size} bytes) is suspiciously small` };
  }

  // Verify duration has not been truncated (> 1.5s difference or > 5% diff on long files)
  if (origMeta.duration > 0) {
    const durationDelta = Math.abs(transcodeMeta.duration - origMeta.duration);
    const maxAllowedDelta = Math.max(1.5, origMeta.duration * 0.05);
    if (durationDelta > maxAllowedDelta) {
      return {
        valid: false,
        reason: `Duration mismatch: original ${origMeta.duration.toFixed(2)}s vs transcoded ${transcodeMeta.duration.toFixed(2)}s (diff ${durationDelta.toFixed(2)}s > ${maxAllowedDelta.toFixed(2)}s)`,
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Core Transcode Execution Function (Non-Destructive)
// ---------------------------------------------------------------------------

export async function transcodeVideoFile(
  mediaPath,
  options = {}
) {
  const {
    crf = VIDEO_TRANSCODE_CRF,
    maxrate = VIDEO_TRANSCODE_MAXRATE,
    bufsize = VIDEO_TRANSCODE_BUFSIZE,
    preset = resolvePreset(),
    timeoutMs = VIDEO_TRANSCODE_TIMEOUT_MS,
    minSavingsRatio = VIDEO_TRANSCODE_MIN_SAVINGS_RATIO,
    limiter = globalTranscodeLimiter,
  } = options;

  if (!fs.existsSync(mediaPath)) {
    return { chosenPath: mediaPath, transcoded: false, reason: 'Input file not found' };
  }

  const origStats = fs.statSync(mediaPath);
  const origSize = origStats.size;
  const transcodedPath = mediaPath.replace(/\.[a-zA-Z0-9]+$/, '.transcoded.mp4');

  // Clean up any stale leftover file from earlier aborted run
  if (fs.existsSync(transcodedPath)) {
    try { fs.unlinkSync(transcodedPath); } catch {}
  }

  if (!shouldTranscodeInput(origSize)) {
    return {
      chosenPath: mediaPath,
      transcoded: false,
      reason: `Input below ${(VIDEO_TRANSCODE_MIN_INPUT_BYTES / 1024 / 1024).toFixed(0)} MiB threshold`,
    };
  }

  return await limiter.run(async () => {
    try {
      // 1. Probe original video metadata for validation comparison
      const origMeta = await probeVideo(mediaPath);

      // 2. Run FFmpeg via spawn (no shell injection, streaming stderr)
      const ffmpegArgs = [
        '-y',
        '-i', mediaPath,
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', String(crf),
        '-maxrate', maxrate,
        '-bufsize', bufsize,
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '128k',
        transcodedPath,
      ];

      await runProcess('ffmpeg', ffmpegArgs, { timeoutMs });

      if (!fs.existsSync(transcodedPath)) {
        return { chosenPath: mediaPath, transcoded: false, reason: 'Transcoded file was not created' };
      }

      const newSize = fs.statSync(transcodedPath).size;

      // 3. Probe and validate transcoded output integrity
      const transcodeMeta = await probeVideo(transcodedPath);
      const validation = validateTranscodeOutput(origMeta, transcodeMeta);
      if (!validation.valid) {
        console.warn(`    ⚠️ Video validation failed: ${validation.reason}. Retaining original.`);
        try { fs.unlinkSync(transcodedPath); } catch {}
        return { chosenPath: mediaPath, transcoded: false, reason: validation.reason };
      }

      // 4. Size Guard check: must save >= minSavingsRatio (default 15%)
      const requiredMaxSize = origSize * (1 - minSavingsRatio);
      if (newSize <= requiredMaxSize) {
        const savedMb = ((origSize - newSize) / (1024 * 1024)).toFixed(2);
        const pct = (((origSize - newSize) / origSize) * 100).toFixed(1);
        console.log(
          `    ✓ Video transcoded: ${(origSize / 1024 / 1024).toFixed(2)}MB -> ${(newSize / 1024 / 1024).toFixed(2)}MB (-${pct}%, saved ${savedMb}MB)`
        );
        // Non-destructive: safe to unlink original ONLY after full verification succeeds
        try { fs.unlinkSync(mediaPath); } catch {}
        return { chosenPath: transcodedPath, transcoded: true, savedBytes: origSize - newSize, pct };
      } else {
        const pct = (((origSize - newSize) / origSize) * 100).toFixed(1);
        console.log(
          `    ℹ Video transcode skipped (Size Guard): savings of ${pct}% did not meet required ${(minSavingsRatio * 100).toFixed(0)}% threshold (${(newSize / 1024 / 1024).toFixed(2)}MB vs ${(origSize / 1024 / 1024).toFixed(2)}MB). Retaining original.`
        );
        try { fs.unlinkSync(transcodedPath); } catch {}
        return { chosenPath: mediaPath, transcoded: false, reason: `Savings below ${minSavingsRatio * 100}%` };
      }
    } catch (err) {
      if (fs.existsSync(transcodedPath)) {
        try { fs.unlinkSync(transcodedPath); } catch {}
      }
      console.warn(`    ⚠️ Video transcode failed, falling back to original: ${err.message}`);
      return { chosenPath: mediaPath, transcoded: false, error: err.message };
    }
  });
}
