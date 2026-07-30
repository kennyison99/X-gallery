import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createConditionalBumpDirectoryVersionStmt } from '../../../lib/directory-data';

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

    const batchResults = await env.DB.batch([
      createConditionalBumpDirectoryVersionStmt(env.DB, 'SELECT 1 FROM images WHERE id = ? AND published = 0', [id]),
      env.DB.prepare('UPDATE images SET published = 1 WHERE id = ? AND published = 0').bind(id),
    ]);

    const approveResult = batchResults[1];
    if (approveResult.meta.changes === 0) {
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
