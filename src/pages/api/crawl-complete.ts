import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

/**
 * POST /api/crawl-complete
 * Called by the GitHub Actions crawl script after finishing one account.
 * Records the last crawl metadata (type, mode, new image count) and
 * auto-resets crawl_all to 0 when a full-history crawl completes, so the
 * next scheduled run falls back to the lightweight "latest 20" mode.
 *
 * Protected by CRAWL_API_KEY.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const apiKey = body.api_key as string | undefined;
    const expectedKey = (env as any).CRAWL_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const username = (body.username || '').trim().replace(/^@/, '');
    const runType = body.run_type === 'manual' ? 'manual' : 'auto';
    const crawlMode = body.crawl_mode === 'all' ? 'all' : 'latest';
    const newImages = Math.max(0, parseInt(body.new_images, 10) || 0);
    const crawlError = typeof body.error === 'string' ? body.error.trim().slice(0, 1000) : '';

    if (!username) {
      return new Response(JSON.stringify({ error: 'username is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Record the result. Errors stay visible and must not clear a requested full scan.
    if (crawlError) {
      await env.DB.prepare(
        `UPDATE crawl_accounts
         SET last_crawled_at = datetime('now'),
             last_crawl_type = ?,
             last_crawl_mode = ?,
             last_crawl_count = ?,
             last_crawl_error = ?
         WHERE username = ?`
      )
        .bind(runType, crawlMode, newImages, crawlError, username)
        .run();
    } else if (crawlMode === 'all') {
      await env.DB.prepare(
        `UPDATE crawl_accounts
         SET last_crawled_at = datetime('now'),
             last_crawl_type = ?,
             last_crawl_mode = ?,
             last_crawl_count = ?,
             last_crawl_error = NULL,
             crawl_all = 0
         WHERE username = ?`
      )
        .bind(runType, crawlMode, newImages, username)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE crawl_accounts
         SET last_crawled_at = datetime('now'),
             last_crawl_type = ?,
             last_crawl_mode = ?,
             last_crawl_count = ?,
             last_crawl_error = NULL
         WHERE username = ?`
      )
        .bind(runType, crawlMode, newImages, username)
        .run();
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
