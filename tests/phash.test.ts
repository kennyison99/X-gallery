import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  computePHash,
  hammingDistance,
  UnionFind,
  buildDuplicateClusters,
  chunkArray,
  type ImageHashItem,
} from '../src/lib/phash.ts';
import { runBackfillLoop } from '../scripts/phash-scan.mjs';

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
    // Multi-image post scenario:
    // Post 100 has 2 images: key100_1 and key100_2
    // Post 200 (50 likes) vs key100_1 (10 likes) -> Post 200 wins, Post 100 loses (added to pending)
    // Post 300 (2 likes) vs key100_2 (10 likes) -> Post 100 wins, Post 300 loses
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
});

describe('Backfill Loop Pagination through Empty Intermediate Pages (Blocker 1 Fix)', () => {
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
      delayMs: 0,
      logger: () => {},
    });

    assert.equal(pageCallCount, 3, 'Should have processed all 3 pages');
    assert.equal(backfilledTotal, 1);
    assert.equal(savedHashes.length, 1);
    assert.equal(savedHashes[0].r2_key, 'img60.jpg');
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
