import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration from environment variables
// ---------------------------------------------------------------------------

const TWITTER_COOKIES = process.env.TWITTER_COOKIES ?? "";
const SITE_URL = (process.env.SITE_URL ?? "http://localhost:4321").replace(
  /\/$/,
  "",
);
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? "";

// Path to the gallery-dl archive database (prevents re-downloading)
const ARCHIVE_PATH = path.resolve("scripts/.gallery-dl-archive.db");

// Allowed image extensions when scanning downloaded files
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a cookie string like "auth_token=abc123; ct0=def456" into an object.
 */
function parseCookieString(cookieStr) {
  const cookies = {};
  for (const part of cookieStr.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

/**
 * Write a Netscape-format cookies.txt file that gallery-dl can consume.
 */
function writeCookiesFile(filePath, cookies) {
  const lines = [
    "# Netscape HTTP Cookie File",
    `.x.com\tTRUE\t/\tTRUE\t0\tauth_token\t${cookies.auth_token ?? ""}`,
    `.x.com\tTRUE\t/\tTRUE\t0\tct0\t${cookies.ct0 ?? ""}`,
  ];
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Recursively collect all image files under `dir`.
 */
function collectImageFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectImageFiles(full));
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Upload a single image file to the crawl-upload API endpoint.
 */
async function uploadImage(filePath, username) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);
  formData.append("author", username);
  formData.append("author_url", `https://x.com/${username}`);
  formData.append("api_key", CRAWL_API_KEY);

  const res = await fetch(`${SITE_URL}/api/crawl-upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} – ${text}`);
  }

  return res;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Twitter Image Crawl ===");
  console.log(`Site URL : ${SITE_URL}`);
  console.log(`Archive  : ${ARCHIVE_PATH}`);
  console.log();

  // --- Validate required env vars ----------------------------------------

  if (!TWITTER_COOKIES) {
    console.error("ERROR: TWITTER_COOKIES is not set.");
    process.exit(1);
  }
  if (!CRAWL_API_KEY) {
    console.error("ERROR: CRAWL_API_KEY is not set.");
    process.exit(1);
  }

  // --- Fetch the list of accounts to crawl -------------------------------

  console.log("Fetching account list…");
  const accountsRes = await fetch(`${SITE_URL}/api/crawl-accounts`);
  if (!accountsRes.ok) {
    console.error(
      `ERROR: Failed to fetch accounts – HTTP ${accountsRes.status}`,
    );
    process.exit(1);
  }

  const { accounts } = await accountsRes.json();
  const enabledAccounts = accounts.filter((a) => a.enabled);
  console.log(
    `Found ${accounts.length} account(s), ${enabledAccounts.length} enabled.\n`,
  );

  if (enabledAccounts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // --- Prepare cookies file ----------------------------------------------

  const cookies = parseCookieString(TWITTER_COOKIES);
  const cookiesDir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-cookies-"));
  const cookiesFilePath = path.join(cookiesDir, "cookies.txt");
  writeCookiesFile(cookiesFilePath, cookies);

  // --- Process each account ----------------------------------------------

  let totalAccountsProcessed = 0;
  let totalImagesDownloaded = 0;
  let totalImagesUploaded = 0;

  for (const account of enabledAccounts) {
    const { username } = account;
    console.log(`--- @${username} ---`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `tw-${username}-`));

    try {
      // Run gallery-dl to download images
      const cmd = [
        "gallery-dl",
        `--cookies "${cookiesFilePath}"`,
        `--directory "${tempDir}"`,
        `--filter "extension in ('jpg', 'jpeg', 'png', 'webp')"`,
        "--range 1-20",
        `--download-archive "${ARCHIVE_PATH}"`,
        `"https://x.com/${username}/media"`,
      ].join(" ");

      console.log(`Running: ${cmd}`);
      try {
        execSync(cmd, { stdio: "inherit", timeout: 5 * 60 * 1000 });
      } catch (dlError) {
        // gallery-dl may exit non-zero even when some images were downloaded
        console.warn(
          `WARNING: gallery-dl exited with an error for @${username}: ${dlError.message}`,
        );
      }

      // Collect downloaded images
      const images = collectImageFiles(tempDir);
      console.log(`Downloaded ${images.length} image(s).`);
      totalImagesDownloaded += images.length;

      // Upload each image
      for (const imgPath of images) {
        try {
          await uploadImage(imgPath, username);
          totalImagesUploaded++;
          console.log(`  ✓ Uploaded: ${path.basename(imgPath)}`);
        } catch (uploadErr) {
          console.error(
            `  ✗ Upload failed (${path.basename(imgPath)}): ${uploadErr.message}`,
          );
        }
      }

      totalAccountsProcessed++;
    } catch (err) {
      console.error(`ERROR processing @${username}: ${err.message}`);
    } finally {
      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log();
  }

  // Clean up cookies temp directory
  fs.rmSync(cookiesDir, { recursive: true, force: true });

  // --- Summary -----------------------------------------------------------

  console.log("=== Summary ===");
  console.log(`Accounts processed : ${totalAccountsProcessed}`);
  console.log(`Images downloaded  : ${totalImagesDownloaded}`);
  console.log(`Images uploaded    : ${totalImagesUploaded}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
