// Perceptual Hash (pHash) similarity scan script for X-gallery images.
// Phase 1: Incrementally backfill & persist 64-bit pHash into DB.
// Phase 2: Graph Union-Find clustering across stored pHashes.
// Phase 3: Move duplicate non-winners into pending review (published = 0).

import { computePHash } from '../src/lib/phash-sharp.ts';
import { buildDuplicateClusters } from '../src/lib/phash-utils.ts';

const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? '';
const APPLY = process.argv.includes('--apply');

function getArgValue(prefix, fallback) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return fallback;
  const val = arg.split('=')[1];
  if (!val) return fallback;
  if (val.toLowerCase() === 'all') return 0;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

const THRESHOLD = Math.min(63, Math.max(0, getArgValue('--threshold=', 10)));
const MAX_BACKFILL_IMAGES = getArgValue('--limit=', 50); // Max unhashed images to backfill per run
const REQUEST_DELAY_MS = getArgValue('--delay=', 100); // Delay between fetches

// CRAWL_API_KEY check is performed inside main() when run via CLI

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUnhashedMedia(cursor = 0, limit = 50) {
  const params = new URLSearchParams({ action: 'unhashed', cursor: String(cursor), limit: String(limit) });
  const response = await fetch(`${SITE_URL}/api/phash-scan?${params}`, {
    headers: { 'X-API-Key': CRAWL_API_KEY },
  });
  if (!response.ok) {
    throw new Error(`Fetch unhashed media failed: HTTP ${response.status} - ${await response.text()}`);
  }
  return response.json();
}

async function fetchImageBuffer(r2Key) {
  const url = `${SITE_URL}/api/r2/${encodeURIComponent(r2Key)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for key "${r2Key}"`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function saveHashesToDB(hashItems) {
  const response = await fetch(`${SITE_URL}/api/phash-scan?action=save_hashes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CRAWL_API_KEY,
    },
    body: JSON.stringify({ hashes: hashItems }),
  });
  if (!response.ok) {
    throw new Error(`Save hashes failed: HTTP ${response.status} - ${await response.text()}`);
  }
  return response.json();
}

async function fetchAllStoredHashes() {
  const response = await fetch(`${SITE_URL}/api/phash-scan?action=hashes`, {
    headers: { 'X-API-Key': CRAWL_API_KEY },
  });
  if (!response.ok) {
    throw new Error(`Fetch stored hashes failed: HTTP ${response.status} - ${await response.text()}`);
  }
  const result = await response.json();
  return result.hashes || [];
}

async function applyPendingPosts(pendingIds) {
  const response = await fetch(`${SITE_URL}/api/phash-scan?action=apply_pending`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CRAWL_API_KEY,
    },
    body: JSON.stringify({ pending_ids: pendingIds }),
  });
  if (!response.ok) {
    throw new Error(`Apply pending failed: HTTP ${response.status} - ${await response.text()}`);
  }
  return response.json();
}

export async function runBackfillLoop({
  fetchFn = fetchUnhashedMedia,
  hashFn = computePHash,
  saveFn = saveHashesToDB,
  fetchBufferFn = fetchImageBuffer,
  maxBackfill = MAX_BACKFILL_IMAGES,
  delayMs = REQUEST_DELAY_MS,
  logger = console.log,
} = {}) {
  let backfilledTotal = 0;
  let cursor = 0;
  let pageCount = 0;

  while (cursor !== null) {
    if (maxBackfill > 0 && backfilledTotal >= maxBackfill) {
      logger(`  Reached backfill limit of ${maxBackfill} images for this run.`);
      break;
    }

    pageCount++;
    const { unhashed = [], next_cursor = null } = await fetchFn(cursor, 50);

    if (unhashed.length > 0) {
      logger(`  [Page ${pageCount}] Found ${unhashed.length} unhashed image(s). Computing pHashes...`);
      const newHashes = [];

      for (const item of unhashed) {
        if (maxBackfill > 0 && backfilledTotal >= maxBackfill) break;

        try {
          if (delayMs > 0 && backfilledTotal > 0) {
            await sleep(delayMs);
          }
          const buffer = await fetchBufferFn(item.r2_key);
          const hashHex = await hashFn(buffer);
          newHashes.push({
            image_id: item.image_id,
            r2_key: item.r2_key,
            phash: hashHex,
          });
          backfilledTotal++;
        } catch (err) {
          logger(`  [Warning] Failed to hash "${item.r2_key}" (Image #${item.image_id}): ${err.message}`);
        }
      }

      if (newHashes.length > 0) {
        await saveFn(newHashes);
        logger(`  Persisted ${newHashes.length} pHash(es) to D1 database.`);
      }
    } else {
      logger(`  [Page ${pageCount}] 0 unhashed images on this page. Next cursor: ${next_cursor}`);
    }

    cursor = next_cursor;
  }

  return backfilledTotal;
}

