import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

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

    // 1. Fetch R2 keys of all selected images
    const placeholders = imageIds.map(() => '?').join(',');
    const query = `SELECT r2_keys FROM images WHERE id IN (${placeholders})`;
    
    // Bind all IDs dynamically
    const stmt = env.DB.prepare(query).bind(...imageIds);
    const { results } = await stmt.all();

    // 2. Extract and delete all unique R2 keys
    const r2KeysToDelete = new Set<string>();
    for (const row of results as any[]) {
      if (row.r2_keys) {
        const keys = row.r2_keys.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
        keys.forEach((k: string) => r2KeysToDelete.add(k));
      }
    }

    // Delete keys from R2 in parallel
    const deletePromises = Array.from(r2KeysToDelete).map(async (key) => {
      try {
        await env.BUCKET.delete(key);
      } catch (err) {
        console.error(`Failed to delete key ${key} from R2:`, err);
      }
    });
    await Promise.all(deletePromises);

    // 3. Delete the image records from D1 (cascade delete handles image_tags relations)
    const deleteQuery = `DELETE FROM images WHERE id IN (${placeholders})`;
    await env.DB.prepare(deleteQuery).bind(...imageIds).run();

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
