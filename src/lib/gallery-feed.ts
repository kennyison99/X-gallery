export const INITIAL_GALLERY_LIMIT = 48;
export const GALLERY_BATCH_LIMIT = 24;
export const MAX_GALLERY_LIMIT = 48;

export type GallerySort = 'newest' | 'oldest';

export interface GalleryBatchParams {
  sort: GallerySort;
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

  const offset = integerParam(params.get('offset'), 0, 'offset');
  const requestedLimit = integerParam(
    params.get('limit'),
    INITIAL_GALLERY_LIMIT,
    'limit',
  );
  if (requestedLimit < 1) throw new Error('Invalid limit');

  return {
    sort,
    offset,
    limit: Math.min(requestedLimit, MAX_GALLERY_LIMIT),
    tag: params.get('tag'),
    author: params.get('author'),
  };
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
} {
  const direction = options.sort === 'oldest' ? 'ASC' : 'DESC';
  const bindings: unknown[] = [];
  let joins = `
    LEFT JOIN image_tags it ON i.id = it.image_id
    LEFT JOIN tags t ON it.tag_id = t.id`;
  let where = 'i.published = 1';

  if (options.tag) {
    joins = `
      JOIN image_tags selected_it ON i.id = selected_it.image_id
      JOIN tags selected_tag ON selected_it.tag_id = selected_tag.id
      LEFT JOIN image_tags it ON i.id = it.image_id
      LEFT JOIN tags t ON it.tag_id = t.id`;
    where = 'selected_tag.name = ? AND i.published = 1';
    bindings.push(options.tag);
  } else if (options.author) {
    where = 'i.author = ? AND i.published = 1';
    bindings.push(options.author);
  }

  bindings.push(options.limit + 1, options.offset);

  return {
    sql: `
      SELECT i.*, group_concat(t.name) AS tags_list
      FROM images i
      ${joins}
      WHERE ${where}
      GROUP BY i.id
      ORDER BY i.created_at ${direction}, i.id ${direction}
      LIMIT ? OFFSET ?`,
    bindings,
  };
}

export async function fetchGalleryBatch(
  db: GalleryDatabase,
  options: GalleryBatchParams,
): Promise<{ items: GalleryRow[]; hasMore: boolean }> {
  const { sql, bindings } = buildGalleryQuery(options);
  const { results = [] } = await db
    .prepare(sql)
    .bind(...bindings)
    .all<GalleryRow>();

  return takeGalleryBatch(results, options.limit);
}
