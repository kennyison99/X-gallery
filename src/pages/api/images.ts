import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  contentTypeForFilename,
  wouldExceedStorage,
  addStorageBytes,
} from '../../lib/storage';

export const GET: APIRoute = async ({ url }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding "DB" is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const tagFilter = url.searchParams.get('tag');

  try {
    let images;
    if (tagFilter) {
      // Get images that have the specific tag, but also fetch ALL tags for each matching image
      const query = `
        SELECT i.*, group_concat(t2.name) as tags_list 
        FROM images i
        JOIN image_tags it ON i.id = it.image_id
        JOIN tags t ON it.tag_id = t.id
        LEFT JOIN image_tags it2 ON i.id = it2.image_id
        LEFT JOIN tags t2 ON it2.tag_id = t2.id
        WHERE t.name = ? AND i.published = 1
        GROUP BY i.id
        ORDER BY i.created_at DESC
      `;
      const { results } = await env.DB.prepare(query).bind(tagFilter).all();
      images = results || [];
    } else {
      // Get all images and their associated tags
      const query = `
        SELECT i.*, group_concat(t.name) as tags_list
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.image_id
        LEFT JOIN tags t ON it.tag_id = t.id
        WHERE i.published = 1
        GROUP BY i.id
        ORDER BY i.created_at DESC
      `;
      const { results } = await env.DB.prepare(query).all();
      images = results || [];
    }

    // Format tags_list from string to array
    const formattedImages = images.map((img: any) => ({
      ...img,
      tags: img.tags_list ? img.tags_list.split(',') : []
    }));

    return new Response(JSON.stringify(formattedImages), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll('file') as File[];
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    const author = formData.get('author') as string | null;
    const authorUrl = formData.get('author_url') as string | null;
    const postUrl = formData.get('post_url') as string | null;
    const tagsString = formData.get('tags') as string | null; // e.g. "白絲,黑絲"

    const validFiles = files.filter(f => f && f.size > 0);
    if (validFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'Please upload at least one valid image file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!author) {
      return new Response(JSON.stringify({ error: 'Author/Twitter handle is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Storage guard: reject if these files would push usage past the threshold
    const incomingBytes = validFiles.reduce((sum, f) => sum + f.size, 0);
    if (await wouldExceedStorage(incomingBytes)) {
      return new Response(JSON.stringify({
        error: '儲存空間不足：R2 用量已接近 10GB 上限，請先刪除舊資料再上傳。',
      }), {
        status: 507,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Upload all files to R2 and gather their keys
    const r2Keys: string[] = [];
    for (const file of validFiles) {
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const r2Key = `${Date.now()}-${cleanFileName}`;

      const fileArrayBuffer = await file.arrayBuffer();
      await env.BUCKET.put(r2Key, fileArrayBuffer, {
        httpMetadata: { contentType: contentTypeForFilename(file.name, file.type || 'image/jpeg') }
      });
      r2Keys.push(r2Key);
    }

    // Increment the storage counter by the bytes actually written
    await addStorageBytes(incomingBytes);

    const r2KeysString = r2Keys.join(',');

    // Parse tags: clean them up
    const tags = (tagsString || '')
      .split(/[\s,]+/)
      .map(t => t.trim().replace(/^#/, ''))
      .filter(t => t.length > 0);

    // 1. Insert image/post metadata
    const insertImageQuery = `
      INSERT INTO images (title, r2_keys, author, author_url, post_url, description)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `;
    const imageResult = await env.DB.prepare(insertImageQuery)
      .bind(
        title || `推文寫真`, 
        r2KeysString, 
        author, 
        authorUrl || '', 
        postUrl || '', 
        description || ''
      )
      .first();

    const imageId = imageResult?.id;
    if (!imageId) {
      throw new Error('Failed to insert post record into D1');
    }

    // 2. Insert tags and link them
    for (const tagName of tags) {
      // Insert tag if not exists
      await env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
        .bind(tagName)
        .run();

      // Get tag ID
      const tagResult = await env.DB.prepare('SELECT id FROM tags WHERE name = ?')
        .bind(tagName)
        .first();

      if (tagResult) {
        // Link image and tag
        await env.DB.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
          .bind(imageId, tagResult.id)
          .run();
      }
    }

    return new Response(JSON.stringify({ success: true, imageId }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
