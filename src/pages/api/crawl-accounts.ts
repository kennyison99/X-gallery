import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

// GET — 取得所有爬取帳號
export const GET: APIRoute = async () => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM crawl_accounts ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify({ accounts: results || [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST — 新增爬取帳號
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const username = (body.username || '').trim().replace(/^@/, '');

    if (!username) {
      return new Response(JSON.stringify({ error: '請輸入 Twitter 帳號名稱' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(
      'INSERT OR IGNORE INTO crawl_accounts (username) VALUES (?)'
    ).bind(username).run();

    return new Response(JSON.stringify({ success: true, username }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE — 刪除爬取帳號
export const DELETE: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const username = (body.username || '').trim().replace(/^@/, '');

    if (!username) {
      return new Response(JSON.stringify({ error: '請輸入要刪除的帳號名稱' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(
      'DELETE FROM crawl_accounts WHERE username = ?'
    ).bind(username).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
