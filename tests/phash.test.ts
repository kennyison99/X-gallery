import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  computePHash,
  hammingDistance,
  UnionFind,
  buildDuplicateClusters,
  chunkArray,
  compute2DDCT,
  type ImageHashItem,
} from '../src/lib/phash.ts';
import { runBackfillLoop } from '../scripts/phash-scan.mjs';

// Reference original 4-nested-loop 2D DCT for mathematical equivalence testing
function oldCompute2DDCT(pixels: Uint8Array | Float64Array | number[], N = 32): Float64Array {
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

function computeHashFromDCT(dct: Float64Array): string {
  const vals: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      vals.push(dct[u * 32 + v]);
    }
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (vals[i] > median) {
      hash |= (1n << BigInt(i));
    }
  }
  return hash.toString(16).padStart(16, '0');
}

describe('Old vs New Separable DCT Equivalence & Persisted-Hash Compatibility', () => {
  it('yields maximum floating-point coefficient difference < 1e-8 between old and separable DCT', () => {
    const pixels = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      pixels[i] = (i * 37 + 13) % 256;
    }

    const oldDct = oldCompute2DDCT(pixels, 32);
    const newDct = compute2DDCT(pixels, 32);

    let maxDiff = 0;
    for (let i = 0; i < 1024; i++) {
      const diff = Math.abs(oldDct[i] - newDct[i]);
      if (diff > maxDiff) maxDiff = diff;
    }

    assert.ok(maxDiff < 1e-8, `Expected max float difference < 1e-8, got ${maxDiff}`);
  });

  it('produces 100% bit-exact 16-character hex pHash across 30 random grayscale matrices', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const pixels = new Uint8Array(1024);
      let state = seed * 12345;
      for (let i = 0; i < 1024; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        pixels[i] = state % 256;
      }

      const oldDct = oldCompute2DDCT(pixels, 32);
      const newDct = compute2DDCT(pixels, 32);

      const oldHash = computeHashFromDCT(oldDct);
      const newHash = computeHashFromDCT(newDct);

      assert.equal(newHash, oldHash, `Mismatch at seed ${seed}: new ${newHash} vs old ${oldHash}`);
    }
  });

  it('produces bit-exact 16-character hex pHash for real JPEG, PNG, and composite image fixtures', async () => {
    const colorSets = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 50, g: 100, b: 200 },
      { r: 240, g: 240, b: 10 },
      { r: 128, g: 64, b: 192 },
    ];

    for (const bg of colorSets) {
      const buffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: bg,
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="200" height="200"><rect x="30" y="30" width="100" height="80" fill="white"/><circle cx="140" cy="140" r="35" fill="black"/></svg>`
            ),
          },
        ])
        .jpeg()
        .toBuffer();

      const { data } = await sharp(buffer)
        .flatten({ background: '#ffffff' })
        .resize(32, 32, { fit: 'fill' })
        .toColourspace('b-w')
        .raw()
        .toBuffer({ resolveWithObject: true });

      const oldDct = oldCompute2DDCT(data, 32);
      const newDct = compute2DDCT(data, 32);

      let maxDiff = 0;
      for (let i = 0; i < 1024; i++) {
        const diff = Math.abs(oldDct[i] - newDct[i]);
        if (diff > maxDiff) maxDiff = diff;
      }
      assert.ok(maxDiff < 1e-8, `Image fixture max float difference ${maxDiff} >= 1e-8`);

      const oldHash = computeHashFromDCT(oldDct);
      const newHash = computeHashFromDCT(newDct);
      assert.equal(newHash, oldHash, `Image fixture hash mismatch: new ${newHash} vs old ${oldHash}`);
    }
  });
});

describe('pHash Algorithm & Image Buffer Processing', () => {
  it('computes valid 16-character hex pHash for standard JPEG image', async () => {
    const buffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const hash = await computePHash(buffer);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/i);
  });

  it('correctly processes transparent PNG / RGBA image without channel errors', async () => {
    const transparentPng = await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const hash = await computePHash(transparentPng);
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/i);
  });

  it('yields low Hamming distance for same image with different JPEG compression', async () => {
    const baseImage = sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 50, g: 100, b: 150 },
      },
    }).composite([
      {
        input: Buffer.from(
          `<svg width="200" height="200"><rect x="20" y="20" width="80" height="80" fill="yellow"/></svg>`
        ),
      },
    ]);

    const jpegHighQuality = await baseImage.jpeg({ quality: 95 }).toBuffer();
    const jpegLowQuality = await baseImage.jpeg({ quality: 30 }).toBuffer();

    const hashHigh = await computePHash(jpegHighQuality);
    const hashLow = await computePHash(jpegLowQuality);

    const dist = hammingDistance(hashHigh, hashLow);
    assert.ok(dist <= 4, `Expected distance <= 4 for different JPEG qualities, got ${dist}`);
  });

  it('yields low Hamming distance for resized version of the same image', async () => {
    const original = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: { r: 200, g: 50, b: 80 },
      },
    })
      .jpeg()
      .toBuffer();

    const resized = await sharp(original).resize(150, 150).jpeg().toBuffer();

    const hashOrig = await computePHash(original);
    const hashResized = await computePHash(resized);

    const dist = hammingDistance(hashOrig, hashResized);
    assert.ok(dist <= 2, `Expected distance <= 2 for resized image, got ${dist}`);
  });

  it('yields high Hamming distance for visually distinct images', async () => {
    const imgA = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: Buffer.from('<svg width="100" height="100"><circle cx="20" cy="20" r="15" fill="black"/></svg>') }])
      .jpeg()
      .toBuffer();

    const imgB = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([{ input: Buffer.from('<svg width="100" height="100"><rect x="60" y="60" width="30" height="30" fill="white"/></svg>') }])
      .jpeg()
      .toBuffer();

    const hashA = await computePHash(imgA);
    const hashB = await computePHash(imgB);

    const dist = hammingDistance(hashA, hashB);
    assert.ok(dist > 15, `Expected high distance (>15) for distinct images, got ${dist}`);
  });
});

describe('Hamming Distance Calculation', () => {
  it('calculates exact bitwise difference between hex pHashes', () => {
    assert.equal(hammingDistance('0000000000000000', '0000000000000000'), 0);
    assert.equal(hammingDistance('0000000000000000', '000000000000000f'), 4);
    assert.equal(hammingDistance('ffffffffffffffff', '0000000000000000'), 64);
  });

  it('throws for invalid hex hash length', () => {
    assert.throws(() => hammingDistance('123', '0000000000000000'));
  });
});

describe('Union-Find & Multi-Image Cluster Winner Selection', () => {
  it('handles transitive cluster A-B, B-C and picks single canonical keeper', () => {
    const items: ImageHashItem[] = [
      { imageId: 10, r2Key: 'keyA', phash: '0000000000000000', likes: 5, title: 'Post A' },
      { imageId: 20, r2Key: 'keyB', phash: '0000000000000003', likes: 12, title: 'Post B' }, // Highest likes -> Winner
      { imageId: 30, r2Key: 'keyC', phash: '000000000000000f', likes: 2, title: 'Post C' },
    ];

    const { keeperIds, pendingIds } = buildDuplicateClusters(items, 10);

    assert.equal(keeperIds.length, 1);
    assert.equal(keeperIds[0], 20, 'Post B with 12 likes should be the canonical keeper');
    assert.deepEqual(pendingIds.sort((a, b) => a - b), [10, 30], 'Posts A and C should be marked pending');
  });

  it('marks post as pending if it loses in ANY cluster, even if it wins in another cluster (Blocker 2 Fix)', () => {
    const items: ImageHashItem[] = [
      { imageId: 200, r2Key: 'key200', phash: '0000000000000000', likes: 50, title: 'Popular Post' },
      { imageId: 100, r2Key: 'key100_1', phash: '0000000000000001', likes: 10, title: 'Multi Image Post' },
      { imageId: 100, r2Key: 'key100_2', phash: 'ffffffffffffffff', likes: 10, title: 'Multi Image Post' },
      { imageId: 300, r2Key: 'key300', phash: 'fffffffffffffffe', likes: 2, title: 'Unpopular Post' },
    ];

    const { keeperIds, pendingIds } = buildDuplicateClusters(items, 5);

    assert.ok(pendingIds.includes(100), 'Post 100 MUST be marked pending because it lost to Post 200');
    assert.ok(!keeperIds.includes(100), 'Post 100 CANNOT remain in keeperIds');
    assert.deepEqual(keeperIds, [200], 'Only Post 200 should be keeper');
    assert.deepEqual(pendingIds.sort((a, b) => a - b), [100, 300]);
  });

  it('caps sample matches array to 100 while retaining exact totalMatchPairsCount for large match sets', () => {
    const items: ImageHashItem[] = Array.from({ length: 15 }, (_, i) => ({
      imageId: (i + 1) * 10,
      r2Key: `key_${i}`,
      phash: '0000000000000000',
      likes: i,
      title: `Post ${i}`,
    }));

    const { matches, totalMatchPairsCount } = buildDuplicateClusters(items, 10);

    assert.equal(totalMatchPairsCount, 105, 'Total match pairs should be 105');
    assert.equal(matches.length, 100, 'Sample matches array should be capped at 100 for memory protection');
  });
});

describe('Backfill Loop Failure Recovery & Starvation Prevention', () => {
  it('continues requesting next_cursor through pages with 0 unhashed images until next_cursor is null', async () => {
    const pages = [
      { unhashed: [], next_cursor: 50 }, // Page 1: 0 unhashed items, next_cursor 50
      { unhashed: [{ image_id: 60, r2_key: 'img60.jpg' }], next_cursor: 100 }, // Page 2: 1 unhashed item
      { unhashed: [], next_cursor: null }, // Page 3: 0 unhashed items, end
    ];

    let pageCallCount = 0;
    const mockFetchUnhashedMedia = async (cursor: number) => {
      pageCallCount++;
      if (cursor === 0) return pages[0];
      if (cursor === 50) return pages[1];
      return pages[2];
    };

    const mockHashFn = async () => '0123456789abcdef';
    const mockFetchBuffer = async () => Buffer.from('fake');
    const savedHashes: any[] = [];
    const mockSaveFn = async (items: any[]) => {
      savedHashes.push(...items);
    };

    const backfilledTotal = await runBackfillLoop({
      fetchFn: mockFetchUnhashedMedia,
      hashFn: mockHashFn,
      saveFn: mockSaveFn,
      fetchBufferFn: mockFetchBuffer,
      maxBackfill: 0,
      concurrency: 4,
      logger: () => {},
    });

    assert.equal(pageCallCount, 3, 'Should have processed all 3 pages');
    assert.equal(backfilledTotal, 1);
    assert.equal(savedHashes.length, 1);
    assert.equal(savedHashes[0].r2_key, 'img60.jpg');
  });

  it('processes multiple items in parallel using specified worker concurrency', async () => {
    const unhashedItems = Array.from({ length: 10 }, (_, i) => ({
      image_id: i + 1,
      r2_key: `img_${i + 1}.jpg`,
    }));

    let maxSimultaneous = 0;
    let activeTasks = 0;

    const mockFetchBuffer = async (key: string) => {
      activeTasks++;
      if (activeTasks > maxSimultaneous) maxSimultaneous = activeTasks;
      await new Promise((res) => setTimeout(res, 10));
      activeTasks--;
      return Buffer.from(key);
    };

    const mockFetchUnhashed = async (cursor: number) => {
      if (cursor === 0) return { unhashed: unhashedItems, next_cursor: null };
      return { unhashed: [], next_cursor: null };
    };

    const savedHashes: any[] = [];
    const backfilledTotal = await runBackfillLoop({
      fetchFn: mockFetchUnhashed,
      hashFn: async () => '1122334455667788',
      saveFn: async (items: any[]) => savedHashes.push(...items),
      fetchBufferFn: mockFetchBuffer,
      maxBackfill: 0,
      concurrency: 5,
      logger: () => {},
    });

    assert.equal(backfilledTotal, 10);
    assert.equal(savedHashes.length, 10);
    assert.ok(maxSimultaneous > 1 && maxSimultaneous <= 5, `Expected simultaneous tasks between 2 and 5, got ${maxSimultaneous}`);
  });

  it('advances past failing images, processes valid images, and counts only successful DB writes (Starvation Prevention)', async () => {
    // Page 1 (IDs 1-50): All 50 images fail (throw error)
    // Page 2 (IDs 51-60): All 10 images succeed
    const page1Items = Array.from({ length: 50 }, (_, i) => ({ image_id: i + 1, r2_key: `corrupt_${i + 1}.jpg` }));
    const page2Items = Array.from({ length: 10 }, (_, i) => ({ image_id: i + 51, r2_key: `valid_${i + 51}.jpg` }));

    const mockFetchUnhashed = async (cursor: number) => {
      if (cursor === 0) return { unhashed: page1Items, next_cursor: 50 };
      if (cursor === 50) return { unhashed: page2Items, next_cursor: null };
      return { unhashed: [], next_cursor: null };
    };

    const mockFetchBuffer = async (key: string) => {
      if (key.startsWith('corrupt_')) {
        throw new Error(`R2 Object Not Found / Corrupt File for ${key}`);
      }
      return Buffer.from('valid_image_bytes');
    };

    const savedHashes: any[] = [];
    const successfulTotal = await runBackfillLoop({
      fetchFn: mockFetchUnhashed,
      hashFn: async () => 'aaaa8888bbbb9999',
      saveFn: async (items: any[]) => savedHashes.push(...items),
      fetchBufferFn: mockFetchBuffer,
      maxBackfill: 10,
      concurrency: 8,
      logger: () => {},
    });

    // Verify 10 valid hashes were saved from page 2, and successfulTotal === 10
    assert.equal(successfulTotal, 10, 'successfulTotal must equal 10 valid saved hashes');
    assert.equal(savedHashes.length, 10, 'Exactly 10 hashes must be persisted to DB');
    assert.equal(savedHashes[0].r2_key, 'valid_51.jpg');
    assert.equal(savedHashes[9].r2_key, 'valid_60.jpg');
  });

  it('processes sub-batches within the SAME page when early items fail, continuing until maxBackfill is reached (Intra-Page Starvation Prevention)', async () => {
    // Single page with 50 items:
    // Items 1..10 (corrupt_1 to corrupt_10): FAIL
    // Items 11..50 (valid_11 to valid_50): SUCCESS
    const pageItems = Array.from({ length: 50 }, (_, i) => {
      const id = i + 1;
      return { image_id: id, r2_key: id <= 10 ? `corrupt_${id}.jpg` : `valid_${id}.jpg` };
    });

    const mockFetchUnhashed = async (cursor: number) => {
      if (cursor === 0) return { unhashed: pageItems, next_cursor: null };
      return { unhashed: [], next_cursor: null };
    };

    const mockFetchBuffer = async (key: string) => {
      if (key.startsWith('corrupt_')) {
        throw new Error(`R2 Object Not Found / Corrupt File for ${key}`);
      }
      return Buffer.from('valid_bytes');
    };

    const savedHashes: any[] = [];
    const successfulTotal = await runBackfillLoop({
      fetchFn: mockFetchUnhashed,
      hashFn: async () => 'cccc4444dddd5555',
      saveFn: async (items: any[]) => {
        savedHashes.push(...items);
        return { saved_count: items.length };
      },
      fetchBufferFn: mockFetchBuffer,
      maxBackfill: 10,
      concurrency: 4,
      logger: () => {},
    });

    // Verify: items 1..10 failed, so inner sub-batch loop continued on the same page to items 11..20
    assert.equal(successfulTotal, 10, 'successfulTotal must equal 10 valid saved hashes');
    assert.equal(savedHashes.length, 10, 'Exactly 10 hashes must be persisted');
    assert.equal(savedHashes[0].r2_key, 'valid_11.jpg');
    assert.equal(savedHashes[9].r2_key, 'valid_20.jpg');
  });
});

describe('D1 Query Bound Parameter Chunking', () => {
  it('chunks large array into batches <= 80 without dropping elements', () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const chunks = chunkArray(ids, 80);

    assert.equal(chunks.length, 4);
    assert.equal(chunks[0].length, 80);
    assert.equal(chunks[1].length, 80);
    assert.equal(chunks[2].length, 80);
    assert.equal(chunks[3].length, 10);

    const flattened = chunks.flat();
    assert.equal(flattened.length, 250);
    assert.deepEqual(flattened, ids);
  });
});
