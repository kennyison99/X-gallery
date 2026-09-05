import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import * as admin from '../src/lib/admin-dashboard.ts';
import * as dedup from '../src/lib/dedup-media.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const queries: string[] = [];
  const adapter = { prepare(sql: string) {
    const execute = (bindings: any[] = []) => ({
      async first() { queries.push(sql); return db.prepare(sql).get(...bindings) ?? null; },
      async all() { queries.push(sql); return { results: db.prepare(sql).all(...bindings) }; },
      async run() { queries.push(sql); return db.prepare(sql).run(...bindings); },
    });
    return { ...execute(), bind: (...bindings: any[]) => execute(bindings) };
  } };
  return { db, adapter, queries };
}

test('filtered totals are shared across pages and sorting but invalidated by content changes', async () => {
  const { db, adapter, queries } = fixture();
  try {
    const getCount = (admin as any).getAdminFilteredCount;
    assert.equal(typeof getCount, 'function', 'filtered totals need a shared cached loader');
    db.exec("INSERT INTO images(r2_keys, author, video_count) VALUES('a.mp4', 'alice', 1), ('b.jpg', 'bob', 0)");
    const params = admin.parseAdminPostsParams(new URL('https://local/api/admin-posts?media=video'));
    assert.equal(await getCount(adapter, params, true), 1);
    assert.equal(await getCount(adapter, { ...params, offset: 10, sort: 'oldest' }, true), 1);
    assert.equal(queries.filter(sql => sql.startsWith('SELECT COUNT(*)')).length, 1);
    db.exec("INSERT INTO images(r2_keys, author, video_count) VALUES('c.mp4', 'alice', 1); UPDATE storage_stats SET directory_version = directory_version + 1 WHERE id = 1");
    assert.equal(await getCount(adapter, params, true), 2);
    assert.equal(queries.filter(sql => sql.startsWith('SELECT COUNT(*)')).length, 2);
    assert.equal(await getCount(adapter, { ...params, author: 'bob' }, true), 0);
  } finally { db.close(); }
});

test('dedup scans bounded ID windows and returns each complete duplicate group once', async () => {
  const { db, adapter, queries } = fixture();
  try {
    const fetchPage = (dedup as any).fetchDuplicateCardPage;
    assert.equal(typeof fetchPage, 'function', 'dedup needs a bounded scan page loader');
    const insert = db.prepare('INSERT INTO images(id, r2_keys, author, post_url) VALUES (?, ?, ?, ?)');
    for (let id = 1; id <= 9; id++) {
      const group = [2, 7].includes(id) ? 2 : [3, 6, 9].includes(id) ? 3 : id;
      insert.run(id, id + '.jpg', 'alice', 'https://x.com/alice/status/' + group);
    }
    let cursor: number | null = 0;
    const seen: number[] = [];
    const groupPages = new Map<number, number>();
    let pages = 0;
    do {
      const page = await fetchPage(adapter, cursor, 2);
      pages++;
      for (const row of page.rows) {
        seen.push(row.id);
        if (groupPages.has(row.group_cursor)) assert.equal(groupPages.get(row.group_cursor), pages);
        groupPages.set(row.group_cursor, pages);
      }
      if (page.nextCursor !== null) assert.ok(page.nextCursor > cursor!);
      cursor = page.nextCursor;
    } while (cursor !== null && pages < 10);
    assert.equal(cursor, null);
    assert.deepEqual(seen.sort((a, b) => a - b), [2, 3, 6, 7, 9]);
    assert.equal(pages, 5, 'empty duplicate pages must still advance their bounded scan');
    assert.ok(!queries.some(sql => /GROUP BY post_url|HAVING COUNT/.test(sql)));
    assert.ok(queries.some(sql => /WHERE id > \? ORDER BY id.*LIMIT \?/s.test(sql)));
  } finally { db.close(); }
});

test('crawler tag batching uses two statements and preserves unique tag links', async () => {
  const module = await import('../src/lib/image-tags.ts').catch(() => ({} as any));
  assert.equal(typeof module.createImageTagStatements, 'function', 'crawler needs batched tag writes');
  const { db, adapter } = fixture();
  try {
    db.exec("INSERT INTO images(id, r2_keys, author) VALUES (1, 'a.jpg', 'alice')");
    const statements = module.createImageTagStatements(adapter, 1, ['原神', 'Alice', '原神']);
    assert.equal(statements.length, 2);
    for (const stmt of statements) await stmt.run();
    assert.deepEqual(db.prepare('SELECT name FROM tags ORDER BY name').all().map(row => row.name), ['Alice', '原神']);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_tags').get()!.count, 2);
    for (const stmt of module.createImageTagStatements(adapter, 1, ['原神', 'Alice'])) await stmt.run();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_tags').get()!.count, 2);
    const source = readFileSync(new URL('../src/pages/api/crawl-upload.ts', import.meta.url), 'utf8');
    assert.match(source, /createImageTagStatements\(env\.DB/);
    assert.doesNotMatch(source, /for \(const tagName of autoTags\)/);
  } finally { db.close(); }
});
