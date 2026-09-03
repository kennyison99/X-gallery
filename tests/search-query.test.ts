import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSearchParams, buildSearchQuery, fetchSearchBatch } from '../src/lib/search-query.ts';

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

test('buildSearchQuery uses instr and executes cleanly on queries exceeding 50 bytes', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');

  const db = new DatabaseSync(':memory:');
  const schemaSql = readFileSync('db/schema.sql', 'utf8');
  db.exec(schemaSql);

  const longQuery = 'https://x.com/silva_siufabing/status/2093637112830808447_extra_long_search_term';
  assert.ok(longQuery.length > 50);

  const parsed = parseSearchParams(new URLSearchParams({ q: longQuery }));
  const { sql, bindings } = buildSearchQuery(parsed);

  assert.ok(sql.includes('instr('));
  assert.doesNotMatch(sql, /i\.title\s+LIKE\s+\?/i);

  // Executes without throwing SQLITE_ERROR
  const stmt = db.prepare(sql);
  const rows = stmt.all(...bindings);
  assert.equal(Array.isArray(rows), true);
});

test('repeated keyword searches reuse cached results instead of repeating the full D1 scan', async () => {
  let d1Reads = 0;
  const db = {
    prepare(sql: string) {
      const all = async () => {
        d1Reads++;
        return { results: [] };
      };
      return {
        bind() {
          return { all };
        },
        async first() {
          d1Reads++;
          return sql.includes('directory_version') ? { directory_version: 23 } : null;
        },
        all,
      };
    },
  };
  const params = parseSearchParams(new URLSearchParams({ q: 'cache_test_keyword_20260903' }));
  const directory = {
    version: 23,
    authors: [],
    tags: [],
    canonicalAuthorSet: new Set<string>(),
  };

  const first = await fetchSearchBatch(db, params, { version: 23, directory });
  const second = await fetchSearchBatch(db, params, { version: 23, directory });

  assert.deepEqual(second, first);
  assert.equal(d1Reads, 1);
});

