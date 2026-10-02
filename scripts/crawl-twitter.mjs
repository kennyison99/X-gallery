import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { uploadMultipartFile } from "./crawl-upload.mjs";
import { MAX_CRAWL_FILE_BYTES, CRAWL_UPLOAD_PART_BYTES } from "../src/lib/crawl-upload-limits.mjs";
import { ensureXtractor, runXtractor } from "./xtractor-lib.mjs";
import { dedupeMediaItems, latestPostSignature, mediaIdFromUrl, newerThanLatest, samePostSignature } from "./media-items.mjs";
import { transcodeVideoFile } from "./video-transcoder.mjs";

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

// Archive: downloaded media ids plus per-account latest post signatures.
const ARCHIVE_PATH = path.resolve("scripts/.xtractor-archive.json");

// Crawl tuning
const LATEST_LIMIT = 40;          // media items per "latest" run (one page)
const ALL_PAGE_LIMIT = 100;       // media items per page when paginating --all
const MAX_ALL_PAGES = 80;         // safety cap on --all pagination (rate-limit guard)
const PAGE_DELAY_MS = 800;        // pause between extraction pages
const ACCOUNT_DELAY_MS = 2000;    // pause between accounts (rate-limit guard)
const DOWNLOAD_RETRIES = 2;       // extra attempts after the first failure
const REQUEST_TIMEOUT_MS = 60_000; // fail a stalled HTTP request instead of hanging the run
const DISCOVERY_CONCURRENCY = 3;  // latest-mode xtractor checks in parallel
const PIPELINE_CONCURRENCY = 4;   // tweet groups processed in parallel
                                   // (each group: download → convert → upload)
                                   // Within a group, files run via Promise.all
                                   // (a tweet has at most 4 media, no cap needed).
const INCLUDE_RETWEETS = true;    // match previous gallery-dl /media behaviour

// Media types we accept from xtractor. photo + animated_gif are converted to
// WebP (animated_gif via ffmpeg); video is kept as mp4.
const ACCEPTED_TYPES = new Set(["photo", "image", "video", "animated_gif", "gif"]);

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

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
}

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



async function uploadSingleFile(filePath, username) {
  if (fs.statSync(filePath).size > CRAWL_UPLOAD_PART_BYTES) {
    return uploadMultipartFile(filePath, username, SITE_URL, CRAWL_API_KEY, fetchWithTimeout);
  }
  const formData = new FormData();
  formData.append("author", username);
  formData.append("api_key", CRAWL_API_KEY);

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mime = mimeForExt(ext);
  formData.append("file", new Blob([fileBuffer], { type: mime }), fileName);

  const res = await fetchWithTimeout(`${SITE_URL}/api/crawl-upload-file`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} – ${text}`);
  }
  const data = await res.json();
  return data.key;
}

async function checkUploadExists(username, postUrl) {
  if (!postUrl) return null;
  const formData = new FormData();
  formData.append("author", username);
  formData.append("post_url", postUrl);
  formData.append("api_key", CRAWL_API_KEY);
  formData.append("check_only", "true");

  const res = await fetchWithTimeout(`${SITE_URL}/api/crawl-upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} – ${text}`);
  }
  const result = await res.json();
  return result.skipped ? result : null;
}

async function uploadImageGroup(filePaths, username, postUrl, description, createdAt, displayName = "") {
  const existing = await checkUploadExists(username, postUrl);
  if (existing) return existing;

  const r2Keys = [];
  for (const filePath of filePaths) {
    const key = await uploadSingleFile(filePath, username);
    r2Keys.push(key);
  }

  const formData = new FormData();
  formData.append("author", username);
  formData.append("author_url", `https://x.com/${username}`);
  if (displayName) formData.append("author_display_name", displayName);
  formData.append("api_key", CRAWL_API_KEY);
  if (postUrl) formData.append("post_url", postUrl);
  if (description) formData.append("description", description);
  if (createdAt) formData.append("created_at", createdAt);
  formData.append("r2_keys", r2Keys.join(","));

  const res = await fetchWithTimeout(`${SITE_URL}/api/crawl-upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} – ${text}`);
  }
  return await res.json();
}

