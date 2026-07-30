// Node CLI script orchestrating paginated media counts backfill via /api/admin/media-count-backfill

const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postBatch(cursor, limit = 100, retries = 3) {
  const url = `${SITE_URL}/api/admin/media-count-backfill`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CRAWL_API_KEY,
        },
        body: JSON.stringify({ cursor, limit }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${await response.text()}`);
      }
      return await response.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  [Retry ${attempt + 1}/${retries}] Backfill request error: ${err.message}`);
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}

async function runBackfill() {
  console.log('=== D1 Media Counts Paginated Backfill ===');
  console.log(`SITE_URL: ${SITE_URL}`);

  let cursor = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let batchCount = 0;

  while (cursor !== null) {
    batchCount++;
    const res = await postBatch(cursor, 100);
    totalUpdated += res.updated ?? 0;
    totalSkipped += res.skipped ?? 0;

    console.log(
      `  [Batch ${batchCount}] Scanned: ${res.scanned}, Updated: ${res.updated}, Skipped: ${res.skipped}, Remaining: ${res.remaining}, Next Cursor: ${res.next_cursor}`
    );

    if (res.media_counts_ready) {
      console.log('✨ All records backfilled! Set media_counts_ready = 1 in storage_stats.');
      break;
    }

    if (res.next_cursor === null || res.scanned === 0) {
      break;
    }

    cursor = res.next_cursor;
  }

  console.log(`=== Backfill Complete. Updated: ${totalUpdated}, Skipped: ${totalSkipped} ===`);
}

if (process.argv[1]?.endsWith('backfill-media-counts.mjs')) {
  runBackfill().catch((err) => {
    console.error('Fatal backfill error:', err);
    process.exit(1);
  });
}
