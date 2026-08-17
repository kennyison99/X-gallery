import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getAdminOverviewStats } from '../../lib/directory-data';

/**
 * GET /api/author-stats
 * Returns per-author byte usage by querying photo_bytes and video_bytes from D1.
 * Leverages versioned admin overview cache.
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
    const overview = await getAdminOverviewStats(env.DB);

    const authors: Record<string, { photo_bytes: number; video_bytes: number }> = {};
    for (const item of overview.authorStats) {
      authors[item.author] = {
        photo_bytes: Number(item.photo_bytes || 0),
        video_bytes: Number(item.video_bytes || 0),
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