async function reportCrawlComplete(username, crawlMode, newImages, error = "") {
  try {
    const res = await fetchWithTimeout(`${SITE_URL}/api/crawl-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: CRAWL_API_KEY,
        username,
        run_type: CRAWL_RUN_TYPE,
        crawl_mode: crawlMode,
        new_images: newImages,
        error: error ? String(error).slice(0, 1000) : "",
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

function renderPipelineProgress(doneGroups, totalGroups, stats) {
  renderProgressLine("Pipeline", doneGroups, totalGroups);
  if (doneGroups === totalGroups) {
    console.log(
      `  Done: downloaded ${stats.downloaded}, processed ${stats.processed}, uploaded ${stats.uploaded}, skipped ${stats.skipped}, failed ${stats.failed}.`,
    );
  }
}

// Extract media items for one account, paginating via cursor for full history.
// Returns a flat array of media items: { url, tweet_id, date, type, content, ... }
async function extractMediaForAccount(username, authToken, { all, previousLatest, postIds }) {
  if (postIds) {
    const media = [];
    for (const postId of postIds) {
      const postUrl = `https://x.com/${username}/status/${postId}`;
      if (await checkUploadExists(username, postUrl)) continue;
      const response = await runXtractor(postUrl, authToken, ["--type", "all"]);
      const items = (response.media ?? []).filter((item) => String(item.tweet_id) === postId);
      if (items.length === 0) throw new Error(`No media returned for recovery post ${postId}`);
      media.push(...items);
    }
    return { media, latest: null, skipped: false };
  }
  const url = `https://x.com/${username}/media`;
  // --type all returns photo + video + animated_gif so we can support videos
  // and convert animated_gif to animated WebP.
  const baseArgs = ["--type", "all", "--retweets", INCLUDE_RETWEETS ? "include" : "skip"];
  const items = [];
  let pages = 0;

  const firstLimit = all ? ALL_PAGE_LIMIT : LATEST_LIMIT;
  const firstResp = await runXtractor(url, authToken, [...baseArgs, "--limit", String(firstLimit)]);
  const firstPageItems = firstResp.media ?? [];
  const latest = latestPostSignature(firstPageItems);
  if (!all && samePostSignature(latest, previousLatest)) {
    return { media: [], latest, skipped: true };
  }

  if (!all) {
    return { media: newerThanLatest(firstPageItems, previousLatest), latest, skipped: false };
  }

  items.push(...firstPageItems);
  pages++;
  let cursor = firstResp.cursor;
  let completed = firstResp.completed === true || !cursor || firstPageItems.length === 0;
  console.log(`  Extracted page ${pages}: +${firstPageItems.length} (total ${items.length})`);

  while (!completed && pages < MAX_ALL_PAGES) {
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
  return { media: items, latest, skipped: false };
}

function accountCrawlAll(account) {
  return (
    process.argv.includes("--all") ||
    account.crawl_all === 1 ||
    account.crawl_all === "1" ||
    account.crawl_all === true
  );
}

async function discoverLatestAccounts(accounts, authToken, archive) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= accounts.length) break;
      const account = accounts[i];
      const username = account.username;
      try {
        const previousLatest = getAccountLatest(archive, username);
        results.set(username, await extractMediaForAccount(username, authToken, {
          all: false,
          previousLatest,
        }));
      } catch (err) {
        results.set(username, { error: err });
      }
    }
  }

  const workers = Math.min(DISCOVERY_CONCURRENCY, accounts.length);
  if (workers > 0) {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
  return results;
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

function accountArchiveKey(username) {
  return username.toLowerCase();
}

function getAccountLatest(archive, username) {
  return archive.__accounts?.[accountArchiveKey(username)]?.latest ?? null;
}

function setAccountLatest(archive, username, latest) {
  if (!latest) return;
  archive.__accounts ??= {};
  archive.__accounts[accountArchiveKey(username)] = { latest };
}

function countArchivedMedia(archive) {
  return Object.values(archive).filter((value) => value === 1).length;
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
  const res = await fetchWithTimeout(mediaUrl, {
    headers: { "User-Agent": "Twitter-X-Media-Batch-Downloader" },
  }, 15 * 60_000);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${mediaUrl}`);
  const tmp = `${outputPath}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, outputPath);
}

