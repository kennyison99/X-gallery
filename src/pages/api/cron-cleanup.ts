import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { addStorageBytes } from '../../lib/storage';
import { createBumpDirectoryVersionStmt, invalidateDirectoryKvCache } from '../../lib/directory-data';
import { extractApiKey, verifySecret } from '../../lib/auth';

/**
 * POST /api/cron-cleanup
 * Deletes posts that are still pending (published=0) and older than 3 days.
 * Called by the Worker scheduled() handler daily, or manually with CRON_SECRET / CRAWL_API_KEY.
 *
 * Also cleans up R2 objects and decrements the storage counter.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const cronSecret = request.headers.get('X-Cron-Secret');
  const expectedCronSecret = (env as any).CRON_SECRET;
  const apiKey = extractApiKey(request, url);
  const expectedApiKey = (env as any).CRAWL_API_KEY;

  const isInternalScheduled = url.hostname === 'internal.local' && !expectedCronSecret;
  const hasValidCronSecret = await verifySecret(cronSecret, expectedCronSecret);
  const hasValidApiKey = await verifySecret(apiKey, expectedApiKey);

  if (!isInternalScheduled && !hasValidCronSecret && !hasValidApiKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Find pending posts older than 3 days (bounded batch of max 100 per run)
    const { results } = await env.DB.prepare(
      `SELECT id, r2_keys, photo_bytes, video_bytes FROM images
       WHERE published = 0 AND created_at < strftime('%Y-%m-%d %H:%M:%S', 'now', '-3 days')
       ORDER BY id ASC
       LIMIT 100`
    ).all<{ id: number; r2_keys: string; photo_bytes?: number; video_bytes?: number }>();

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0, message: 'No pending posts to clean up.' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const expiredIds = results.map((row) => row.id);
    let freedBytes = 0;
    const allKeysToDelete: string[] = [];

    for (const row of results) {
      const keys = (row.r2_keys || '').split(',').map((k) => k.trim()).filter(Boolean);
      allKeysToDelete.push(...keys);

      const storedRowBytes = Number(row.photo_bytes || 0) + Number(row.video_bytes || 0);
      if (storedRowBytes > 0) {
        freedBytes += storedRowBytes;
      } else {
        for (const key of keys) {
          try {
            const head = await env.BUCKET.head(key);
            if (head) freedBytes += head.size;
          } catch (err) {
            console.error(`Failed to head R2 key ${key}:`, err);
          }
        }
      }
    }

    // Delete R2 keys in bounded chunks
    for (let i = 0; i < allKeysToDelete.length; i += 100) {
      const batchKeys = allKeysToDelete.slice(i, i + 100);
      try {
        await env.BUCKET.delete(batchKeys.length === 1 ? batchKeys[0] : batchKeys);
      } catch (err) {
        console.error('Failed to delete R2 key batch:', err);
      }
    }

    // Single atomic batch: delete expired images, media_assets, and orphaned tags, and bump directory version
    const placeholders = expiredIds.map(() => '?').join(',');
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM media_assets WHERE image_id IN (${placeholders})`).bind(...expiredIds),
      env.DB.prepare(`DELETE FROM images WHERE id IN (${placeholders})`).bind(...expiredIds),
      env.DB.prepare(`DELETE FROM tags WHERE id IN (SELECT t.id FROM tags t LEFT JOIN image_tags it ON t.id = it.tag_id WHERE it.tag_id IS NULL LIMIT 100)`),
      createBumpDirectoryVersionStmt(env.DB),
    ]);

    await invalidateDirectoryKvCache((env as any).CACHE);

    // Decrement storage counter
    if (freedBytes > 0) {
      await addStorageBytes(-freedBytes);
    }

    return new Response(JSON.stringify({
      success: true,
      deleted: expiredIds.length,
      freed_bytes: freedBytes,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
