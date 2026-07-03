import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { normalizeCrawlUsername } from '../../lib/crawl-accounts.ts';

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
    const username = normalizeCrawlUsername(body.username);

    if (!username) {
      return new Response(JSON.stringify({ error: '請輸入 Twitter 帳號名稱' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const existing = await env.DB.prepare(
      'SELECT username FROM crawl_accounts WHERE lower(username) = ? LIMIT 1'
    ).bind(username).first<{ username: string }>();

    if (existing) {
      return new Response(JSON.stringify({
        error: `@${existing.username} 已在爬蟲帳號列表中`,
        duplicate: true,
        username: existing.username
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(
      'INSERT INTO crawl_accounts (username) VALUES (?)'
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
    const username = normalizeCrawlUsername(body.username);

    if (!username) {
      return new Response(JSON.stringify({ error: '請輸入要刪除的帳號名稱' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(
      'DELETE FROM crawl_accounts WHERE lower(username) = ?'
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

// PUT — 更新爬取帳號設定
export const PUT: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const username = normalizeCrawlUsername(body.username);
    const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : null;
    const crawlAll = body.crawl_all !== undefined ? (body.crawl_all ? 1 : 0) : null;

    if (!username) {
      return new Response(JSON.stringify({ error: '請輸入帳號名稱' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (enabled !== null && crawlAll !== null) {
      await env.DB.prepare(
        'UPDATE crawl_accounts SET enabled = ?, crawl_all = ? WHERE lower(username) = ?'
      ).bind(enabled, crawlAll, username).run();
    } else if (enabled !== null) {
      await env.DB.prepare(
        'UPDATE crawl_accounts SET enabled = ? WHERE lower(username) = ?'
      ).bind(enabled, username).run();
    } else if (crawlAll !== null) {
      await env.DB.prepare(
        'UPDATE crawl_accounts SET crawl_all = ? WHERE lower(username) = ?'
      ).bind(crawlAll, username).run();
    }

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