async function downloadMediaTask(task, archive) {
  if (archive[task.mediaId]) return { status: "skipped", task };
  if (fs.existsSync(task.outputPath)) return { status: "downloaded", task };

  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES + 1; attempt++) {
    try {
      await downloadFile(task.url, task.outputPath);
      return { status: "downloaded", task };
    } catch (err) {
      if (attempt <= DOWNLOAD_RETRIES) {
        await sleep(attempt * 500);
      } else {
        console.error(`  ✗ ${task.tweetId} download failed: ${err.message}`);
      }
    }
  }
  return { status: "failed", task };
}

async function convertMediaFile(mediaPath, itemType) {
  const ext = path.extname(mediaPath).toLowerCase();
  const isGif = itemType === "gif" || itemType === "animated_gif";
  const isVideo = itemType === "video";

  if (isVideo) {
    const result = await transcodeVideoFile(mediaPath);
    return result.chosenPath;
  }

  if (ext === ".webp") return mediaPath;

  const webpPath = mediaPath.replace(/\.[a-zA-Z0-9]+$/, ".webp");
  if (isGif) {
    const cmd = `ffmpeg -y -i "${mediaPath}" -loop 0 -q:v 60 "${webpPath}"`;
    await execAsync(cmd, { timeout: 60000 });
  } else {
    const convertCmd = `python -c "from PIL import Image; Image.open(r'''${mediaPath}''').save(r'''${webpPath}''', 'WEBP', quality=80)"`;
    await execAsync(convertCmd);
  }
  fs.unlinkSync(mediaPath);
  return webpPath;
}

export async function processTweetGroup({ key, tasks, username, metaByTweetId, accountNick, archive }) {
  const stats = { downloaded: 0, skipped: 0, processed: 0, uploaded: 0, failed: 0 };
  const downloadedTasks = [];

  const downloadResults = await Promise.all(tasks.map((task) => downloadMediaTask(task, archive)));
  for (const result of downloadResults) {
    if (result.status === "downloaded") {
      stats.downloaded++;
      downloadedTasks.push(result.task);
    } else if (result.status === "skipped") {
      stats.skipped++;
    } else {
      stats.failed++;
    }
  }

  if (stats.failed > 0 || downloadedTasks.length === 0) return stats;

  // Use indexed assignment so file order matches the original tweet media order
  // (Promise.all resolves all promises but .push() would insert in completion order).
  const finalFiles = new Array(downloadedTasks.length);
  await Promise.all(
    downloadedTasks.map(async (task, idx) => {
      const baseName = path.basename(task.outputPath);
      const itemType = (task.item.type ?? "").toLowerCase();
      try {
        finalFiles[idx] = await convertMediaFile(task.outputPath, itemType);
        stats.processed++;
      } catch (err) {
        console.error(`  ✗ ${key} processing failed for ${baseName}: ${err.message}`);
        finalFiles[idx] = task.outputPath;
        stats.failed++;
      }
    }),
  );

  if (stats.failed > 0) return stats;

  // Large files use R2 multipart uploads, independently of the HTTP body limit.
  let hasTooLargeFile = false;
  for (const filePath of finalFiles) {
    if (filePath && fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      if (size > MAX_CRAWL_FILE_BYTES) {
        console.warn(`  Tweet ${key} failed: file exceeds the 1 GB limit (${size} bytes).`);
        hasTooLargeFile = true;
        break;
      }
    }
  }

  if (hasTooLargeFile) {
    stats.failed += finalFiles.length;
    return stats;
  }

  try {
    const isTweetId = /^\d+$/.test(key);
    const postUrl = isTweetId ? `https://x.com/${username}/status/${key}` : "";
    const meta = isTweetId ? metaByTweetId.get(key) : null;
    const uploadResult = await uploadImageGroup(
      finalFiles,
      username,
      postUrl,
      meta?.description ?? "",
      meta?.createdAt ?? "",
      meta?.nick || accountNick,
    );
    if (uploadResult?.skipped) {
      stats.skipped += finalFiles.length;
    } else {
      stats.uploaded += finalFiles.length;
    }
    for (const task of downloadedTasks) {
      archive[task.mediaId] = 1;
    }
    saveArchive(archive);
  } catch (err) {
    console.error(`  ✗ ${key} upload failed: ${err.message}`);
    stats.failed++;
  }

  return stats;
}

