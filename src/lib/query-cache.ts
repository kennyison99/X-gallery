export interface QueryCacheKv {
  get<T>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

export interface CachedQueryOptions<T> {
  kv?: QueryCacheKv;
  key: string;
  memoryTtlMs: number;
  kvTtlSeconds: number;
  load: () => Promise<T>;
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

async function boundedCacheKey(rawKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawKey);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `query:v1:${hash}`;
}

export function createThreeTierCache(maxEntries = 250) {
  const memory = new Map<string, MemoryEntry>();

  function remember(key: string, value: unknown, ttlMs: number): void {
    if (!memory.has(key) && memory.size >= maxEntries) {
      const oldestKey = memory.keys().next().value;
      if (oldestKey) memory.delete(oldestKey);
    }
    memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  return {
    async getOrLoad<T>(options: CachedQueryOptions<T>): Promise<T> {
      const key = await boundedCacheKey(options.key);
      const memoryEntry = memory.get(key);
      if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
        return memoryEntry.value as T;
      }
      if (memoryEntry) memory.delete(key);

      if (options.kv) {
        try {
          const cached = await options.kv.get<T>(key, 'json');
          if (cached !== null) {
            remember(key, cached, options.memoryTtlMs);
            return cached;
          }
        } catch (error) {
          console.error('Query cache KV read failed:', error);
        }
      }

      const fresh = await options.load();
      remember(key, fresh, options.memoryTtlMs);

      if (options.kv) {
        try {
          await options.kv.put(key, JSON.stringify(fresh), {
            expirationTtl: options.kvTtlSeconds,
          });
        } catch (error) {
          console.error('Query cache KV write failed:', error);
        }
      }

      return fresh;
    },
  };
}

export const queryCache = createThreeTierCache();
