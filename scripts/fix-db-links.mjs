import { ensureXtractor, extractAllMedia } from "./xtractor-lib.mjs";

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

async function main() {
  console.log(`Starting DB post links repair via API endpoint...`);
  console.log(`SITE_URL: ${SITE_URL}\n`);

  // Ensure the xtractor binary is present (downloads + SHA-256 verifies if missing).
  await ensureXtractor();

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

  for (let authorIdx = 0; authorIdx < authors.length; authorIdx++) {
    const author = authors[authorIdx];
    console.log(`\n------------------------------------------------------------`);
    console.log(`Fetching correct tweet IDs for @${author} via xtractor...`);
    try {
      // Paginate through the author's full media timeline so older tweets
      // (beyond the first page) can still be matched against rounded DB IDs.
      const media = await extractAllMedia(author, authToken);
      console.log(`Retrieved ${media.length} media items for @${author}.`);

      // Extract unique correct tweet IDs (strings) and build a Number->ID
      // lookup map for O(1) matching against rounded DB IDs.
      const correctIdByNum = new Map();
      for (const m of media) {
        const tid = String(m.tweet_id);
        if (!tid) continue;
        correctIdByNum.set(Number(tid), tid);
      }
      
      const authorImages = imagesByAuthor[author];
      let matchCount = 0;

      for (const img of authorImages) {
        const match = img.post_url.match(/\/status\/(\d+)/);
        if (!match) continue;
        const roundedIdStr = match[1];
        const roundedIdNum = Number(roundedIdStr);

        // Find the correct tweet ID whose Number representation matches the
        // rounded DB ID (both lose precision the same way, so they compare equal).
        const matchedCorrectId = correctIdByNum.get(roundedIdNum);
        if (matchedCorrectId) {
          if (matchedCorrectId !== roundedIdStr) {
            const newPostUrl = img.post_url.replace(roundedIdStr, matchedCorrectId);
            console.log(`  [Matched] Image ID ${img.id}: ${roundedIdStr} -> ${matchedCorrectId}`);
            updates.push({ id: img.id, post_url: newPostUrl });
            matchCount++;
          }
        } else {
          console.log(`  [Skip] Image ID ${img.id}: Rounded ID ${roundedIdStr} could not be matched (tweet may be deleted or beyond the crawled timeline).`);
        }
      }
      console.log(`Matched @${author}: ${matchCount}/${authorImages.length} links.`);
    } catch (err) {
      console.error(`  Failed to process @${author}:`, err.message);
    }

    // Pause between authors to avoid rate limiting during pagination.
    if (authorIdx < authors.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
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