async function processTweetGroups(groupEntries, options, onProgress) {
  const totals = { downloaded: 0, skipped: 0, processed: 0, uploaded: 0, failed: 0 };
  let cursor = 0;
  let doneGroups = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= groupEntries.length) break;
      const [key, tasks] = groupEntries[i];
      const stats = await processTweetGroup({ key, tasks, ...options });
      totals.downloaded += stats.downloaded;
      totals.skipped += stats.skipped;
      totals.processed += stats.processed;
      totals.uploaded += stats.uploaded;
      totals.failed += stats.failed;
      doneGroups++;
      onProgress(doneGroups, groupEntries.length, totals);
    }
  }

  const workers = Math.min(PIPELINE_CONCURRENCY, groupEntries.length);
  if (workers > 0) {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Twitter Image Crawl (xtractor engine) ===");
  console.log(`Site URL        : ${SITE_URL}`);
  console.log(`Archive         : ${ARCHIVE_PATH}`);
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

  const xtractor = await ensureXtractor();
  console.log(`xtractor        : ${xtractor.version} (pipeline concurrency ${PIPELINE_CONCURRENCY})`);

  console.log("Fetching account list…");
  const accountsRes = await fetchWithTimeout(`${SITE_URL}/api/crawl-accounts`);
  if (!accountsRes.ok) {
    console.error(`ERROR: Failed to fetch accounts – HTTP ${accountsRes.status}`);
    process.exit(1);
  }

  const { accounts } = await accountsRes.json();
  const recoveryPath = process.env.CRAWL_RECOVERY_FILE;
  const recoveryPosts = recoveryPath ? JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).posts : null;
  const enabledAccounts = recoveryPosts
    ? [...new Set(recoveryPosts.map((post) => post.username))].map((username) => ({ username, enabled: true, crawl_all: 1 }))
    : accounts.filter((a) => a.enabled);
  console.log(`Found ${accounts.length} account(s), ${enabledAccounts.length} enabled.\n`);

  if (enabledAccounts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const archive = loadArchive();
  console.log(`Archive has ${countArchivedMedia(archive)} known media item(s).\n`);
  const latestAccounts = enabledAccounts.filter((account) => !accountCrawlAll(account));
  const discoveredLatest = latestAccounts.length > 0
    ? await discoverLatestAccounts(latestAccounts, authToken, archive)
    : new Map();
  const skippedLatestUsernames = latestAccounts
    .map((account) => account.username)
    .filter((username) => discoveredLatest.get(username)?.skipped);
  const runnableAccountCount = enabledAccounts.length - skippedLatestUsernames.length;
  if (latestAccounts.length > 0) {
    console.log(`Pre-checked ${latestAccounts.length} latest-mode account(s) (concurrency ${DISCOVERY_CONCURRENCY}).`);
    if (skippedLatestUsernames.length > 0) {
      console.log("Following accounts will be skipped:");
      for (const username of skippedLatestUsernames) {
        console.log(`@${username}`);
      }
      console.log(`Total [${skippedLatestUsernames.length}/${enabledAccounts.length}] account(s) skipped.\n`);
    } else {
      console.log("No latest-mode account will be skipped.\n");
    }
  }

  let totalAccountsProcessed = 0;
  let totalImagesDownloaded = 0;
  let totalImagesUploaded = 0;
  let failedAccounts = 0;

  for (let ai = 0; ai < enabledAccounts.length; ai++) {
    const account = enabledAccounts[ai];
    const { username } = account;
    const isCrawlAll = accountCrawlAll(account);
    const crawlMode = isCrawlAll && !recoveryPosts ? "all" : "latest";
    const discovered = isCrawlAll ? null : discoveredLatest.get(username);
    if (!isCrawlAll && discovered?.skipped) {
      await reportCrawlComplete(username, crawlMode, 0);
      continue;
    }

    totalAccountsProcessed++;
    console.log(`======================================================================`);
    console.log(`[Account ${totalAccountsProcessed}/${runnableAccountCount}] @${username}`);
    console.log(`======================================================================`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `tw-${username}-`));
    let accountImagesUploaded = 0;

    try {
      // 1) Extract media URLs + metadata via xtractor ---------------------
      console.log(`Extracting media via xtractor (${crawlMode})…`);
      const previousLatest = getAccountLatest(archive, username);
      let mediaItems = [];
      let latest = null;
      try {
        const extracted = isCrawlAll
          ? await extractMediaForAccount(username, authToken, {
            all: true, previousLatest,
            postIds: recoveryPosts?.filter((post) => post.username === username).map((post) => post.tweetId),
          })
          : discovered;
        if (!extracted) throw new Error("latest discovery result missing");
        if (extracted?.error) throw extracted.error;
        mediaItems = extracted.media;
        latest = extracted.latest;
        if (extracted.skipped) {
          console.log(`  Latest post unchanged (${latest.postId}${latest.date ? ` @ ${latest.date}` : ""}); skipping @${username}.`);
          await reportCrawlComplete(username, crawlMode, 0);
          continue;
        }
      } catch (extErr) {
        failedAccounts++;
        console.error(`  ✗ xtractor failed for @${username}: ${extErr.message}`);
        await reportCrawlComplete(username, crawlMode, 0, extErr.message);
        continue;
      }

      // Keep accepted media types with a usable URL.
      mediaItems = mediaItems.filter(
        (m) => m && m.url && ACCEPTED_TYPES.has((m.type ?? "").toLowerCase()),
      );
      mediaItems = dedupeMediaItems(mediaItems);
      if (recoveryPosts) {
        for (const item of mediaItems) delete archive[mediaIdFromUrl(item.url)];
      }
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
        setAccountLatest(archive, username, latest);
        saveArchive(archive);
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

      const groupTasks = new Map();
      for (const [tid, group] of tweetOrder) {
        const tasks = group.map((m, idx) => {
          const nn = idx + 1;
          const ext = extForItem(m);
          return {
            url: m.url,
            mediaId: mediaIdFromUrl(m.url),
            tweetId: tid,
            outputPath: path.join(tempDir, `${tid}_${nn}${ext}`),
            item: m,
          };
        });
        groupTasks.set(tid, tasks);
      }

      // Build a tweetId -> metadata lookup from the xtractor response.
      // Pull the display name (nick) from the first media item's user/author
      // object so the card can show "By: nick@handle".
      const metaByTweetId = new Map();
      let accountNick = "";
      for (const m of mediaItems) {
        const tid = String(m.tweet_id);
        if (!accountNick) {
          accountNick = (m.user?.nick ?? m.author?.nick ?? "").trim();
        }
        if (!metaByTweetId.has(tid)) {
          metaByTweetId.set(tid, {
            description: (m.content ?? "").trim(),
            createdAt: m.date ?? "",
            nick: (m.user?.nick ?? m.author?.nick ?? "").trim(),
          });
        }
      }
      if (!accountNick) accountNick = username;

      // 3) Pipeline per tweet group: download -> convert -> upload.
      const groupEntries = Array.from(groupTasks.entries());
      console.log(`Processing ${groupEntries.length} tweet group(s) (pipeline concurrency ${PIPELINE_CONCURRENCY}):`);
      const pipelineStats = await processTweetGroups(
        groupEntries,
        { username, metaByTweetId, accountNick, archive },
        renderPipelineProgress,
      );

      totalImagesDownloaded += pipelineStats.downloaded;
      totalImagesUploaded += pipelineStats.uploaded;
      accountImagesUploaded += pipelineStats.uploaded;

      // Only advance the checkpoint after every media group completed cleanly.
      const accountError = pipelineStats.failed > 0
        ? `${pipelineStats.failed} media task(s) failed; latest checkpoint was not advanced.`
        : "";
      if (pipelineStats.failed === 0) {
        setAccountLatest(archive, username, latest);
        saveArchive(archive);
      } else {
        failedAccounts++;
        console.warn(`  WARNING: ${accountError}`);
      }
      await reportCrawlComplete(username, crawlMode, accountImagesUploaded, accountError);
      console.log(`  Reported crawl-complete: ${crawlMode} mode, +${accountImagesUploaded} new image(s).`);
    } catch (err) {
      failedAccounts++;
      console.error(`ERROR processing @${username}: ${err.message}`);
      await reportCrawlComplete(username, crawlMode, accountImagesUploaded, err.message);
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
  if (recoveryPosts && failedAccounts > 0) throw new Error(`Recovery incomplete: ${failedAccounts} account(s) failed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
