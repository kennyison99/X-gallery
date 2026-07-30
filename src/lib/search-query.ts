import { buildFilterKey, decodeCursor, encodeCursor, generateCursorWhereClause } from './cursor.ts';
import { getDirectoryData } from './directory-data.ts';

export interface SearchParams {
  q?: string;
  work?: string;
  tag?: string;
  author?: string;
  sort: 'newest' | 'oldest';
  cursorStr?: string;
  offset: number;
  limit: number;
}

export interface SearchResultItem {
  id: number;
  title: string | null;
  r2_keys: string;
  author: string;
  author_display_name: string | null;
  author_url: string | null;
  post_url: string | null;
  description: string | null;
  likes: number;
  created_at: string;
  tags_list: string | null;
}

export interface SearchBatchResult {
  items: SearchResultItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function parseSearchParams(params: URLSearchParams): SearchParams {
  const q = params.get('q')?.trim() || undefined;
  const work = params.get('work')?.trim() || undefined;
  const tag = params.get('tag')?.trim() || undefined;
  const author = params.get('author')?.trim() || undefined;
  const sortRaw = params.get('sort')?.toLowerCase();
  const sort: 'newest' | 'oldest' = sortRaw === 'oldest' ? 'oldest' : 'newest';

  const cursorStr = params.get('cursor')?.trim() || undefined;
  const offsetRaw = parseInt(params.get('offset') ?? '0', 10);
  const offset = isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;

  const limitRaw = parseInt(params.get('limit') ?? '48', 10);
  const limit = isNaN(limitRaw) ? 48 : Math.min(Math.max(limitRaw, 1), 96);

  return {
    q,
    work,
    tag,
    author,
    sort,
    cursorStr,
    offset,
    limit,
  };
}

export function buildSearchQuery(params: SearchParams) {
  const filterKey = buildFilterKey('search', {
    q: params.q,
    work: params.work,
    tag: params.tag,
    author: params.author,
    sort: params.sort,
  });

  const decodedCursor = params.cursorStr ? decodeCursor(params.cursorStr, filterKey, params.sort) : null;

  const whereClauses: string[] = ['i.published = 1'];
  const bindings: any[] = [];

  if (params.author) {
    whereClauses.push('i.author = ? COLLATE NOCASE');
    bindings.push(params.author.replace(/^@/, ''));
  }

  if (params.tag) {
    whereClauses.push(`
      EXISTS (
        SELECT 1 FROM image_tags it_t
        JOIN tags t_t ON it_t.tag_id = t_t.id
        WHERE it_t.image_id = i.id AND lower(t_t.name) = lower(?)
      )
    `);
    bindings.push(params.tag);
  }

  if (params.work) {
    whereClauses.push(`
      EXISTS (
        SELECT 1 FROM image_tags it_w
        JOIN tags t_w ON it_w.tag_id = t_w.id
        WHERE it_w.image_id = i.id AND lower(t_w.name) = lower(?)
      )
    `);
    bindings.push(params.work);
  }

  if (params.q) {
    const qPattern = `%${params.q}%`;
    whereClauses.push(`
      (
        i.title LIKE ?
        OR i.description LIKE ?
        OR i.author LIKE ?
        OR i.author_display_name LIKE ?
        OR EXISTS (
          SELECT 1 FROM image_tags it_q
          JOIN tags t_q ON it_q.tag_id = t_q.id
          WHERE it_q.image_id = i.id AND t_q.name LIKE ?
        )
      )
    `);
    bindings.push(qPattern, qPattern, qPattern, qPattern, qPattern);
  }

  if (decodedCursor) {
    const clause = generateCursorWhereClause(decodedCursor.sort);
    whereClauses.push(clause.sql);
    bindings.push(...clause.bindings(decodedCursor.createdAt, decodedCursor.id));
  }

  const orderDirection = params.sort === 'oldest' ? 'ASC' : 'DESC';
  const whereSql = whereClauses.join(' AND ');

  let offsetClause = '';
  if (!decodedCursor && params.offset > 0) {
    offsetClause = `OFFSET ?`;
  }

  const sql = `
    WITH paged_ids AS (
      SELECT i.id, i.created_at
      FROM images i
      WHERE ${whereSql}
      ORDER BY i.created_at ${orderDirection}, i.id ${orderDirection}
      LIMIT ? ${offsetClause}
    )
    SELECT 
      i.id, i.title, i.r2_keys, i.author, i.author_display_name, 
      i.author_url, i.post_url, i.description, i.likes, i.created_at,
      GROUP_CONCAT(t.name) as tags_list
    FROM paged_ids p
    JOIN images i ON p.id = i.id
    LEFT JOIN image_tags it ON i.id = it.image_id
    LEFT JOIN tags t ON it.tag_id = t.id
    GROUP BY i.id
    ORDER BY i.created_at ${orderDirection}, i.id ${orderDirection}
  `;

  bindings.push(params.limit + 1);
  if (!decodedCursor && params.offset > 0) {
    bindings.push(params.offset);
  }

  return { sql, bindings, filterKey };
}

export async function fetchSearchBatch(db: any, params: SearchParams): Promise<SearchBatchResult> {
  const { sql, bindings, filterKey } = buildSearchQuery(params);
  const { results = [] } = await db.prepare(sql).bind(...bindings).all<SearchResultItem>();

  const hasMore = results.length > params.limit;
  const pageRows = hasMore ? results.slice(0, params.limit) : results;

  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows.at(-1)!;
    nextCursor = encodeCursor({
      v: 1,
      sort: params.sort,
      createdAt: last.created_at,
      id: last.id,
      filterKey,
    });
  }

  // Use cached directory data to sanitize author handles from tags
  const directory = await getDirectoryData(db, 'public');
  const sanitizedItems = pageRows.map((img) => ({
    ...img,
    tags: img.tags_list
      ? img.tags_list.split(',').filter((tag) => !directory.canonicalAuthorSet.has(tag.trim().toLowerCase()))
      : [],
  }));

  return {
    items: sanitizedItems as any[],
    hasMore,
    nextCursor,
  };
}
