import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

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
    const author = formData.get('author') as string | null;
    const authorUrl = formData.get('author_url') as string | null;
    const postUrl = formData.get('post_url') as string | null;
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    const createdAt = formData.get('created_at') as string | null;

    const validFiles = files.filter(f => f && f.size > 0);
    if (validFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid image files provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!author) {
      return new Response(JSON.stringify({ error: 'Author is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check for duplicate: same author + same original filename pattern
    // Use the first file's name as a dedup key
    const firstFileName = validFiles[0].name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const existingCheck = await env.DB.prepare(
      'SELECT id FROM images WHERE author = ? AND r2_keys LIKE ?'
    ).bind(author, `%${firstFileName}%`).first();

    if (existingCheck) {
      return new Response(JSON.stringify({ 
        success: false, 
        skipped: true, 
        message: `Image "${firstFileName}" already exists for @${author}` 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Upload all files to R2
    const r2Keys: string[] = [];
    for (const file of validFiles) {
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      // Use author prefix for organized storage
      const r2Key = `${author}_${cleanFileName}`;

      const fileArrayBuffer = await file.arrayBuffer();
      await env.BUCKET.put(r2Key, fileArrayBuffer, {
        httpMetadata: { contentType: file.type || 'image/jpeg' }
      });
      r2Keys.push(r2Key);
    }

    const r2KeysString = r2Keys.join(',');

    // Insert into D1
    const insertQuery = `
      INSERT INTO images (title, r2_keys, author, author_url, post_url, description${createdAt ? ', created_at' : ''})
      VALUES (?, ?, ?, ?, ?, ?${createdAt ? ', ?' : ''})
      RETURNING id
    `;
    const bindParams = [
      title || `@${author} 推文`,
      r2KeysString,
      author,
      authorUrl || `https://x.com/${author}`,
      postUrl || '',
      description || ''
    ];
    if (createdAt) {
      bindParams.push(createdAt);
    }
    const imageResult = await env.DB.prepare(insertQuery)
      .bind(...bindParams)
      .first();

    // Auto-tagging logic based on description and author
    if (imageResult?.id) {
      const autoTags = new Set<string>();
      
      // 1. Always add the blogger's username as a tag
      if (author) {
        autoTags.add(author.trim().toLowerCase());
      }

      // 2. Scan tweet description for keywords to assign tags
      if (description) {
        const descLower = description.toLowerCase();
        
        // Black tights / 黑絲
        if (descLower.includes('黑絲') || descLower.includes('黒タイツ') || descLower.includes('black tights') || descLower.includes('blacktights')) {
          autoTags.add('黑絲');
          autoTags.add('絲襪');
        }
        
        // White tights / 白絲
        if (descLower.includes('白絲') || descLower.includes('白タイツ') || descLower.includes('白ストッキング') || descLower.includes('white tights') || descLower.includes('white stockings') || descLower.includes('white pantyhose')) {
          autoTags.add('白絲');
          autoTags.add('絲襪');
        }
        
        // Tights / 絲襪 (general)
        if (descLower.includes('絲襪') || descLower.includes('タイツ') || descLower.includes('tights') || descLower.includes('pantyhose') || descLower.includes('ストッキング') || descLower.includes('網襪')) {
          autoTags.add('絲襪');
        }

        // Barefoot / Bare legs / 裸足
        if (descLower.includes('裸足') || descLower.includes('赤腳') || descLower.includes('光腿') || descLower.includes('生脚') || descLower.includes('素足') || descLower.includes('barefoot') || descLower.includes('bare feet') || descLower.includes('bare legs')) {
          autoTags.add('裸足');
        }
        
        // Cosplay / COS
        if (descLower.includes('cosplay') || descLower.includes('cos') || descLower.includes('コスプレ') || descLower.includes('角色扮演')) {
          autoTags.add('COS');
        }
        
        // Gravure / 寫真
        if (descLower.includes('寫真') || descLower.includes('グラビア') || descLower.includes('gravure') || descLower.includes('photobook') || descLower.includes('週刊') || descLower.includes('young jump') || descLower.includes('friday')) {
          autoTags.add('寫真');
        }
        
        // Casual / 日常
        if (descLower.includes('日常') || descLower.includes('日常服') || descLower.includes('casual') || descLower.includes('私服') || descLower.includes('散步')) {
          autoTags.add('日常');
        }
      }

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
      "UPDATE crawl_accounts SET last_crawled_at = datetime('now') WHERE username = ?"
    ).bind(author).run();

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
