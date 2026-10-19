// CLI script orchestrating batch migration of root R2 objects to account folders
// Usage: node scripts/migrate-r2-folders.mjs [--dry-run | --live]

const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? '';

const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--live');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postBatch(cursor, limit = 20, retries = 3) {
  const url = `${SITE_URL}/admin/api/migrate-folders`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CRAWL_API_KEY,
        },
        body: JSON.stringify({ cursor, limit, dryRun: isDryRun }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${await response.text()}`);
      }
      return await response.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  [Retry ${attempt + 1}/${retries}] Request error: ${err.message}`);
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}

async function runMigration() {
  console.log('======================================================================');
  console.log(`📦 R2 Root Objects -> Account Folders Migration`);
  console.log(`SITE_URL: ${SITE_URL}`);
  console.log(`MODE    : ${isDryRun ? '🔍 DRY-RUN (Preview changes only; no R2/D1 mutation)' : '🚀 LIVE (Moving objects and updating D1)'}`);
  if (isDryRun) {
    console.log(`TIP     : Pass --live to perform actual moves.`);
  }
  console.log('======================================================================\n');

  let cursor = 0;
  let batchCount = 0;
  let totalProcessed = 0;
  let totalMigratedPosts = 0;
  let totalMigratedKeys = 0;

  while (cursor !== null) {
    batchCount++;
    const res = await postBatch(cursor, 20);

    totalProcessed += res.processed ?? 0;
    totalMigratedPosts += res.migratedPosts ?? 0;
    totalMigratedKeys += res.migratedKeys ?? 0;

    console.log(
      `[Batch ${batchCount}] Scanned: ${res.processed} posts | Migrated in batch: ${res.migratedPosts} posts (${res.migratedKeys} keys) | Next Cursor: ${res.nextCursor}`
    );

    if (res.details && res.details.length > 0) {
      for (const d of res.details) {
        console.log(`  • #${d.id} @${d.author}: "${d.from}" -> "${d.to}"`);
      }
    }

    if (res.done || res.processed === 0) {
      break;
    }

    cursor = res.nextCursor;
    await sleep(200);
  }

  console.log('\n======================================================================');
  console.log(`🎉 Migration Finished!`);
  console.log(`Total Posts Scanned : ${totalProcessed}`);
  console.log(`Total Posts Migrated: ${totalMigratedPosts}`);
  console.log(`Total Keys Moved    : ${totalMigratedKeys}`);
  console.log(`Mode                : ${isDryRun ? 'DRY-RUN (Run with --live to apply)' : 'LIVE (Changes applied successfully)'}`);
  console.log('======================================================================\n');
}

runMigration().catch((err) => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
