import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Load config from environment variables
const SITE_URL = (process.env.SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? "";
const TWITTER_COOKIES = process.env.TWITTER_COOKIES ?? "";

if (!CRAWL_API_KEY) {
  console.error("ERROR: CRAWL_API_KEY environment variable is not configured.");
  process.exit(1);
}

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

// Find xtractor binary
const BIN_DIR = path.join(process.cwd(), "bin");
const XTRACTOR_EXE = process.platform === "win32" ? "xtractor.exe" : "xtractor";
const XTRACTOR_PATH = path.join(BIN_DIR, XTRACTOR_EXE);

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

async function main() {
  console.log(`Starting DB post links repair via API endpoint...`);
  console.log(`SITE_URL: ${SITE_URL}\n`);

  console.log("Fetching images requiring repair from site API...");
  const fetchUrl = `${SITE_URL}/api/fix-links?api_key=${encodeURIComponent(CRAWL_API_KEY)}`;
  const fetchRes = await fetch(fetchUrl);
  if (!fetchRes.ok) {
    const errText = await fetchRes.text();
    throw new Error(`Failed to fetch images from API: HTTP ${fetchRes.status} - ${errText}`);
  }
  const images = await fetchRes.json();
  console.log(`Found ${images.length} posts with status links in the database.`);

  if (images.length === 0) {
    console.log("No links to repair. Exiting.");
    return;
  }

  // Group images by author
  const imagesByAuthor = {};
  for (const img of images) {
    if (!imagesByAuthor[img.author]) imagesByAuthor[img.author] = [];
    imagesByAuthor[img.author].push(img);
  }

  const authors = Object.keys(imagesByAuthor);
  console.log(`Processing ${authors.length} authors...`);

  const updates = [];

  for (const author of authors) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`Fetching correct tweet IDs for @${author} via xtractor...`);
    const url = `https://x.com/${author}/media`;
    try {
      // Fetch latest 300 media items for the author
      const resp = await runXtractor(url, authToken, ["--type", "all", "--limit", "300"]);
      const media = resp.media || [];
      console.log(`Retrieved ${media.length} media items for @${author}.`);

      // Extract unique correct tweet IDs (strings)
      const correctTweetIds = Array.from(new Set(media.map(m => String(m.tweet_id)).filter(Boolean)));
      
      const authorImages = imagesByAuthor[author];
      let matchCount = 0;

      for (const img of authorImages) {
        const match = img.post_url.match(/\/status\/(\d+)/);
        if (!match) continue;
        const roundedIdStr = match[1];
        const roundedIdNum = Number(roundedIdStr);

        // Find a correct tweet ID that matches when converted to Number
        const matchedCorrectId = correctTweetIds.find(cid => Number(cid) === roundedIdNum);
        if (matchedCorrectId) {
          if (matchedCorrectId !== roundedIdStr) {
            const newPostUrl = img.post_url.replace(roundedIdStr, matchedCorrectId);
            console.log(`  [Matched] Image ID ${img.id}: ${roundedIdStr} -> ${matchedCorrectId}`);
            updates.push({ id: img.id, post_url: newPostUrl });
            matchCount++;
          }
        } else {
          console.log(`  [Skip] Image ID ${img.id}: Rounded ID ${roundedIdStr} could not be matched (tweet may be older than the limit or deleted).`);
        }
      }
      console.log(`Matched @${author}: ${matchCount}/${authorImages.length} links.`);
    } catch (err) {
      console.error(`  Failed to process @${author}:`, err.message);
    }
  }

  if (updates.length > 0) {
    console.log(`\nSending ${updates.length} updates to D1 database via API...`);
    const saveRes = await fetch(`${SITE_URL}/api/fix-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: CRAWL_API_KEY, updates })
    });
    if (!saveRes.ok) {
      const errText = await saveRes.text();
      throw new Error(`Failed to save updates to D1: HTTP ${saveRes.status} - ${errText}`);
    }
    const saveResult = await saveRes.json();
    console.log(`Successfully repaired ${saveResult.count} links in the production database!`);
  } else {
    console.log("\nNo matching links found to repair.");
  }

  console.log("All done!");
}

main().catch(console.error);