async function main() {
  if (!CRAWL_API_KEY) {
    console.error('ERROR: CRAWL_API_KEY environment variable is not configured.');
    process.exit(1);
  }

  console.log('=== Persistent pHash Image Similarity Scan ===');
  console.log(`SITE_URL    : ${SITE_URL}`);
  console.log(`Mode        : ${APPLY ? 'APPLY (move duplicates to pending)' : 'DRY-RUN'}`);
  console.log(`Threshold   : ${THRESHOLD} bits (Hamming Distance <= ${THRESHOLD})`);
  console.log(`Max Backfill: ${MAX_BACKFILL_IMAGES > 0 ? MAX_BACKFILL_IMAGES + ' images/run' : 'Unlimited'}`);
  console.log(`Fetch Delay : ${REQUEST_DELAY_MS} ms`);

  // --- Phase 1: Incremental Backfill of Missing pHashes ---
  console.log('\n[Phase 1] Checking unhashed media assets across all pages...');
  const backfilledTotal = await runBackfillLoop();
  console.log(`[Phase 1 Complete] Backfilled ${backfilledTotal} image(s) in this run.`);

  // --- Phase 2: Cluster Comparison & Canonical Winner Selection ---
  console.log('\n[Phase 2] Fetching stored pHash corpus for similarity clustering...');
  const storedHashes = await fetchAllStoredHashes();
  console.log(`  Loaded ${storedHashes.length} stored pHash(es) from DB.`);

  if (storedHashes.length === 0) {
    console.log('No hashed images available for comparison. Exiting.');
    return;
  }

  const items = storedHashes.map((r) => ({
    imageId: r.image_id,
    r2Key: r.r2_key,
    phash: r.phash,
    likes: r.likes || 0,
    title: r.title,
    createdAt: r.created_at,
  }));

  console.log(`  Running Union-Find clustering across ${items.length} images (Threshold: ${THRESHOLD} bits)...`);
  const { keeperIds, pendingIds, matches, totalMatchPairsCount } = buildDuplicateClusters(items, THRESHOLD);

  console.log(`\nFound ${totalMatchPairsCount} high-similarity image pair match(es) across ${items.length} assets.`);
  console.log(`Unique duplicate posts flagged for pending review: ${pendingIds.length}`);

  if (matches.length > 0) {
    console.log('\nSample Pair-level Candidate Matches (up to 10):');
    for (const m of matches.slice(0, 10)) {
      console.log(`  Distance ${m.distance} (${m.similarity}): Preferred Candidate Post #${m.preferredPostId} ("${m.preferredTitle || 'Untitled'}"), Compare Candidate Post #${m.candidatePostId} ("${m.candidateTitle || 'Untitled'}")`);
    }
  }

  if (pendingIds.length === 0) {
    console.log('\nNo duplicate clusters found. Gallery is clean!');
    return;
  }

  // --- Phase 3: Apply pending status in batches ---
  if (!APPLY) {
    console.log(`\nDry-run complete. Found ${pendingIds.length} duplicate post(s) (IDs: ${pendingIds.join(', ')}).`);
    console.log('Re-run with --apply to move these posts to pending review.');
    return;
  }

  console.log(`\n[Phase 3] Applying changes: Moving ${pendingIds.length} post(s) to pending review...`);
  const result = await applyPendingPosts(pendingIds);
  console.log(`Successfully updated ${result.updated_count} post(s) to pending review!`);
}

// Only execute main when invoked directly via node CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error during pHash scan:', error);
    process.exit(1);
  });
}
