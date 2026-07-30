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

describe('Union-Find & Cluster Canonical Winner Selection', () => {
  it('handles transitive cluster A-B, B-C and picks single canonical keeper', () => {
    // Hashes where A <-> B (dist 2) and B <-> C (dist 2)
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

  it('breaks tie in likes by selecting smaller imageId (earliest post)', () => {
    const items: ImageHashItem[] = [
      { imageId: 105, r2Key: 'key1', phash: 'aaaaaaaaaaaaaaaa', likes: 10, title: 'Later Post' },
      { imageId: 42, r2Key: 'key2', phash: 'aaaaaaaaaaaaaaab', likes: 10, title: 'Earlier Post' },
    ];

    const { keeperIds, pendingIds } = buildDuplicateClusters(items, 5);

    assert.equal(keeperIds[0], 42, 'Post #42 should win tie due to earlier ID');
    assert.deepEqual(pendingIds, [105]);
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
