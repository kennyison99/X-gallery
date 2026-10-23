import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import {
  extractApiKey,
  hasCloudflareAccessAuth,
  hasSameOrigin,
  isLocalOrigin,
  isProtectedAdminRoute,
  verifySecret,
} from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const method = request.method.toUpperCase();

  if (!isProtectedAdminRoute(url.pathname, method)) {
    return next();
  }

  const expectedApiKey = (env as any)?.CRAWL_API_KEY;
  const providedApiKey = extractApiKey(request, url);

  if (providedApiKey !== null) {
    if (await verifySecret(providedApiKey, expectedApiKey)) {
      return next();
    }
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (isLocalOrigin(url)) {
    return next();
  }

  if (!hasCloudflareAccessAuth(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (isMutation && !hasSameOrigin(request, url)) {
    return new Response(JSON.stringify({ error: 'Cross-origin request forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const response = await next();

  if (
    (url.pathname === '/admin' || url.pathname === '/admin/') &&
    request.headers.get('Cf-Access-Jwt-Assertion')
  ) {
    const headers = new Headers(response.headers);
    headers.append(
      'Set-Cookie',
      '__admin_session=1; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200',
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
});
