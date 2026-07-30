import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  createAutoTagBatch,
  normalizeAutoTagBatchInput,
  type AutoTagImage
} from '../../../lib/auto-tag-backfill.ts';

import { createBumpDirectoryVersionStmt } from '../../../lib/directory-data';

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) {
    return json({ error: 'D1 binding is not configured' }, 500);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { cursor, limit } = normalizeAutoTagBatchInput(body);
    const includeTotal = body.includeTotal === true || cursor === 0;

    const totalRow = includeTotal
      ? await env.DB.prepare('SELECT COUNT(*) AS total FROM images').first<{ total: number }>()
      : null;

    const { results } = await env.DB.prepare(
      'SELECT id, author, description FROM images WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).bind(cursor, limit + 1).all<AutoTagImage>();

    const hasMore = results.length > limit;
    const images = results.slice(0, limit);
    const { tagNames, links } = createAutoTagBatch(images);

    let added = 0;
    if (tagNames.length > 0 && links.length > 0) {
      // Set-based SQL transaction: exactly 3 statements per batch, safely under D1 Free Plan 50 statement limits
      const uniqueTagsJson = JSON.stringify(Array.from(new Set(tagNames)));
      const linksJson = JSON.stringify(links.map((l) => ({ imageId: l.imageId, tagName: l.tagName })));

      const batchResults = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO tags(name) SELECT value FROM json_each(?)').bind(uniqueTagsJson),
        env.DB.prepare(
          `INSERT OR IGNORE INTO image_tags(image_id, tag_id)
           SELECT json_extract(j.value, '$.imageId'), t.id
           FROM json_each(?) j
           JOIN tags t ON t.name = json_extract(j.value, '$.tagName')`
        ).bind(linksJson),
        createBumpDirectoryVersionStmt(env.DB)
      ]);

      added = Number(batchResults[1]?.meta?.changes ?? 0);
    }

    const nextCursor = images.at(-1)?.id ?? cursor;
    return json({
      scanned: images.length,
      total: totalRow ? Number(totalRow.total) : undefined,
      added,
      nextCursor,
      done: !hasMore
    });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
