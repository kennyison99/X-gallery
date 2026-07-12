import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

/**
 * GET /api/author-stats
 * Returns per-author byte usage by querying photo_bytes and video_bytes from D1.
 *
 * Response: { authors: { [handle]: { photo_bytes, video_bytes } } }
 */

export const GET: APIRoute = async () => {
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const query = `
      SELECT 
        author, 
        SUM(photo_bytes) as photo_bytes, 
        SUM(video_bytes) as video_bytes 
      FROM images 
      GROUP BY author
    `;
    const { results } = await env.DB.prepare(query).all();

    const authors: Record<string, { photo_bytes: number; video_bytes: number }> = {};
    for (const row of (results || []) as any[]) {
      authors[row.author] = {
        photo_bytes: Number(row.photo_bytes || 0),
        video_bytes: Number(row.video_bytes || 0),
      };
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
