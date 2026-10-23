const encoder = new TextEncoder();

/**
 * Constant-time string comparison using SHA-256 digests so neither string
 * content nor string length leaks via timing.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  if (typeof (crypto.subtle as any).timingSafeEqual === 'function') {
    return (crypto.subtle as any).timingSafeEqual(digestA, digestB);
  }
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  if (bytesA.byteLength !== bytesB.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.byteLength; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

/**
 * Fail-closed secret verification. Returns false if either provided or
 * expected secret is missing or empty.
 */
export async function verifySecret(provided: unknown, expected: unknown): Promise<boolean> {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (typeof expected !== 'string' || expected.length === 0) return false;
  return timingSafeEqualStrings(provided, expected);
}

export function extractApiKey(request: Request, url?: URL): string | null {
  const headerKey = request.headers.get('X-API-Key');
  if (headerKey) return headerKey;
  const parsedUrl = url ?? new URL(request.url);
  return parsedUrl.searchParams.get('api_key');
}

export function isLocalOrigin(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === 'internal.local' ||
    host.endsWith('.localhost')
  );
}

export function hasSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin) {
    return origin === url.origin;
  }
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
    return true;
  }
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin === url.origin;
    } catch {
      return false;
    }
  }
  return false;
}

export function hasCloudflareAccessAuth(request: Request): boolean {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (assertion && assertion.trim().length > 0) {
    return true;
  }
  const cookieHeader = request.headers.get('Cookie') ?? '';
  return /(?:^|;\s*)(?:CF_Authorization|__admin_session)=[^;\s]+/.test(cookieHeader);
}

export function isProtectedAdminRoute(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase();
  const isMutation = upperMethod !== 'GET' && upperMethod !== 'HEAD' && upperMethod !== 'OPTIONS';

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return true;
  }
  if (pathname === '/api/admin-posts' || pathname.startsWith('/api/admin/')) {
    return true;
  }
  if (pathname === '/api/crawl-accounts') {
    return true;
  }
  if (pathname === '/api/storage-stats' && isMutation) {
    return true;
  }
  if ((pathname === '/api/images' || pathname.startsWith('/api/images/')) && isMutation) {
    return true;
  }
  return false;
}
