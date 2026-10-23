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

export function mimeForKey(key: string): string {
  const ext = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export function parseByteRange(
  rangeHeader: string,
  total: number,
): { start: number; end: number; length: number } | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  // Suffix byte-range-spec: "bytes=-500" (last N bytes)
  if (!rawStart && rawEnd) {
    const suffixLength = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, total - suffixLength);
    const end = total - 1;
    return { start, end, length: end - start + 1 };
  }

  const start = parseInt(rawStart, 10);
  let end = rawEnd ? parseInt(rawEnd, 10) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
    return null;
  }
  end = Math.min(end, total - 1);
  return { start, end, length: end - start + 1 };
}

export function matchesIfNoneMatch(ifNoneMatchHeader: string | null, etag: string | null): boolean {
  if (!ifNoneMatchHeader || !etag) return false;
  const normalize = (val: string) => val.trim().replace(/^W\//i, '');
  const target = normalize(etag);
  return ifNoneMatchHeader
    .split(',')
    .some((candidate) => candidate.trim() === '*' || normalize(candidate) === target);
}
