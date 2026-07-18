import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  buildCardDuplicateFix,
  buildMediaDuplicateFixes,
  splitR2Keys,
  type CardDuplicateFix,
  type DedupImageRow,
  type DedupObject,
  type DuplicateFix,
  type MediaDuplicateFix,
} from '../../lib/dedup-media';
import { addStorageBytes } from '../../lib/storage';

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 50;

interface CardScanRow extends DedupImageRow {
  group_cursor: number;
}

interface ApplyCardRow extends DedupImageRow {
  likes: number;
  published: number;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function integerParam(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  return /^\d+$/.test(value) ? Number(value) : null;
}

async function validApiKey(value: unknown): Promise<boolean> {
  if (typeof value !== 'string' || !env.CRAWL_API_KEY) return false;
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(value)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.CRAWL_API_KEY)),
  ]);
  return crypto.subtle.timingSafeEqual(provided, expected);
}

async function headKeys(keys: string[]): Promise<Map<string, DedupObject>> {
  const entries = await Promise.all([...new Set(keys)].map(async (key) => {
    try {
      const object = await env.BUCKET.head(key);
      return object ? [key, { etag: object.etag, size: object.size }] as const : null;
    } catch {
      return null;
    }
  }));
  return new Map(entries.filter((entry): entry is readonly [string, DedupObject] => entry !== null));
}

async function scanCards(cursor: number, limit: number) {
  const { results = [] } = await env.DB.prepare(`
    WITH duplicate_posts AS (
      SELECT post_url, MIN(id) AS group_cursor
      FROM images
      WHERE post_url LIKE '%/status/%'
      GROUP BY post_url
      HAVING COUNT(*) > 1 AND MIN(id) > ?
      ORDER BY group_cursor
      LIMIT ?
    )
    SELECT i.id, i.post_url, i.r2_keys, d.group_cursor
    FROM images i
    JOIN duplicate_posts d ON d.post_url = i.post_url
    ORDER BY d.group_cursor, i.id
  `).bind(cursor, limit + 1).all<CardScanRow>();

  const cursors = [...new Set(results.map((row) => row.group_cursor))];
  const pageCursors = new Set(cursors.slice(0, limit));
  const pageRows = results.filter((row) => pageCursors.has(row.group_cursor));
  const byPost = new Map<string, CardScanRow[]>();
  for (const row of pageRows) {
    const rows = byPost.get(row.post_url);
    if (rows) rows.push(row);
    else byPost.set(row.post_url, [row]);
  }

  const fixes = await Promise.all([...byPost.values()].map(async (rows) => {
    const objects = await headKeys(rows.flatMap((row) => splitR2Keys(row.r2_keys)));
    return buildCardDuplicateFix(rows, objects);
  }));

  return {
    duplicates: fixes.filter((fix): fix is CardDuplicateFix => fix !== null),
    next_cursor: cursors.length > limit ? cursors[limit - 1] : null,
  };
}

