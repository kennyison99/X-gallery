export interface CursorPayload {
  v: 1;
  sort: 'newest' | 'oldest';
  createdAt: string;
  id: number;
  filterKey: string;
}

const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Encodes a string to Web-native URL-safe Base64 supporting full UTF-8 Unicode.
 */
function utf8ToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decodes a Web-native URL-safe Base64 string back to UTF-8 Unicode string.
 */
function base64UrlToUtf8(str: string): string | null {
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Builds a canonical filterKey string for scope verification.
 */
export function buildFilterKey(
  scope: 'gallery' | 'search' | 'admin',
  filters: Record<string, string | number | boolean | null | undefined>
): string {
  const sortedKeys = Object.keys(filters).sort();
  const pairs: string[] = [`scope=${scope}`];
  for (const k of sortedKeys) {
    const val = filters[k];
    if (val !== undefined && val !== null && val !== '') {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(val))}`);
    }
  }
  return pairs.join('&');
}

/**
 * Encodes a cursor payload into a Base64URL string.
 */
export function encodeCursor(payload: CursorPayload): string {
  return utf8ToBase64Url(JSON.stringify(payload));
}

export class InvalidCursorError extends Error {
  constructor(message = 'Invalid cursor parameter') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

/**
 * Decodes and strictly validates a cursor payload string.
 * Throws InvalidCursorError if cursorStr is provided but invalid or mismatched.
 */
export function decodeCursor(cursorStr: string, expectedFilterKey: string): CursorPayload | null {
  if (!cursorStr || typeof cursorStr !== 'string') return null;

  const jsonStr = base64UrlToUtf8(cursorStr);
  if (!jsonStr) {
    throw new InvalidCursorError('Malformed Base64 cursor encoding');
  }

  try {
    const parsed = JSON.parse(jsonStr) as Partial<CursorPayload>;
    if (
      parsed &&
      parsed.v === 1 &&
      (parsed.sort === 'newest' || parsed.sort === 'oldest') &&
      typeof parsed.createdAt === 'string' &&
      TIMESTAMP_REGEX.test(parsed.createdAt) &&
      typeof parsed.id === 'number' &&
      Number.isInteger(parsed.id) &&
      parsed.id > 0 &&
      typeof parsed.filterKey === 'string' &&
      parsed.filterKey === expectedFilterKey
    ) {
      return parsed as CursorPayload;
    }
  } catch (e: any) {
    if (e instanceof InvalidCursorError) throw e;
    throw new InvalidCursorError('Invalid cursor payload JSON');
  }

  throw new InvalidCursorError('Cursor filterKey mismatch or invalid fields');
}

/**
 * Generates SQL comparison clause for keyset pagination.
 */
export function generateCursorWhereClause(sort: 'newest' | 'oldest') {
  if (sort === 'oldest') {
    return {
      sql: '(i.created_at > ? OR (i.created_at = ? AND i.id > ?))',
      bindings: (createdAt: string, id: number) => [createdAt, createdAt, id],
    };
  }
  return {
    sql: '(i.created_at < ? OR (i.created_at = ? AND i.id < ?))',
    bindings: (createdAt: string, id: number) => [createdAt, createdAt, id],
  };
}
