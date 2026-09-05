import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearDirectoryMemoryCache,
  createBumpDirectoryVersionStmt,
  createConditionalBumpDirectoryVersionStmt,
  getDirectoryData,
} from '../src/lib/directory-data.ts';

test('createBumpDirectoryVersionStmt returns valid SQL statement', () => {
  const mockDb = {
    prepare(sql: string) {
      return {
        sql,
        bind(...args: any[]) {
          return { sql, args };
        },
      };
    },
  };

  const stmt = createBumpDirectoryVersionStmt(mockDb as any);
  assert.ok(stmt.sql.includes('UPDATE storage_stats SET directory_version = directory_version + 1'), 'Must update directory_version');
});

test('createConditionalBumpDirectoryVersionStmt binds condition predicate', () => {
  const mockDb = {
    prepare(sql: string) {
      return {
        sql,
        bind(...args: any[]) {
          return { sql, args };
        },
      };
    },
  };

  const stmt = createConditionalBumpDirectoryVersionStmt(
    mockDb as any,
    'SELECT 1 FROM images WHERE id = ? AND published = 0',
    [42]
  );
  assert.ok(stmt.sql.includes('EXISTS (SELECT 1 FROM images WHERE id = ? AND published = 0)'), 'Must wrap condition in EXISTS');
  assert.deepEqual((stmt as any).args, [42]);
});

test('getDirectoryData queries D1 and returns structured directory payload for public and admin scopes', async () => {
  let queriedVersion = false;
  let queriedAuthors = false;
  let authorsSql = '';

  const mockDb = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return this;
        },
        async first<T>() {
          if (sql.includes('directory_version')) {
            queriedVersion = true;
            return { directory_version: 5 } as T;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes('DISTINCT author')) {
            queriedAuthors = true;
            authorsSql = sql;
            return { results: [{ author: 'genshin' }] } as T;
          }
          if (sql.includes('FROM tags')) {
            return { results: [{ id: 1, name: 'Anime' }] } as T;
          }
          return { results: [] } as T;
        },
      };
    },
  };

  const publicData = await getDirectoryData(mockDb as any, 'public');
  assert.ok(queriedVersion, 'Must query directory_version from D1');
  assert.ok(queriedAuthors, 'Must query authors on cache miss');
  assert.match(authorsSql, /INDEXED BY idx_images_published_author/);
  assert.equal(publicData.version, 5);
  assert.deepEqual(publicData.authors, ['genshin']);
  assert.deepEqual(publicData.tags, [{ id: 1, name: 'Anime' }]);
});

test('getDirectoryData reuses fixed-key KV data across directory version bumps', async () => {
  clearDirectoryMemoryCache();
  let d1Reads = 0;
  const mockDb = {
    prepare(sql: string) {
      return {
        async all<T>() {
          d1Reads++;
          if (sql.includes('DISTINCT author')) {
            return { results: [{ author: 'cached_author' }] } as T;
          }
          if (sql.includes('FROM tags')) {
            return { results: [{ id: 9, name: 'Cached Tag' }] } as T;
          }
          return { results: [] } as T;
        },
      };
    },
  };
  const values = new Map<string, string>();
  const kv = {
    async get<T>(key: string, type: 'json') {
      assert.equal(type, 'json');
      const value = values.get(key);
      return value ? JSON.parse(value) as T : null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  };

  const first = await getDirectoryData(mockDb, 'public', { version: 101, kv });
  clearDirectoryMemoryCache();
  const second = await getDirectoryData(mockDb, 'public', { version: 102, kv });

  assert.equal(d1Reads, 2, 'the second request should not repeat author and tag queries');
  assert.deepEqual(second.authors, first.authors);
  assert.deepEqual(second.tags, first.tags);
  assert.equal(second.version, 102);
  assert.ok(second.canonicalAuthorSet.has('cached_author'));
});

test('a warm KV directory remains available without consulting a failing D1 database', async () => {
  clearDirectoryMemoryCache();
  let dbCalls = 0;
  const db = { prepare() { dbCalls++; throw new Error('D1 daily cap exceeded'); } };
  const kv = {
    async get() { return { version: 7, authors: ['Alice'], tags: [{ id: 1, name: 'Art' }] }; },
    async put() {},
  };
  const data = await getDirectoryData(db, 'public', { kv });
  assert.deepEqual(data.authors, ['Alice']);
  assert.ok(data.canonicalAuthorSet.has('alice'));
  assert.equal(data.version, 7);
  assert.equal(dbCalls, 0);
  clearDirectoryMemoryCache();
});

test('directory memory hits skip D1 but expire even when its version is unchanged', async (t) => {
  clearDirectoryMemoryCache();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let author = 'before';
  let reads = 0;
  const db = { prepare(sql: string) { return {
    async first() { reads++; return { directory_version: 1 }; },
    async all() { reads++; return { results: sql.includes('FROM images') ? [{ author }] : [] }; },
  }; } };
  await getDirectoryData(db, 'public');
  const coldReads = reads;
  author = 'after';
  assert.deepEqual((await getDirectoryData(db, 'public')).authors, ['before']);
  assert.equal(reads, coldReads);
  t.mock.timers.tick(3_600_001);
  assert.deepEqual((await getDirectoryData(db, 'public')).authors, ['after']);
  clearDirectoryMemoryCache();
});

test('concurrent directory misses share author and tag queries', async () => {
  clearDirectoryMemoryCache();
  let reads = 0;
  const db = { prepare() { return {
    async all() {
      reads++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { results: [] };
    },
  }; } };
  await Promise.all(Array.from({ length: 20 }, () => getDirectoryData(db, 'public', { version: 77 })));
  assert.equal(reads, 2);
  clearDirectoryMemoryCache();
});
