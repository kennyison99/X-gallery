import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeCrawlUsername } from '../src/lib/crawl-accounts.ts';

test('normalizes crawler account handles and profile URLs', () => {
  assert.equal(normalizeCrawlUsername('  @@FogLanTau1  '), 'foglantau1');
  assert.equal(normalizeCrawlUsername('https://x.com/MaruKrug/status/123'), 'marukrug');
  assert.equal(normalizeCrawlUsername('twitter.com/SHUIYINSHUI/media'), 'shuiyinshui');
});

test('crawler account API rejects case-insensitive duplicates before insert', () => {
  const source = readFileSync(new URL('../src/pages/api/crawl-accounts.ts', import.meta.url), 'utf8');

  assert.match(source, /SELECT username FROM crawl_accounts WHERE lower\(username\) = \? LIMIT 1/);
  assert.match(source, /status: 409/);
  assert.match(source, /'INSERT INTO crawl_accounts \(username\) VALUES \(\?\)'/);
  assert.doesNotMatch(source, /INSERT OR IGNORE INTO crawl_accounts/);
});

test('crawler account API can rename account handles and existing posts', () => {
  const source = readFileSync(new URL('../src/pages/api/crawl-accounts.ts', import.meta.url), 'utf8');

  assert.match(source, /new_username/);
  assert.match(source, /UPDATE crawl_accounts SET username = \?/);
  assert.match(source, /UPDATE images/);
  assert.match(source, /post_url = replace\(replace\(post_url/);
});
