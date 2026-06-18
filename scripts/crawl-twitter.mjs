import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec, execSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

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
const CRAWL_RUN_TYPE = process.env.CRAWL_RUN_TYPE === "manual" ? "manual" : "auto";

// xtractor binary (pinned, SHA-256 verified against the GitHub release digest).
// Source: https://github.com/afkarxyz/xtractor-binaries (MIT).
// The extractor is a PyInstaller binary; the CLI contract below mirrors
// https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader backend/twitter.go
const XTRACTOR_VERSION = "v1.1";
const XTRACTOR_ASSETS = {
  linux: {
    url: "https://github.com/afkarxyz/xtractor-binaries/releases/download/v1.1/linux-amd64.zip",
    sha256: "6361f46860e08ebc78c86a92e23cb43030169f52daa6e7b026f5c15dcc3357e7",
  },
  darwin: {
    arm64: {
      url: "https://github.com/afkarxyz/xtractor-binaries/releases/download/v1.1/macos-arm64.zip",
      sha256: "a733229ef72050dbe1f5942d9a56180c50d3466edf64cbfb0d8c091f0874fb39",
    },
    amd64: {
      url: "https://github.com/afkarxyz/xtractor-binaries/releases/download/v1.1/macos-amd64.zip",
      sha256: "57f82c3ac4926c61d8e8d0d9ebc7d6d6baae2304f80f2a9caea81773447742cc",
    },
  },
  win32: {
    url: "https://github.com/afkarxyz/xtractor-binaries/releases/download/v1.1/windows-amd64.zip",
    sha256: "240dfae5fdefb63a0d4fc6e907a1f5a5377c85545fa2a69c80276ffa79999368",
  },
};

// Local cache locations (kept under scripts/ so the workflow can cache them)
const BIN_DIR = path.resolve("scripts/.xtractor-bin");
const XTRACTOR_EXE = process.platform === "win32" ? "xtractor.exe" : "xtractor";
const XTRACTOR_PATH = path.join(BIN_DIR, XTRACTOR_EXE);
const XTRACTOR_VERSION_PATH = path.join(BIN_DIR, "xtractor-version.json");

// Archive: map of already-downloaded media content ids -> 1.
// Keyed by the pbs.twimg.com media id so the same image is never re-downloaded.
const ARCHIVE_PATH = path.resolve("scripts/.xtractor-archive.json");

// Crawl tuning
const LATEST_LIMIT = 40;          // media items per "latest" run (one page)
const ALL_PAGE_LIMIT = 100;       // media items per page when paginating --all
const MAX_ALL_PAGES = 80;         // safety cap on --all pagination (rate-limit guard)
const PAGE_DELAY_MS = 800;        // pause between extraction pages
const ACCOUNT_DELAY_MS = 2000;    // pause between accounts (rate-limit guard)
const DOWNLOAD_CONCURRENCY = 10;  // parallel CDN downloads (pbs.twimg.com)
const DOWNLOAD_RETRIES = 2;       // extra attempts after the first failure
const CONVERT_CONCURRENCY = 4;    // parallel WebP conversions
const UPLOAD_CONCURRENCY = 5;     // parallel group uploads
const INCLUDE_RETWEETS = true;    // match previous gallery-dl /media behaviour

