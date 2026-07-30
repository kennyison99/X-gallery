// Perceptual Hash (pHash) similarity scan script for X-gallery images.
// Phase 1: Incrementally backfill & persist 64-bit pHash into DB with multi-worker concurrency.
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
const CONCURRENCY = Math.min(16, Math.max(1, getArgValue('--concurrency=', parseInt(process.env.CONCURRENCY || '12', 10))));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapConcurrent(items, limit, fn) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
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

async function fetchImageBuffer(r2Key, retries = 2) {
  const url = `${SITE_URL}/api/r2/${encodeURIComponent(r2Key)}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for key "${r2Key}"`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
      } else {
        throw err;
      }
    }
  }
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
  concurrency = CONCURRENCY,
  logger = console.log,
} = {}) {
  const clampedConcurrency = Math.min(16, Math.max(1, concurrency));
  let successfulTotal = 0;
  let cursor = 0;
  let pageCount = 0;

  while (cursor !== null) {
    if (maxBackfill > 0 && successfulTotal >= maxBackfill) {
      logger(`  Reached backfill limit of ${maxBackfill} successful hashes for this run.`);
      break;
    }

    pageCount++;
    const { unhashed = [], next_cursor = null } = await fetchFn(cursor, 50);

    if (unhashed.length > 0) {
      logger(`  [Page ${pageCount}] Found ${unhashed.length} unhashed image(s). Computing pHashes (Concurrency: ${clampedConcurrency})...`);

      const itemsToProcess = [];
      for (const item of unhashed) {
        if (maxBackfill > 0 && (successfulTotal + itemsToProcess.length) >= maxBackfill) {
          break;
        }
        itemsToProcess.push(item);
      }

      const poolResults = await mapConcurrent(itemsToProcess, clampedConcurrency, async (item) => {
        try {
          const buffer = await fetchBufferFn(item.r2_key);
          const hashHex = await hashFn(buffer);
          return {
            image_id: item.image_id,
            r2_key: item.r2_key,
            phash: hashHex,
          };
        } catch (err) {
          logger(`  [Warning] Failed to hash "${item.r2_key}" (Image #${item.image_id}): ${err.message}`);
          return null;
        }
      });

      const newHashes = poolResults.filter(Boolean);

      if (newHashes.length > 0) {
        await saveFn(newHashes);
        successfulTotal += newHashes.length;
        logger(`  Persisted ${newHashes.length} pHash(es) to D1 database. Total saved this run: ${successfulTotal}/${maxBackfill > 0 ? maxBackfill : 'Unlimited'}`);
      }
    } else {
      logger(`  [Page ${pageCount}] 0 unhashed images on this page. Next cursor: ${next_cursor}`);
    }

    cursor = next_cursor;
  }

  return successfulTotal;
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
  console.log(`Concurrency : ${CONCURRENCY} parallel workers`);

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
