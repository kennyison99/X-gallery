import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { classifyMediaKeys, isVideoKey } from '../../../lib/media-classifier';

export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawCursor = Number(body.cursor ?? 0);
    const cursor = Number.isFinite(rawCursor) && rawCursor >= 0 ? rawCursor : 0;
    const rawLimit = Number(body.limit ?? 35);
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 35), 40);

    const { results } = await env.DB.prepare(
      'SELECT id, r2_keys FROM images WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).bind(cursor, limit + 1).all<{ id: number; r2_keys: string }>();

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        processed: 0,
        nextCursor: cursor,
        done: true,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const hasMore = results.length > limit;
    const rows = results.slice(0, limit);

    // Collect all R2 keys for this batch
    const batchKeys = new Set<string>();
    for (const row of rows) {
      const keys = (row.r2_keys || '').split(',').map((k) => k.trim()).filter(Boolean);
      keys.forEach((k) => batchKeys.add(k));
    }

    // Fetch head metadata for keys in batch
    const r2Sizes = new Map<string, number>();
    for (const key of batchKeys) {
      try {
        const head = await env.BUCKET.head(key);
        if (head) r2Sizes.set(key, head.size);
      } catch (err) {
        console.error(`R2 head failed for key ${key}:`, err);
      }
    }

    const statements = [];
    for (const row of rows) {
      const keys = (row.r2_keys || '').split(',').map((k) => k.trim()).filter(Boolean);
      let photoBytes = 0;
      let videoBytes = 0;

      for (const key of keys) {
        const size = r2Sizes.get(key) || 0;
        if (isVideoKey(key)) videoBytes += size;
        else photoBytes += size;
      }

      const { photoCount, videoCount } = classifyMediaKeys(row.r2_keys);

      statements.push(
        env.DB.prepare(
          'UPDATE images SET photo_bytes = ?, video_bytes = ?, photo_count = ?, video_count = ?, media_count_version = 1 WHERE id = ?'
        ).bind(photoBytes, videoBytes, photoCount, videoCount, row.id)
      );
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    const nextCursor = rows.at(-1)?.id ?? cursor;

    return new Response(JSON.stringify({
      success: true,
      processed: rows.length,
      nextCursor,
      done: !hasMore,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
