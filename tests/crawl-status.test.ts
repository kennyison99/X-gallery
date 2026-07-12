import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('crawl completion records errors without resetting full-scan mode', () => {
  const source = read('../src/pages/api/crawl-complete.ts');
  const errorBranch = source.slice(source.indexOf('if (crawlError)'), source.indexOf('if (crawlMode ==='));

  assert.match(source, /const crawlError = typeof body\.error === 'string'/);
  assert.match(source, /last_crawl_error/);
  assert.match(source, /if \(crawlError\)/);
  assert.doesNotMatch(errorBranch, /crawl_all = 0/);
});

test('failed tweet groups and accounts do not advance the latest checkpoint', () => {
  const source = read('../scripts/crawl-twitter.mjs');
  const groupBlock = source.slice(
    source.indexOf('async function processTweetGroup'),
    source.indexOf('async function processTweetGroups'),
  );

  assert.match(groupBlock, /stats\.failed > 0 \|\| downloadedTasks\.length === 0/);
  assert.match(groupBlock, /if \(stats\.failed > 0\) return stats/);
  assert.match(source, /if \(pipelineStats\.failed === 0\)/);
  assert.match(source, /reportCrawlComplete\(username, crawlMode, accountImagesUploaded,/);
});

test('admin crawler displays the latest account error', () => {
  const page = read('../src/pages/admin/index.astro');
  const panel = read('../src/components/admin/AdminCrawlerPanel.astro');

  assert.match(page, /lastCrawlError = .*a\.last_crawl_error/);
  assert.match(panel, /lastCrawlError/);
  assert.match(panel, /crawl-error/);
});

test('base schema and migration include crawl error state', () => {
  assert.match(read('../db/schema.sql'), /last_crawl_error TEXT/);
  assert.match(read('../db/migration-007-crawl-error.sql'), /ADD COLUMN last_crawl_error TEXT/);
});

test('crawler applies timeouts to every HTTP request', () => {
  const source = read('../scripts/crawl-twitter.mjs');

  assert.match(source, /const REQUEST_TIMEOUT_MS = 60_000/);
  assert.match(source, /function fetchWithTimeout\(url, options = \{\}, timeoutMs = REQUEST_TIMEOUT_MS\)/);
  assert.ok((source.match(/fetchWithTimeout\(/g) ?? []).length >= 5);
});

test('server-side duplicate uploads count as skipped, not new uploads', () => {
  const source = read('../scripts/crawl-twitter.mjs');
  const groupBlock = source.slice(
    source.indexOf('async function processTweetGroup'),
    source.indexOf('async function processTweetGroups'),
  );

  assert.match(source, /return await res\.json\(\)/);
  assert.match(groupBlock, /const uploadResult = await uploadImageGroup/);
  assert.match(groupBlock, /if \(uploadResult\?\.skipped\)/);
  assert.match(groupBlock, /stats\.skipped \+= finalFiles\.length/);
});
