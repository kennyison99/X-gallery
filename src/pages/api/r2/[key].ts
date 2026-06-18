import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params }) => {
  const { key } = params;
  if (!key) {
    return new Response('Missing key', { status: 400 });
  }

  if (!env || !env.BUCKET) {
    return new Response('R2 Bucket binding "BUCKET" is not configured', { status: 500 });
  }

  try {
    const object = await env.BUCKET.get(decodeURIComponent(key));
    if (!object) {
      return new Response('Object not found in R2', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000');

    // Default content type guessing if not already set
    if (!headers.has('content-type')) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.endsWith('.png')) {
        headers.set('content-type', 'image/png');
      } else if (lowerKey.endsWith('.gif')) {
        headers.set('content-type', 'image/gif');
      } else if (lowerKey.endsWith('.webp')) {
        headers.set('content-type', 'image/webp');
      } else {
        headers.set('content-type', 'image/jpeg');
      }
    }

    return new Response(object.body, {
      headers
    });
  } catch (error: any) {
    return new Response(error.message || 'Error retrieving R2 object', { status: 500 });
  }
};
