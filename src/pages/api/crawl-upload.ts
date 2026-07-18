import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { generateAutoTags } from '../../lib/auto-tags';
import {
  contentTypeForFilename,
  wouldExceedStorage,
  addStorageBytes,
  isVideoKey,
} from '../../lib/storage';
import { normalizeAuthorInput } from '../../lib/admin-dashboard';


/**
 * POST /api/crawl-upload
 * Batch upload endpoint for the GitHub Actions crawl script.
 * Accepts FormData with image files and metadata.
 * Protected by CRAWL_API_KEY environment variable.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await request.formData();
    
    // Simple API key authentication
    const apiKey = formData.get('api_key') as string | null;
    const expectedKey = (env as any).CRAWL_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const files = formData.getAll('file') as File[];
    const existingR2KeysStr = formData.get('r2_keys') as string | null;
    const authorInput = normalizeAuthorInput(
      formData.get('author'),
      formData.get('author_display_name'),
    );
    const authorUrl = formData.get('author_url') as string | null;
    const postUrl = formData.get('post_url') as string | null;
    const checkOnly = formData.get('check_only') === 'true';
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    const createdAt = formData.get('created_at') as string | null;

    if (!authorInput.handle) {
      return new Response(JSON.stringify({ error: 'Author is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const existingPost = postUrl
      ? await env.DB.prepare('SELECT id FROM images WHERE post_url = ?').bind(postUrl).first()
      : null;
    if (checkOnly) {
      return new Response(JSON.stringify({
        success: !existingPost,
        skipped: !!existingPost,
        message: existingPost ? `Post "${postUrl}" already exists` : undefined,
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (existingPost) {
      return new Response(JSON.stringify({
        success: false,
        skipped: true,
        message: `Post "${postUrl}" already exists`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let firstFileName = '';
    if (existingR2KeysStr) {
      const keys = existingR2KeysStr.split(',').map(k => k.trim()).filter(Boolean);
      if (keys.length > 0) {
        firstFileName = keys[0];
      }
    } else {
      const validFiles = files.filter(f => f && f.size > 0);
      if (validFiles.length > 0) {
        firstFileName = validFiles[0].name.replace(/[^a-zA-Z0-9.-]/g, '_');
      }
    }

    if (!firstFileName) {
      return new Response(JSON.stringify({ error: 'No files or R2 keys provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check for duplicate: same author + same original filename pattern
    const existingCheck = await env.DB.prepare(
      'SELECT id FROM images WHERE author = ? AND r2_keys LIKE ?'
    ).bind(authorInput.handle, `%${firstFileName}%`).first();

    if (existingCheck) {
      return new Response(JSON.stringify({
        success: false,
        skipped: true,
        message: `Image "${firstFileName}" already exists for @${authorInput.handle}`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let r2Keys: string[] = [];
    let photoBytes = 0;
    let videoBytes = 0;

    if (existingR2KeysStr) {
      r2Keys = existingR2KeysStr.split(',').map(k => k.trim()).filter(Boolean);
      for (const key of r2Keys) {
        const meta = await env.BUCKET.head(key);
        const size = meta?.size || 0;
        if (isVideoKey(key)) {
          videoBytes += size;
        } else {
          photoBytes += size;
        }
      }
    } else {
      const validFiles = files.filter(f => f && f.size > 0);
      const incomingBytes = validFiles.reduce((sum, f) => sum + f.size, 0);

      // Storage guard
      if (await wouldExceedStorage(incomingBytes)) {
        return new Response(JSON.stringify({
          error: '儲存空間不足：R2 用量已接近 10GB 上限，請先刪除舊資料再上傳。',
        }), {
          status: 507,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      for (const file of validFiles) {
        if (isVideoKey(file.name)) {
          videoBytes += file.size;
        } else {
          photoBytes += file.size;
        }
      }

      // Upload all files to R2
      for (const file of validFiles) {
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const r2Key = `${authorInput.handle}_${cleanFileName}`;
        const fileArrayBuffer = await file.arrayBuffer();
        await env.BUCKET.put(r2Key, fileArrayBuffer, {
          httpMetadata: { contentType: contentTypeForFilename(file.name, file.type || 'image/jpeg') }
        });
        r2Keys.push(r2Key);
      }
      await addStorageBytes(incomingBytes);
    }

    // AI classification disabled: all uploads are published directly by default.
    const publishedValue = 1;

    const r2KeysString = r2Keys.join(',');

    // Insert into D1
    const insertQuery = `
      INSERT INTO images (title, r2_keys, author, author_display_name, author_url, post_url, description, published, photo_bytes, video_bytes${createdAt ? ', created_at' : ''})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${createdAt ? ', ?' : ''})
      RETURNING id
    `;
    const bindParams = [
      title || `@${authorInput.handle} 推文`,
      r2KeysString,
      authorInput.handle,
      authorInput.displayName,
      authorUrl || `https://x.com/${authorInput.handle}`,
      postUrl || '',
      description || '',
      publishedValue,
      photoBytes,
      videoBytes
    ];
    if (createdAt) {
      bindParams.push(createdAt);
    }
    const imageResult = await env.DB.prepare(insertQuery)
      .bind(...bindParams)
      .first();

    // Auto-tagging logic based on description and author
    if (imageResult?.id) {
      const autoTags = generateAutoTags(authorInput.handle, description);

      // Save tags to D1 and link them to this image
      for (const tagName of autoTags) {
        // Ensure the tag exists in tags table
        await env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(tagName).run();
        // Get tag ID
        const tagRow = await env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(tagName).first<{ id: number }>();
        if (tagRow) {
          // Link tag to this image in image_tags table
          await env.DB.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
            .bind(imageResult.id, tagRow.id)
            .run();
        }
      }
    }

    // Update last_crawled_at for this account
    await env.DB.prepare(
      "UPDATE crawl_accounts SET last_crawled_at = datetime('now') WHERE lower(username) = ?"
    ).bind(authorInput.handle.toLowerCase()).run();

    return new Response(JSON.stringify({ 
      success: true, 
      imageId: imageResult?.id,
      r2Keys 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
