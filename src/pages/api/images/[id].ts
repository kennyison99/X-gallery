import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

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
    for (const key of keys) {
      await env.BUCKET.delete(key);
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
    const author = formData.get('author') as string | null;
    const authorUrl = formData.get('author_url') as string | null;
    const postUrl = formData.get('post_url') as string | null;
    const tagsString = formData.get('tags') as string | null; // Comma separated list of tags
    const existingKeysString = formData.get('existing_keys') as string | null; // Comma separated list of keys to KEEP

    if (!author) {
      return new Response(JSON.stringify({ error: 'Author is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Parse keys to keep
    const keptKeys = (existingKeysString || '')
      .split(',')
      .map((k: string) => k.trim())
      .filter(Boolean);

    // 2. Fetch original keys to determine which ones to delete
    const oldImage = await env.DB.prepare('SELECT r2_keys FROM images WHERE id = ?')
      .bind(imageId)
      .first();
    const oldKeys = oldImage && oldImage.r2_keys 
      ? oldImage.r2_keys.split(',').map((k: string) => k.trim()).filter(Boolean) 
      : [];

    // Find keys to delete (present in oldKeys but not in keptKeys)
    const keysToDelete = oldKeys.filter((key: string) => !keptKeys.includes(key));
    for (const key of keysToDelete) {
      try {
        await env.BUCKET.delete(key);
      } catch (e) {
        console.error(`Failed to delete old key ${key} from R2:`, e);
      }
    }

    // 3. Upload new files if any
    const validFiles = files.filter(f => f && f.size > 0);
    const newlyUploadedKeys: string[] = [];
    for (const file of validFiles) {
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const r2Key = `${Date.now()}-${cleanFileName}`;
      const fileArrayBuffer = await file.arrayBuffer();
      await env.BUCKET.put(r2Key, fileArrayBuffer, {
        httpMetadata: { contentType: file.type || 'image/jpeg' }
      });
      newlyUploadedKeys.push(r2Key);
    }

    // Combine kept keys and new keys
    const finalKeys = [...keptKeys, ...newlyUploadedKeys];
    const finalKeysString = finalKeys.join(',');

    if (finalKeys.length === 0) {
      return new Response(JSON.stringify({ error: '貼文必須至少包含一張照片。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update image metadata including final R2 keys and updated_at timestamp
    await env.DB.prepare(
      "UPDATE images SET title = ?, r2_keys = ?, author = ?, author_url = ?, post_url = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(title || '推文寫真', finalKeysString, author, authorUrl || '', postUrl || '', description || '', imageId)
      .run();

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
