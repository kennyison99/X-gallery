import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  extractApiKey,
  hasCloudflareAccessAuth,
  hasSameOrigin,
  isLocalOrigin,
  isProtectedAdminRoute,
  verifySecret,
} from '../src/lib/auth.ts';
import { matchesIfNoneMatch, parseByteRange } from '../src/lib/r2-range.ts';
import { invalidateDirectoryKvCache } from '../src/lib/directory-data.ts';
import { parseMaxFailedAccounts } from '../scripts/crawl-twitter.mjs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('verifySecret fails closed when secret is unset, empty, or mismatched', async () => {
  assert.equal(await verifySecret(null, 'secret'), false);
  assert.equal(await verifySecret('secret', undefined), false);
  assert.equal(await verifySecret('secret', ''), false);
  assert.equal(await verifySecret('', ''), false);
  assert.equal(await verifySecret('wrong', 'secret'), false);
  assert.equal(await verifySecret('secret', 'secret'), true);
});

test('isProtectedAdminRoute guards admin pages, admin APIs, crawl-accounts, and image mutations', () => {
  assert.equal(isProtectedAdminRoute('/admin', 'GET'), true);
  assert.equal(isProtectedAdminRoute('/admin/api/migrate-folders', 'POST'), true);
  assert.equal(isProtectedAdminRoute('/api/admin/approve', 'POST'), true);
  assert.equal(isProtectedAdminRoute('/api/admin-posts', 'GET'), true);
  assert.equal(isProtectedAdminRoute('/api/crawl-accounts', 'GET'), true);
  assert.equal(isProtectedAdminRoute('/api/crawl-accounts', 'POST'), true);
  assert.equal(isProtectedAdminRoute('/api/images', 'GET'), false);
  assert.equal(isProtectedAdminRoute('/api/images', 'POST'), true);
  assert.equal(isProtectedAdminRoute('/api/images/123', 'PUT'), true);
  assert.equal(isProtectedAdminRoute('/api/images/123', 'DELETE'), true);
  assert.equal(isProtectedAdminRoute('/api/images/bulk-delete', 'POST'), true);
  assert.equal(isProtectedAdminRoute('/api/storage-stats', 'GET'), false);
  assert.equal(isProtectedAdminRoute('/api/storage-stats', 'POST'), true);
});

test('Cloudflare Access auth, same-origin checks, and local origin detection work as expected', () => {
  assert.equal(isLocalOrigin(new URL('http://localhost:4321/admin')), true);
  assert.equal(isLocalOrigin(new URL('https://x-gallery.example.com/admin')), false);

  const reqWithJwt = new Request('https://x-gallery.example.com/admin', {
    headers: { 'Cf-Access-Jwt-Assertion': 'eyJ...' },
  });
  assert.equal(hasCloudflareAccessAuth(reqWithJwt), true);

  const reqWithCookie = new Request('https://x-gallery.example.com/api/images/1', {
    headers: {
      Cookie: 'CF_Authorization=token123',
      Origin: 'https://x-gallery.example.com',
    },
  });
  assert.equal(hasCloudflareAccessAuth(reqWithCookie), true);
  assert.equal(hasSameOrigin(reqWithCookie, new URL(reqWithCookie.url)), true);

  const crossOriginReq = new Request('https://x-gallery.example.com/api/images/1', {
    headers: {
      Cookie: 'CF_Authorization=token123',
      Origin: 'https://evil.example.com',
    },
  });
  assert.equal(hasSameOrigin(crossOriginReq, new URL(crossOriginReq.url)), false);

  const apiKeyReq = new Request('https://x-gallery.example.com/api/crawl-accounts?api_key=abc');
  assert.equal(extractApiKey(apiKeyReq), 'abc');
});

