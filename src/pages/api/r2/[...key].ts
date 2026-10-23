import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { matchesIfNoneMatch, mimeForKey, parseByteRange } from '../../../lib/r2-range';

const MAX_EDGE_CACHE_BYTES = 20 * 1024 * 1024; // 20 MB

export const GET: APIRoute = async ({ params, request, locals }) => {
  const { key } = params;
  if (!key) {
    return new Response('Missing key', { status: 400 });
  }

  if (!env || !env.BUCKET) {
    return new Response('R2 Bucket binding "BUCKET" is not configured', { status: 500 });
  }

  let decodedKey: string;
  try {
    decodedKey = decodeURIComponent(key);
  } catch {
    return new Response('Invalid key encoding', { status: 400 });
  }

  const cache = typeof caches !== 'undefined' ? (caches as any).default : undefined;
  const rangeHeader = request.headers.get('range');
  const ifNoneMatch = request.headers.get('if-none-match');
  const cacheKey = `https://r2-cache.internal/${encodeURIComponent(decodedKey)}`;

  if (!rangeHeader && cache) {
    try {
      const cached = await cache.match(new Request(cacheKey));
      if (cached) {
        if (matchesIfNoneMatch(ifNoneMatch, cached.headers.get('etag'))) {
          return new Response(null, { status: 304, headers: cached.headers });
        }
        return cached;
      }
    } catch {
      // Fail open on Cache API read error
    }
  }

  try {
    const contentType = mimeForKey(decodedKey);
    const isVideo = contentType.startsWith('video/');

    // Range request handling (needed for video seeking / streaming).
    if (rangeHeader) {
      const fullObject = await env.BUCKET.head(decodedKey);
      if (!fullObject) {
        return new Response('Object not found in R2', { status: 404 });
      }
      const total = fullObject.size;
      const parsedRange = parseByteRange(rangeHeader, total);
      if (!parsedRange) {
        return new Response('Requested range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }

      const { start, end, length } = parsedRange;
      const ranged = await env.BUCKET.get(decodedKey, {
        range: { offset: start, length },
      });
      if (!ranged) {
        return new Response('Object not found in R2', { status: 404 });
      }

      const headers = new Headers();
      ranged.writeHttpMetadata(headers);
      headers.set('etag', ranged.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Content-Type', contentType);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      headers.set('Content-Length', String(length));
      headers.set('Content-Disposition', 'inline');

      return new Response(ranged.body, { status: 206, headers });
    }

    // Full object — stream from R2 without buffering in Worker memory.
    const object = await env.BUCKET.get(decodedKey);
    if (!object) {
      return new Response('Object not found in R2', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Length', String(object.size));
    headers.set('Content-Type', contentType);

    if (matchesIfNoneMatch(ifNoneMatch, object.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }

    if (
      cache &&
      !isVideo &&
      object.size <= MAX_EDGE_CACHE_BYTES &&
      object.body &&
      typeof object.body.tee === 'function'
    ) {
      const [clientBody, cacheBody] = object.body.tee();
      const responseToCache = new Response(cacheBody, {
        status: 200,
        headers: new Headers(headers),
      });
      const cachePromise = cache.put(new Request(cacheKey), responseToCache).catch(() => {});
      const waitUntil = (locals as any)?.runtime?.ctx?.waitUntil;
      if (typeof waitUntil === 'function') {
        waitUntil.call((locals as any).runtime.ctx, cachePromise);
      }
      return new Response(clientBody, { status: 200, headers });
    }

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    console.error('Error retrieving R2 object:', error);
    return new Response('Error retrieving R2 object', { status: 500 });
  }
};
