import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { addStorageBytes } from '../../lib/storage';

// Dedup scan + repair for images whose r2_keys contain multiple keys pointing
// to identical R2 objects (same etag/MD5). This happens when the crawler races
// on a duplicated xtractor entry and stores the same file twice as _1/_2.
//
// GET  ?api_key=  → scans all multi-key records, returns duplicates grouped by etag
// POST { api_key, fixes } → applies fixes: deletes dup R2 objects, updates D1 r2_keys

function checkApiKey(url: URL, body?: any): boolean {
  const key = body?.api_key ?? url.searchParams.get('api_key');
  return !!key && key === env.CRAWL_API_KEY;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  if (!env || !env.DB || !env.BUCKET) return json({ error: 'DB or BUCKET binding not configured' }, 500);
  if (!checkApiKey(url)) return json({ error: 'Unauthorized' }, 401);

  try {
    // Only scan records with multiple r2_keys (contain a comma).
    const { results } = await env.DB.prepare(
      "SELECT id, r2_keys FROM images WHERE r2_keys LIKE '%,%' ORDER BY id"
    ).all<{ id: number; r2_keys: string }>();

    const duplicates: Array<{
      image_id: number;
      keep_key: string;
      delete_keys: string[];
      etag: string;
      size: number;
    }> = [];

    for (const row of results ?? []) {
      const keys = row.r2_keys.split(',').map(k => k.trim()).filter(k => k.length > 0);
      if (keys.length < 2) continue;

      // head() each key to get etag + size (metadata only, no body download).
      const heads = await Promise.all(
        keys.map(async (key) => {
          try {
            const head = await env.BUCKET.head(key);
            return { key, etag: head?.etag ?? null, size: head?.size ?? 0, exists: !!head };
          } catch {
            return { key, etag: null, size: 0, exists: false };
          }
        })
      );

      // Group by etag; keys sharing the same etag are identical content.
      const byEtag = new Map<string, { key: string; size: number; exists: boolean }[]>();
      for (const h of heads) {
        if (!h.etag) continue; // skip missing or headless objects
        const group = byEtag.get(h.etag);
        if (group) group.push(h);
        else byEtag.set(h.etag, [h]);
      }

      for (const [etag, group] of byEtag) {
        if (group.length < 2) continue;
        // Keep the first key, mark the rest for deletion.
        const keep = group[0];
        const dels = group.slice(1);
        duplicates.push({
          image_id: row.id,
          keep_key: keep.key,
          delete_keys: dels.map(d => d.key),
          etag,
          size: keep.size,
        });
      }
    }

    return json({ success: true, duplicates, count: duplicates.length });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) return json({ error: 'DB or BUCKET binding not configured' }, 500);

  try {
    const body = await request.json();
    if (!checkApiKey(new URL('http://x'), body)) return json({ error: 'Unauthorized' }, 401);

    const { fixes } = body;
    if (!Array.isArray(fixes) || fixes.length === 0) return json({ success: true, count: 0 });

    // fixes: [{ image_id, keep_key, delete_keys: [key, ...] }]
    let totalDeleted = 0;
    let freedBytes = 0;
    const applied: number[] = [];

    for (const fix of fixes) {
      const imageId = parseInt(fix.image_id, 10);
      const deleteKeys: string[] = Array.isArray(fix.delete_keys) ? fix.delete_keys : [];
      if (!imageId || deleteKeys.length === 0) continue;

      // Fetch current r2_keys for this record (guard against stale data).
      const row = await env.DB.prepare('SELECT r2_keys FROM images WHERE id = ?')
        .bind(imageId)
        .first<{ r2_keys: string }>();
      if (!row) continue;

      const currentKeys = row.r2_keys.split(',').map(k => k.trim()).filter(k => k.length > 0);
      const deleteSet = new Set(deleteKeys);

      // Only delete keys that still exist in the current record.
      const keysToDelete = deleteKeys.filter(k => currentKeys.includes(k));
      if (keysToDelete.length === 0) continue;

      // Delete duplicate R2 objects and sum freed bytes.
      for (const key of keysToDelete) {
        try {
          const head = await env.BUCKET.head(key);
          if (head) freedBytes += head.size;
          await env.BUCKET.delete(key);
          totalDeleted++;
        } catch (err) {
          console.error(`Failed to delete R2 key ${key}:`, err);
        }
      }

      // Update D1: remove deleted keys from r2_keys.
      const remainingKeys = currentKeys.filter(k => !deleteSet.has(k));
      if (remainingKeys.length > 0) {
        await env.DB.prepare('UPDATE images SET r2_keys = ? WHERE id = ?')
          .bind(remainingKeys.join(','), imageId)
          .run();
        applied.push(imageId);
      }
    }

    if (freedBytes > 0) {
      await addStorageBytes(-freedBytes);
    }

    return json({ success: true, count: totalDeleted, freed_bytes: freedBytes, fixed_ids: applied });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};
