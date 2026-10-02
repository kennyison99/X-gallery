import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { handleCrawlMultipart } from '../../lib/crawl-multipart';
import { MAX_CRAWL_FILE_BYTES } from '../../lib/crawl-upload-limits.mjs';
import {
  contentTypeForFilename,
  wouldExceedStorage,
  addStorageBytes,
} from '../../lib/storage';

/**
 * POST /api/crawl-upload-file
 * Uploads a single media file to R2 during crawls.
 * Protected by CRAWL_API_KEY.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    if (new URL(request.url).searchParams.has('action')) {
      const apiKey = request.headers.get('X-API-Key');
      const expectedKey = env.CRAWL_API_KEY;
      if (!apiKey || !expectedKey) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const encoder = new TextEncoder();
      const [provided, expected] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(apiKey)),
        crypto.subtle.digest('SHA-256', encoder.encode(expectedKey)),
      ]);
      if (!crypto.subtle.timingSafeEqual(provided, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      return await handleCrawlMultipart(request, env.BUCKET, wouldExceedStorage, addStorageBytes);
    }
    const formData = await request.formData();
    const apiKey = formData.get('api_key') as string | null;
    const expectedKey = (env as any).CRAWL_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const file = formData.get('file') as File | null;
    const author = formData.get('author') as string | null;

    if (!file || file.size === 0) {
      return new Response(JSON.stringify({ error: 'No valid file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (file.size > MAX_CRAWL_FILE_BYTES) return Response.json({ error: 'File exceeds 1 GB' }, { status: 413 });

    if (!author) {
      return new Response(JSON.stringify({ error: 'Author is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Storage guard
    if (await wouldExceedStorage(file.size)) {
      return new Response(JSON.stringify({
        error: '儲存空間不足：R2 用量已接近 10GB 上限，請先刪除舊資料再上傳。',
      }), {
        status: 507,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cleanAuthor = author.trim().replace(/^@+/, '');
    const r2Key = `${cleanAuthor}_${cleanFileName}`;

    const fileArrayBuffer = await file.arrayBuffer();
    await env.BUCKET.put(r2Key, fileArrayBuffer, {
      httpMetadata: { contentType: contentTypeForFilename(file.name, file.type || 'image/jpeg') }
    });

    await addStorageBytes(file.size);

    return new Response(JSON.stringify({ success: true, key: r2Key }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const PUT = POST;

export const GET: APIRoute = () => Response.json({ multipart: true, maxFileBytes: MAX_CRAWL_FILE_BYTES });
