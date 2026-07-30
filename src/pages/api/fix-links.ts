import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'DB binding is not configured' }), { status: 500 });
  }

  const apiKey = url.searchParams.get('api_key');
  if (!apiKey || apiKey !== env.CRAWL_API_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const cursor = Math.max(0, parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '500', 10) || 500));

  try {
    const query = "SELECT id, author, post_url FROM images WHERE id > ? AND post_url LIKE '%/status/%' ORDER BY id ASC LIMIT ?";
    const { results = [] } = await env.DB.prepare(query).bind(cursor, limit + 1).all();
    const hasMore = results.length > limit;
    const pageRows = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? pageRows.at(-1)?.id ?? null : null;

    return new Response(JSON.stringify(pageRows || []), {
      headers: {
        'Content-Type': 'application/json',
        'X-Has-More': String(hasMore),
        'X-Next-Cursor': String(nextCursor ?? ''),
      }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'DB binding is not configured' }), { status: 500 });
  }

  try {
    const { api_key, updates } = await request.json();
    if (!api_key || api_key !== env.CRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0 }));
    }

    // Prepare batch statements
    const statements = updates.map((u: any) => 
      env.DB.prepare("UPDATE images SET post_url = ? WHERE id = ?").bind(u.post_url, u.id)
    );

    // Run batch update
    await env.DB.batch(statements);

    return new Response(JSON.stringify({ success: true, count: updates.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
