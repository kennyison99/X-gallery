import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding "DB" is not configured' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing image ID' }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let action = 'like';
    try {
      const body = await request.json();
      if (body && body.action) {
        action = body.action;
      }
    } catch (e) {
      // Fallback to like if body is empty or invalid
    }

    const imageId = parseInt(id, 10);
    let result;

    if (action === 'unlike') {
      result = await env.DB.prepare('UPDATE images SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ? RETURNING likes')
        .bind(imageId)
        .first();
    } else {
      result = await env.DB.prepare('UPDATE images SET likes = likes + 1 WHERE id = ? RETURNING likes')
        .bind(imageId)
        .first();
    }

    if (!result) {
      return new Response(JSON.stringify({ error: 'Image not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, likes: result.likes }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
