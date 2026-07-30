import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { classifyMediaKeys } from '../../../lib/media-classifier';

interface UnbackfilledRow {
  id: number;
  r2_keys: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
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

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) return json({ error: 'DB binding is not configured' }, 500);
  if (!await validApiKey(request)) return json({ error: 'Unauthorized header credentials' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const cursor = typeof body.cursor === 'number' && body.cursor >= 0 ? body.cursor : 0;
    const requestedLimit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 40;
    const limit = Math.min(requestedLimit, 40);

    // Query un-backfilled rows using index
    const { results = [] } = await env.DB.prepare(`
      SELECT id, r2_keys
      FROM images
      WHERE id > ? AND media_count_version < 1
      ORDER BY id ASC
      LIMIT ?
    `).bind(cursor, limit + 1).all<UnbackfilledRow>();

    const hasMore = results.length > limit;
    const pageRows = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? pageRows.at(-1)?.id ?? null : null;

    let updated = 0;
    let skipped = 0;

    if (pageRows.length > 0) {
      const statements = pageRows.map((row) => {
        const { photoCount, videoCount } = classifyMediaKeys(row.r2_keys);
        return env.DB.prepare(`
          UPDATE images
          SET photo_count = ?, video_count = ?, media_count_version = 1
          WHERE id = ? AND r2_keys = ? AND media_count_version = 0
        `).bind(photoCount, videoCount, row.id, row.r2_keys);
      });

      const batchResults = await env.DB.batch(statements);
      for (const res of batchResults) {
        const changes = Number(res.meta?.changes ?? 0);
        if (changes > 0) updated++;
        else skipped++;
      }
    }

    // Check remaining un-backfilled rows
    const remainingRow = await env.DB.prepare(
      'SELECT COUNT(*) AS remaining FROM images WHERE media_count_version < 1'
    ).first<{ remaining: number }>();
    const remaining = Number(remainingRow?.remaining ?? 0);

    let mediaCountsReady = false;
    if (remaining === 0) {
      await env.DB.prepare('UPDATE storage_stats SET media_counts_ready = 1 WHERE id = 1').run();
      mediaCountsReady = true;
    }

    return json({
      scanned: pageRows.length,
      updated,
      skipped,
      remaining,
      next_cursor: nextCursor,
      media_counts_ready: mediaCountsReady,
    });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};
