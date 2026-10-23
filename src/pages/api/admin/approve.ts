import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createConditionalBumpDirectoryVersionStmt, invalidateDirectoryKvCache } from '../../../lib/directory-data';

export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id))
      : (typeof body.id !== 'undefined' && !isNaN(parseInt(body.id, 10)) ? [parseInt(body.id, 10)] : []);

    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid or missing image ID(s)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const chunkArray = <T>(arr: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    const idChunks = chunkArray(ids, 50);
    let totalChanges = 0;

    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',');
      const conditionSql = `SELECT 1 FROM images WHERE id IN (${placeholders}) AND published = 0`;
      const updateSql = `UPDATE images SET published = 1, reviewed = 1, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now') WHERE id IN (${placeholders}) AND published = 0`;

      const batchResults = await env.DB.batch([
        createConditionalBumpDirectoryVersionStmt(env.DB, conditionSql, chunk),
        env.DB.prepare(updateSql).bind(...chunk),
      ]);

      const approveResult = batchResults[1];
      totalChanges += approveResult?.meta?.changes ?? 0;
    }

    if (totalChanges === 0 && ids.length === 1) {
      return new Response(JSON.stringify({ error: 'Post not found or already published' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (totalChanges > 0) {
      await invalidateDirectoryKvCache((env as any).CACHE);
    }

    return new Response(JSON.stringify({ success: true, count: totalChanges }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
