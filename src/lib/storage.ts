import { env } from 'cloudflare:workers';

// R2 free-tier storage cap used for the admin "used / 10GB" display and the
// soft reject that kicks in near the limit.
export const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const STORAGE_REJECT_THRESHOLD = 0.95; // reject new uploads at >= 95%

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

/**
 * Resolve a content-type from a filename, falling back to image/jpeg.
 * Used when uploading via FormData where the client may not set a type.
 */
export function contentTypeForFilename(filename: string, fallback = 'image/jpeg'): string {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return MIME_BY_EXT[ext] ?? fallback;
}

/** True if the R2 key/filename refers to a video asset. */
export function isVideoKey(key: string): boolean {
  const ext = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return VIDEO_EXTS.has(ext);
}

/**
 * Read the current total_bytes counter. Returns 0 if the row is missing
 * (which also signals that a reconcile is needed).
 */
export async function getStorageTotal(): Promise<number> {
  if (!env?.DB) return 0;
  const row = await env.DB.prepare('SELECT total_bytes FROM storage_stats WHERE id = 1').first<{ total_bytes: number }>();
  return row?.total_bytes ?? 0;
}

/**
 * Atomically add `delta` bytes to the counter (delta may be negative).
 */
export async function addStorageBytes(delta: number): Promise<void> {
  if (!env?.DB || delta === 0) return;
  await env.DB.prepare(
    "UPDATE storage_stats SET total_bytes = MAX(0, total_bytes + ?), updated_at = datetime('now') WHERE id = 1"
  ).bind(delta).run();
}

/**
 * Returns true if uploading `incomingBytes` would exceed the reject threshold.
 * Call before putting objects to R2.
 */
export async function wouldExceedStorage(incomingBytes: number): Promise<boolean> {
  const total = await getStorageTotal();
  return total + incomingBytes >= STORAGE_REJECT_THRESHOLD * STORAGE_LIMIT_BYTES;
}

/**
 * Sum the size of every object in the R2 bucket by paginating list().
 * Used to reconcile the counter when it is 0 or on manual admin request.
 */
export async function reconcileStorage(): Promise<number> {
  if (!env?.BUCKET) return 0;
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ limit: 1000, cursor });
    for (const obj of page.objects) {
      total += obj.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.prepare(
    "UPDATE storage_stats SET total_bytes = ?, updated_at = datetime('now') WHERE id = 1"
  ).bind(total).run();
  return total;
}
