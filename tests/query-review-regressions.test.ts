import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildGalleryQuery, parseGalleryBatchParams } from '../src/lib/gallery-feed.ts';
import { buildSearchQuery, parseSearchParams } from '../src/lib/search-query.ts';
import { encodeCursor } from '../src/lib/cursor.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO tags VALUES (1, 'Rare'), (2, 'rare'), (3, 'Common')");
  const insert = db.prepare('INSERT INTO images(id, r2_keys, author, published, created_at) VALUES (?, ?, ?, ?, ?)');
  const link = db.prepare('INSERT INTO image_tags VALUES (?, ?)');
  for (let id = 1; id <= 200; id++) {
    insert.run(id, 'test.jpg', id % 2 ? 'Alice' : 'Bob', id % 5 ? 1 : 0,
      id <= 100 ? '2026-01-01 00:00:00' : '2026-01-02 00:00:00');
    link.run(id, 3);
    if (id % 31 === 0) { link.run(id, 1); link.run(id, 2); }
  }
  db.exec('ANALYZE');
  return db;
}

test('gallery cursors seek by timestamp and preserve tied-timestamp ordering in both directions', () => {
  const db = fixture();
  try {
    for (const sort of ['newest', 'oldest'] as const) {
      const params = parseGalleryBatchParams(new URLSearchParams({ sort, limit: '24' }));
      const filterKey = buildGalleryQuery(params).filterKey;
      const cursor = { v: 1 as const, sort, createdAt: '2026-01-01 00:00:00', id: 64, filterKey };
      const query = buildGalleryQuery({ ...params, cursorStr: encodeCursor(cursor) });
      const rows = db.prepare(query.sql).all(...query.bindings);
      const comparison = sort === 'newest' ? '<' : '>';
      const direction = sort === 'newest' ? 'DESC' : 'ASC';
      const expected = db.prepare(`SELECT id FROM images WHERE published = 1
        AND (created_at ${comparison} ? OR (created_at = ? AND id ${comparison} ?))
        ORDER BY created_at ${direction}, id ${direction} LIMIT 25`).all(cursor.createdAt, cursor.createdAt, cursor.id);
      assert.deepEqual(rows.map(row => row.id), expected.map(row => row.id));
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.bindings);
      assert.ok(plan.some(row => /idx_images_published_created.*created_at[<>]/.test(String(row.detail))),
        JSON.stringify(plan));
    }
  } finally { db.close(); }
});

test('tag and work searches select matching IDs once, preserving case-insensitive intersections', () => {
  const db = fixture();
  try {
    // Production still has a newer, unanalyzed index that can hijack published-only filters.
    db.exec('DROP INDEX idx_images_published_id; CREATE INDEX idx_images_published_reviewed ON images(published, reviewed, id DESC)');
    for (const filter of ['tag=RARE', 'work=rare', 'tag=rare&work=common', 'tag=rare&author=alice']) {
      const query = buildSearchQuery(parseSearchParams(new URLSearchParams(filter)));
      const rows = db.prepare(query.sql).all(...query.bindings);
      assert.ok(rows.length > 0);
      assert.ok(rows.every(row => Number(row.id) % 31 === 0 && Number(row.id) % 5 !== 0));
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
      if (filter.includes('author')) assert.ok(rows.every(row => row.author === 'Alice'));
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.bindings);
      assert.ok(!plan.some(row => String(row.detail).includes('CORRELATED SCALAR SUBQUERY')), JSON.stringify(plan));
      assert.ok(plan.some(row => /idx_image_tags_tag_image/.test(String(row.detail))), JSON.stringify(plan));
      const firstImageLookup = plan.find(row => /^SEARCH i /.test(String(row.detail)));
      assert.match(String(firstImageLookup?.detail), /(?:rowid| id)=\?/, JSON.stringify(plan));
    }
  } finally { db.close(); }
});
