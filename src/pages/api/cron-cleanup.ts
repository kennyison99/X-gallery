import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { addStorageBytes } from '../../lib/storage';

/**
 * POST /api/cron-cleanup
 * Deletes posts that are still pending (published=0) and older than 3 days.
 * Called by the Worker scheduled() handler daily, or manually with CRON_SECRET.
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

  // Authenticate: either from scheduled() (X-Cron-Secret) or admin (api_key)
  const cronSecret = request.headers.get('X-Cron-Secret');
  const expectedCronSecret = (env as any).CRON_SECRET;
  if (expectedCronSecret && cronSecret !== expectedCronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Find pending posts older than 3 days
    const { results } = await env.DB.prepare(
      `SELECT id, r2_keys FROM images
       WHERE published = 0 AND created_at < datetime('now', '-3 days')`
    ).all<{ id: number; r2_keys: string }>();

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0, message: 'No pending posts to clean up.' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let freedBytes = 0;
    let deletedCount = 0;

    for (const row of results) {
      const keys = row.r2_keys.split(',').map((k) => k.trim()).filter(Boolean);

      // Sum sizes and delete from R2
      for (const key of keys) {
        try {
          const head = await env.BUCKET.head(key);
          if (head) freedBytes += head.size;
          await env.BUCKET.delete(key);
        } catch (err) {
          console.error(`Failed to delete R2 key ${key}:`, err);
        }
      }

      // Delete from D1 (cascade handles image_tags)
      await env.DB.prepare('DELETE FROM images WHERE id = ?').bind(row.id).run();
      deletedCount++;
    }

    // Decrement storage counter
    if (freedBytes > 0) {
      await addStorageBytes(-freedBytes);
    }

    return new Response(JSON.stringify({
      success: true,
      deleted: deletedCount,
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
