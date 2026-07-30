export interface TagItem {
  id: number;
  name: string;
}

export interface AdminAuthorItem {
  author: string;
  author_display_name: string | null;
}

export interface DirectoryData {
  version: number;
  authors: string[];
  adminAuthors?: AdminAuthorItem[];
  tags: TagItem[];
  canonicalAuthorSet: Set<string>;
}

export interface GetDirectoryDataOptions {
  cache?: any; // Cloudflare Workers Cache API instance
  cacheBaseUrl?: string;
}

// Bounded single-entry in-memory cache per scope to avoid memory leaks
const memoryCache: Record<'public' | 'admin', { version: number; data: DirectoryData } | null> = {
  public: null,
  admin: null,
};

/**
 * Creates SQL statement to unconditionally bump directory version.
 */
export function createBumpDirectoryVersionStmt(db: any) {
  return db.prepare('UPDATE storage_stats SET directory_version = directory_version + 1 WHERE id = 1');
}

/**
 * Creates SQL statement to conditionally bump directory version only when condition SQL matches.
 */
export function createConditionalBumpDirectoryVersionStmt(db: any, conditionSql: string, bindings: any[] = []) {
  const sql = `UPDATE storage_stats SET directory_version = directory_version + 1 WHERE id = 1 AND EXISTS (${conditionSql})`;
  return db.prepare(sql).bind(...bindings);
}

/**
 * Fetches structured directory metadata (authors & tags) using scoped versioned caching.
 * Always reads directory_version fresh from D1 (1 row read) on each request.
 */
export async function getDirectoryData(
  db: any,
  scope: 'public' | 'admin' = 'public',
  options: GetDirectoryDataOptions = {}
): Promise<DirectoryData> {
  // 1. Always query current directory_version from D1 (1 D1 row read)
  const versionRow = await db
    .prepare('SELECT directory_version FROM storage_stats WHERE id = 1')
    .first<{ directory_version: number }>();
  const version = versionRow?.directory_version ?? 1;

  // 2. Check in-memory single-entry version cache
  const cachedMem = memoryCache[scope];
  if (cachedMem && cachedMem.version === version) {
    return cachedMem.data;
  }

  // 3. Fail-open Cache API check if available
  const cache = options.cache ?? (typeof caches !== 'undefined' ? (caches as any).default : undefined);
  const baseUrl = options.cacheBaseUrl ?? 'http://localhost';
  const cacheKey = `${baseUrl}/api/directory-cache-${scope}-v${version}`;

  if (cache) {
    try {
      const match = await cache.match(cacheKey);
      if (match) {
        const raw = await match.json();
        const data: DirectoryData = {
          ...raw,
          canonicalAuthorSet: new Set(raw.authors.map((a: string) => a.toLowerCase())),
        };
        memoryCache[scope] = { version, data };
        return data;
      }
    } catch {
      // Fail open on Cache API errors
    }
  }

  // 4. Query D1 for directory data on cache miss
  let authors: string[] = [];
  let adminAuthors: AdminAuthorItem[] | undefined;

  if (scope === 'public') {
    const { results = [] } = await db
      .prepare('SELECT DISTINCT author FROM images WHERE published = 1 ORDER BY author ASC')
      .all<{ author: string }>();
    authors = results.map((r: { author: string }) => r.author);
  } else {
    const { results = [] } = await db
      .prepare(
        'SELECT DISTINCT author, MAX(author_display_name) as author_display_name FROM images GROUP BY author ORDER BY author ASC'
      )
      .all<AdminAuthorItem>();
    adminAuthors = results;
    authors = results.map((r: AdminAuthorItem) => r.author);
  }

  const { results: tagResults = [] } = await db
    .prepare('SELECT id, name FROM tags ORDER BY name ASC')
    .all<TagItem>();

  const data: DirectoryData = {
    version,
    authors,
    adminAuthors,
    tags: tagResults,
    canonicalAuthorSet: new Set(authors.map((a) => a.toLowerCase())),
  };

  // Update in-memory cache (replacing old version)
  memoryCache[scope] = { version, data };

  // Fail-open Cache API write
  if (cache) {
    try {
      const responsePayload = {
        version,
        authors: data.authors,
        adminAuthors: data.adminAuthors,
        tags: data.tags,
      };
      const res = new Response(JSON.stringify(responsePayload), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      });
      await cache.put(cacheKey, res);
    } catch {
      // Fail open on Cache API put errors
    }
  }

  return data;
}
