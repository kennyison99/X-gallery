import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Setup paths matching crawl-twitter.mjs
const DB_NAME = "gallery-db";
const BIN_DIR = path.join(process.cwd(), "bin");
const XTRACTOR_EXE = process.platform === "win32" ? "xtractor.exe" : "xtractor";
const XTRACTOR_PATH = path.join(BIN_DIR, XTRACTOR_EXE);

// Load auth token from cookies
const TWITTER_COOKIES = process.env.TWITTER_COOKIES ?? "";
function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
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
const cookies = parseCookies(TWITTER_COOKIES);
const authToken = cookies.auth_token ?? "";

if (!authToken) {
  console.error("ERROR: auth_token not found in TWITTER_COOKIES. Make sure you set TWITTER_COOKIES env var.");
  process.exit(1);
}

function extractBalancedAt(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return "";
}

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
        // try next
      }
    }
    searchFrom = start + 1;
  }
  return null;
}

async function runXtractor(url, token, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [url, "--auth-token", token, "--json", "--metadata", ...extraArgs];
    const child = spawn(XTRACTOR_PATH, args, {
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`xtractor exited with code ${code}. stderr: ${stderr.trim()}`));
      } else {
        const parsed = parseCliResponse(stdout) || parseCliResponse(`${stdout}\n${stderr}`);
        resolve(parsed);
      }
    });
    child.on("error", reject);
  });
}

function runD1Query(sql, isRemote = true) {
  const remoteFlag = isRemote ? "--remote" : "--local";
  // Escape backslashes and double quotes for PowerShell / Shell
  const escapedSql = sql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${remoteFlag} --command="${escapedSql}" --json`;
  const output = execSync(cmd).toString();
  try {
    const parsed = JSON.parse(output);
    return parsed[0].results || [];
  } catch (err) {
    console.error("Failed to parse D1 output:", output);
    throw err;
  }
}

function executeD1(sql, isRemote = true) {
  const remoteFlag = isRemote ? "--remote" : "--local";
  const escapedSql = sql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${remoteFlag} --command="${escapedSql}"`;
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  const isRemote = process.argv.includes("--local") ? false : true;
  const envLabel = isRemote ? "REMOTE (production)" : "LOCAL";
  console.log(`Starting DB post links repair on ${envLabel} database...\n`);

  console.log("Fetching images with status URLs from D1...");
  const sql = "SELECT id, author, post_url FROM images WHERE post_url LIKE '%/status/%'";
  const images = runD1Query(sql, isRemote);
  console.log(`Found ${images.length} posts with status links.`);

  if (images.length === 0) {
    console.log("No links to repair. Exiting.");
    return;
  }

  // Group images by author to run xtractor once per author
  const imagesByAuthor = {};
  for (const img of images) {
    if (!imagesByAuthor[img.author]) imagesByAuthor[img.author] = [];
    imagesByAuthor[img.author].push(img);
  }

  const authors = Object.keys(imagesByAuthor);
  console.log(`Processing ${authors.length} authors...`);

  for (const author of authors) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`Fetching correct tweet IDs for @${author} via xtractor...`);
    const url = `https://x.com/${author}/media`;
    try {
      const resp = await runXtractor(url, authToken, ["--type", "all", "--limit", "300"]);
      const media = resp.media || [];
      console.log(`Retrieved ${media.length} media items for @${author}.`);

      // Extract unique correct tweet IDs (strings)
      const correctTweetIds = Array.from(new Set(media.map(m => String(m.tweet_id)).filter(Boolean)));
      
      const authorImages = imagesByAuthor[author];
      let matchCount = 0;

      for (const img of authorImages) {
        // Parse rounded ID from post_url
        const match = img.post_url.match(/\/status\/(\d+)/);
        if (!match) continue;
        const roundedIdStr = match[1];
        const roundedIdNum = Number(roundedIdStr);

        // Find a correct tweet ID that matches when converted to Number
        const matchedCorrectId = correctTweetIds.find(cid => Number(cid) === roundedIdNum);
        if (matchedCorrectId) {
          if (matchedCorrectId !== roundedIdStr) {
            const newPostUrl = img.post_url.replace(roundedIdStr, matchedCorrectId);
            console.log(`  [Fix] Image ID ${img.id}: ${roundedIdStr} -> ${matchedCorrectId}`);
            
            const updateSql = `UPDATE images SET post_url = '${newPostUrl}' WHERE id = ${img.id}`;
            executeD1(updateSql, isRemote);
            matchCount++;
          }
        } else {
          // If the tweet wasn't found in the latest 300 media items, we can optionally search for it or skip
          console.log(`  [Skip] Image ID ${img.id}: Rounded ID ${roundedIdStr} could not be matched (tweet may be older than the limit or deleted).`);
        }
      }
      console.log(`Completed @${author}: Repaired ${matchCount}/${authorImages.length} links.`);
    } catch (err) {
      console.error(`  Failed to process @${author}:`, err.message);
    }
  }

  console.log("\nAll done!");
}

main().catch(console.error);
