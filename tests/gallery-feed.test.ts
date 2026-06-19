import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const feed = await import('../src/lib/gallery-feed.ts').catch(() => ({}));
const parseGalleryBatchParams = feed.parseGalleryBatchParams ?? (() => undefined);
const takeGalleryBatch = feed.takeGalleryBatch ?? (() => undefined);
const buildGalleryQuery = feed.buildGalleryQuery ?? (() => ({ sql: '', bindings: [] }));

test('parses a valid oldest batch and caps its limit at 48', () => {
  const params = new URLSearchParams('sort=oldest&offset=48&limit=100&tag=art&author=alice');
  assert.deepEqual(parseGalleryBatchParams(params), {
    sort: 'oldest',
    offset: 48,
    limit: 48,
    tag: 'art',
    author: 'alice',
  });
});

test('defaults the initial feed to newest offset zero and 48 posts', () => {
  assert.deepEqual(parseGalleryBatchParams(new URLSearchParams()), {
    sort: 'newest',
    offset: 0,
    limit: 48,
    tag: null,
    author: null,
  });
});

test('rejects invalid sort and offset values', () => {
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('sort=random')), /sort/);
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('offset=-1')), /offset/);
});

test('uses one extra row to report whether another batch exists', () => {
  const rows = Array.from({ length: 25 }, (_, id) => ({ id }));

  assert.deepEqual(takeGalleryBatch(rows, 24), {
    items: rows.slice(0, 24),
    hasMore: true,
  });
  assert.deepEqual(takeGalleryBatch(rows.slice(0, 24), 24), {
    items: rows.slice(0, 24),
    hasMore: false,
  });
});

test('builds a newest unfiltered query with a stable id tie breaker', () => {
  const query = buildGalleryQuery(parseGalleryBatchParams(new URLSearchParams()));

  assert.match(query.sql, /WHERE i\.published = 1/);
  assert.match(query.sql, /ORDER BY i\.created_at DESC, i\.id DESC/);
  assert.match(query.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(query.bindings, [49, 0]);
});

test('binds filters before batch controls and reverses both sort keys', () => {
  const options = parseGalleryBatchParams(
    new URLSearchParams('sort=oldest&offset=48&limit=24&author=alice'),
  );
  const query = buildGalleryQuery(options);

  assert.match(query.sql, /WHERE i\.author = \? AND i\.published = 1/);
  assert.match(query.sql, /ORDER BY i\.created_at ASC, i\.id ASC/);
  assert.deepEqual(query.bindings, ['alice', 25, 48]);
});

test('the homepage renders its initial cards through the bounded feed query', () => {
  const source = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

  assert.match(source, /fetchGalleryBatch\(env\.DB, batchOptions\)/);
  assert.match(source, /const initialParams = new URLSearchParams\(\)/);
  assert.doesNotMatch(source, /let images = \[\]/);
});

test('the gallery endpoint renders a validated ImageCard fragment', () => {
  const source = readFileSync(new URL('../src/pages/api/gallery.astro', import.meta.url), 'utf8');

  assert.match(source, /import ImageCard/);
  assert.match(source, /parseGalleryBatchParams/);
  assert.match(source, /fetchGalleryBatch/);
  assert.match(source, /status:\s*400/);
  assert.match(source, /data-count/);
  assert.match(source, /data-has-more/);
});

test('the homepage incrementally loads cards and resets server sorting', () => {
  const source = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

  assert.match(source, /INITIAL_GALLERY_LIMIT/);
  assert.match(source, /GALLERY_BATCH_LIMIT/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /rootMargin:\s*['"]800px 0px['"]/);
  assert.match(source, /grid\.replaceChildren/);
  assert.match(source, /gallery:updated/);
});

test('the layout re-initializes PhotoSwipe and sliders appended by the gallery feed', () => {
  const source = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');

  assert.match(source, /addEventListener\(['"]gallery:updated['"],\s*\(\)\s*=>\s*\{\s*initPhotoSwipe\(\);\s*initSliders\(\);\s*\}\)/);
});
