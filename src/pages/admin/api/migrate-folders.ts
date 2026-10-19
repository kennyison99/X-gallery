import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { normalizeAuthorHandle } from '../../../lib/admin-dashboard';

interface MigrateRow {
  id: number;
  author: string;
  r2_keys: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Allow either same-origin requests or API key authenticated requests
  const apiKey = request.headers.get('X-API-Key') || new URL(request.url).searchParams.get('api_key');
  const expectedKey = (env as any).CRAWL_API_KEY;
  if (apiKey && expectedKey && apiKey !== expectedKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawCursor = Number(body.cursor ?? 0);
    const cursor = Number.isFinite(rawCursor) && rawCursor >= 0 ? rawCursor : 0;
    const rawLimit = Number(body.limit ?? 20);
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 30);
    const dryRun = Boolean(body.dryRun ?? false);

    const { results } = await env.DB.prepare(
      'SELECT id, author, r2_keys FROM images WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).bind(cursor, limit + 1).all<MigrateRow>();

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        processed: 0,
        migratedPosts: 0,
        migratedKeys: 0,
        dryRun,
        nextCursor: cursor,
        done: true,
        details: [],
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const hasMore = results.length > limit;
    const rows = results.slice(0, limit);

    let migratedPostsCount = 0;
    let migratedKeysCount = 0;
    const details: Array<{ id: number; author: string; from: string; to: string; moved: boolean }> = [];

    for (const row of rows) {
      const cleanAuthor = normalizeAuthorHandle(row.author).replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
      const oldKeys = (row.r2_keys || '').split(',').map((k: string) => k.trim()).filter(Boolean);
      const newKeys: string[] = [];
      let postChanged = false;

      for (const key of oldKeys) {
        if (key.includes('/')) {
          // Already in a folder, keep unchanged
          newKeys.push(key);
          continue;
        }

        // Option A: Strip redundant author prefix if present
        const prefix = `${cleanAuthor}_`;
        const stripped = key.startsWith(prefix) ? key.slice(prefix.length) : key;
        const targetKey = `${cleanAuthor}/${stripped}`;

        let moved = false;
        if (!dryRun) {
          try {
            const headTarget = await env.BUCKET.head(targetKey);
            if (!headTarget) {
              const oldObj = await env.BUCKET.get(key);
              if (oldObj) {
                await env.BUCKET.put(targetKey, oldObj.body, {
                  httpMetadata: oldObj.httpMetadata,
                  customMetadata: oldObj.customMetadata,
                });
                await env.BUCKET.delete(key);
                moved = true;
              }
            } else {
              // Target already exists in R2, remove redundant old root object
              await env.BUCKET.delete(key);
              moved = true;
            }

            // Update media_assets pHash record
            await env.DB.prepare(
              'UPDATE media_assets SET r2_key = ? WHERE r2_key = ?'
            ).bind(targetKey, key).run();
          } catch (err) {
            console.error(`Error migrating R2 object "${key}" to "${targetKey}":`, err);
          }
        } else {
          moved = true;
        }

        newKeys.push(targetKey);
        postChanged = true;
        migratedKeysCount++;
        details.push({ id: row.id, author: cleanAuthor, from: key, to: targetKey, moved });
      }

      if (postChanged) {
        if (!dryRun) {
          await env.DB.prepare(
            'UPDATE images SET r2_keys = ? WHERE id = ?'
          ).bind(newKeys.join(','), row.id).run();
        }
        migratedPostsCount++;
      }
    }

    if (!hasMore && !dryRun) {
      await env.DB.prepare(
        'UPDATE storage_stats SET directory_version = directory_version + 1 WHERE id = 1'
      ).run();
    }

    const nextCursor = rows.at(-1)?.id ?? cursor;

    return new Response(JSON.stringify({
      success: true,
      processed: rows.length,
      migratedPosts: migratedPostsCount,
      migratedKeys: migratedKeysCount,
      dryRun,
      nextCursor,
      done: !hasMore,
      details,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
