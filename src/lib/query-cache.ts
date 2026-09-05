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

/** Coalesce work within an isolate; failed work is always removed for retries. */
export function createSingleFlight() {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, load: () => Promise<T>): Promise<T> {
      const pending = inFlight.get(key);
      if (pending) return pending as Promise<T>;
      const loading = Promise.resolve().then(load).finally(() => inFlight.delete(key));
      inFlight.set(key, loading);
      return loading;
    },
  };
}

export function createThreeTierCache(maxEntries = 250) {
  const memory = new Map<string, MemoryEntry>();
  const inFlight = createSingleFlight();

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

      return inFlight.run(key, async () => {
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
      });
    },
  };
}

export const queryCache = createThreeTierCache();
