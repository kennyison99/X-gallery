import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dedup = await import('../src/lib/dedup-media.ts').catch(() => ({}));
const buildCardDuplicateFix = dedup.buildCardDuplicateFix ?? (() => undefined);
const buildMediaDuplicateFixes = dedup.buildMediaDuplicateFixes ?? (() => undefined);

test('keeps the exact tweet-id card and removes the rounded duplicate', () => {
  const postUrl = 'https://x.com/97san97/status/2054492655774576931';
  const roundedKey = '97san97_2054492655774577000_1.webp';
  const exactKey = '97san97_2054492655774576931_1.webp';
  const rows = [
    { id: 3698, post_url: postUrl, r2_keys: roundedKey },
    { id: 18328, post_url: postUrl, r2_keys: exactKey },
  ];
  const objects = new Map([
    [roundedKey, { etag: 'same-etag', size: 1664772 }],
    [exactKey, { etag: 'same-etag', size: 1664772 }],
  ]);

  assert.deepEqual(buildCardDuplicateFix(rows, objects), {
    kind: 'card',
    post_url: postUrl,
    keep_id: 18328,
    delete_ids: [3698],
    delete_keys: [roundedKey],
    freed_bytes: 1664772,
  });
});

test('does not merge cards whose media contents differ', () => {
  const postUrl = 'https://x.com/example/status/1234567890123456789';
  const rows = [
    { id: 1, post_url: postUrl, r2_keys: 'rounded.webp' },
    { id: 2, post_url: postUrl, r2_keys: 'exact.webp' },
  ];
  const objects = new Map([
    ['rounded.webp', { etag: 'first', size: 10 }],
    ['exact.webp', { etag: 'second', size: 10 }],
  ]);

  assert.equal(buildCardDuplicateFix(rows, objects), null);
});

test('still removes identical objects within one card', () => {
  const row = { id: 7, post_url: '', r2_keys: 'one.webp,two.webp,three.webp' };
  const objects = new Map([
    ['one.webp', { etag: 'duplicate', size: 10 }],
    ['two.webp', { etag: 'duplicate', size: 10 }],
    ['three.webp', { etag: 'unique', size: 20 }],
  ]);

  assert.deepEqual(buildMediaDuplicateFixes(row, objects), [{
    kind: 'media',
    image_id: 7,
    keep_key: 'one.webp',
    delete_keys: ['two.webp'],
    freed_bytes: 10,
  }]);
});

test('deduplication has a standalone manual workflow', () => {
  const dedupWorkflow = readFileSync(
    new URL('../.github/workflows/dedup-media.yml', import.meta.url),
    'utf8',
  );
  const crawlWorkflow = readFileSync(
    new URL('../.github/workflows/crawl-twitter.yml', import.meta.url),
    'utf8',
  );

  assert.match(dedupWorkflow, /name:\s*Deduplicate Media/);
  assert.match(dedupWorkflow, /workflow_dispatch:/);
  assert.match(dedupWorkflow, /apply:/);
  assert.match(dedupWorkflow, /npm run dedup-media/);
  assert.match(dedupWorkflow, /group:\s*gallery-media-mutations/);
  assert.match(crawlWorkflow, /group:\s*gallery-media-mutations/);
  assert.doesNotMatch(crawlWorkflow, /dedup_media/);
});

test('dedup endpoint scans cards in pages and merges their tags before deletion', () => {
  const source = readFileSync(
    new URL('../src/pages/api/dedup-scan.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /scope === 'cards'/);
  assert.match(source, /GROUP BY post_url/);
  assert.match(source, /buildCardDuplicateFix/);
  assert.match(source, /next_cursor/);
  assert.match(source, /INSERT OR IGNORE INTO image_tags/);
  assert.match(source, /DELETE FROM images/);
});

test('dedup CLI scans both card and within-card duplicates page by page', () => {
  const source = readFileSync(
    new URL('../scripts/dedup-media.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /['"]cards['"]/);
  assert.match(source, /['"]media['"]/);
  assert.match(source, /next_cursor/);
  assert.match(source, /BATCH_SIZE/);
});

test('crawler checks post_url before uploading files and rechecks before insert', () => {
  const crawler = readFileSync(
    new URL('../scripts/crawl-twitter.mjs', import.meta.url),
    'utf8',
  );
  const uploadApi = readFileSync(
    new URL('../src/pages/api/crawl-upload.ts', import.meta.url),
    'utf8',
  );

  assert.match(crawler, /checkUploadExists/);
  const uploadGroup = crawler.slice(
    crawler.indexOf('async function uploadImageGroup'),
    crawler.indexOf('async function reportCrawlComplete'),
  );
  assert.ok(uploadGroup.indexOf('checkUploadExists') < uploadGroup.indexOf('uploadSingleFile(filePath'));
  assert.match(uploadApi, /check_only/);
  assert.match(uploadApi, /post_url = \?/);
});
