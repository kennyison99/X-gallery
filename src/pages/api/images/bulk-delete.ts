import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { addStorageBytes } from '../../../lib/storage';
import { createBumpDirectoryVersionStmt, invalidateDirectoryKvCache } from '../../../lib/directory-data';

/**
 * POST /api/images/bulk-delete
 * Delete multiple images from both R2 bucket and D1 database.
 * Body: { ids: number[] }
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid image IDs' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Convert IDs to numbers
    const imageIds = ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
    if (imageIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid image IDs provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Helper to chunk arrays
    const chunkArray = <T>(arr: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    // Split IDs into chunks of 50 to prevent SQLite/D1 variable limit errors
    const idChunks = chunkArray(imageIds, 50);
    const r2KeysToDelete = new Set<string>();
    const unmeasuredKeys = new Set<string>();
    let freedBytes = 0;

    // 1. Fetch R2 keys and stored byte sizes chunk by chunk
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',');
      const query = `SELECT r2_keys, photo_bytes, video_bytes FROM images WHERE id IN (${placeholders})`;
      const { results } = await env.DB.prepare(query).bind(...chunk).all();
      
      for (const row of results as any[]) {
        if (row.r2_keys) {
          const keys = row.r2_keys.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
          keys.forEach((k: string) => r2KeysToDelete.add(k));
          const storedBytes = Number(row.photo_bytes || 0) + Number(row.video_bytes || 0);
          if (storedBytes > 0) {
            freedBytes += storedBytes;
          } else {
            keys.forEach((k: string) => unmeasuredKeys.add(k));
          }
        }
      }
    }

    // Only call BUCKET.head() for legacy rows where stored bytes are 0
    if (unmeasuredKeys.size > 0) {
      await Promise.all(Array.from(unmeasuredKeys).map(async (key) => {
        try {
          const head = await env.BUCKET.head(key);
          if (head) freedBytes += head.size;
        } catch (err) {
          console.error(`Failed to head key ${key} in R2:`, err);
        }
      }));
    }

    // 2. Delete keys from R2 in bounded chunks
    const allKeys = Array.from(r2KeysToDelete);
    const keyChunks = chunkArray(allKeys, 100);
    for (const keyBatch of keyChunks) {
      try {
        await env.BUCKET.delete(keyBatch.length === 1 ? keyBatch[0] : keyBatch);
      } catch (err) {
        console.error('Failed to delete R2 key batch:', err);
      }
    }

    if (freedBytes > 0) {
      await addStorageBytes(-freedBytes);
    }

    // 3. Delete image records and media_assets from D1 chunk by chunk with atomic directory version bump
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',');
      await env.DB.batch([
        createBumpDirectoryVersionStmt(env.DB),
        env.DB.prepare(`DELETE FROM media_assets WHERE image_id IN (${placeholders})`).bind(...chunk),
        env.DB.prepare(`DELETE FROM images WHERE id IN (${placeholders})`).bind(...chunk),
      ]);
    }

    await invalidateDirectoryKvCache((env as any).CACHE);

    return new Response(JSON.stringify({ success: true, count: imageIds.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
