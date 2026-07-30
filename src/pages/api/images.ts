import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  contentTypeForFilename,
  wouldExceedStorage,
  addStorageBytes,
  isVideoKey,
} from '../../lib/storage';
import { normalizeAuthorInput } from '../../lib/admin-dashboard';

import {
  parseGalleryBatchParams,
  fetchGalleryBatch,
} from '../../lib/gallery-feed';

import { getDirectoryData, createBumpDirectoryVersionStmt } from '../../lib/directory-data';
import { classifyMediaKeys } from '../../lib/media-classifier';

export const GET: APIRoute = async ({ url }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'D1 DB binding "DB" is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let batchParams;
    try {
      batchParams = parseGalleryBatchParams(url.searchParams);
    } catch (paramErr: any) {
      return new Response(JSON.stringify({ error: paramErr.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { items, hasMore } = await fetchGalleryBatch(env.DB, batchParams);

    // Fetch cached directory data to sanitize tag lists (1 D1 row read on cache hit)
    const directory = await getDirectoryData(env.DB, 'public');

    const formattedImages = items.map((img: any) => ({
      ...img,
      tags: img.tags_list 
        ? img.tags_list.split(',').filter((tag: string) => !directory.canonicalAuthorSet.has(tag.trim().toLowerCase())) 
        : []
    }));

    return new Response(JSON.stringify(formattedImages), {
      headers: {
        'Content-Type': 'application/json',
        'X-Has-More': String(hasMore),
        'X-Offset': String(batchParams.offset),
        'X-Limit': String(batchParams.limit),
      }
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
    const authorInput = normalizeAuthorInput(
      formData.get('author'),
      formData.get('author_display_name'),
    );
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

    if (!authorInput.handle) {
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

    // Calculate photo and video bytes
    let photoBytes = 0;
    let videoBytes = 0;
    for (const file of validFiles) {
      if (isVideoKey(file.name)) {
        videoBytes += file.size;
      } else {
        photoBytes += file.size;
      }
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
    const { photoCount, videoCount } = classifyMediaKeys(r2KeysString);

    // Parse tags: clean them up
    const tags = (tagsString || '')
      .split(/[\s,]+/)
      .map(t => t.trim().replace(/^#/, ''))
      .filter(t => t.length > 0);

    // Stage 1: Insert image/post metadata with published = 0 (unapproved until tags are written)
    const insertImageQuery = `
      INSERT INTO images (title, r2_keys, author, author_display_name, author_url, post_url, description, photo_bytes, video_bytes, photo_count, video_count, media_count_version, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
      RETURNING id
    `;
    const imageResult = await env.DB.prepare(insertImageQuery)
      .bind(
        title || `推文寫真`, 
        r2KeysString, 
        authorInput.handle,
        authorInput.displayName,
        authorUrl || '', 
        postUrl || '', 
        description || '',
        photoBytes,
        videoBytes,
        photoCount,
        videoCount
      )
      .first();

    const imageId = imageResult?.id;
    if (!imageId) {
      throw new Error('Failed to insert post record into D1');
    }

    // 2. Insert tags and link them
    for (const tagName of tags) {
      await env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
        .bind(tagName)
        .run();

      const tagResult = await env.DB.prepare('SELECT id FROM tags WHERE name = ?')
        .bind(tagName)
        .first();

      if (tagResult) {
        await env.DB.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
          .bind(imageId, tagResult.id)
          .run();
      }
    }

    // Stage 2: Atomically set published = 1 and bump directory_version in a single D1 transaction
    await env.DB.batch([
      env.DB.prepare('UPDATE images SET published = 1 WHERE id = ?').bind(imageId),
      createBumpDirectoryVersionStmt(env.DB),
    ]);

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
