import { createSingleFlight } from './query-cache.ts';

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

export interface AdminAuthorStatItem {
  author: string;
  author_display_name: string | null;
  posts: number;
  published: number;
  pending: number;
  photos: number;
  videos: number;
  photo_bytes: number;
  video_bytes: number;
}

export interface AdminOverviewStats {
  version: number;
  totalPosts: number;
  publishedCount: number;
  pendingCount: number;
  totalPhotos: number;
  totalVideos: number;
  authorStats: AdminAuthorStatItem[];
}

export interface GetDirectoryDataOptions {
  cache?: any; // Cloudflare Workers Cache API instance
  cacheBaseUrl?: string;
  version?: number;
  adminAuthors?: AdminAuthorItem[];
  kv?: {
    get<T>(key: string, type: 'json'): Promise<T | null>;
    put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  };
}

export interface GetAdminOverviewStatsOptions {
  cache?: any;
  cacheBaseUrl?: string;
  mediaCountsReady?: boolean;
  kv?: {
    get<T>(key: string, type: 'json'): Promise<T | null>;
    put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  };
}

// Bounded single-entry in-memory cache per scope to avoid memory leaks
const memoryCache: Record<'public' | 'admin', { version: number; data: DirectoryData; expiresAt: number } | null> = {
  public: null,
  admin: null,
};

let adminOverviewMemoryCache: { version: number; data: AdminOverviewStats; expiresAt: number } | null = null;

const ADMIN_OVERVIEW_KV_KEY = 'admin-overview:v1';
const ADMIN_OVERVIEW_KV_TTL_SECONDS = 3_600;
const DIRECTORY_KV_TTL_SECONDS = 3_600;
const DIRECTORY_MEMORY_TTL_MS = 30_000;
const directoryLoads = createSingleFlight();
const overviewLoads = createSingleFlight();

export function clearDirectoryMemoryCache(): void {
  memoryCache.public = null;
  memoryCache.admin = null;
  adminOverviewMemoryCache = null;
}

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
 * If options.version is provided, skips querying storage_stats.
 * If scope === 'admin' and options.adminAuthors is provided, avoids duplicate GROUP BY author scan on images.
 */
export function getDirectoryData(
  db: any,
  scope: 'public' | 'admin' = 'public',
  options: GetDirectoryDataOptions = {},
): Promise<DirectoryData> {
  return directoryLoads.run(`${scope}:${options.version ?? 'latest'}`, () => loadDirectoryData(db, scope, options));
}

async function loadDirectoryData(
  db: any,
  scope: 'public' | 'admin' = 'public',
  options: GetDirectoryDataOptions = {}
): Promise<DirectoryData> {
  // Serve bounded cache entries before consulting D1, including during a D1 outage.
  let version = options.version;
  const cachedMem = memoryCache[scope];
  if (cachedMem && cachedMem.expiresAt > Date.now() && (version === undefined || cachedMem.version === version)) {
    return cachedMem.data;
  }

  // Use a fixed KV key so uploads do not invalidate the complete author/tag
  // directory. The bounded TTL trades at most one hour of staleness for avoiding
  // repeated full directory reads during active crawls.
  if (options.kv) {
    try {
      const cached = await options.kv.get<{
        version?: number;
        authors: string[];
        adminAuthors?: AdminAuthorItem[];
        tags: TagItem[];
      }>(`directory:v1:${scope}`, 'json');
      if (cached) {
        const data: DirectoryData = {
          ...cached,
          version: version ?? cached.version ?? 1,
          canonicalAuthorSet: new Set(cached.authors.map((author) => author.toLowerCase())),
        };
        memoryCache[scope] = { version: data.version, data, expiresAt: Date.now() + DIRECTORY_MEMORY_TTL_MS };
        return data;
      }
    } catch (error) {
      console.error('Directory KV read failed:', error);
    }
  }

  if (typeof version !== 'number') {
    const versionRow = await db
      .prepare('SELECT directory_version FROM storage_stats WHERE id = 1')
      .first<{ directory_version: number }>();
    version = versionRow?.directory_version ?? 1;
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
        memoryCache[scope] = { version, data, expiresAt: Date.now() + DIRECTORY_MEMORY_TTL_MS };
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
      .prepare('SELECT DISTINCT author FROM images INDEXED BY idx_images_published_author WHERE published = 1 ORDER BY author ASC')
      .all<{ author: string }>();
    authors = results.map((r: { author: string }) => r.author);
  } else {
    if (options.adminAuthors && options.adminAuthors.length > 0) {
      // Reuse already computed admin authors to avoid second images table GROUP BY scan
      adminAuthors = options.adminAuthors;
      authors = adminAuthors.map((r) => r.author);
    } else {
      const { results = [] } = await db
        .prepare(
          'SELECT DISTINCT author, MAX(author_display_name) as author_display_name FROM images GROUP BY author ORDER BY author ASC'
        )
        .all<AdminAuthorItem>();
      adminAuthors = results;
      authors = results.map((r: AdminAuthorItem) => r.author);
    }
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
  memoryCache[scope] = { version, data, expiresAt: Date.now() + DIRECTORY_MEMORY_TTL_MS };

  if (options.kv) {
    try {
      await options.kv.put(`directory:v1:${scope}`, JSON.stringify({
        version: data.version,
        authors: data.authors,
        adminAuthors: data.adminAuthors,
        tags: data.tags,
      }), {
        expirationTtl: DIRECTORY_KV_TTL_SECONDS,
      });
    } catch (error) {
      console.error('Directory KV write failed:', error);
    }
  }

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
          'Cache-Control': 'public, max-age=3600',
        },
      });
      await cache.put(cacheKey, res);
    } catch {
      // Fail open on Cache API put errors
    }
  }

  return data;
}

