import { buildFilterKey, decodeCursor, encodeCursor, generateCursorWhereClause } from './cursor.ts';

export const INITIAL_GALLERY_LIMIT = 48;
export const GALLERY_BATCH_LIMIT = 24;
export const MAX_GALLERY_LIMIT = 48;

export type GallerySort = 'newest' | 'oldest';

export interface GalleryBatchParams {
  sort: GallerySort;
  cursorStr?: string;
  offset: number;
  limit: number;
  tag: string | null;
  author: string | null;
}

export interface GalleryRow {
  id: number;
  title: string;
  r2_keys: string;
  author: string;
  author_display_name?: string;
  author_url: string;
  post_url: string;
  description: string;
  likes: number;
  tags_list?: string;
  created_at?: string;
  updated_at?: string;
}

interface GalleryDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
}

function integerParam(value: string | null, fallback: number, name: string): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
  return Number(value);
}

export function parseGalleryBatchParams(params: URLSearchParams): GalleryBatchParams {
  const sort = params.get('sort') ?? 'newest';
  if (sort !== 'newest' && sort !== 'oldest') throw new Error('Invalid sort');

  const cursorStr = params.get('cursor')?.trim() || undefined;
  const offset = integerParam(params.get('offset'), 0, 'offset');
  const requestedLimit = integerParam(
    params.get('limit'),
    INITIAL_GALLERY_LIMIT,
    'limit',
  );
  if (requestedLimit < 1) throw new Error('Invalid limit');

  const res: GalleryBatchParams = {
    sort: sort as GallerySort,
    offset,
    limit: Math.min(requestedLimit, MAX_GALLERY_LIMIT),
    tag: params.get('tag'),
    author: params.get('author'),
  };
  if (cursorStr) {
    res.cursorStr = cursorStr;
  }
  return res;
}

export function takeGalleryBatch<T>(rows: T[], limit: number): {
  items: T[];
  hasMore: boolean;
} {
  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

export function buildGalleryQuery(options: GalleryBatchParams): {
  sql: string;
  bindings: unknown[];
  filterKey: string;
} {
  const filterKey = buildFilterKey('gallery', {
    tag: options.tag,
    author: options.author,
    sort: options.sort,
  });

  const decodedCursor = options.cursorStr ? decodeCursor(options.cursorStr, filterKey) : null;
  const direction = options.sort === 'oldest' ? 'ASC' : 'DESC';
  const bindings: unknown[] = [];
  const whereClauses: string[] = [];

  if (options.tag) {
    whereClauses.push('selected_tag.name = ? AND i.published = 1');
    bindings.push(options.tag);
  } else if (options.author) {
    whereClauses.push('i.author = ? AND i.published = 1');
    bindings.push(options.author);
  } else {
    whereClauses.push('i.published = 1');
  }

  if (decodedCursor) {
    const clause = generateCursorWhereClause(decodedCursor.sort);
    whereClauses.push(clause.sql);
    bindings.push(...clause.bindings(decodedCursor.createdAt, decodedCursor.id));
  }

  const whereSql = whereClauses.join(' AND ');

  bindings.push(options.limit + 1);
  let offsetClause = '';
  if (!decodedCursor && options.offset > 0) {
    offsetClause = 'OFFSET ?';
    bindings.push(options.offset);
  }

  const tagJoin = options.tag
    ? `JOIN image_tags selected_it ON i.id = selected_it.image_id JOIN tags selected_tag ON selected_it.tag_id = selected_tag.id`
    : '';

  return {
    sql: `
      WITH page_images AS (
        SELECT i.*
        FROM images i
        ${tagJoin}
        WHERE ${whereSql}
        ORDER BY i.created_at ${direction}, i.id ${direction}
        LIMIT ? ${offsetClause}
      )
      SELECT p.*, group_concat(t.name) AS tags_list
      FROM page_images p
      LEFT JOIN image_tags it ON p.id = it.image_id
      LEFT JOIN tags t ON it.tag_id = t.id
      GROUP BY p.id
      ORDER BY p.created_at ${direction}, p.id ${direction}`,
    bindings,
    filterKey,
  };
}

export async function fetchGalleryBatch(
  db: GalleryDatabase,
  options: GalleryBatchParams,
): Promise<{ items: GalleryRow[]; hasMore: boolean; nextCursor: string | null }> {
  const { sql, bindings, filterKey } = buildGalleryQuery(options);
  const { results = [] } = await db
    .prepare(sql)
    .bind(...bindings)
    .all<GalleryRow>();

  const { items, hasMore } = takeGalleryBatch(results, options.limit);
  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items.at(-1)!;
    if (last.created_at) {
      nextCursor = encodeCursor({
        v: 1,
        sort: options.sort,
        createdAt: last.created_at,
        id: last.id,
        filterKey,
      });
    }
  }

  return { items, hasMore, nextCursor };
}
