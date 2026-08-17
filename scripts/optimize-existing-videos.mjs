import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { transcodeVideoFile, ConcurrencyLimiter } from './video-transcoder.mjs';

const execAsync = promisify(exec);

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '42262e62f0ff1107d0eb78d92a94d873';
const R2_BUCKET = 'gallery-images';
const D1_DB = 'gallery-db';
const CACHE_DIR = path.resolve('.cache');
const PROGRESS_FILE = path.join(CACHE_DIR, 'video-optimize-progress.json');
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

const isVideoKey = (key) => VIDEO_EXTS.has(path.extname(key.toLowerCase()));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    limit: 0,
    concurrency: 2,
    minSizeMb: args.includes('--all') ? 0 : 5, // Default skip videos < 5 MB unless --all or specified
    force: args.includes('--force'),
  };

  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    options.limit = parseInt(args[limitIdx + 1], 10) || 0;
  }

  const concIdx = args.indexOf('--concurrency');
  if (concIdx !== -1 && args[concIdx + 1]) {
    options.concurrency = parseInt(args[concIdx + 1], 10) || 2;
  }

  const minSizeIdx = args.indexOf('--min-size');
  if (minSizeIdx !== -1 && args[minSizeIdx + 1]) {
    options.minSizeMb = parseFloat(args[minSizeIdx + 1]) || 0;
  }

  return options;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1000; // Cloudflare decimal standard
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

