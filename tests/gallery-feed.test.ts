import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const feed = await import('../src/lib/gallery-feed.ts').catch(() => ({}));
const parseGalleryBatchParams = feed.parseGalleryBatchParams ?? (() => undefined);
const takeGalleryBatch = feed.takeGalleryBatch ?? (() => undefined);
const buildGalleryQuery = feed.buildGalleryQuery ?? (() => ({ sql: '', bindings: [] }));
const buildGalleryBatchSearchParams = feed.buildGalleryBatchSearchParams ?? (() => undefined);
const fetchGalleryBatch = feed.fetchGalleryBatch ?? (() => undefined);

test('parses a valid oldest batch and caps its limit at 48', () => {
  const params = new URLSearchParams('sort=oldest&media=video&offset=48&limit=100&tag=art&author=alice');
  assert.deepEqual(parseGalleryBatchParams(params), {
    sort: 'oldest',
    media: 'video',
    offset: 48,
    limit: 48,
    tag: 'art',
    author: 'alice',
  });
});

test('defaults the initial feed to newest offset zero and 48 posts', () => {
  assert.deepEqual(parseGalleryBatchParams(new URLSearchParams()), {
    sort: 'newest',
    media: 'all',
    offset: 0,
    limit: 48,
    tag: null,
    author: null,
  });
});

test('rejects invalid sort and offset values', () => {
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('sort=random')), /sort/);
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('media=audio')), /media/);
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('offset=-1')), /offset/);
});

test('keeps the selected media type when sorting resets the gallery request', () => {
  const params = buildGalleryBatchSearchParams({
    reset: true,
    sort: 'oldest',
    media: 'video',
    offset: 48,
    nextCursor: 'ignored-on-reset',
    tag: null,
    author: 'kanade_suntm',
  });

  assert.equal(params.toString(), 'limit=48&sort=oldest&media=video&offset=0&author=kanade_suntm');
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
  assert.match(query.sql, /LIMIT \?/);
  assert.deepEqual(query.bindings, [49]);
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

test('filters video batches in SQL before applying the page limit', () => {
  const options = parseGalleryBatchParams(
    new URLSearchParams('sort=oldest&media=video&limit=24&author=kanade_suntm'),
  );
  const query = buildGalleryQuery(options);

  assert.match(query.sql, /i\.video_count > 0/);
  assert.match(query.sql, /WHERE i\.author = \? AND i\.published = 1 AND i\.video_count > 0/);
  assert.deepEqual(query.bindings, ['kanade_suntm', 25]);
});

test('uses different cursor filter keys for different media filters', () => {
  const allQuery = buildGalleryQuery(parseGalleryBatchParams(new URLSearchParams('media=all')));
  const videoQuery = buildGalleryQuery(parseGalleryBatchParams(new URLSearchParams('media=video')));

  assert.notEqual(allQuery.filterKey, videoQuery.filterKey);
});

test('repeated gallery batches reuse cached results instead of reading D1 again', async () => {
  let d1Reads = 0;
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              d1Reads++;
              return {
                results: [{
                  id: 81,
                  title: 'cached',
                  r2_keys: 'cached.jpg',
                  author: 'cache_test_gallery',
                  author_url: '',
                  post_url: '',
                  description: '',
                  likes: 0,
                  created_at: '2026-09-03 10:00:00',
                }],
              };
            },
          };
        },
      };
    },
  };
  const options = parseGalleryBatchParams(new URLSearchParams('author=cache_test_gallery'));
  const cacheOptions = { version: 17 };

  const first = await fetchGalleryBatch(db, options, cacheOptions);
  const second = await fetchGalleryBatch(db, options, cacheOptions);

  assert.deepEqual(second, first);
  assert.equal(d1Reads, 1);
});

test('gallery cache remains reusable when an unrelated upload changes directory version', async () => {
  let d1Reads = 0;
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              d1Reads++;
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const options = parseGalleryBatchParams(new URLSearchParams('author=cache_test_cross_version_gallery'));

  await fetchGalleryBatch(db, options, { version: 31 });
  await fetchGalleryBatch(db, options, { version: 32 });

  assert.equal(d1Reads, 1, 'bounded TTL should absorb unrelated directory-version bumps');
});

test('the homepage renders its initial cards through the bounded feed query', () => {
  const source = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

  assert.match(source, /fetchGalleryBatch\(env\.DB, batchOptions,/);
  assert.match(source, /const initialParams = new URLSearchParams\(\)/);
  assert.doesNotMatch(source, /let images = \[\]/);
});

test('the gallery endpoint renders a validated ImageCard fragment', () => {
  const source = readFileSync(new URL('../src/pages/api/gallery.astro', import.meta.url), 'utf8');

  assert.match(source, /import ImageCard/);
  assert.match(source, /parseGalleryBatchParams/);
  assert.match(source, /fetchGalleryBatch/);
  assert.match(source, /status/);
  assert.match(source, /data-count/);
  assert.match(source, /data-has-more/);
});

test('the homepage incrementally loads cards and resets server sorting', () => {
  const source = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

  assert.match(source, /buildGalleryBatchSearchParams/);
  assert.match(source, /gallery:media-filter/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /rootMargin:\s*['"]800px 0px['"]/);
  assert.match(source, /grid\.replaceChildren/);
  assert.match(source, /gallery:updated/);
});

test('the layout re-initializes PhotoSwipe and sliders appended by the gallery feed', () => {
  const source = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');

  assert.match(source, /addEventListener\(['"]gallery:updated['"],\s*\(\)\s*=>\s*\{\s*initPhotoSwipe\(\);\s*initSliders\(\);\s*\}\)/);
});