// Media types we accept from xtractor. photo + animated_gif are converted to
// WebP (animated_gif via ffmpeg); video is kept as mp4.
const ACCEPTED_TYPES = new Set(["photo", "image", "video", "animated_gif", "gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

// MIME per extension, used when uploading so R2 stores a correct content-type.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};
function mimeForExt(ext) {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function collectMediaFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMediaFiles(full));
    } else if (MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

async function uploadImageGroup(filePaths, username, postUrl, description, createdAt) {
  const formData = new FormData();
  formData.append("author", username);
  formData.append("author_url", `https://x.com/${username}`);
  formData.append("api_key", CRAWL_API_KEY);
  if (postUrl) formData.append("post_url", postUrl);
  if (description) formData.append("description", description);
  if (createdAt) formData.append("created_at", createdAt);

  for (const filePath of filePaths) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const mime = mimeForExt(ext);
    // Set the Blob type so the server stores a correct content-type even
    // before its filename-based fallback runs.
    formData.append("file", new Blob([fileBuffer], { type: mime }), fileName);
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

async function reportCrawlComplete(username, crawlMode, newImages) {
  try {
    const res = await fetch(`${SITE_URL}/api/crawl-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: CRAWL_API_KEY,
        username,
        run_type: CRAWL_RUN_TYPE,
        crawl_mode: crawlMode,
        new_images: newImages,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`  WARNING: crawl-complete report failed for @${username}: HTTP ${res.status} – ${text}`);
    }
  } catch (err) {
    console.warn(`  WARNING: crawl-complete report error for @${username}: ${err.message}`);
  }
}

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
// xtractor binary management
// ---------------------------------------------------------------------------

function pickAsset() {
  if (process.platform === "linux") return XTRACTOR_ASSETS.linux;
  if (process.platform === "win32") return XTRACTOR_ASSETS.win32;
  if (process.platform === "darwin") {
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    return XTRACTOR_ASSETS.darwin[arch];
  }
  throw new Error(`unsupported platform for xtractor: ${process.platform}`);
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readInstalledVersion() {
  try {
    const meta = JSON.parse(fs.readFileSync(XTRACTOR_VERSION_PATH, "utf-8"));
    return meta.version ?? "";
  } catch {
    return "";
  }
}

function writeInstalledVersion(version) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(XTRACTOR_VERSION_PATH, JSON.stringify({ version }, null, 2), "utf-8");
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { shell: true },
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { shell: true });
  }
}

// Mirrors findExtractorBinaryEntry from extractor.go: prefer an entry whose
// name contains "xtractor"/"extractor", else fall back to the first file.
function findExtractedBinary(dir) {
  let fallback = null;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else {
        if (!fallback) fallback = full;
        const lower = entry.name.toLowerCase();
        if (lower.includes("xtractor") || lower.includes("extractor")) {
          return full;
        }
      }
    }
    return null;
  }
  return walk(dir) ?? fallback;
}

async function ensureXtractor() {
  if (fs.existsSync(XTRACTOR_PATH) && readInstalledVersion() === XTRACTOR_VERSION) {
    if (process.platform !== "win32") {
      try { fs.chmodSync(XTRACTOR_PATH, 0o755); } catch { /* ignore */ }
    }
    console.log(`xtractor ${XTRACTOR_VERSION} already installed at ${XTRACTOR_PATH}`);
    return;
  }

  const asset = pickAsset();
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = path.join(BIN_DIR, "xtractor.zip");

  console.log(`Downloading xtractor ${XTRACTOR_VERSION}…`);
  const res = await fetch(asset.url);
  if (!res.ok) throw new Error(`failed to download xtractor: HTTP ${res.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

  const actualSha = sha256File(zipPath);
  if (actualSha !== asset.sha256) {
    fs.unlinkSync(zipPath);
    throw new Error(`xtractor archive checksum mismatch: expected ${asset.sha256}, got ${actualSha}`);
  }
  console.log(`  SHA-256 verified: ${actualSha}`);

  const extractDir = path.join(BIN_DIR, "extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  extractZip(zipPath, extractDir);

  const binary = findExtractedBinary(extractDir);
  if (!binary) throw new Error("xtractor binary not found inside archive");

  fs.rmSync(XTRACTOR_PATH, { force: true });
  fs.renameSync(binary, XTRACTOR_PATH);
  if (process.platform !== "win32") fs.chmodSync(XTRACTOR_PATH, 0o755);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.unlinkSync(zipPath);
  writeInstalledVersion(XTRACTOR_VERSION);
  console.log(`  Installed to ${XTRACTOR_PATH}`);
}

// ---------------------------------------------------------------------------
// xtractor invocation + JSON parsing
// ---------------------------------------------------------------------------

// Brace-match a JSON object starting at `start`, ignoring braces inside
// string literals so tweet text containing "{" or "}" is safe.
function extractBalancedAt(text, start) {
  if (text[start] !== "{") return "";
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

// Parse the xtractor CLI response from a text blob that may contain leading
// log lines. Tries each "{" offset until one yields valid JSON, so a log line
// that happens to contain "{" cannot derail extraction.
function parseCliResponse(text) {
  let searchFrom = 0;
  while (true) {
    const start = text.indexOf("{", searchFrom);
    if (start === -1) break;
    const candidate = extractBalancedAt(text, start);
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        /* not the real JSON object; try the next "{" */
      }
    }
    searchFrom = start + 1;
  }
  return null;
}

// Mirrors parseExtractorError from twitter.go.
function parseExtractorError(output, username) {
  const lower = output.toLowerCase();
  let errorLine = "";
  for (const line of output.split("\n")) {
    const ll = line.toLowerCase();
    if (ll.includes("error:") || ll.includes("exception")) {
      errorLine = line.trim();
      break;
    }
  }
  if (!errorLine) errorLine = output.trim();
  if (errorLine.length > 300) errorLine = errorLine.slice(0, 300) + "...";

  let hint = "";
  if (lower.includes("unable to retrieve tweets from this timeline")) {
    hint = " [Hint: End of timeline or rate limited — partial data already fetched will be saved]";
  } else if (lower.includes("rate limit") || output.includes("429")) {
    hint = " [Hint: Rate limited — wait 5-15 minutes before retrying]";
  } else if (output.includes("401") || lower.includes("unauthorized")) {
    hint = " [Hint: auth_token may be invalid or expired]";
  } else if (output.includes("404")) {
    hint = ` [Hint: @${username} may not exist or is suspended]`;
  } else if (lower.includes("protected") || output.includes("403")) {
    hint = " [Hint: Protected account — need to follow and use auth token]";
  } else if (lower.includes("authenticated cookies needed") || lower.includes("cookies needed")) {
    hint = " [Hint: auth_token missing, invalid or expired — check TWITTER_COOKIES]";
  }
  return errorLine + hint;
}

// Run the xtractor binary and return the parsed CLI response object:
//   { media: [...], metadata: [...], cursor, total, completed }
async function runXtractor(url, authToken, extraArgs = []) {
  const args = [url, "--auth-token", authToken, "--json", "--metadata", ...extraArgs];
  const child = spawn(XTRACTOR_PATH, args, {
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });

  const code = await new Promise((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });

  if (code !== 0) {
    const merged = `${stdout}\n${stderr}`.trim();
    if (!merged) throw new Error("xtractor process terminated before returning data");
    throw new Error(parseExtractorError(merged, ""));
  }

  const parsed = parseCliResponse(stdout) || parseCliResponse(`${stdout}\n${stderr}`);
  if (!parsed) {
    throw new Error(`xtractor returned no JSON. stderr: ${stderr.trim().slice(0, 300)}`);
  }
  return parsed;
}

// Extract media items for one account, paginating via cursor for full history.
// Returns a flat array of media items: { url, tweet_id, date, type, content, ... }
async function extractMediaForAccount(username, authToken, { all }) {
  const url = `https://x.com/${username}/media`;
  // --type all returns photo + video + animated_gif so we can support videos
  // and convert animated_gif to animated WebP.
  const baseArgs = ["--type", "all", "--retweets", INCLUDE_RETWEETS ? "include" : "skip"];
  const items = [];
  let cursor = "";
  let pages = 0;

  if (!all) {
    const resp = await runXtractor(url, authToken, [...baseArgs, "--limit", String(LATEST_LIMIT)]);
    return resp.media ?? [];
  }

  while (pages < MAX_ALL_PAGES) {
    const args = [...baseArgs, "--limit", String(ALL_PAGE_LIMIT)];
    if (cursor) args.push("--cursor", cursor);

    let resp;
    try {
      resp = await runXtractor(url, authToken, args);
    } catch (err) {
      const msg = err.message.toLowerCase();
      if (items.length > 0 && (msg.includes("rate limit") || msg.includes("429"))) {
        console.warn(`  Rate limit hit after ${items.length} items — keeping what we have.`);
        break;
      }
      throw err;
    }

    const pageItems = resp.media ?? [];
    items.push(...pageItems);
    pages++;
    const isDone = resp.completed === true || !resp.cursor || pageItems.length === 0;
    console.log(`  Extracted page ${pages}: +${pageItems.length} (total ${items.length})`);
    if (isDone) break;
    cursor = resp.cursor;
    await sleep(PAGE_DELAY_MS);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Archive (dedup across runs)
// ---------------------------------------------------------------------------

function loadArchive() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveArchive(archive) {
  const tmp = ARCHIVE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(archive));
  fs.renameSync(tmp, ARCHIVE_PATH);
}

// Stable media content id from a pbs.twimg.com URL.
// e.g. https://pbs.twimg.com/media/Eb1abc?format=jpg&name=large  ->  Eb1abc
function mediaIdFromUrl(mediaUrl) {
  try {
    const u = new URL(mediaUrl);
    const base = path.basename(u.pathname);
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  } catch {
    return mediaUrl;
  }
}

// File extension for a media URL, using ?format= when present
// (pbs.twimg.com convention) and falling back to the path extension.
function extFromUrl(mediaUrl) {
  try {
    const u = new URL(mediaUrl);
    const format = u.searchParams.get("format");
    if (format) return "." + format;
    const ext = path.extname(u.pathname);
    if (ext) return ext;
  } catch { /* ignore */ }
  return ".jpg";
}

// Choose the on-disk extension for a downloaded media item.
// Photos keep their CDN extension (jpg/png) so Pillow can convert to WebP.
// Videos are stored as .mp4. animated_gif downloads as .mp4 and is later
// converted to .webp by ffmpeg.
function extForItem(item) {
  const type = (item.type ?? "").toLowerCase();
  if (type === "video") return ".mp4";
  if (type === "gif" || type === "animated_gif") return ".mp4";
  return extFromUrl(item.url);
}

// ---------------------------------------------------------------------------
// Parallel media download
// ---------------------------------------------------------------------------

async function downloadFile(mediaUrl, outputPath) {
  const res = await fetch(mediaUrl, {
    headers: { "User-Agent": "Twitter-X-Media-Batch-Downloader" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${mediaUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = `${outputPath}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, outputPath);
}

// Worker pool. Each task: { url, outputPath, mediaId }
// Updates the archive in-place for skipped/downloaded items.
async function downloadMediaItems(tasks, archive, onProgress) {
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = 0;
  const total = tasks.length;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= total) break;
      const task = tasks[i];

      if (archive[task.mediaId]) {
        skipped++;
        onProgress(downloaded + skipped + failed);
        continue;
      }
      if (fs.existsSync(task.outputPath)) {
        archive[task.mediaId] = 1;
        skipped++;
        onProgress(downloaded + skipped + failed);
        continue;
      }

      let ok = false;
      for (let attempt = 1; attempt <= DOWNLOAD_RETRIES + 1; attempt++) {
        try {
          await downloadFile(task.url, task.outputPath);
          ok = true;
          break;
        } catch (err) {
          if (attempt <= DOWNLOAD_RETRIES) {
            await sleep(attempt * 500);
          } else {
            console.error(`  ✗ Download failed: ${path.basename(task.outputPath)} — ${err.message}`);
          }
        }
      }

      if (ok) {
        archive[task.mediaId] = 1;
        downloaded++;
      } else {
        failed++;
      }
      onProgress(downloaded + skipped + failed);
    }
  }

  const numWorkers = Math.min(DOWNLOAD_CONCURRENCY, total);
  if (numWorkers > 0) {
    await Promise.all(Array.from({ length: numWorkers }, () => worker()));
  }
  return { downloaded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Twitter Image Crawl (xtractor engine) ===");
  console.log(`Site URL        : ${SITE_URL}`);
  console.log(`Archive         : ${ARCHIVE_PATH}`);
  console.log(`xtractor        : ${XTRACTOR_VERSION} (concurrency ${DOWNLOAD_CONCURRENCY})`);
  console.log();

  if (!TWITTER_COOKIES) {
    console.error("ERROR: TWITTER_COOKIES is not set.");
    process.exit(1);
  }
  if (!CRAWL_API_KEY) {
    console.error("ERROR: CRAWL_API_KEY is not set.");
    process.exit(1);
  }

  const cookies = parseCookieString(TWITTER_COOKIES);
  const authToken = cookies.auth_token ?? "";
  if (!authToken) {
    console.error("ERROR: auth_token not found in TWITTER_COOKIES.");
    process.exit(1);
  }

  await ensureXtractor();

  console.log("Fetching account list…");
  const accountsRes = await fetch(`${SITE_URL}/api/crawl-accounts`);
  if (!accountsRes.ok) {
    console.error(`ERROR: Failed to fetch accounts – HTTP ${accountsRes.status}`);
    process.exit(1);
  }

  const { accounts } = await accountsRes.json();
  const enabledAccounts = accounts.filter((a) => a.enabled);
  console.log(`Found ${accounts.length} account(s), ${enabledAccounts.length} enabled.\n`);

  if (enabledAccounts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const archive = loadArchive();
  console.log(`Archive has ${Object.keys(archive).length} known media item(s).\n`);

  let totalAccountsProcessed = 0;
  let totalImagesDownloaded = 0;
  let totalImagesUploaded = 0;

  for (let ai = 0; ai < enabledAccounts.length; ai++) {
    const account = enabledAccounts[ai];
    totalAccountsProcessed++;
    const { username } = account;
    console.log(`======================================================================`);
    console.log(`[Account ${totalAccountsProcessed}/${enabledAccounts.length}] @${username}`);
    console.log(`======================================================================`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `tw-${username}-`));
    let accountImagesUploaded = 0;
    const isCrawlAll =
      process.argv.includes("--all") ||
      account.crawl_all === 1 ||
      account.crawl_all === "1" ||
      account.crawl_all === true;
    const crawlMode = isCrawlAll ? "all" : "latest";

    try {
      // 1) Extract media URLs + metadata via xtractor ---------------------
      console.log(`Extracting media via xtractor (${crawlMode})…`);
      let mediaItems = [];
      try {
        mediaItems = await extractMediaForAccount(username, authToken, { all: isCrawlAll });
      } catch (extErr) {
        console.error(`  ✗ xtractor failed for @${username}: ${extErr.message}`);
        await reportCrawlComplete(username, crawlMode, 0);
        continue;
      }

      // Keep accepted media types with a usable URL.
      mediaItems = mediaItems.filter(
        (m) => m && m.url && ACCEPTED_TYPES.has((m.type ?? "").toLowerCase()),
      );
      const photoCount = mediaItems.filter((m) => {
        const t = (m.type ?? "").toLowerCase();
        return t === "photo" || t === "image" || t === "";
      }).length;
      const videoCount = mediaItems.filter((m) => (m.type ?? "").toLowerCase() === "video").length;
      const gifCount = mediaItems.filter((m) => {
        const t = (m.type ?? "").toLowerCase();
        return t === "gif" || t === "animated_gif";
      }).length;
      console.log(`  Found ${mediaItems.length} item(s): ${photoCount} photo, ${videoCount} video, ${gifCount} gif.`);

      if (mediaItems.length === 0) {
        console.log(`  No new media to process.`);
        await reportCrawlComplete(username, crawlMode, 0);
        continue;
      }

      // 2) Build download tasks, grouped by tweet id and indexed per tweet.
      //    Filename: {tweet_id}_{NN}.{ext}  (matches prior gallery-dl naming
      //    so server-side dedup and tweet grouping keep working.)
      const tweetOrder = new Map();
      for (const m of mediaItems) {
        const tid = String(m.tweet_id);
        if (!tweetOrder.has(tid)) tweetOrder.set(tid, []);
        tweetOrder.get(tid).push(m);
      }

      const tasks = [];
      for (const [tid, group] of tweetOrder) {
        group.forEach((m, idx) => {
          const nn = idx + 1;
          const ext = extForItem(m);
          tasks.push({
            url: m.url,
            mediaId: mediaIdFromUrl(m.url),
            tweetId: tid,
            outputPath: path.join(tempDir, `${tid}_${nn}${ext}`),
            item: m,
          });
        });
      }

      // 3) Download in parallel ------------------------------------------
      console.log(`Downloading ${tasks.length} file(s) (concurrency ${DOWNLOAD_CONCURRENCY}):`);
      const { downloaded, skipped, failed } = await downloadMediaItems(
        tasks,
        archive,
        (done) => renderProgressLine("Downloading", done, tasks.length),
      );
      console.log(`  Downloaded ${downloaded}, skipped ${skipped}, failed ${failed}.`);
      saveArchive(archive);

      // Map each downloaded file's basename to its xtractor media type so the
      // conversion step can tell animated_gif (→ animated WebP) apart from
      // regular video (→ keep mp4).
      const typeByBasename = new Map();
      for (const t of tasks) {
        typeByBasename.set(path.basename(t.outputPath), (t.item.type ?? "").toLowerCase());
      }

      // 4) Convert media to final form -----------------------------------
      //    photo (jpg/png)      -> WebP via Pillow
      //    animated_gif (mp4)   -> animated WebP via ffmpeg
      //    video (mp4)          -> kept as-is
      //    already WebP         -> kept as-is
      const rawFiles = collectMediaFiles(tempDir);
      const finalFiles = [];
      const totalToProcess = rawFiles.length;
      if (totalToProcess > 0) {
        console.log(`Processing media (photo→WebP, gif→animated WebP, video→mp4):`);
      }

      let processIndex = 0;
      for (let i = 0; i < rawFiles.length; i += CONVERT_CONCURRENCY) {
        const chunk = rawFiles.slice(i, i + CONVERT_CONCURRENCY);
        await Promise.all(
          chunk.map(async (mediaPath) => {
            const ext = path.extname(mediaPath).toLowerCase();
            const baseName = path.basename(mediaPath);
            const itemType = typeByBasename.get(baseName) ?? "";
            const isGif = itemType === "gif" || itemType === "animated_gif";
            const isVideo = itemType === "video";

            try {
              if (isVideo) {
                // Keep videos as-is (mp4).
                finalFiles.push(mediaPath);
              } else if (isGif) {
                // animated_gif arrives as mp4 -> convert to animated WebP.
                const webpPath = mediaPath.replace(/\.[a-zA-Z0-9]+$/, ".webp");
                // -loop 0 = loop forever; -q:v is webp quality (0-100, lower = smaller).
                const cmd = `ffmpeg -y -i "${mediaPath}" -loop 0 -q:v 60 "${webpPath}"`;
                await execAsync(cmd, { timeout: 60000 });
                fs.unlinkSync(mediaPath);
                finalFiles.push(webpPath);
              } else if (ext === ".webp") {
                finalFiles.push(mediaPath);
              } else {
                // Photo (jpg/png) -> WebP via Pillow.
                const webpPath = mediaPath.replace(/\.[a-zA-Z0-9]+$/, ".webp");
                const convertCmd = `python -c "from PIL import Image; Image.open(r'''${mediaPath}''').save(r'''${webpPath}''', 'WEBP', quality=80)"`;
                await execAsync(convertCmd);
                fs.unlinkSync(mediaPath);
                finalFiles.push(webpPath);
              }
            } catch (convErr) {
              console.error(`  ✗ Processing failed for ${baseName}: ${convErr.message}`);
              finalFiles.push(mediaPath);
            }
            processIndex++;
            renderProgressLine("Processing", processIndex, totalToProcess);
          }),
        );
      }

      totalImagesDownloaded += finalFiles.length;

      // 5) Group by tweet id and upload ---------------------------------
      const groups = {};
      for (const imgPath of finalFiles) {
        const baseName = path.basename(imgPath);
        const match = baseName.match(/^(\d+)_\d+/);
        const key = match ? match[1] : baseName;
        if (!groups[key]) groups[key] = [];
        groups[key].push(imgPath);
      }

      // Build a tweetId -> metadata lookup from the xtractor response.
      const metaByTweetId = new Map();
      for (const m of mediaItems) {
        const tid = String(m.tweet_id);
        if (!metaByTweetId.has(tid)) {
          metaByTweetId.set(tid, {
            description: (m.content ?? "").trim(),
            createdAt: m.date ?? "",
          });
        }
      }

      const groupEntries = Object.entries(groups);
      const totalGroups = groupEntries.length;
      if (totalGroups > 0) {
        console.log(`Uploading image groups to Cloudflare:`);
      }

      let uploadIndex = 0;
      for (let i = 0; i < groupEntries.length; i += UPLOAD_CONCURRENCY) {
        const chunk = groupEntries.slice(i, i + UPLOAD_CONCURRENCY);
        await Promise.all(
          chunk.map(async ([key, filesInGroup]) => {
            try {
              const isTweetId = /^\d+$/.test(key);
              const postUrl = isTweetId ? `https://x.com/${username}/status/${key}` : "";
              const meta = isTweetId ? metaByTweetId.get(key) : null;

              await uploadImageGroup(
                filesInGroup,
                username,
                postUrl,
                meta?.description ?? "",
                meta?.createdAt ?? "",
              );
              totalImagesUploaded += filesInGroup.length;
              accountImagesUploaded += filesInGroup.length;
              uploadIndex++;
              renderProgressLine("Uploading", uploadIndex, totalGroups);
            } catch (uploadErr) {
              console.error(`  ✗ Upload failed for group ${key}: ${uploadErr.message}`);
              uploadIndex++;
            }
          }),
        );
      }

      // 6) Report this account's crawl result ---------------------------
      await reportCrawlComplete(username, crawlMode, accountImagesUploaded);
      console.log(`  Reported crawl-complete: ${crawlMode} mode, +${accountImagesUploaded} new image(s).`);
    } catch (err) {
      console.error(`ERROR processing @${username}: ${err.message}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    saveArchive(archive);

    if (ai < enabledAccounts.length - 1) {
      await sleep(ACCOUNT_DELAY_MS);
    }
    console.log();
  }

  console.log("=== Summary ===");
  console.log(`Accounts processed : ${totalAccountsProcessed}`);
  console.log(`Images downloaded  : ${totalImagesDownloaded}`);
  console.log(`Images uploaded    : ${totalImagesUploaded}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