test('parseByteRange handles standard, open-ended, and suffix byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=0-499', 1000), { start: 0, end: 499, length: 500 });
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999, length: 500 });
  assert.deepEqual(parseByteRange('bytes=-200', 1000), { start: 800, end: 999, length: 200 });
  assert.deepEqual(parseByteRange('bytes=-2000', 1000), { start: 0, end: 999, length: 1000 });
  assert.equal(parseByteRange('bytes=-0', 1000), null);
  assert.equal(parseByteRange('bytes=1000-1200', 1000), null);
  assert.equal(parseByteRange('bytes=600-400', 1000), null);
  assert.equal(parseByteRange('bytes=-', 1000), null);
});

test('matchesIfNoneMatch supports strong and weak ETags', () => {
  assert.equal(matchesIfNoneMatch('"abc123"', '"abc123"'), true);
  assert.equal(matchesIfNoneMatch('W/"abc123"', '"abc123"'), true);
  assert.equal(matchesIfNoneMatch('"other", "abc123"', '"abc123"'), true);
  assert.equal(matchesIfNoneMatch('"different"', '"abc123"'), false);
});

test('R2 proxy streams full objects without buffering via object.arrayBuffer()', () => {
  const r2Route = read('../src/pages/api/r2/[...key].ts');
  assert.doesNotMatch(r2Route, /object\.arrayBuffer\(/);
  assert.match(r2Route, /object\.body\.tee\(\)/);
  assert.match(r2Route, /status:\s*304/);
});

test('parseMaxFailedAccounts preserves explicit 0 and workflow preserves 0 via format()', () => {
  assert.equal(parseMaxFailedAccounts(['node', 'crawl-twitter.mjs'], { MAX_FAILED_ACCOUNTS: '0' }), 0);
  assert.equal(parseMaxFailedAccounts(['node', 'crawl-twitter.mjs'], { MAX_FAILED_ACCOUNTS: '5' }), 5);
  assert.equal(parseMaxFailedAccounts(['node', 'crawl-twitter.mjs'], { MAX_FAILED_ACCOUNTS: '' }), 0);
  assert.equal(parseMaxFailedAccounts(['node', 'crawl-twitter.mjs', '--max-failed-accounts=0'], {}), 0);

  const workflow = read('../.github/workflows/crawl-twitter.yml');
  assert.match(workflow, /format\('\{0\}',\s*inputs\.max_failed_accounts\)/);
  assert.doesNotMatch(workflow, /setup-python/);
});

test('crawler converts photos with FFmpeg instead of Python Pillow and pre-checks post_url before download', () => {
  const crawler = read('../scripts/crawl-twitter.mjs');
  assert.doesNotMatch(crawler, /from PIL import Image/);
  assert.match(crawler, /runProcess\("ffmpeg"/);
  const groupBlock = crawler.slice(
    crawler.indexOf('export async function processTweetGroup'),
    crawler.indexOf('async function processTweetGroups'),
  );
  assert.ok(groupBlock.indexOf('checkUploadExists(username, postUrl)') < groupBlock.indexOf('downloadMediaTask(task, archive)'));
});

test('likes endpoint restricts updates to published posts and delete endpoints clean up media_assets', () => {
  const likesRoute = read('../src/pages/api/likes/[id].ts');
  assert.match(likesRoute, /WHERE id = \? AND published = 1 RETURNING likes/);

  const imageIdRoute = read('../src/pages/api/images/[id].ts');
  assert.match(imageIdRoute, /DELETE FROM media_assets WHERE image_id = \?/);
  assert.match(imageIdRoute, /DELETE FROM media_assets WHERE r2_key IN/);

  const dedupRoute = read('../src/pages/api/dedup-scan.ts');
  assert.match(dedupRoute, /DELETE FROM media_assets WHERE r2_key IN/);
});

test('invalidateDirectoryKvCache deletes fixed directory and overview KV keys', async () => {
  const deleted: string[] = [];
  await invalidateDirectoryKvCache({
    async delete(key: string) {
      deleted.push(key);
    },
  });
  assert.deepEqual(deleted.sort(), [
    'admin-overview:v1',
    'directory:v1:admin',
    'directory:v1:public',
  ]);
});
