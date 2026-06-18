import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

function mimeForKey(key: string): string {
  const ext = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export const GET: APIRoute = async ({ params, request }) => {
  const { key } = params;
  if (!key) {
    return new Response('Missing key', { status: 400 });
  }

  if (!env || !env.BUCKET) {
    return new Response('R2 Bucket binding "BUCKET" is not configured', { status: 500 });
  }

  const decodedKey = decodeURIComponent(key);

  try {
    // Range request handling (needed for video seeking / streaming).
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const fullObject = await env.BUCKET.head(decodedKey);
      if (!fullObject) {
        return new Response('Object not found in R2', { status: 404 });
      }
      const total = fullObject.size;

      // Parse "bytes=start-end" (end optional)
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (!match) {
        return new Response('Invalid range', { status: 416 });
      }
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return new Response('Invalid range', { status: 416 });
      }
      if (start > end || start >= total) {
        return new Response('Requested range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }
      end = Math.min(end, total - 1);
      const length = end - start + 1;

      const ranged = await env.BUCKET.get(decodedKey, {
        range: { offset: start, length },
      });
      if (!ranged) {
        return new Response('Object not found in R2', { status: 404 });
      }

      const headers = new Headers();
      ranged.writeHttpMetadata(headers);
      headers.set('etag', ranged.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000');
      headers.set('Content-Type', mimeForKey(decodedKey));
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      headers.set('Content-Length', String(length));
      headers.set('Content-Disposition', 'inline');

      return new Response(ranged.body, { status: 206, headers });
    }

    // Full object
    const object = await env.BUCKET.get(decodedKey);
    if (!object) {
      return new Response('Object not found in R2', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Length', String(object.size));

    // Ensure correct content type — always override with our extension-based
    // mapping so video files get the proper MIME (R2 metadata may be stale
    // or missing for older uploads).
    headers.set('Content-Type', mimeForKey(decodedKey));

    return new Response(object.body, { headers });
  } catch (error: any) {
    return new Response(error.message || 'Error retrieving R2 object', { status: 500 });
  }
};
