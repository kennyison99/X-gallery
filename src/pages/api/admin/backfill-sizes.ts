import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const isVideoKey = (k: string) => VIDEO_EXTS.has((k.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''));

export const POST: APIRoute = async () => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. List all R2 objects to build key -> size map
    const r2Sizes = new Map<string, number>();
    let cursor: string | undefined;
    let listCount = 0;
    do {
      const listResult = await env.BUCKET.list({ limit: 1000, cursor });
      for (const obj of listResult.objects) {
        r2Sizes.set(obj.key, obj.size);
      }
      listCount += listResult.objects.length;
      cursor = listResult.truncated ? listResult.cursor : undefined;
    } while (cursor);

    // 2. Fetch all images
    const { results } = await env.DB.prepare('SELECT id, r2_keys FROM images').all();
    
    // 3. Prepare D1 update statements
    const statements = [];
    for (const row of (results || []) as any[]) {
      const keys = (row.r2_keys || '').split(',').map((k: string) => k.trim()).filter(Boolean);
      let photoBytes = 0;
      let videoBytes = 0;

      for (const key of keys) {
        const size = r2Sizes.get(key) || 0;
        if (isVideoKey(key)) {
          videoBytes += size;
        } else {
          photoBytes += size;
        }
      }
      
      statements.push(
        env.DB.prepare('UPDATE images SET photo_bytes = ?, video_bytes = ? WHERE id = ?').bind(photoBytes, videoBytes, row.id)
      );
    }

    // Run updates in batches of 500 statements
    const chunkSize = 500;
    let updatedCount = 0;
    for (let i = 0; i < statements.length; i += chunkSize) {
      const batch = statements.slice(i, i + chunkSize);
      await env.DB.batch(batch);
      updatedCount += batch.length;
    }

    return new Response(JSON.stringify({ success: true, total_r2_objects: listCount, total_db_rows: results?.length, updatedCount }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