async function scanMedia(cursor: number, limit: number) {
  const { results = [] } = await env.DB.prepare(`
    SELECT id, post_url, r2_keys
    FROM images
    WHERE id > ? AND r2_keys LIKE '%,%'
    ORDER BY id
    LIMIT ?
  `).bind(cursor, limit + 1).all<DedupImageRow>();
  const pageRows = results.slice(0, limit);
  const fixes = await Promise.all(pageRows.map(async (row) => {
    const objects = await headKeys(splitR2Keys(row.r2_keys));
    return buildMediaDuplicateFixes(row, objects);
  }));

  return {
    duplicates: fixes.flat(),
    next_cursor: results.length > limit ? pageRows.at(-1)?.id ?? null : null,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDuplicateFix(value: unknown): value is DuplicateFix {
  if (!value || typeof value !== 'object') return false;
  const fix = value as Record<string, unknown>;
  if (fix.kind === 'card') {
    return typeof fix.post_url === 'string'
      && isPositiveInteger(fix.keep_id)
      && Array.isArray(fix.delete_ids)
      && fix.delete_ids.every(isPositiveInteger)
      && isStringArray(fix.delete_keys);
  }
  return fix.kind === 'media'
    && isPositiveInteger(fix.image_id)
    && typeof fix.keep_key === 'string'
    && isStringArray(fix.delete_keys);
}

function sameNumbers(a: number[], b: number[]): boolean {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

function sameStrings(a: string[], b: string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

async function deleteObjects(keys: string[], objects: ReadonlyMap<string, DedupObject>) {
  let deleted = 0;
  let freedBytes = 0;
  for (const key of keys) {
    try {
      await env.BUCKET.delete(key);
      deleted++;
      freedBytes += objects.get(key)?.size ?? 0;
    } catch (error) {
      console.error(JSON.stringify({ message: 'dedup R2 delete failed', key, error: String(error) }));
    }
  }
  return { deleted, freedBytes };
}

async function applyMediaFix(requested: MediaDuplicateFix) {
  const row = await env.DB.prepare('SELECT id, post_url, r2_keys FROM images WHERE id = ?')
    .bind(requested.image_id)
    .first<DedupImageRow>();
  if (!row) return null;

  const objects = await headKeys(splitR2Keys(row.r2_keys));
  const current = buildMediaDuplicateFixes(row, objects).find(
    (fix) => fix.keep_key === requested.keep_key && sameStrings(fix.delete_keys, requested.delete_keys),
  );
  if (!current) return null;

  const deleteSet = new Set(current.delete_keys);
  const remaining = splitR2Keys(row.r2_keys).filter((key) => !deleteSet.has(key));
  await env.DB.prepare('UPDATE images SET r2_keys = ? WHERE id = ?')
    .bind(remaining.join(','), row.id)
    .run();
  const deleted = await deleteObjects(current.delete_keys, objects);
  return { ...deleted, deletedCards: 0, fixedId: row.id };
}

async function applyCardFix(requested: CardDuplicateFix) {
  const ids = [requested.keep_id, ...requested.delete_ids];
  const placeholders = ids.map(() => '?').join(',');
  const { results = [] } = await env.DB.prepare(
    `SELECT id, post_url, r2_keys, likes, published FROM images WHERE id IN (${placeholders})`,
  ).bind(...ids).all<ApplyCardRow>();
  if (results.length !== ids.length || results.some((row) => row.post_url !== requested.post_url)) return null;

  const objects = await headKeys(results.flatMap((row) => splitR2Keys(row.r2_keys)));
  const current = buildCardDuplicateFix(results, objects);
  if (!current
    || current.keep_id !== requested.keep_id
    || !sameNumbers(current.delete_ids, requested.delete_ids)
    || !sameStrings(current.delete_keys, requested.delete_keys)) return null;

  const maxLikes = Math.max(...results.map((row) => row.likes ?? 0));
  const maxPublished = Math.max(...results.map((row) => row.published ?? 0));
  const deletePlaceholders = current.delete_ids.map(() => '?').join(',');
  const statements = current.delete_ids.map((deleteId) => env.DB.prepare(`
    INSERT OR IGNORE INTO image_tags (image_id, tag_id)
    SELECT ?, tag_id FROM image_tags WHERE image_id = ?
  `).bind(current.keep_id, deleteId));
  statements.push(
    env.DB.prepare('UPDATE images SET likes = ?, published = ? WHERE id = ?')
      .bind(maxLikes, maxPublished, current.keep_id),
    env.DB.prepare(`DELETE FROM image_tags WHERE image_id IN (${deletePlaceholders})`)
      .bind(...current.delete_ids),
    env.DB.prepare(`DELETE FROM images WHERE id IN (${deletePlaceholders})`)
      .bind(...current.delete_ids),
  );
  await env.DB.batch(statements);

  const deleted = await deleteObjects(current.delete_keys, objects);
  return {
    ...deleted,
    deletedCards: current.delete_ids.length,
    fixedId: current.keep_id,
  };
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!env?.DB || !env?.BUCKET) return json({ error: 'DB or BUCKET binding not configured' }, 500);
  const apiKey = request.headers.get('X-API-Key') ?? url.searchParams.get('api_key');
  if (!await validApiKey(apiKey)) return json({ error: 'Unauthorized' }, 401);

  const scope = url.searchParams.get('scope') ?? 'cards';
  const cursor = integerParam(url.searchParams.get('cursor'), 0);
  const requestedLimit = integerParam(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE);
  if ((scope !== 'cards' && scope !== 'media') || cursor === null || requestedLimit === null || requestedLimit < 1) {
    return json({ error: 'Invalid scan parameters' }, 400);
  }

  try {
    const result = scope === 'cards'
      ? await scanCards(cursor, Math.min(requestedLimit, MAX_PAGE_SIZE))
      : await scanMedia(cursor, Math.min(requestedLimit, MAX_PAGE_SIZE));
    return json({ success: true, scope, count: result.duplicates.length, ...result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.BUCKET) return json({ error: 'DB or BUCKET binding not configured' }, 500);

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return json({ error: 'Invalid body' }, 400);
    const input = body as Record<string, unknown>;
    if (!await validApiKey(input.api_key)) return json({ error: 'Unauthorized' }, 401);
    if (!Array.isArray(input.fixes) || !input.fixes.every(isDuplicateFix)) {
      return json({ error: 'Invalid fixes' }, 400);
    }

    let deletedCards = 0;
    let deletedObjects = 0;
    let freedBytes = 0;
    const fixedIds: number[] = [];
    for (const fix of input.fixes) {
      const result = fix.kind === 'card'
        ? await applyCardFix(fix)
        : await applyMediaFix(fix);
      if (!result) continue;
      deletedCards += result.deletedCards;
      deletedObjects += result.deleted;
      freedBytes += result.freedBytes;
      fixedIds.push(result.fixedId);
    }

    await addStorageBytes(-freedBytes);
    return json({
      success: true,
      fixed: fixedIds.length,
      deleted_cards: deletedCards,
      deleted_objects: deletedObjects,
      freed_bytes: freedBytes,
      fixed_ids: fixedIds,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
