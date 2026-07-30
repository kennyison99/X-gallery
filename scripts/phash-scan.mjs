// Perceptual Hash (pHash) similarity scan script for X-gallery images.
// Scans published images, computes 64-bit DCT pHash, finds highly similar pairs,
// and moves duplicate/similar posts into pending review (published = 0).

import sharp from 'sharp';

const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');
const CRAWL_API_KEY = process.env.CRAWL_API_KEY ?? '';
const APPLY = process.argv.includes('--apply');

function getArgValue(prefix, fallback) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return fallback;
  const val = arg.split('=')[1];
  if (!val) return fallback;
  if (val.toLowerCase() === 'all') return 0;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

const THRESHOLD = getArgValue('--threshold=', 10);
const MAX_IMAGES = getArgValue('--limit=', 50); // Default max 50 images to respect Cloudflare rate limits
const REQUEST_DELAY_MS = getArgValue('--delay=', 100); // 100ms delay between image fetches to prevent rate limiting
const PAGE_SIZE = 50;
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

if (!CRAWL_API_KEY) {
  console.error('ERROR: CRAWL_API_KEY environment variable is not configured.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVideoKey(key) {
  const ext = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return VIDEO_EXTS.has(ext);
}

function compute2DDCT(pixels, N = 32) {
  const dct = new Float64Array(N * N);
  const c = new Float64Array(N);
  c[0] = 1 / Math.sqrt(2);
  for (let i = 1; i < N; i++) c[i] = 1;

  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          sum += pixels[x * N + y]
            * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))
            * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
        }
      }
      dct[u * N + v] = 0.25 * c[u] * c[v] * sum;
    }
  }
  return dct;
}

async function computePHash(imageBuffer) {
  const rawPixels = await sharp(imageBuffer)
    .resize(32, 32, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  const dct = compute2DDCT(rawPixels, 32);

  // Extract top-left 8x8 AC coefficients (excluding DC at [0,0])
  const vals = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) continue;
      vals.push(dct[u * 32 + v]);
    }
  }

  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  let hash = 0n;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > median) {
      hash |= 1n << BigInt(i);
    }
  }

  return hash;
}

function hammingDistance(hashA, hashB) {
  let diff = hashA ^ hashB;
  let count = 0n;
  while (diff > 0n) {
    diff &= diff - 1n;
    count++;
  }
  return Number(count);
}

async function fetchPublishedPosts() {
  const posts = [];
  let cursor = 0;
  let page = 0;

  do {
    const params = new URLSearchParams({ cursor: String(cursor), limit: String(PAGE_SIZE), api_key: CRAWL_API_KEY });
    const response = await fetch(`${SITE_URL}/api/phash-scan?${params}`, {
      headers: { 'X-API-Key': CRAWL_API_KEY },
    });
    if (!response.ok) {
      throw new Error(`Fetch published posts failed: HTTP ${response.status} - ${await response.text()}`);
    }
    const result = await response.json();
    if (!Array.isArray(result.images)) {
      throw new Error('Invalid response structure from /api/phash-scan');
    }
    posts.push(...result.images);
    cursor = result.next_cursor;
    page++;
  } while (cursor !== null);

  return posts;
}

