import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSearchParams, buildSearchQuery } from '../src/lib/search-query.ts';

test('parseSearchParams clamps limit and parses search filters', () => {
  const params = new URLSearchParams({ q: '原神', limit: '200', sort: 'newest' });
  const parsed = parseSearchParams(params);
  assert.equal(parsed.q, '原神');
  assert.equal(parsed.limit, 96, 'Must clamp limit to maximum 96 items');
  assert.equal(parsed.sort, 'newest');
});

test('buildSearchQuery generates page-first CTE with EXISTS clause for keyword tag matching', () => {
  const parsed = parseSearchParams(new URLSearchParams({ q: '崩壞' }));
  const { sql, bindings } = buildSearchQuery(parsed);

  assert.ok(sql.includes('WITH paged_ids AS'), 'Must use page-first CTE pattern');
  assert.ok(/EXISTS\s*\(\s*SELECT 1 FROM image_tags/.test(sql), 'Must use EXISTS for keyword tag matching');
  assert.ok(sql.includes('LIMIT ?'), 'Must bound result set with limit + 1');
  assert.ok(bindings.length > 0);
});
