import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";

// Shared xtractor binary management + CLI invocation.
// Used by crawl-twitter.mjs and fix-db-links.mjs so both scripts resolve the
// binary to the same on-disk location (scripts/.xtractor-bin) and share the
// SHA-256-verified download + JSON parsing logic.

// xtractor binary (pinned release, SHA-256 verified against the GitHub release digest).
// Source: https://github.com/afkarxyz/xtractor-binaries (MIT).
// The extractor is a PyInstaller binary; the CLI contract below mirrors
// https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader backend/twitter.go
const DEFAULT_XTRACTOR_VERSION = "v1.1";
const XTRACTOR_RELEASE_URL = `https://api.github.com/repos/afkarxyz/xtractor-binaries/releases/tags/${DEFAULT_XTRACTOR_VERSION}`;
const DEFAULT_XTRACTOR_ASSETS = {
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

// Local cache locations (kept under scripts/ so the workflow can cache them).
// Resolved relative to the current working directory, which both scripts run
// from the repository root, matching the actions/cache path "scripts/.xtractor-bin".
const BIN_DIR = path.resolve("scripts/.xtractor-bin");
const XTRACTOR_EXE = process.platform === "win32" ? "xtractor.exe" : "xtractor";
const XTRACTOR_PATH = path.join(BIN_DIR, XTRACTOR_EXE);
const XTRACTOR_VERSION_PATH = path.join(BIN_DIR, "xtractor-version.json");

// ---------------------------------------------------------------------------
// Binary management
// ---------------------------------------------------------------------------

function xtractorAssetName(platform = process.platform, arch = process.arch) {
  const archName = arch === "arm64" ? "arm64" : "amd64";
  if (platform === "linux") return `linux-${archName}.zip`;
  if (platform === "win32") return `windows-${archName}.zip`;
  if (platform === "darwin") return `macos-${archName}.zip`;
  throw new Error(`unsupported platform for xtractor: ${platform}`);
}

function pickDefaultAsset(platform = process.platform, arch = process.arch) {
  if (platform === "linux") return DEFAULT_XTRACTOR_ASSETS.linux;
  if (platform === "win32") return DEFAULT_XTRACTOR_ASSETS.win32;
  if (platform === "darwin") {
    const archName = arch === "arm64" ? "arm64" : "amd64";
    return DEFAULT_XTRACTOR_ASSETS.darwin[archName];
  }
  throw new Error(`unsupported platform for xtractor: ${platform}`);
}

async function resolveXtractorAsset(fetchImpl = fetch, platform = process.platform, arch = process.arch) {
  try {
    const res = await fetchImpl(XTRACTOR_RELEASE_URL, {
      headers: { "User-Agent": "magical-brahmagupta-crawler" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    const name = xtractorAssetName(platform, arch);
    const releaseAsset = release.assets?.find((asset) => asset.name === name);
    const sha256 = releaseAsset?.digest?.replace(/^sha256:/, "");
    if (!release.tag_name || !releaseAsset?.browser_download_url || !sha256) {
      throw new Error(`${DEFAULT_XTRACTOR_VERSION} xtractor release is missing ${name}`);
    }
    return { version: release.tag_name, url: releaseAsset.browser_download_url, sha256 };
  } catch (err) {
    if (fetchImpl !== fetch) throw err;
    console.warn(`Could not resolve xtractor ${DEFAULT_XTRACTOR_VERSION} release (${err.message}); using bundled metadata.`);
    return { version: DEFAULT_XTRACTOR_VERSION, ...pickDefaultAsset(platform, arch) };
  }
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
  const asset = await resolveXtractorAsset();
  if (fs.existsSync(XTRACTOR_PATH) && readInstalledVersion() === asset.version) {
    if (process.platform !== "win32") {
      try { fs.chmodSync(XTRACTOR_PATH, 0o755); } catch { /* ignore */ }
    }
    console.log(`xtractor ${asset.version} already installed at ${XTRACTOR_PATH}`);
    return asset;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = path.join(BIN_DIR, "xtractor.zip");

  console.log(`Downloading xtractor ${asset.version}...`);
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
  writeInstalledVersion(asset.version);
  console.log(`  Installed to ${XTRACTOR_PATH}`);
  return asset;
}

// ---------------------------------------------------------------------------
// CLI invocation + JSON parsing
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
        // Wrap 15+ digit integers in quotes to prevent precision loss in JS JSON.parse
        const sanitized = candidate.replace(/:\s*(\d{15,})/g, ': "$1"');
        return JSON.parse(sanitized);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch ALL media items for an author by paginating through their /media
// timeline via --cursor. Returns a flat array of media items.
// Used by fix-db-links.mjs to build a complete tweet-ID map so tweets beyond
// the first page (older posts) can still be matched against rounded DB IDs.
async function extractAllMedia(username, authToken, {
  maxPages = 80,
  pageLimit = 100,
  pageDelayMs = 800,
  retweets = true,
} = {}) {
  const url = `https://x.com/${username}/media`;
  const baseArgs = [
    "--type", "all",
    "--retweets", retweets ? "include" : "skip",
    "--limit", String(pageLimit),
  ];
  const items = [];
  let cursor = "";
  let pages = 0;

  while (pages < maxPages) {
    const args = [...baseArgs];
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
    const done = resp.completed === true || !resp.cursor || pageItems.length === 0;
    console.log(`  Page ${pages}: +${pageItems.length} (total ${items.length})`);
    if (done) break;
    cursor = resp.cursor;
    if (pageDelayMs > 0) await sleep(pageDelayMs);
  }
  return items;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "--print-version") {
  const asset = await resolveXtractorAsset();
  console.log(asset.version);
}

export { DEFAULT_XTRACTOR_VERSION as XTRACTOR_VERSION, XTRACTOR_PATH, ensureXtractor, runXtractor, extractAllMedia, resolveXtractorAsset };