/**
 * Fetches consolidated Admin Overview metrics & Author stats using versioned caching.
 * Performs at most ONE single images table GROUP BY aggregation on cache miss,
 * deriving global totals via JS reduction without a second full table scan.
 */
export function getAdminOverviewStats(
  db: any,
  version?: number,
  options: GetAdminOverviewStatsOptions = {},
): Promise<AdminOverviewStats> {
  return overviewLoads.run(`${version ?? 'latest'}:${options.mediaCountsReady ?? 'unknown'}`,
    () => loadAdminOverviewStats(db, version, options));
}

async function loadAdminOverviewStats(
  db: any,
  version?: number,
  options: GetAdminOverviewStatsOptions = {}
): Promise<AdminOverviewStats> {
  let mediaCountsReady = options.mediaCountsReady;
  let resolvedVersion = version;
  // Check bounded caches before touching D1, just like the public directory.
  if (adminOverviewMemoryCache && adminOverviewMemoryCache.expiresAt > Date.now()
    && (resolvedVersion === undefined || adminOverviewMemoryCache.version === resolvedVersion)) {
    return adminOverviewMemoryCache.data;
  }

  // Use a fixed KV key so frequent image writes do not force another full-table
  // aggregation. Admin overview numbers may be stale for at most one hour.
  if (options.kv) {
    try {
      const cached = await options.kv.get<AdminOverviewStats>(ADMIN_OVERVIEW_KV_KEY, 'json');
      if (cached) {
        const data = { ...cached, version: resolvedVersion ?? cached.version };
        adminOverviewMemoryCache = { version: data.version, data, expiresAt: Date.now() + DIRECTORY_MEMORY_TTL_MS };
        return data;
      }
    } catch (error) {
      console.error('Admin overview KV read failed:', error);
    }
  }

  if (typeof resolvedVersion !== 'number' || typeof mediaCountsReady !== 'boolean') {
    const statsRow = await db
      .prepare('SELECT directory_version, media_counts_ready FROM storage_stats WHERE id = 1')
      .first<{ directory_version: number; media_counts_ready: number }>();
    resolvedVersion ??= statsRow?.directory_version ?? 1;
    mediaCountsReady ??= statsRow?.media_counts_ready === 1;
  }

  // 3. Fail-open Cache API check
  const cache = options.cache ?? (typeof caches !== 'undefined' ? (caches as any).default : undefined);
  const baseUrl = options.cacheBaseUrl ?? 'http://localhost';
  const cacheKey = `${baseUrl}/api/admin-overview-cache-v${resolvedVersion}`;

  if (cache) {
    try {
      const match = await cache.match(cacheKey);
      if (match) {
        const data: AdminOverviewStats = await match.json();
        adminOverviewMemoryCache = { version: resolvedVersion, data, expiresAt: Date.now() + DIRECTORY_MEMORY_TTL_MS };
        return data;
      }
    } catch {
      // Fail open on Cache API errors
    }
  }

  // 4. Query D1 for consolidated author & global metrics on cache miss
  let authorStats: AdminAuthorStatItem[] = [];
  let totalPosts = 0;
  let publishedCount = 0;
  let pendingCount = 0;
  let totalPhotos = 0;
  let totalVideos = 0;

  if (mediaCountsReady) {
    // Single consolidated query replacing two separate full table scans
    const { results = [] } = await db
      .prepare(`
        SELECT 
          author, 
          MAX(author_display_name) AS author_display_name, 
          COUNT(*) AS posts, 
          SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END) AS published, 
          SUM(CASE WHEN published = 0 THEN 1 ELSE 0 END) AS pending, 
          SUM(photo_count) AS photos, 
          SUM(video_count) AS videos, 
          SUM(photo_bytes) AS photo_bytes, 
          SUM(video_bytes) AS video_bytes 
        FROM images 
        GROUP BY author 
        ORDER BY author ASC
      `)
      .all<any>();

    authorStats = (results || []).map((r: any) => ({
      author: String(r.author || ''),
      author_display_name: r.author_display_name ? String(r.author_display_name) : null,
      posts: Number(r.posts || 0),
      published: Number(r.published || 0),
      pending: Number(r.pending || 0),
      photos: Number(r.photos || 0),
      videos: Number(r.videos || 0),
      photo_bytes: Number(r.photo_bytes || 0),
      video_bytes: Number(r.video_bytes || 0),
    }));

    // JS reduction over ~87 author rows to calculate global summary counts
    for (const r of authorStats) {
      totalPosts += r.posts;
      publishedCount += r.published;
      pendingCount += r.pending;
      totalPhotos += r.photos;
      totalVideos += r.videos;
    }
  } else {
    // Fallback path before media count backfill is complete
    const countRow = await db
      .prepare(
        'SELECT COUNT(*) as total, SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END) as published, SUM(CASE WHEN published = 0 THEN 1 ELSE 0 END) as pending FROM images'
      )
      .first<any>();

    totalPosts = Number(countRow?.total || 0);
    publishedCount = Number(countRow?.published || 0);
    pendingCount = Number(countRow?.pending || 0);

    const authorRows = await db
      .prepare('SELECT author, author_display_name, r2_keys, published, photo_bytes, video_bytes FROM images')
      .all<any>();

    const authorMap = new Map<
      string,
      { display: string | null; posts: number; published: number; pending: number; photos: number; videos: number; photo_bytes: number; video_bytes: number }
    >();

    for (const row of authorRows.results || []) {
      const author = String(row.author || '');
      const displayName = row.author_display_name ? String(row.author_display_name) : null;
      const isPublished = Number(row.published || 0) === 1;
      const photoBytes = Number(row.photo_bytes || 0);
      const videoBytes = Number(row.video_bytes || 0);
      const keys = (row.r2_keys || '')
        .split(',')
        .map((k: string) => k.trim())
        .filter((k: string) => k.length > 0);

      let photosCount = 0;
      let videosCount = 0;
      for (const key of keys) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.endsWith('.mp4') || lowerKey.endsWith('.webm') || lowerKey.endsWith('.mov') || lowerKey.endsWith('.m4v')) {
          videosCount++;
        } else {
          photosCount++;
        }
      }

      totalPhotos += photosCount;
      totalVideos += videosCount;

      const existing = authorMap.get(author);
      if (existing) {
        existing.posts += 1;
        if (isPublished) existing.published += 1;
        else existing.pending += 1;
        existing.photos += photosCount;
        existing.videos += videosCount;
        existing.photo_bytes += photoBytes;
        existing.video_bytes += videoBytes;
        if (!existing.display && displayName) existing.display = displayName;
      } else {
        authorMap.set(author, {
          display: displayName,
          posts: 1,
          published: isPublished ? 1 : 0,
          pending: isPublished ? 0 : 1,
          photos: photosCount,
          videos: videosCount,
          photo_bytes: photoBytes,
          video_bytes: videoBytes,
        });
      }
    }

    authorStats = Array.from(authorMap.entries())
      .map(([author, data]) => ({
        author,
        author_display_name: data.display,
        posts: data.posts,
        published: data.published,
        pending: data.pending,
        photos: data.photos,
        videos: data.videos,
        photo_bytes: data.photo_bytes,
        video_bytes: data.video_bytes,
      }))
      .sort((a, b) => a.author.localeCompare(b.author));
  }

  const data: AdminOverviewStats = {
    version: resolvedVersion,
    totalPosts,
    publishedCount,
    pendingCount,
    totalPhotos,
    totalVideos,
    authorStats,
  };

  // Update in-memory cache
  adminOverviewMemoryCache = { version: resolvedVersion, data, expiresAt: Date.now() + DIRECTORY_MEMORY_TTL_MS };

  if (options.kv) {
    try {
      await options.kv.put(ADMIN_OVERVIEW_KV_KEY, JSON.stringify(data), {
        expirationTtl: ADMIN_OVERVIEW_KV_TTL_SECONDS,
      });
    } catch (error) {
      console.error('Admin overview KV write failed:', error);
    }
  }

  // Fail-open Cache API write
  if (cache) {
    try {
      const res = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      });
      await cache.put(cacheKey, res);
    } catch {
      // Fail open on Cache API put errors
    }
  }

  return data;
}
