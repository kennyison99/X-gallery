import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec, execSync, spawn } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
 * Upload a group of image files (belonging to the same post) to the crawl-upload API.
 */
async function uploadImageGroup(filePaths, username, postUrl, description, createdAt) {
  const formData = new FormData();
  formData.append("author", username);
  formData.append("author_url", `https://x.com/${username}`);
  formData.append("api_key", CRAWL_API_KEY);
  if (postUrl) {
    formData.append("post_url", postUrl);
  }
  if (description) {
    formData.append("description", description);
  }
  if (createdAt) {
    formData.append("created_at", createdAt);
  }

  for (const filePath of filePaths) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    formData.append("file", new Blob([fileBuffer]), fileName);
  }

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

/**
 * Runs gallery-dl and parses stdout line-by-line to count downloads.
 */
function runGalleryDlQuietly(cmdString, tempDir, onProgress) {
  return new Promise((resolve, reject) => {
    // Run via shell to support arguments quoting on Windows/Linux
    const child = spawn(cmdString, { shell: true });
    
    let downloadedCount = 0;
    let buffer = "";
    
    const normalizedTempDir = tempDir.replace(/\\/g, "/");

    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        const normalizedLine = line.replace(/\\/g, "/");
        if (normalizedLine.includes(normalizedTempDir) && (normalizedLine.endsWith(".jpg") || normalizedLine.endsWith(".jpeg") || normalizedLine.endsWith(".png") || normalizedLine.endsWith(".webp"))) {
          downloadedCount++;
          onProgress(downloadedCount);
        }
      }
    });

    child.on("close", (code) => {
      if (buffer) {
        const normalizedLine = buffer.replace(/\\/g, "/");
        if (normalizedLine.includes(normalizedTempDir) && (normalizedLine.endsWith(".jpg") || normalizedLine.endsWith(".jpeg") || normalizedLine.endsWith(".png") || normalizedLine.endsWith(".webp"))) {
          downloadedCount++;
          onProgress(downloadedCount);
        }
      }
      resolve(downloadedCount);
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Renders a milestone progress update in the terminal to avoid log spamming in GitHub Actions.
 * Only outputs on ~10% milestones, first item, and completion.
 */
function renderProgressLine(label, current, total) {
  if (total <= 0) return;
  const step = Math.max(1, Math.floor(total / 10));
  const isMilestone = current === 1 || current === total || (current % step === 0);
  
  if (isMilestone) {
    const percentage = Math.round((current / total) * 100);
    const barWidth = 20;
    const filledWidth = Math.round((current / total) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const bar = "█".repeat(filledWidth) + "░".repeat(emptyWidth);
    
    console.log(`  ${label}: [${bar}] ${percentage}% (${current}/${total})`);
  }
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
    totalAccountsProcessed++;
    const { username } = account;
    console.log(`======================================================================`);
    console.log(`[Account ${totalAccountsProcessed}/${enabledAccounts.length}] @${username}`);
    console.log(`======================================================================`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `tw-${username}-`));

    try {
      // Run gallery-dl to download images
      const isCrawlAll = process.argv.includes("--all") || account.crawl_all === 1 || account.crawl_all === "1" || account.crawl_all === true;
      const rangeParam = isCrawlAll ? "" : "--range 1-20";

      const cmd = [
        "gallery-dl",
        `--cookies "${cookiesFilePath}"`,
        `--directory "${tempDir}"`,
        `--filter "extension in ('jpg', 'jpeg', 'png', 'webp')"`,
        rangeParam,
        "--write-metadata",
        "--sleep 2.5",
        "--sleep-request 1.5",
        `--download-archive "${ARCHIVE_PATH}"`,
        `"https://x.com/${username}/media"`,
      ].filter(Boolean).join(" ");

      console.log(`Running gallery-dl...`);
      let downloadCount = 0;
      try {
        await runGalleryDlQuietly(cmd, tempDir, (count) => {
          downloadCount = count;
          // Print download progress every 20 images to avoid log spamming
          if (downloadCount % 20 === 0 || downloadCount === 1) {
            console.log(`  Downloading: ${downloadCount} images downloaded so far...`);
          }
        });
      } catch (dlError) {
        // gallery-dl may exit non-zero even when some images were downloaded
        console.warn(
          `WARNING: gallery-dl exited with an error for @${username}: ${dlError.message}`,
        );
      }

      // Collect raw downloaded files
      const rawFiles = collectImageFiles(tempDir);
      console.log(`Downloaded ${rawFiles.length} raw image(s).`);

      // Convert non-webp images to webp (quality 80)
      const webpImages = [];
      const totalToConvert = rawFiles.length;
      if (totalToConvert > 0) {
        console.log(`Converting images to WebP (Quality 80%):`);
      }
      
      const CONVERT_CONCURRENCY = 4;
      let convertIndex = 0;
      for (let i = 0; i < rawFiles.length; i += CONVERT_CONCURRENCY) {
        const chunk = rawFiles.slice(i, i + CONVERT_CONCURRENCY);
        await Promise.all(chunk.map(async (imgPath) => {
          const ext = path.extname(imgPath).toLowerCase();
          if (ext === ".webp") {
            webpImages.push(imgPath);
            convertIndex++;
            renderProgressLine("Converting", convertIndex, totalToConvert);
          } else {
            try {
              const webpPath = imgPath.replace(/\.[a-zA-Z0-9]+$/, ".webp");
              const convertCmd = `python -c "from PIL import Image; Image.open(r'''${imgPath}''').save(r'''${webpPath}''', 'WEBP', quality=80)"`;
              await execAsync(convertCmd);
              fs.unlinkSync(imgPath);
              webpImages.push(webpPath);
              convertIndex++;
              renderProgressLine("Converting", convertIndex, totalToConvert);
            } catch (convErr) {
              console.error(`  ✗ WebP conversion failed for ${path.basename(imgPath)}: ${convErr.message}`);
              webpImages.push(imgPath);
              convertIndex++;
            }
          }
        }));
      }

      totalImagesDownloaded += webpImages.length;

      // Group downloaded images by tweet ID
      const groups = {};
      for (const imgPath of webpImages) {
        const baseName = path.basename(imgPath);
        // Extract tweet ID from filename like 2055667177102131596_1.webp
        const match = baseName.match(/^(\d+)_\d+/);
        const key = match ? match[1] : baseName;
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(imgPath);
      }

      // Collect JSON metadata files
      const jsonFiles = fs.existsSync(tempDir) ? fs.readdirSync(tempDir).filter(f => f.endsWith(".json")) : [];

      // Upload each group
      const groupEntries = Object.entries(groups);
      const totalGroups = groupEntries.length;
      if (totalGroups > 0) {
        console.log(`Uploading image groups to Cloudflare:`);
      }
      
      const UPLOAD_CONCURRENCY = 5;
      let uploadIndex = 0;
      for (let i = 0; i < groupEntries.length; i += UPLOAD_CONCURRENCY) {
        const chunk = groupEntries.slice(i, i + UPLOAD_CONCURRENCY);
        await Promise.all(chunk.map(async ([key, filesInGroup]) => {
          try {
            const isTweetId = /^\d+$/.test(key);
            const postUrl = isTweetId ? `https://x.com/${username}/status/${key}` : "";

            // Parse description and date from metadata JSON if available
            let description = "";
            let createdAt = "";
            const jsonFile = jsonFiles.find(f => f.includes(key));
            if (jsonFile) {
              try {
                const metaData = JSON.parse(fs.readFileSync(path.join(tempDir, jsonFile), "utf-8"));
                description = metaData.content || metaData.text || metaData.tweet_text || metaData.description || "";
                description = description.trim();
                createdAt = metaData.date || metaData.created_at || "";
              } catch (jsonErr) {
                // Ignore parser errors to avoid messing up the UI progress bar
              }
            }

            await uploadImageGroup(filesInGroup, username, postUrl, description, createdAt);
            totalImagesUploaded += filesInGroup.length;
            uploadIndex++;
            renderProgressLine("Uploading", uploadIndex, totalGroups);
          } catch (uploadErr) {
            console.error(
              `  ✗ Upload failed for group ${key}: ${uploadErr.message}`,
            );
            uploadIndex++;
          }
        }));
      }
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