async function fetchImageBuffer(r2Key) {
  const url = `${SITE_URL}/api/r2/${encodeURIComponent(r2Key)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for key "${r2Key}"`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  console.log('=== pHash Image Similarity Scan ===');
  console.log(`SITE_URL    : ${SITE_URL}`);
  console.log(`Mode        : ${APPLY ? 'APPLY (move to pending)' : 'DRY-RUN'}`);
  console.log(`Threshold   : ${THRESHOLD} bits (Hamming Distance <= ${THRESHOLD})`);
  console.log(`Max Images  : ${MAX_IMAGES > 0 ? MAX_IMAGES + ' (Rate-limit protection)' : 'Unlimited'}`);
  console.log(`Delay/Fetch : ${REQUEST_DELAY_MS} ms`);
  console.log('Fetching published posts...');

  const posts = await fetchPublishedPosts();
  console.log(`Total published posts in DB: ${posts.length}`);

  if (posts.length === 0) {
    console.log('No published posts found. Exiting.');
    return;
  }

  console.log('Computing pHashes for image assets (with rate limit protection)...');
  const imageHashes = [];

  for (let i = 0; i < posts.length; i++) {
    if (MAX_IMAGES > 0 && imageHashes.length >= MAX_IMAGES) {
      console.log(`Reached limit of ${MAX_IMAGES} images (CF free rate limit protection). Stopping image fetch.`);
      break;
    }

    const post = posts[i];
    const keys = (post.r2_keys || '').split(',').map((k) => k.trim()).filter(Boolean);
    const imageKeys = keys.filter((k) => !isVideoKey(k));

    for (const key of imageKeys) {
      if (MAX_IMAGES > 0 && imageHashes.length >= MAX_IMAGES) break;

      try {
        if (REQUEST_DELAY_MS > 0 && imageHashes.length > 0) {
          await sleep(REQUEST_DELAY_MS);
        }
        const buffer = await fetchImageBuffer(key);
        const hash = await computePHash(buffer);
        imageHashes.push({
          postId: post.id,
          postUrl: post.post_url,
          title: post.title,
          author: post.author,
          createdAt: post.created_at,
          likes: post.likes || 0,
          r2Key: key,
          hash,
        });
      } catch (err) {
        console.warn(`  [Warning] Failed to hash key "${key}" (Post #${post.id}): ${err.message}`);
      }
    }

    if ((i + 1) % 10 === 0 || i + 1 === posts.length || (MAX_IMAGES > 0 && imageHashes.length >= MAX_IMAGES)) {
      console.log(`  Processed ${imageHashes.length} image hash(es)...`);
    }
  }

  console.log(`Comparing ${imageHashes.length} images for pHash similarity...`);
  const flaggedPostIds = new Set();
  const matches = [];

  for (let i = 0; i < imageHashes.length; i++) {
    for (let j = i + 1; j < imageHashes.length; j++) {
      const a = imageHashes[i];
      const b = imageHashes[j];

      if (a.postId === b.postId) continue; // Skip images within same post

      const dist = hammingDistance(a.hash, b.hash);
      if (dist <= THRESHOLD) {
        let keep = a;
        let flag = b;

        if (b.likes > a.likes || (b.likes === a.likes && b.postId < a.postId)) {
          keep = b;
          flag = a;
        }

        flaggedPostIds.add(flag.postId);
        matches.push({
          keepPostId: keep.postId,
          keepTitle: keep.title,
          flagPostId: flag.postId,
          flagTitle: flag.title,
          distance: dist,
          similarity: `${(((63 - dist) / 63) * 100).toFixed(1)}%`,
        });
      }
    }
  }

  if (matches.length === 0) {
    console.log('No high pHash similarity images found. All clean!');
    return;
  }

  console.log(`\nFound ${matches.length} high pHash similarity match(es):`);
  for (const m of matches) {
    console.log(`  Match: Distance ${m.distance} (${m.similarity} similarity)`);
    console.log(`    Keep published : Post #${m.keepPostId} ("${m.keepTitle || 'Untitled'}")`);
    console.log(`    Move to pending: Post #${m.flagPostId} ("${m.flagTitle || 'Untitled'}")`);
  }

  const pendingList = [...flaggedPostIds];
  console.log(`\nTotal unique posts to move to pending review: ${pendingList.length} (IDs: ${pendingList.join(', ')})`);

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to move these posts to pending review.');
    return;
  }

  console.log(`\nApplying changes: Moving ${pendingList.length} post(s) to pending review...`);
  const response = await fetch(`${SITE_URL}/api/phash-scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CRAWL_API_KEY,
    },
    body: JSON.stringify({
      api_key: CRAWL_API_KEY,
      pending_ids: pendingList,
    }),
  });

  if (!response.ok) {
    throw new Error(`Apply failed: HTTP ${response.status} - ${await response.text()}`);
  }

  const result = await response.json();
  console.log(`Successfully moved ${result.updated_count} post(s) to pending review!`);
}

main().catch((error) => {
  console.error('Fatal error during pHash scan:', error);
  process.exit(1);
});
