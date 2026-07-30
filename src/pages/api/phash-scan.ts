import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { chunkArray, isValidPHashHex } from '../../lib/phash-utils';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

interface UnhashedMediaRow {
  image_id: number;
  r2_key: string;
  title: string | null;
  likes: number;
}

interface StoredHashRow {
  image_id: number;
  r2_key: string;
  phash: string;
  likes: number;
  title: string | null;
  created_at: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function integerParam(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  return /^\d+$/.test(value) ? Number(value) : null;
}

async function validApiKey(request: Request): Promise<boolean> {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || !env?.CRAWL_API_KEY) return false;
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(apiKey)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.CRAWL_API_KEY)),
  ]);
  return crypto.subtle.timingSafeEqual(provided, expected);
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!env?.DB) return json({ error: 'DB binding not configured' }, 500);

  if (!await validApiKey(request)) return json({ error: 'Unauthorized header credentials' }, 401);

  const action = url.searchParams.get('action') ?? 'unhashed';

  try {
    if (action === 'hashes') {
      // Fast retrieval of all stored 16-hex pHashes for published images
      const { results = [] } = await env.DB.prepare(`
        SELECT m.image_id, m.r2_key, m.phash, i.likes, i.title, i.created_at
        FROM media_assets m
        JOIN images i ON m.image_id = i.id
        WHERE i.published = 1 AND m.phash IS NOT NULL
        ORDER BY m.image_id ASC
      `).all<StoredHashRow>();

      return json({
        success: true,
        count: results.length,
        hashes: results.filter((r) => isValidPHashHex(r.phash)),
      });
    }

    // Default action: unhashed media assets
    const cursor = integerParam(url.searchParams.get('cursor'), 0);
    const requestedLimit = integerParam(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE);

    if (cursor === null || requestedLimit === null || requestedLimit < 1) {
      return json({ error: 'Invalid query parameters' }, 400);
    }

    const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);

    // Optimized Single-query lookup eliminating N+1 queries
    const { results = [] } = await env.DB.prepare(`
      SELECT i.id AS image_id, i.r2_keys, i.title, i.likes
      FROM images i
      WHERE i.published = 1 AND i.id > ?
      ORDER BY i.id ASC
      LIMIT ?
    `).bind(cursor, limit + 1).all<{ image_id: number; r2_keys: string; title: string | null; likes: number }>();

    const hasMore = results.length > limit;
    const pageRows = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? pageRows.at(-1)?.image_id ?? null : null;

    const unhashedList: UnhashedMediaRow[] = [];
    const videoExts = new Set(['.mp4', '.webm', '.mov', '.m4v']);

    // Gather keys and batch check media_assets in D1
    const keysToCheck: { image_id: number; key: string; title: string | null; likes: number }[] = [];
    for (const post of pageRows) {
      const keys = (post.r2_keys || '')
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0 && !videoExts.has(k.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''));

      for (const key of keys) {
        keysToCheck.push({ image_id: post.image_id, key, title: post.title, likes: post.likes || 0 });
      }
    }

    if (keysToCheck.length > 0) {
      const keySet = new Set(keysToCheck.map((k) => k.key));
      const keyArray = [...keySet];
      const keyBatches = chunkArray(keyArray, 80);
      const hashedKeysSet = new Set<string>();

      for (const batch of keyBatches) {
        const placeholders = batch.map(() => '?').join(',');
        const { results: storedRows = [] } = await env.DB.prepare(
          `SELECT r2_key FROM media_assets WHERE phash IS NOT NULL AND r2_key IN (${placeholders})`
        ).bind(...batch).all<{ r2_key: string }>();

        for (const row of storedRows) {
          hashedKeysSet.add(row.r2_key);
        }
      }

      for (const item of keysToCheck) {
        if (!hashedKeysSet.has(item.key)) {
          unhashedList.push({
            image_id: item.image_id,
            r2_key: item.key,
            title: item.title,
            likes: item.likes,
          });
        }
      }
    }

    return json({
      success: true,
      count: unhashedList.length,
      unhashed: unhashedList,
      next_cursor: nextCursor,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  if (!env?.DB) return json({ error: 'DB binding not configured' }, 500);

  if (!await validApiKey(request)) return json({ error: 'Unauthorized header credentials' }, 401);

  const action = url.searchParams.get('action') ?? 'apply_pending';

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request body' }, 400);

    const input = body as Record<string, unknown>;

    if (action === 'save_hashes') {
      const hashes = Array.isArray(input.hashes) ? input.hashes : [];
      let savedCount = 0;

      for (const item of hashes) {
        if (!item || typeof item !== 'object') continue;
        const h = item as Record<string, unknown>;
        const imageId = Number(h.image_id);
        const r2Key = String(h.r2_key || '');
        const phash = String(h.phash || '').toLowerCase();

        // Strict 16-hex pHash format validation
        if (!Number.isInteger(imageId) || imageId <= 0 || !r2Key || !isValidPHashHex(phash)) continue;

        await env.DB.prepare(`
          INSERT INTO media_assets (image_id, r2_key, phash, hashed_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(r2_key) DO UPDATE SET
            image_id = excluded.image_id,
            phash = excluded.phash,
            hashed_at = datetime('now')
        `).bind(imageId, r2Key, phash).run();

        savedCount++;
      }

      return json({ success: true, saved_count: savedCount });
    }

    // Default POST action: apply_pending
    const pendingIds = Array.isArray(input.pending_ids)
      ? input.pending_ids.filter((id): id is number => Number.isInteger(id) && id > 0)
      : [];

    if (pendingIds.length === 0) {
      return json({ success: true, updated_count: 0, updated_ids: [] });
    }

    // D1 Parameter Limit Protection: Chunk updates in batches of max 80
    const batches = chunkArray(pendingIds, 80);
    let totalUpdated = 0;

    for (const batch of batches) {
      const placeholders = batch.map(() => '?').join(',');
      const statement = env.DB.prepare(
        `UPDATE images SET published = 0, updated_at = datetime('now') WHERE id IN (${placeholders}) AND published = 1`
      ).bind(...batch);

      const result = await statement.run();
      totalUpdated += result.meta.changes ?? 0;
    }

    return json({
      success: true,
      updated_count: totalUpdated,
      updated_ids: pendingIds,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
