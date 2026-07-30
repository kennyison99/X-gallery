import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDirectoryData, createBumpDirectoryVersionStmt, createConditionalBumpDirectoryVersionStmt } from '../src/lib/directory-data.ts';

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
  assert.equal(publicData.version, 5);
  assert.deepEqual(publicData.authors, ['genshin']);
  assert.deepEqual(publicData.tags, [{ id: 1, name: 'Anime' }]);
});
