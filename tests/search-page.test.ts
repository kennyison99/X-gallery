import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('search page exposes work browsing separate from generic tags', () => {
  const source = readFileSync(new URL('../src/pages/search.astro', import.meta.url), 'utf8');

  assert.match(source, /get\('work'\)/);
  assert.match(source, /WORK_TAG_GROUPS/);
  assert.match(source, /按作品分類/);
  assert.match(source, /其他標籤/);
  assert.match(source, /!workTagSet\.has\(name\)/);
  assert.match(source, /!characterTagSet\.has\(name\)/);
});
