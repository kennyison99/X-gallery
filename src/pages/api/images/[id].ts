import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  contentTypeForFilename,
  wouldExceedStorage,
  addStorageBytes,
  isVideoKey,
} from '../../../lib/storage';
import { normalizeAuthorInput } from '../../../lib/admin-dashboard';

export const DELETE: APIRoute = async ({ params }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing image ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const imageId = parseInt(id, 10);

    // Get r2_keys first to delete from storage
    const image = await env.DB.prepare('SELECT r2_keys FROM images WHERE id = ?')
      .bind(imageId)
      .first();

    if (!image) {
      return new Response(JSON.stringify({ error: 'Image not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Split keys and delete all images from R2
    const keys = image.r2_keys.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);

    // Sum the size of each object before deleting so the storage counter
    // can be decremented accurately.
    let freedBytes = 0;
    for (const key of keys) {
      try {
        const head = await env.BUCKET.head(key);
        if (head) freedBytes += head.size;
      } catch {
        /* ignore head errors */
      }
      await env.BUCKET.delete(key);
    }

    if (freedBytes > 0) {
      await addStorageBytes(-freedBytes);
    }

    // Delete from D1 (cascade deletes associations)
    await env.DB.prepare('DELETE FROM images WHERE id = ?')
      .bind(imageId)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing image ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const imageId = parseInt(id, 10);
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
    const tagsString = formData.get('tags') as string | null; // Comma separated list of tags
    const existingKeysString = formData.get('existing_keys') as string | null; // Comma separated list of keys to KEEP

    if (!authorInput.handle) {
      return new Response(JSON.stringify({ error: 'Author is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Parse and validate existing keys to keep
    const keptKeys = (existingKeysString || '')
      .split(',')
      .map((k: string) => k.trim())
      .filter(Boolean);

    // 2. Fetch original keys to determine which ones to delete
    const oldImage = await env.DB.prepare('SELECT r2_keys FROM images WHERE id = ?')
      .bind(imageId)
      .first();
    if (!oldImage) {
      return new Response(JSON.stringify({ error: 'Image not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const oldKeys = oldImage.r2_keys
      ? oldImage.r2_keys.split(',').map((k: string) => k.trim()).filter(Boolean)
      : [];

    if (keptKeys.some((key: string) => !oldKeys.includes(key))) {
      return new Response(JSON.stringify({ error: 'Invalid existing image key' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find keys to delete (present in oldKeys but not in keptKeys)
    const keysToDelete = oldKeys.filter((key: string) => !keptKeys.includes(key));
    const validFiles = files.filter(f => f && f.size > 0);
    if (keptKeys.length === 0 && validFiles.length === 0) {
      return new Response(JSON.stringify({ error: '貼文必須至少包含一張照片。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Read current sizes without mutating R2 so every validation can run first.
    const oldKeySizes = new Map<string, number>();
    for (const key of oldKeys) {
      try {
        const head = await env.BUCKET.head(key);
        if (head) oldKeySizes.set(key, head.size);
      } catch (e) {
        console.error(`Failed to read old key ${key} from R2:`, e);
      }
    }

    const incomingBytes = validFiles.reduce((sum, f) => sum + f.size, 0);
    const removableBytes = keysToDelete.reduce((sum: number, key: string) => sum + (oldKeySizes.get(key) || 0), 0);
    const netIncomingBytes = incomingBytes - removableBytes;
    if (netIncomingBytes > 0 && await wouldExceedStorage(netIncomingBytes)) {
      return new Response(JSON.stringify({
        error: '儲存空間不足：R2 用量已接近 10GB 上限，請先刪除舊資料再上傳。',
      }), {
        status: 507,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Calculate final persisted sizes before mutating storage.
    let photoBytes = 0;
    let videoBytes = 0;
    for (const key of keptKeys) {
      const size = oldKeySizes.get(key) || 0;
      if (isVideoKey(key)) videoBytes += size;
      else photoBytes += size;
    }
    for (const file of validFiles) {
      if (isVideoKey(file.name)) videoBytes += file.size;
      else photoBytes += file.size;
    }

    const newlyUploadedKeys: string[] = [];
    try {
      for (const file of validFiles) {
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const r2Key = `${Date.now()}-${cleanFileName}`;
        const fileArrayBuffer = await file.arrayBuffer();
        await env.BUCKET.put(r2Key, fileArrayBuffer, {
          httpMetadata: { contentType: contentTypeForFilename(file.name, file.type || 'image/jpeg') }
        });
        newlyUploadedKeys.push(r2Key);
      }

      const finalKeys = [...keptKeys, ...newlyUploadedKeys];
      const finalKeysString = finalKeys.join(',');

      await env.DB.prepare(
        "UPDATE images SET title = ?, r2_keys = ?, author = ?, author_display_name = ?, author_url = ?, post_url = ?, description = ?, published = 1, photo_bytes = ?, video_bytes = ?, updated_at = datetime('now') WHERE id = ?"
      )
        .bind(title || '推文寫真', finalKeysString, authorInput.handle, authorInput.displayName, authorUrl || '', postUrl || '', description || '', photoBytes, videoBytes, imageId)
        .run();
    } catch (error) {
      for (const key of newlyUploadedKeys) {
        await env.BUCKET.delete(key).catch(() => {});
      }
      throw error;
    }

    // The DB now references the final set, so removed objects can be deleted.
    let deletedBytes = 0;
    for (const key of keysToDelete) {
      try {
        await env.BUCKET.delete(key);
        deletedBytes += oldKeySizes.get(key) || 0;
      } catch (e) {
        console.error(`Failed to delete old key ${key} from R2:`, e);
      }
    }
    await addStorageBytes(incomingBytes - deletedBytes);

    // 2. Clean current tags associations
    await env.DB.prepare('DELETE FROM image_tags WHERE image_id = ?')
      .bind(imageId)
      .run();

    // 3. Process tags
    const tags = (tagsString || '')
      .split(/[\s,]+/)
      .map(t => t.trim().replace(/^#/, ''))
      .filter(t => t.length > 0);

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

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
