import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

/**
 * GET /api/author-stats
 * Returns per-author byte usage by cross-referencing DB r2_keys with R2 object sizes.
 * This is the lazy-loaded counterpart to the old SSR R2 listing that was blocking
 * the admin page render.
 *
 * Response: { authors: { [handle]: { photo_bytes, video_bytes } } }
 */

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function isVideoKey(key: string): boolean {
  const ext = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return VIDEO_EXTS.has(ext);
}

export const GET: APIRoute = async () => {
  if (!env?.DB || !env?.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. List all R2 objects to build a key→size map
    const r2Sizes = new Map<string, number>();
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const listResult = await env.BUCKET.list({ limit: 1000, cursor });
      for (const obj of listResult.objects) {
        r2Sizes.set(obj.key, obj.size);
      }
      if (!listResult.truncated) break;
      cursor = listResult.cursor;
    }

    // 2. Query all images for author + r2_keys
    const { results } = await env.DB.prepare('SELECT author, r2_keys FROM images').all();
    const authorMap = new Map<string, { photo_bytes: number; video_bytes: number }>();

    for (const row of (results || []) as any[]) {
      const author: string = row.author;
      const keys = (row.r2_keys || '').split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);

      if (!authorMap.has(author)) {
        authorMap.set(author, { photo_bytes: 0, video_bytes: 0 });
      }
      const entry = authorMap.get(author)!;

      for (const key of keys) {
        const fileSize = r2Sizes.get(key) || 0;
        if (isVideoKey(key)) {
          entry.video_bytes += fileSize;
        } else {
          entry.photo_bytes += fileSize;
        }
      }
    }

    // 3. Convert to plain object for JSON
    const authors: Record<string, { photo_bytes: number; video_bytes: number }> = {};
    for (const [handle, stats] of authorMap) {
      authors[handle] = stats;
    }

    return new Response(JSON.stringify({ authors }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
