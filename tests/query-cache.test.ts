import assert from 'node:assert/strict';
import { test } from 'node:test';

const cacheModule = await import('../src/lib/query-cache.ts').catch(() => ({} as any));
const createThreeTierCache =
  (cacheModule as any).createThreeTierCache ??
  (() => {
    throw new Error('createThreeTierCache is not implemented');
  });

class MemoryKv {
  values = new Map<string, string>();
  writes: Array<{ key: string; value: string; expirationTtl: number }> = [];

  async get<T>(key: string, type: 'json'): Promise<T | null> {
    assert.equal(type, 'json');
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value) as T;
  }

  async put(key: string, value: string, options: { expirationTtl: number }): Promise<void> {
    this.values.set(key, value);
    this.writes.push({ key, value, expirationTtl: options.expirationTtl });
  }
}

test('a KV hit returns cached query data without executing the D1 loader', async () => {
  const kv = new MemoryKv();
  const firstWorker = createThreeTierCache();
  const secondWorker = createThreeTierCache();
  let loads = 0;

  const expected = { items: [{ id: 7 }], hasMore: false };
  await firstWorker.getOrLoad({
    kv,
    key: 'gallery:version=3&sort=newest',
    memoryTtlMs: 30_000,
    kvTtlSeconds: 300,
    load: async () => {
      loads++;
      return expected;
    },
  });

  const result = await secondWorker.getOrLoad({
    kv,
    key: 'gallery:version=3&sort=newest',
    memoryTtlMs: 30_000,
    kvTtlSeconds: 300,
    load: async () => {
      loads++;
      return { items: [], hasMore: false };
    },
  });

  assert.deepEqual(result, expected);
  assert.equal(loads, 1);
});

test('a cache miss persists JSON with the requested KV expiration', async () => {
  const kv = new MemoryKv();
  const cache = createThreeTierCache();

  const result = await cache.getOrLoad({
    kv,
    key: 'search:q=原神',
    memoryTtlMs: 30_000,
    kvTtlSeconds: 1_800,
    load: async () => ({ items: [1, 2, 3] }),
  });

  assert.deepEqual(result, { items: [1, 2, 3] });
  assert.equal(kv.writes.length, 1);
  assert.equal(kv.writes[0].expirationTtl, 1_800);
  assert.deepEqual(JSON.parse(kv.writes[0].value), { items: [1, 2, 3] });
  assert.ok(kv.writes[0].key.length <= 128, 'hashed KV keys must remain bounded');
});

test('KV failures fail open and return fresh D1 data', async () => {
  const cache = createThreeTierCache();
  const brokenKv = {
    async get() {
      throw new Error('KV unavailable');
    },
    async put() {
      throw new Error('KV unavailable');
    },
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await cache.getOrLoad({
      kv: brokenKv,
      key: 'gallery:first-page',
      memoryTtlMs: 30_000,
      kvTtlSeconds: 300,
      load: async () => ({ items: [{ id: 9 }] }),
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, { items: [{ id: 9 }] });
});
