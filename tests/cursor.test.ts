import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCursor, decodeCursor, buildFilterKey, generateCursorWhereClause } from '../src/lib/cursor.ts';

test('cursor encoding and decoding with UTF-8 Chinese, Emojis, and URL safety', () => {
  const filterKey = buildFilterKey('search', { q: '崩壞：星穹鐵道 🎨', tag: '原神', author: '@GenshinImpact' });
  const cursorObj = {
    v: 1,
    sort: 'newest' as const,
    createdAt: '2026-07-30 12:34:56',
    id: 1234,
    filterKey,
  };

  const encoded = encodeCursor(cursorObj);
  assert.ok(typeof encoded === 'string', 'Encoded cursor must be string');
  assert.ok(!encoded.includes('+') && !encoded.includes('/') && !encoded.includes('='), 'Encoded cursor must be Base64URL safe');

  const decoded = decodeCursor(encoded, filterKey);
  assert.ok(decoded !== null, 'Decoded cursor must not be null');
  assert.equal(decoded?.id, 1234);
  assert.equal(decoded?.createdAt, '2026-07-30 12:34:56');
  assert.equal(decoded?.sort, 'newest');
  assert.equal(decoded?.filterKey, filterKey);
});

test('cursor validation rejects mismatched filterKey, invalid timestamp format, or bad version', () => {
  const filterKeyA = buildFilterKey('gallery', { tag: '原神', sort: 'newest' });
  const filterKeyB = buildFilterKey('gallery', { tag: '崩壞', sort: 'newest' });

  const encoded = encodeCursor({ v: 1, sort: 'newest', createdAt: '2026-07-30 12:34:56', id: 100, filterKey: filterKeyA });

  // Mismatched filterKey
  assert.equal(decodeCursor(encoded, filterKeyB), null, 'Must reject cursor if filterKey does not match');

  // Bad Base64 / malformed JSON
  assert.equal(decodeCursor('!!!not_base64!!!', filterKeyA), null, 'Must reject invalid Base64');
  assert.equal(decodeCursor(btoa('{"v":999}'), filterKeyA), null, 'Must reject invalid version');
});

test('generateCursorWhereClause creates correct SQL predicate for newest and oldest sort', () => {
  const newestClause = generateCursorWhereClause('newest');
  assert.equal(newestClause.sql, '(i.created_at < ? OR (i.created_at = ? AND i.id < ?))');
  assert.deepEqual(newestClause.bindings('2026-07-30 12:34:56', 100), ['2026-07-30 12:34:56', '2026-07-30 12:34:56', 100]);

  const oldestClause = generateCursorWhereClause('oldest');
  assert.equal(oldestClause.sql, '(i.created_at > ? OR (i.created_at = ? AND i.id > ?))');
  assert.deepEqual(oldestClause.bindings('2026-07-30 12:34:56', 100), ['2026-07-30 12:34:56', '2026-07-30 12:34:56', 100]);
});
