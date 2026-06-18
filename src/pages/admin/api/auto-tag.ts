import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  createAutoTagBatch,
  normalizeAutoTagBatchInput,
  type AutoTagImage
} from '../../../lib/auto-tag-backfill.ts';

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) {
    return json({ error: 'D1 binding is not configured' }, 500);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { cursor, limit } = normalizeAutoTagBatchInput(body);
    const totalRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM images')
      .first<{ total: number }>();
    const { results } = await env.DB.prepare(
      'SELECT id, author, description FROM images WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).bind(cursor, limit + 1).all<AutoTagImage>();

    const hasMore = results.length > limit;
    const images = results.slice(0, limit);
    const { tagNames, links } = createAutoTagBatch(images);

    if (tagNames.length > 0) {
      await env.DB.batch(tagNames.map((tagName) =>
        env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(tagName)
      ));
    }

    let added = 0;
    if (links.length > 0) {
      const placeholders = tagNames.map(() => '?').join(',');
      const tagRows = await env.DB.prepare(
        `SELECT id, name FROM tags WHERE name IN (${placeholders})`
      ).bind(...tagNames).all<{ id: number; name: string }>();
      const tagIds = new Map(tagRows.results.map((tag) => [tag.name, tag.id]));
      const statements = links.flatMap(({ imageId, tagName }) => {
        const tagId = tagIds.get(tagName);
        return tagId === undefined ? [] : [
          env.DB.prepare(
            'INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)'
          ).bind(imageId, tagId)
        ];
      });

      if (statements.length > 0) {
        const linkResults = await env.DB.batch(statements);
        added = linkResults.reduce(
          (sum, result) => sum + Number(result.meta?.changes ?? 0),
          0
        );
      }
    }

    const nextCursor = images.at(-1)?.id ?? cursor;
    return json({
      scanned: images.length,
      total: Number(totalRow?.total ?? 0),
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
