export const ADMIN_TABS = ['overview', 'posts', 'upload', 'crawler', 'auto-tag'] as const;
export type AdminTab = typeof ADMIN_TABS[number];

export function normalizeAuthorHandle(value: unknown): string {
  return String(value ?? '').trim().replace(/^@+/, '').trim();
}

export function formatAuthorName(displayName: unknown, handle: unknown): string {
  const cleanDisplayName = String(displayName ?? '').trim();
  const cleanHandle = normalizeAuthorHandle(handle);
  if (!cleanHandle) return cleanDisplayName;
  return cleanDisplayName ? `${cleanDisplayName}@${cleanHandle}` : `@${cleanHandle}`;
}

export function authorSearchText(displayName: unknown, handle: unknown): string {
  return `${String(displayName ?? '').trim()} ${normalizeAuthorHandle(handle)}`.trim().toLowerCase();
}

export function normalizeAuthorInput(handle: unknown, displayName: unknown) {
  return {
    handle: normalizeAuthorHandle(handle),
    displayName: String(displayName ?? '').trim(),
  };
}

export function resolveAdminTab(hash: string): AdminTab {
  const candidate = hash.replace(/^#/, '') as AdminTab;
  return ADMIN_TABS.includes(candidate) ? candidate : 'overview';
}

export interface AdminPostsQueryParams {
  offset: number;
  limit: number;
  published: number;
  search: string;
  author: string;
  tag: string;
  media: string;
  sort: string;
}

export function parseAdminPostsParams(url: URL): AdminPostsQueryParams {
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
  const published = url.searchParams.get('published') === '0' ? 0 : 1;
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
  const author = (url.searchParams.get('author') ?? '').trim();
  const tag = (url.searchParams.get('tag') ?? '').trim();
  const media = url.searchParams.get('media') ?? '';
  const sort = url.searchParams.get('sort') ?? 'newest';
  return { offset, limit, published, search, author, tag, media, sort };
}

export function buildAdminPostsQuery(params: AdminPostsQueryParams, mediaCountsReady: boolean = false): {
  countSql: string;
  countBindings: unknown[];
  pageSql: string;
  pageBindings: unknown[];
  where: string;
} {
  const conditions: string[] = ['i.published = ?'];
  const bindings: unknown[] = [params.published];

  if (params.search) {
    conditions.push('(instr(LOWER(i.title), ?) > 0 OR instr(LOWER(i.author), ?) > 0 OR instr(LOWER(i.description), ?) > 0 OR instr(LOWER(i.author_display_name), ?) > 0)');
    bindings.push(params.search, params.search, params.search, params.search);
  }

  if (params.author) {
    conditions.push('i.author = ? COLLATE NOCASE');
    bindings.push(params.author.replace(/^@/, ''));
  }

  if (params.tag) {
    conditions.push(`i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE t.name = ?)`);
    bindings.push(params.tag);
  }

  if (params.media === 'photo' || params.media === 'video') {
    if (mediaCountsReady) {
      if (params.media === 'photo') {
        conditions.push('(i.photo_count > 0 AND i.video_count = 0)');
      } else {
        conditions.push('i.video_count > 0');
      }
    } else {
      if (params.media === 'video') {
        conditions.push(`(i.r2_keys LIKE '%.mp4%' OR i.r2_keys LIKE '%.webm%' OR i.r2_keys LIKE '%.mov%' OR i.r2_keys LIKE '%.m4v%')`);
      } else {
        conditions.push(`(i.r2_keys NOT LIKE '%.mp4%' AND i.r2_keys NOT LIKE '%.webm%' AND i.r2_keys NOT LIKE '%.mov%' AND i.r2_keys NOT LIKE '%.m4v%')`);
      }
    }
  }

  const where = conditions.join(' AND ');
  const countSql = `SELECT COUNT(*) as total FROM images i WHERE ${where}`;
  const countBindings = [...bindings];

  let orderBy = 'i.created_at DESC, i.id DESC';
  if (params.sort === 'oldest') {
    orderBy = 'i.created_at ASC, i.id ASC';
  } else if (params.sort === 'size_desc') {
    orderBy = '(COALESCE(i.photo_bytes, 0) + COALESCE(i.video_bytes, 0)) DESC, i.created_at DESC, i.id DESC';
  } else if (params.sort === 'size_asc') {
    orderBy = '(COALESCE(i.photo_bytes, 0) + COALESCE(i.video_bytes, 0)) ASC, i.created_at DESC, i.id DESC';
  }

  const pageBindings = [...bindings, params.limit, params.offset];
  const pageSql = `
    WITH page AS (
      SELECT i.id
      FROM images i
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    )
    SELECT i.*, group_concat(t.name) AS tags_list
    FROM page p
    JOIN images i ON p.id = i.id
    LEFT JOIN image_tags it ON i.id = it.image_id
    LEFT JOIN tags t ON it.tag_id = t.id
    GROUP BY i.id
    ORDER BY ${orderBy}`;

  return {
    countSql,
    countBindings,
    pageSql,
    pageBindings,
    where,
  };
}

export function canUseOverviewCount(params: AdminPostsQueryParams): boolean {
  return !params.search && !params.author && !params.tag && !params.media;
}

export function getOverviewCount(
  params: AdminPostsQueryParams,
  overview: { publishedCount: number; pendingCount: number }
): number {
  return params.published === 1 ? overview.publishedCount : overview.pendingCount;
}
