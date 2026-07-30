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
      // Execute tag creation, tag-image linking, and directory version bump in a SINGLE atomic D1 batch transaction
      const batchStmts = [
        ...tagNames.map((tagName) =>
          env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(tagName)
        ),
        ...links.map(({ imageId, tagName }) =>
          env.DB.prepare(
            'INSERT OR IGNORE INTO image_tags (image_id, tag_id) SELECT ?, id FROM tags WHERE name = ?'
          ).bind(imageId, tagName)
        ),
        createBumpDirectoryVersionStmt(env.DB)
      ];

      const batchResults = await env.DB.batch(batchStmts);

      // Sum changes from image_tags insertion statements (skipping tag inserts and final version bump)
      const linkResults = batchResults.slice(tagNames.length, tagNames.length + links.length);
      added = linkResults.reduce(
        (sum, result) => sum + Number(result.meta?.changes ?? 0),
        0
      );
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
