// Scan for and repair duplicate R2 objects within image records.
// Uses R2 etag (MD5) to detect identical content, then deletes duplicates
// and updates D1 r2_keys so each card only shows unique files.
//
// Usage:
//   node scripts/dedup-media.mjs           # dry-run: scan only, report duplicates
//   node scripts/dedup-media.mjs --apply   # apply fixes: delete dup R2 + update D1

const SITE_URL = (process.env.SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? "";

if (!CRAWL_API_KEY) {
  console.error("ERROR: CRAWL_API_KEY environment variable is not configured.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log("=== Duplicate Media Scan (R2 etag / MD5) ===");
  console.log(`SITE_URL : ${SITE_URL}`);
  console.log(`Mode     : ${APPLY ? "APPLY (will delete duplicates)" : "DRY-RUN (scan only)"}`);
  console.log();

  // 1. Scan
  console.log("Scanning all multi-key records for duplicate R2 objects...");
  const scanRes = await fetch(`${SITE_URL}/api/dedup-scan?api_key=${encodeURIComponent(CRAWL_API_KEY)}`);
  if (!scanRes.ok) {
    const text = await scanRes.text();
    throw new Error(`Scan failed: HTTP ${scanRes.status} - ${text}`);
  }
  const { duplicates, count } = await scanRes.json();

  if (count === 0) {
    console.log("No duplicates found. All clean!");
    return;
  }

  console.log(`Found ${count} duplicate group(s) across ${new Set(duplicates.map(d => d.image_id)).size} record(s):\n`);

  let totalFreed = 0;
  for (const dup of duplicates) {
    const freedKb = (dup.size / 1024).toFixed(1);
    totalFreed += dup.size * dup.delete_keys.length;
    console.log(`  Image #${dup.image_id}: keep "${dup.keep_key}"`);
    for (const dk of dup.delete_keys) {
      console.log(`    └─ delete "${dk}" (etag=${dup.etag.slice(0, 16)}..., ${dup.size} bytes)`);
    }
    console.log(`    Freed if applied: ${(dup.size * dup.delete_keys.length / 1024).toFixed(1)} KB`);
  }

  console.log(`\nTotal space recoverable: ${(totalFreed / 1024 / 1024).toFixed(2)} MB`);

  if (!APPLY) {
    console.log("\nDry-run complete. To apply fixes, re-run with --apply:");
    console.log("  node scripts/dedup-media.mjs --apply");
    return;
  }

  // 2. Apply fixes in batches to stay under Cloudflare Workers' 1000
  //    subrequest limit (each fix ~6 subrequests: D1 select + R2 head +
  //    R2 delete + D1 update). Batches of 50 = ~300 subrequests, safe margin.
  const BATCH_SIZE = 50;
  let totalDeleted = 0;
  let totalFreedBytes = 0;
  const allFixedIds = [];

  console.log(`\nApplying fixes in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < duplicates.length; i += BATCH_SIZE) {
    const batch = duplicates.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(duplicates.length / BATCH_SIZE);
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} fixes)...`);

    const fixRes = await fetch(`${SITE_URL}/api/dedup-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: CRAWL_API_KEY, fixes: batch }),
    });
    if (!fixRes.ok) {
      const text = await fixRes.text();
      throw new Error(`Fix failed on batch ${batchNum}: HTTP ${fixRes.status} - ${text}`);
    }
    const result = await fixRes.json();
    totalDeleted += result.count;
    totalFreedBytes += result.freed_bytes;
    if (result.fixed_ids) allFixedIds.push(...result.fixed_ids);
  }

  console.log(`\nDone! Deleted ${totalDeleted} duplicate R2 object(s) from ${allFixedIds.length} record(s).`);
  console.log(`Freed ${(totalFreedBytes / 1024 / 1024).toFixed(2)} MB of R2 storage.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