async function runWranglerCmd(cmd) {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID };
  const { stdout, stderr } = await execAsync(`npx ${cmd}`, { env, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

// ---------------------------------------------------------------------------
// Cloudflare Operations
// ---------------------------------------------------------------------------

async function fetchVideoRecordsFromD1() {
  console.log('Fetching video records from remote D1 database...');
  const sql = `
    SELECT id, author, author_display_name, r2_keys, video_count, video_bytes, photo_bytes
    FROM images
    WHERE video_count > 0 OR r2_keys LIKE '%.mp4%' OR r2_keys LIKE '%.webm%' OR r2_keys LIKE '%.mov%'
    ORDER BY video_bytes DESC;
  `;
  const out = await runWranglerCmd(`wrangler d1 execute ${D1_DB} --remote --command="${sql.replace(/"/g, '\\"')}" --json`);
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

async function downloadR2Object(key, destPath) {
  await runWranglerCmd(`wrangler r2 object get ${R2_BUCKET}/${key} --file "${destPath}" --remote`);
}

async function uploadR2Object(key, srcPath) {
  await runWranglerCmd(`wrangler r2 object put ${R2_BUCKET}/${key} --file "${srcPath}" --content-type video/mp4 --remote`);
}

async function updateD1VideoBytes(imageId, newVideoBytes) {
  const sql = `UPDATE images SET video_bytes = ${newVideoBytes} WHERE id = ${imageId};`;
  await runWranglerCmd(`wrangler d1 execute ${D1_DB} --remote --command="${sql.replace(/"/g, '\\"')}"`);
}

async function reconcileD1StorageStats() {
  console.log('\nReconciling remote D1 storage stats...');
  const sql = `
    UPDATE storage_stats 
    SET total_bytes = (SELECT COALESCE(SUM(photo_bytes + video_bytes), 0) FROM images),
        directory_version = directory_version + 1,
        updated_at = datetime('now')
    WHERE id = 1;
  `;
  await runWranglerCmd(`wrangler d1 execute ${D1_DB} --remote --command="${sql.replace(/"/g, '\\"')}"`);
  console.log('✓ D1 storage_stats successfully reconciled.');
}

// ---------------------------------------------------------------------------
// Main Processing Flow
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs();
  console.log('=== Batch Video Optimization Tool ===');
  console.log(`Mode        : ${options.dryRun ? 'DRY-RUN (Preview Only)' : 'PRODUCTION (Upload & Modify D1)'}`);
  console.log(`Concurrency : ${options.concurrency}`);
  if (options.limit) console.log(`Limit       : ${options.limit} videos`);
  if (options.minSizeMb) console.log(`Min Size    : ${options.minSizeMb} MB`);
  console.log();

  const progress = options.force ? {} : loadProgress();
  const allRows = await fetchVideoRecordsFromD1();
  console.log(`Found ${allRows.length} video post records in D1.\n`);

  // Extract individual video tasks
  const tasks = [];
  for (const row of allRows) {
    const keys = (row.r2_keys || '').split(',').map((k) => k.trim()).filter(Boolean);
    const videoKeys = keys.filter(isVideoKey);
    for (const vKey of videoKeys) {
      tasks.push({
        imageId: row.id,
        author: row.author,
        authorName: row.author_display_name || row.author,
        r2Key: vKey,
        rowVideoBytes: row.video_bytes || 0,
      });
    }
  }

  // Filter tasks based on options
  let filteredTasks = tasks.filter((t) => {
    if (options.minSizeMb > 0 && t.rowVideoBytes < options.minSizeMb * 1000 * 1000) {
      return false;
    }
    return true;
  });

  if (options.limit > 0) {
    filteredTasks = filteredTasks.slice(0, options.limit);
  }

  console.log(`Total video items to process: ${filteredTasks.length}\n`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-video-opt-'));
  const limiter = new ConcurrencyLimiter(options.concurrency);

  let processedCount = 0;
  let transcodedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalOrigBytes = 0;
  let totalNewBytes = 0;
  let totalSavedBytes = 0;

  const resultsSummary = [];

  try {
    for (let i = 0; i < filteredTasks.length; i++) {
      const task = filteredTasks[i];
      const progressKey = task.r2Key;

      if (!options.force && progress[progressKey] && progress[progressKey].status !== 'failed') {
        const prev = progress[progressKey];
        processedCount++;
        if (prev.status === 'transcoded') {
          transcodedCount++;
          totalOrigBytes += prev.origBytes || 0;
          totalNewBytes += prev.newBytes || 0;
          totalSavedBytes += prev.savedBytes || 0;
        } else {
          skippedCount++;
        }
        console.log(`[${i + 1}/${filteredTasks.length}] [CACHE] ${task.r2Key} already processed (${prev.status}). Skipping.`);
        continue;
      }

      console.log(`\n[${i + 1}/${filteredTasks.length}] Processing @${task.author}: ${task.r2Key} (~${formatBytes(task.rowVideoBytes)})...`);

      const localDownloadPath = path.join(tempRoot, task.r2Key);
      let transcodeResult = null;

      try {
        // 1. Download from R2
        process.stdout.write('  ↓ Downloading from R2... ');
        await downloadR2Object(task.r2Key, localDownloadPath);
        const actualOrigSize = fs.statSync(localDownloadPath).size;
        console.log(`Done (${formatBytes(actualOrigSize)})`);

        // 2. Transcode with Size Guard & Validation
        console.log('  ⚙ Transcoding with H.264 CRF 22 + VBV Cap + Faststart...');
        transcodeResult = await transcodeVideoFile(localDownloadPath, {
          limiter,
          minSavingsRatio: 0.15,
        });

        if (transcodeResult.transcoded) {
          const newSize = fs.statSync(transcodeResult.chosenPath).size;
          const savedBytes = actualOrigSize - newSize;
          const pct = (((actualOrigSize - newSize) / actualOrigSize) * 100).toFixed(1);

          console.log(`  ✓ Accepted Size Guard: ${formatBytes(actualOrigSize)} -> ${formatBytes(newSize)} (-${pct}%, saved ${formatBytes(savedBytes)})`);

          if (!options.dryRun) {
            // 3. Upload replacement to R2
            process.stdout.write('  ↑ Uploading optimized MP4 to R2... ');
            await uploadR2Object(task.r2Key, transcodeResult.chosenPath);
            console.log('Done.');

            // 4. Update D1 database video_bytes
            process.stdout.write('  📝 Updating D1 database record... ');
            await updateD1VideoBytes(task.imageId, newSize);
            console.log('Done.');
          } else {
            console.log('  [DRY-RUN] Skipped R2 upload and D1 update.');
          }

          progress[progressKey] = {
            status: 'transcoded',
            imageId: task.imageId,
            author: task.author,
            origBytes: actualOrigSize,
            newBytes: newSize,
            savedBytes,
            pct,
            timestamp: new Date().toISOString(),
          };

          transcodedCount++;
          totalOrigBytes += actualOrigSize;
          totalNewBytes += newSize;
          totalSavedBytes += savedBytes;

          resultsSummary.push({
            author: task.author,
            key: task.r2Key,
            orig: actualOrigSize,
            new: newSize,
            saved: savedBytes,
            pct: `${pct}%`,
            status: 'Transcoded',
          });
        } else {
          console.log(`  ℹ Retaining original: ${transcodeResult.reason || 'Skipped'}`);
          progress[progressKey] = {
            status: 'skipped',
            imageId: task.imageId,
            author: task.author,
            reason: transcodeResult.reason || 'Skipped',
            timestamp: new Date().toISOString(),
          };
          skippedCount++;
          resultsSummary.push({
            author: task.author,
            key: task.r2Key,
            orig: actualOrigSize,
            new: actualOrigSize,
            saved: 0,
            pct: '0.0%',
            status: 'Skipped (<15% savings)',
          });
        }
      } catch (err) {
        console.error(`  ✗ Error processing ${task.r2Key}: ${err.message}`);
        progress[progressKey] = {
          status: 'failed',
          error: err.message,
          timestamp: new Date().toISOString(),
        };
        failedCount++;
      } finally {
        // Clean up temp downloaded/transcoded files
        try { if (fs.existsSync(localDownloadPath)) fs.unlinkSync(localDownloadPath); } catch {}
        if (transcodeResult?.chosenPath && fs.existsSync(transcodeResult.chosenPath)) {
          try { fs.unlinkSync(transcodeResult.chosenPath); } catch {}
        }
      }

      processedCount++;
      saveProgress(progress);
    }

    if (!options.dryRun && transcodedCount > 0) {
      await reconcileD1StorageStats();
    }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n=============================================');
  console.log('       BATCH OPTIMIZATION SUMMARY');
  console.log('=============================================');
  console.log(`Total Videos Processed : ${processedCount}`);
  console.log(`Successfully Optimized : ${transcodedCount}`);
  console.log(`Skipped (Kept Original): ${skippedCount}`);
  console.log(`Failed                 : ${failedCount}`);
  console.log('---------------------------------------------');
  console.log(`Original Total Space   : ${formatBytes(totalOrigBytes)}`);
  console.log(`Optimized Total Space  : ${formatBytes(totalNewBytes)}`);
  console.log(`Total Space Saved      : ${formatBytes(totalSavedBytes)} (${totalOrigBytes > 0 ? ((totalSavedBytes / totalOrigBytes) * 100).toFixed(1) : 0}%)`);
  console.log('=============================================\n');
}

main().catch((err) => {
  console.error('Fatal error in video optimization script:', err);
  process.exit(1);
});
