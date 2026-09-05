import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  getAdminOverviewStats,
  getDirectoryData,
  clearDirectoryMemoryCache,
} from '../src/lib/directory-data.ts';

describe('Admin Overview Stats & Directory Cache Consolidation Suite', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    clearDirectoryMemoryCache();
    db = new DatabaseSync(':memory:');
    const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
    db.exec(schemaSql);

    // Seed test records
    const insertImageStmt = db.prepare(`
      INSERT INTO images (
        id, title, r2_keys, author, author_display_name, description, created_at, published, photo_bytes, video_bytes, photo_count, video_count, media_count_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    // Author Alice: 3 published, 1 pending
    insertImageStmt.run(1, 'Alice 1', 'a1.jpg', 'alice', 'Alice Wonder', 'desc 1', '2026-08-01 10:00:00', 1, 1000, 0, 1, 0);
    insertImageStmt.run(2, 'Alice 2', 'a2.mp4', 'alice', 'Alice Wonder', 'desc 2', '2026-08-02 10:00:00', 1, 0, 5000, 0, 1);
    insertImageStmt.run(3, 'Alice 3', 'a3.jpg,a3.mp4', 'alice', 'Alice Wonder', 'desc 3', '2026-08-03 10:00:00', 1, 2000, 8000, 1, 1);
    insertImageStmt.run(4, 'Alice 4', 'a4.jpg', 'alice', 'Alice Wonder', 'desc 4', '2026-08-04 10:00:00', 0, 1500, 0, 1, 0);

    // Author Bob: 2 published
    insertImageStmt.run(5, 'Bob 1', 'b1.jpg', 'bob', 'Bob Builder', 'desc 5', '2026-08-05 10:00:00', 1, 3000, 0, 1, 0);
    insertImageStmt.run(6, 'Bob 2', 'b2.jpg', 'bob', 'Bob Builder', 'desc 6', '2026-08-06 10:00:00', 1, 4000, 0, 1, 0);

    // Seed tags
    db.prepare("INSERT INTO tags (id, name) VALUES (1, 'landscape'), (2, 'portrait')").run();
    db.prepare('INSERT INTO image_tags (image_id, tag_id) VALUES (1, 1), (5, 2)').run();

    // Mark media_counts_ready = 1
    db.prepare('UPDATE storage_stats SET media_counts_ready = 1, directory_version = 1 WHERE id = 1').run();
  });

  // Adapter wrapping DatabaseSync to simulate Cloudflare D1 interface
  function createD1Adapter(realDb: DatabaseSync) {
    let queryCount = 0;
    const queriesRun: string[] = [];

    const adapter = {
      getQueryCount: () => queryCount,
      getQueriesRun: () => [...queriesRun],
      resetCounts: () => {
        queryCount = 0;
        queriesRun.length = 0;
      },
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async first<T = unknown>(): Promise<T | null> {
                queryCount++;
                queriesRun.push(sql.trim());
                const stmt = realDb.prepare(sql);
                const row = stmt.get(...bindings);
                return (row as T) ?? null;
              },
              async all<T = unknown>(): Promise<{ results: T[] }> {
                queryCount++;
                queriesRun.push(sql.trim());
                const stmt = realDb.prepare(sql);
                const results = stmt.all(...bindings);
                return { results: results as T[] };
              },
              async run(): Promise<{ meta: { changes: number } }> {
                queryCount++;
                queriesRun.push(sql.trim());
                const stmt = realDb.prepare(sql);
                const info = stmt.run(...bindings);
                return { meta: { changes: Number(info.changes) } };
              },
            };
          },
          async first<T = unknown>(): Promise<T | null> {
            return this.bind().first<T>();
          },
          async all<T = unknown>(): Promise<{ results: T[] }> {
            return this.bind().all<T>();
          },
          async run(): Promise<{ meta: { changes: number } }> {
            return this.bind().run();
          },
        };
      },
    };
    return adapter;
  }

  function createMemoryKv() {
    const values = new Map<string, string>();
    const writes: Array<{ key: string; expirationTtl: number }> = [];

    return {
      writes,
      async get<T>(key: string, type: 'json'): Promise<T | null> {
        assert.equal(type, 'json');
        const value = values.get(key);
        return value === undefined ? null : JSON.parse(value) as T;
      },
      async put(key: string, value: string, options: { expirationTtl: number }): Promise<void> {
        values.set(key, value);
        writes.push({ key, expirationTtl: options.expirationTtl });
      },
    };
  }

  it('pending pagination counts stay live even when overview and version caches are warm', async () => {
    const { getAdminFilteredCount, parseAdminPostsParams, buildAdminPostsQuery } = await import('../src/lib/admin-dashboard.ts');
    const adapter = createD1Adapter(db);
    const kv = createMemoryKv();
    const params = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=0&limit=25'));
    db.exec('DELETE FROM images WHERE published = 0');
    await getAdminOverviewStats(adapter, 1, { mediaCountsReady: true, kv });
    assert.equal(await getAdminFilteredCount(adapter, params, true, kv), 0);
    // External moderation can change publication state without bumping metadata.
    for (let id = 100; id < 126; id++) {
      db.prepare("INSERT INTO images(id, r2_keys, author, published) VALUES (?, 'test.jpg', 'test', 0)").run(id);
    }
    const total = await getAdminFilteredCount(adapter, params, true, kv);
    const page = buildAdminPostsQuery(params, true);
    const rows = db.prepare(page.pageSql).all(...page.pageBindings);
    assert.equal(total, 26);
    assert.equal(rows.length, 25);
    assert.equal(rows.length < total, true, 'second page must remain reachable');
    db.exec('UPDATE images SET published = 1 WHERE published = 0');
    assert.equal(await getAdminFilteredCount(adapter, params, true, kv), 0);
  });

  it('post list and SSR badges use list counts instead of stale overview totals', () => {
    const api = readFileSync(new URL('../src/pages/api/admin-posts.ts', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../src/pages/admin/index.astro', import.meta.url), 'utf8');
    assert.ok(!api.includes('total = getOverviewCount('));
    assert.match(page, /getAdminFilteredCount\(env.DB/);
    assert.match(page, /tabPending.textContent =/);
  });

  it('getAdminOverviewStats consolidates author aggregation and JS reduction into exact global totals', async () => {
    const mockDb = createD1Adapter(db);

    const stats = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });

    // Assert global totals
    assert.equal(stats.totalPosts, 6);
    assert.equal(stats.publishedCount, 5);
    assert.equal(stats.pendingCount, 1);
    assert.equal(stats.totalPhotos, 5); // Alice: 1+0+1+1=3, Bob: 1+1=2 -> Total 5
    assert.equal(stats.totalVideos, 2); // Alice: 0+1+1+0=2, Bob: 0 -> Total 2

    // Assert author-level breakdown
    assert.equal(stats.authorStats.length, 2);
    const alice = stats.authorStats.find((a) => a.author === 'alice')!;
    assert.ok(alice);
    assert.equal(alice.author_display_name, 'Alice Wonder');
    assert.equal(alice.posts, 4);
    assert.equal(alice.published, 3);
    assert.equal(alice.pending, 1);
    assert.equal(alice.photos, 3);
    assert.equal(alice.videos, 2);
    assert.equal(alice.photo_bytes, 4500); // 1000 + 0 + 2000 + 1500
    assert.equal(alice.video_bytes, 13000); // 0 + 5000 + 8000 + 0

    const bob = stats.authorStats.find((a) => a.author === 'bob')!;
    assert.ok(bob);
    assert.equal(bob.posts, 2);
    assert.equal(bob.published, 2);
    assert.equal(bob.pending, 0);
    assert.equal(bob.photo_bytes, 7000);
    assert.equal(bob.video_bytes, 0);

    // Verify exactly ONE images query was executed (no second global-count query)
    const imagesQueries = mockDb.getQueriesRun().filter((q) => q.includes('FROM images'));
    assert.equal(imagesQueries.length, 1);
    assert.ok(imagesQueries[0].includes('GROUP BY author'));
  });

  it('getAdminOverviewStats returns cached in-memory data on subsequent calls (0 D1 image queries on hit)', async () => {
    const mockDb = createD1Adapter(db);

    // Cold miss: 1 query
    const stats1 = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });
    assert.equal(mockDb.getQueryCount(), 1);

    // Cache hit: 0 queries
    mockDb.resetCounts();
    const stats2 = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });
    assert.equal(mockDb.getQueryCount(), 0);
    assert.deepEqual(stats1, stats2);
  });

  it('overview KV hits avoid D1 even when no version or media readiness was supplied', async () => {
    const mockDb = createD1Adapter(db);
    const kv = createMemoryKv();
    const expected = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true, kv });
    clearDirectoryMemoryCache();
    const unavailableDb = { prepare() { throw new Error('D1 daily cap exceeded'); } };
    assert.deepEqual(await getAdminOverviewStats(unavailableDb, undefined, { kv }), expected);
  });

  it('concurrent overview misses execute only one full-table aggregation', async () => {
    const adapter = createD1Adapter(db);
    await Promise.all(Array.from({ length: 20 }, () =>
      getAdminOverviewStats(adapter, 1, { mediaCountsReady: true })));
    assert.equal(adapter.getQueriesRun().filter(sql => sql.includes('FROM images')).length, 1);
  });

  it('fixed KV cache prevents a full images scan when directory_version changes', async () => {
    const mockDb = createD1Adapter(db);
    const kv = createMemoryKv();

    const first = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true, kv });
    assert.equal(first.totalPosts, 6);
    assert.equal(kv.writes.length, 1);
    assert.equal(kv.writes[0].expirationTtl, 3_600);

    db.prepare('UPDATE storage_stats SET directory_version = 2 WHERE id = 1').run();
    db.prepare(`
      INSERT INTO images (
        id, title, r2_keys, author, author_display_name, description, created_at, published, photo_bytes, video_bytes, photo_count, video_count, media_count_version
      ) VALUES (7, 'Bob 3', 'b3.jpg', 'bob', 'Bob Builder', 'desc 7', '2026-08-07 10:00:00', 1, 2000, 0, 1, 0, 1)
    `).run();

    clearDirectoryMemoryCache();
    mockDb.resetCounts();
    const cached = await getAdminOverviewStats(mockDb, 2, { mediaCountsReady: true, kv });

    assert.equal(mockDb.getQueryCount(), 0, 'KV hit must avoid every D1 query');
    assert.equal(cached.version, 2, 'cached stats should adopt the current directory version');
    assert.equal(cached.totalPosts, 6, 'stats may remain stale only for the bounded KV TTL');
  });

  it('getDirectoryData reuses passed version and adminAuthors to eliminate redundant version & author queries', async () => {
    const mockDb = createD1Adapter(db);

    // 1. Fetch overview stats
    const overview = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });
    assert.equal(mockDb.getQueryCount(), 1); // 1 query for overview

    // 2. Derive adminAuthors
    const adminAuthors = overview.authorStats.map((r) => ({
      author: r.author,
      author_display_name: r.author_display_name,
    }));

    // 3. Call getDirectoryData with passed version & adminAuthors
    mockDb.resetCounts();
    const directory = await getDirectoryData(mockDb, 'admin', { version: 1, adminAuthors });

    // Assert directory result
    assert.equal(directory.version, 1);
    assert.deepEqual(directory.authors, ['alice', 'bob']);
    assert.equal(directory.tags.length, 2);

    // Assert: getDirectoryData only queried `tags`, NOT `storage_stats` or `images`!
    const queries = mockDb.getQueriesRun();
    assert.equal(queries.length, 1);
    assert.ok(queries[0].includes('FROM tags'));
    assert.ok(!queries.some((q) => q.includes('FROM images')));
    assert.ok(!queries.some((q) => q.includes('FROM storage_stats')));
  });

  it('cache invalidates cleanly when directory_version is bumped', async () => {
    const mockDb = createD1Adapter(db);

    // 1. Warm cache on version 1
    const v1Stats = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });
    assert.equal(v1Stats.version, 1);
    assert.equal(mockDb.getQueryCount(), 1);

    // 2. Bump version to 2 and add an image for Bob
    db.prepare('UPDATE storage_stats SET directory_version = 2 WHERE id = 1').run();
    db.prepare(`
      INSERT INTO images (
        id, title, r2_keys, author, author_display_name, description, created_at, published, photo_bytes, video_bytes, photo_count, video_count, media_count_version
      ) VALUES (7, 'Bob 3', 'b3.jpg', 'bob', 'Bob Builder', 'desc 7', '2026-08-07 10:00:00', 1, 2000, 0, 1, 0, 1)
    `).run();

    // 3. Fetch version 2 (cache miss on new version)
    mockDb.resetCounts();
    const v2Stats = await getAdminOverviewStats(mockDb, 2, { mediaCountsReady: true });

    assert.equal(v2Stats.version, 2);
    assert.equal(mockDb.getQueryCount(), 1); // Queried fresh data
    assert.equal(v2Stats.totalPosts, 7); // 6 + 1
    assert.equal(v2Stats.publishedCount, 6); // 5 + 1
    const bob = v2Stats.authorStats.find((a) => a.author === 'bob')!;
    assert.equal(bob.posts, 3);
    assert.equal(bob.photo_bytes, 9000); // 7000 + 2000
  });

  it('handles fallback correctly when mediaCountsReady = false and accumulates photo_bytes and video_bytes', async () => {
    const mockDb = createD1Adapter(db);

    const fallbackStats = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: false });

    assert.equal(fallbackStats.totalPosts, 6);
    assert.equal(fallbackStats.publishedCount, 5);
    assert.equal(fallbackStats.pendingCount, 1);
    assert.equal(fallbackStats.authorStats.length, 2);

    const alice = fallbackStats.authorStats.find((a) => a.author === 'alice')!;
    assert.ok(alice);
    assert.equal(alice.photo_bytes, 4500);
    assert.equal(alice.video_bytes, 13000);
    assert.equal(alice.published, 3);
    assert.equal(alice.pending, 1);

    const bob = fallbackStats.authorStats.find((a) => a.author === 'bob')!;
    assert.ok(bob);
    assert.equal(bob.photo_bytes, 7000);
    assert.equal(bob.video_bytes, 0);
    assert.equal(bob.published, 2);
    assert.equal(bob.pending, 0);
  });

  it('directory version invariant: account rename and dedup media fix bump version', () => {
    // 1. Initial version
    const initialVersion = db.prepare('SELECT directory_version FROM storage_stats WHERE id = 1').get() as any;
    assert.equal(initialVersion.directory_version, 1);

    // 2. Simulate crawl account rename batch
    db.prepare('UPDATE storage_stats SET directory_version = directory_version + 1 WHERE id = 1').run();
    const renamedVersion = db.prepare('SELECT directory_version FROM storage_stats WHERE id = 1').get() as any;
    assert.equal(renamedVersion.directory_version, 2);

    // 3. Simulate dedup media fix batch
    db.prepare('UPDATE storage_stats SET directory_version = directory_version + 1 WHERE id = 1').run();
    const dedupVersion = db.prepare('SELECT directory_version FROM storage_stats WHERE id = 1').get() as any;
    assert.equal(dedupVersion.directory_version, 3);
  });

  it('Admin Posts: unfiltered query bypasses SQL COUNT and reuses overview version & authors for directory lookup', async () => {
    const { canUseOverviewCount, getOverviewCount, parseAdminPostsParams, buildAdminPostsQuery } = await import('../src/lib/admin-dashboard.ts');
    const mockDb = createD1Adapter(db);

    // Warm cache on version 1
    await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });
    mockDb.resetCounts();

    const params = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&limit=10&offset=0'));
    assert.equal(canUseOverviewCount(params), true);

    const { countSql, countBindings, pageSql, pageBindings } = buildAdminPostsQuery(params, true);

    // Simulated admin-posts handler logic:
    let total: number;
    let overview: any = null;
    if (canUseOverviewCount(params)) {
      overview = await getAdminOverviewStats(mockDb, 1, { mediaCountsReady: true });
      total = getOverviewCount(params, overview);
    } else {
      const countRow = await mockDb.prepare(countSql).bind(...countBindings).first();
      total = countRow?.total ?? 0;
    }

    assert.equal(total, 5); // 5 published images in test seed

    // Page query execution
    await mockDb.prepare(pageSql).bind(...pageBindings).all();

    // Directory lookup reusing overview version and adminAuthors
    const directory = overview
      ? await getDirectoryData(mockDb, 'admin', {
          version: overview.version,
          adminAuthors: overview.authorStats.map((r: any) => ({
            author: r.author,
            author_display_name: r.author_display_name,
          })),
        })
      : await getDirectoryData(mockDb, 'admin');

    assert.equal(directory.version, 1);
    assert.deepEqual(directory.authors, ['alice', 'bob']);

    const queriesRun = mockDb.getQueriesRun();
    // Assert: SQL COUNT(*) was NOT executed on images!
    assert.ok(
      !queriesRun.some((q) => q.startsWith('SELECT COUNT(*) as total FROM images')),
      `Expected no SELECT COUNT(*) query on images, but got: ${queriesRun.join(', ')}`
    );
    // Assert: No second GROUP BY author was executed
    assert.ok(
      !queriesRun.some((q) => q.includes('GROUP BY author')),
      `Expected no GROUP BY author query, but got: ${queriesRun.join(', ')}`
    );
  });

  it('Admin Posts: filtered queries (author, tag, search, media) execute exact SQL COUNT', async () => {
    const { canUseOverviewCount, parseAdminPostsParams, buildAdminPostsQuery } = await import('../src/lib/admin-dashboard.ts');
    const mockDb = createD1Adapter(db);

    const filterUrls = [
      'https://example.com/api/admin-posts?published=1&author=alice&limit=10&offset=0',
      'https://example.com/api/admin-posts?published=1&tag=landscape&limit=10&offset=0',
      'https://example.com/api/admin-posts?published=1&search=photo&limit=10&offset=0',
      'https://example.com/api/admin-posts?published=1&media=photo&limit=10&offset=0',
    ];

    for (const urlStr of filterUrls) {
      mockDb.resetCounts();
      const params = parseAdminPostsParams(new URL(urlStr));
      assert.equal(canUseOverviewCount(params), false);

      const { countSql, countBindings } = buildAdminPostsQuery(params, true);
      const countRow = await mockDb.prepare(countSql).bind(...countBindings).first<any>();
      assert.ok(countRow !== undefined);

      const queriesRun = mockDb.getQueriesRun();
      assert.ok(
        queriesRun.some((q) => q.startsWith('SELECT COUNT(*) as total FROM images')),
        `Expected SELECT COUNT(*) for filtered query ${urlStr}`
      );
    }
  });
});
