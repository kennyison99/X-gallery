import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('crawler account form checks existing accounts before posting', () => {
  const source = readFileSync(new URL('../src/pages/admin/index.astro', import.meta.url), 'utf8');

  assert.match(source, /normalizeCrawlUsernameInput/);
  assert.match(source, /querySelectorAll\('\.crawl-account-item'\)/);
  assert.match(source, /已在爬蟲帳號列表中/);
});

test('crawler account list supports renaming accounts', () => {
  const panel = readFileSync(new URL('../src/components/admin/AdminCrawlerPanel.astro', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/pages/admin/index.astro', import.meta.url), 'utf8');

  assert.match(panel, /rename-crawl-btn/);
  assert.match(source, /handleRenameCrawl/);
  assert.match(source, /new_username/);
  assert.match(source, /已改名/);
});
