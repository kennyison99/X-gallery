// Find and optionally repair duplicate cards and duplicate files within cards.
// Every candidate is verified by R2 etag before deletion.

const SITE_URL = (process.env.SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? "";
const APPLY = process.argv.includes("--apply");
const SCOPES = ["cards", "media"];
const PAGE_SIZE = 40;
const BATCH_SIZE = 20;

if (!CRAWL_API_KEY) {
  console.error("ERROR: CRAWL_API_KEY environment variable is not configured.");
  process.exit(1);
}

async function scanScope(scope) {
  const duplicates = [];
  let cursor = 0;
  let page = 0;

  do {
    const params = new URLSearchParams({ scope, cursor: String(cursor), limit: String(PAGE_SIZE) });
    // Keep query auth for deployments still running the legacy endpoint; the header is the preferred path.
    params.set("api_key", CRAWL_API_KEY);
    const response = await fetch(`${SITE_URL}/api/dedup-scan?${params}`, {
      headers: { "X-API-Key": CRAWL_API_KEY },
    });
    if (!response.ok) {
      throw new Error(`${scope} scan failed: HTTP ${response.status} - ${await response.text()}`);
    }
    const result = await response.json();
    if (!Array.isArray(result.duplicates) || !Object.prototype.hasOwnProperty.call(result, "next_cursor")) {
      throw new Error("dedup API is outdated; deploy the latest main branch before running this action");
    }
    duplicates.push(...result.duplicates);
    cursor = result.next_cursor;
    page++;
    console.log(`  ${scope}: page ${page}, +${result.count} duplicate group(s)`);
  } while (cursor !== null);

  return duplicates;
}

function printFix(fix) {
  if (fix.kind === "card") {
    console.log(`  Card ${fix.post_url}: keep #${fix.keep_id}, delete #${fix.delete_ids.join(", #")}`);
  } else {
    console.log(`  Image #${fix.image_id}: keep "${fix.keep_key}", delete ${fix.delete_keys.map((key) => `"${key}"`).join(", ")}`);
  }
  console.log(`    Recoverable: ${(fix.freed_bytes / 1024).toFixed(1)} KB`);
}

async function applyFixes(fixes) {
  const totals = { fixed: 0, deletedCards: 0, deletedObjects: 0, freedBytes: 0 };
  for (let i = 0; i < fixes.length; i += BATCH_SIZE) {
    const batch = fixes.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(fixes.length / BATCH_SIZE);
    console.log(`  Batch ${batchNumber}/${totalBatches} (${batch.length} fixes)...`);

    const response = await fetch(`${SITE_URL}/api/dedup-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: CRAWL_API_KEY, fixes: batch }),
    });
    if (!response.ok) {
      throw new Error(`Apply batch ${batchNumber} failed: HTTP ${response.status} - ${await response.text()}`);
    }
    const result = await response.json();
    totals.fixed += result.fixed;
    totals.deletedCards += result.deleted_cards;
    totals.deletedObjects += result.deleted_objects;
    totals.freedBytes += result.freed_bytes;
  }
  return totals;
}

async function main() {
  console.log("=== Duplicate Card / Media Scan ===");
  console.log(`SITE_URL : ${SITE_URL}`);
  console.log(`Mode     : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("Scanning in bounded pages...");

  const duplicates = [];
  for (const scope of SCOPES) duplicates.push(...await scanScope(scope));

  if (duplicates.length === 0) {
    console.log("No duplicates found. All clean!");
    return;
  }

  console.log(`Found ${duplicates.length} verified duplicate group(s):`);
  for (const fix of duplicates) printFix(fix);
  const recoverable = duplicates.reduce((sum, fix) => sum + fix.freed_bytes, 0);
  console.log(`Total recoverable: ${(recoverable / 1024 / 1024).toFixed(2)} MB`);

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply to remove these duplicates.");
    return;
  }

  console.log(`Applying in batches of ${BATCH_SIZE}...`);
  const totals = await applyFixes(duplicates);
  console.log(`Done: fixed ${totals.fixed} group(s), deleted ${totals.deletedCards} card(s) and ${totals.deletedObjects} R2 object(s).`);
  console.log(`Freed ${(totals.freedBytes / 1024 / 1024).toFixed(2)} MB.`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
