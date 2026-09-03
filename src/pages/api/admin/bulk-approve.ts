import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createConditionalBumpDirectoryVersionStmt } from '../../../lib/directory-data';

/**
 * POST /api/admin/bulk-approve
 * Approve multiple images in D1 database and conditionally bump directory version.
 * Body: { ids: number[] }
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids : (typeof body.id !== 'undefined' ? [body.id] : []);
    const imageIds = ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));

    if (imageIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid image IDs' }), {
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

    // Chunk array by 50 to stay well under D1 / SQLite parameter limits
    const idChunks = chunkArray(imageIds, 50);
    let totalUpdated = 0;

    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',');
      const conditionSql = `SELECT 1 FROM images WHERE id IN (${placeholders}) AND published = 0`;
      const updateSql = `UPDATE images SET published = 1, reviewed = 1, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now') WHERE id IN (${placeholders}) AND published = 0`;

      const batchResults = await env.DB.batch([
        createConditionalBumpDirectoryVersionStmt(env.DB, conditionSql, chunk),
        env.DB.prepare(updateSql).bind(...chunk),
      ]);

      const approveResult = batchResults[1];
      totalUpdated += approveResult?.meta?.changes ?? chunk.length;
    }

    return new Response(JSON.stringify({ success: true, count: totalUpdated }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
