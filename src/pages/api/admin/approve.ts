import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

/**
 * POST /api/admin/approve
 * Approve a pending post (published=0 → 1).
 * Body: { id: number }
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const id = parseInt(body.id, 10);
    if (isNaN(id)) {
      return new Response(JSON.stringify({ error: 'Invalid image ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await env.DB.prepare(
      'UPDATE images SET published = 1 WHERE id = ? AND published = 0'
    ).bind(id).run();

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Post not found or already published' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
