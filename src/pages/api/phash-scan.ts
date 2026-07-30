import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

interface PublishedImageRow {
  id: number;
  title: string | null;
  r2_keys: string;
  author: string;
  author_display_name: string | null;
  post_url: string | null;
  likes: number;
  created_at: string;
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

export const GET: APIRoute = async ({ request, url }) => {
  if (!env?.DB) return json({ error: 'DB binding not configured' }, 500);

  const apiKey = request.headers.get('X-API-Key') ?? url.searchParams.get('api_key');
  if (!await validApiKey(apiKey)) return json({ error: 'Unauthorized' }, 401);

  const cursor = integerParam(url.searchParams.get('cursor'), 0);
  const requestedLimit = integerParam(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE);

  if (cursor === null || requestedLimit === null || requestedLimit < 1) {
    return json({ error: 'Invalid query parameters' }, 400);
  }

  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);

  try {
    const { results = [] } = await env.DB.prepare(`
      SELECT id, title, r2_keys, author, author_display_name, post_url, likes, created_at
      FROM images
      WHERE published = 1 AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `).bind(cursor, limit + 1).all<PublishedImageRow>();

    const hasMore = results.length > limit;
    const pageRows = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? pageRows.at(-1)?.id ?? null : null;

    return json({
      success: true,
      count: pageRows.length,
      images: pageRows,
      next_cursor: nextCursor,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) return json({ error: 'DB binding not configured' }, 500);

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request body' }, 400);

    const input = body as Record<string, unknown>;
    const apiKey = request.headers.get('X-API-Key') ?? (typeof input.api_key === 'string' ? input.api_key : null);
    if (!await validApiKey(apiKey)) return json({ error: 'Unauthorized' }, 401);

    const pendingIds = Array.isArray(input.pending_ids)
      ? input.pending_ids.filter((id): id is number => Number.isInteger(id) && id > 0)
      : [];

    if (pendingIds.length === 0) {
      return json({ success: true, updated_count: 0, updated_ids: [] });
    }

    const placeholders = pendingIds.map(() => '?').join(',');
    const statement = env.DB.prepare(
      `UPDATE images SET published = 0, updated_at = datetime('now') WHERE id IN (${placeholders}) AND published = 1`
    ).bind(...pendingIds);

    const result = await statement.run();
    const updatedCount = result.meta.changes ?? 0;

    return json({
      success: true,
      updated_count: updatedCount,
      updated_ids: pendingIds,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
