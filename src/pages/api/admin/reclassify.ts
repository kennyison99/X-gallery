import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { classifyPost } from '../../../lib/classify';

/**
 * POST /api/admin/reclassify
 * Batch reclassify posts using Cloudflare Workers AI.
 * Body: { ids: number[] }
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const ids = body.ids as number[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid or empty IDs array' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let updatedCount = 0;
    const results: { id: number; published: boolean; reasons: string[] }[] = [];

    for (const id of ids) {
      // 1. Fetch image details
      const imageRow = await env.DB.prepare(
        'SELECT r2_keys FROM images WHERE id = ?'
      ).bind(id).first<{ r2_keys: string }>();

      if (!imageRow) {
        continue;
      }

      const keys = imageRow.r2_keys.split(',').map((k) => k.trim()).filter(Boolean);
      const fileBuffers: { name: string; buffer: ArrayBuffer }[] = [];

      // 2. Fetch all image buffers from R2
      for (const key of keys) {
        try {
          const obj = await env.BUCKET.get(key);
          if (obj) {
            const buffer = await obj.arrayBuffer();
            fileBuffers.push({ name: key, buffer });
          }
        } catch (err) {
          console.error(`Failed to fetch R2 key ${key} for reclassification:`, err);
        }
      }

      if (fileBuffers.length === 0) {
        continue;
      }

      // 3. Classify the files
      const { published, reasons } = await classifyPost(fileBuffers);
      const publishedValue = published ? 1 : 0;

      // 4. Update the DB
      await env.DB.prepare('UPDATE images SET published = ? WHERE id = ?')
        .bind(publishedValue, id)
        .run();

      results.push({ id, published, reasons });
      updatedCount++;
    }

    return new Response(JSON.stringify({ success: true, count: updatedCount, details: results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
