export interface DedupImageRow {
  id: number;
  post_url: string;
  r2_keys: string;
}

export interface DedupObject {
  etag: string;
  size: number;
}

export interface CardDuplicateFix {
  kind: 'card';
  post_url: string;
  keep_id: number;
  delete_ids: number[];
  delete_keys: string[];
  freed_bytes: number;
}

export interface MediaDuplicateFix {
  kind: 'media';
  image_id: number;
  keep_key: string;
  delete_keys: string[];
  freed_bytes: number;
}

export type DuplicateFix = CardDuplicateFix | MediaDuplicateFix;

export function splitR2Keys(value: string): string[] {
  return value.split(',').map((key) => key.trim()).filter(Boolean);
}

function mediaSignature(
  row: DedupImageRow,
  objects: ReadonlyMap<string, DedupObject>,
): string | null {
  const etags = splitR2Keys(row.r2_keys).map((key) => objects.get(key)?.etag);
  return etags.length > 0 && etags.every(Boolean) ? etags.sort().join('\n') : null;
}

export function buildCardDuplicateFix(
  rows: DedupImageRow[],
  objects: ReadonlyMap<string, DedupObject>,
): CardDuplicateFix | null {
  if (rows.length < 2 || rows.some((row) => row.post_url !== rows[0].post_url)) return null;

  const postId = rows[0].post_url.match(/\/status\/(\d+)/)?.[1];
  const exactRows = postId
    ? rows.filter((row) => splitR2Keys(row.r2_keys).some((key) => key.includes(postId)))
    : [];
  const candidates = exactRows.length > 0 ? exactRows : rows;
  const keep = candidates.reduce((oldest, row) => row.id < oldest.id ? row : oldest);
  const keepSignature = mediaSignature(keep, objects);
  if (!keepSignature) return null;

  const duplicateRows = rows.filter(
    (row) => row.id !== keep.id && mediaSignature(row, objects) === keepSignature,
  );
  if (duplicateRows.length === 0) return null;

  const keepKeys = new Set(splitR2Keys(keep.r2_keys));
  const deleteKeys = [...new Set(
    duplicateRows.flatMap((row) => splitR2Keys(row.r2_keys)).filter((key) => !keepKeys.has(key)),
  )];

  return {
    kind: 'card',
    post_url: keep.post_url,
    keep_id: keep.id,
    delete_ids: duplicateRows.map((row) => row.id),
    delete_keys: deleteKeys,
    freed_bytes: deleteKeys.reduce((sum, key) => sum + (objects.get(key)?.size ?? 0), 0),
  };
}

export function buildMediaDuplicateFixes(
  row: DedupImageRow,
  objects: ReadonlyMap<string, DedupObject>,
): MediaDuplicateFix[] {
  const byEtag = new Map<string, string[]>();
  for (const key of splitR2Keys(row.r2_keys)) {
    const etag = objects.get(key)?.etag;
    if (!etag) continue;
    const keys = byEtag.get(etag);
    if (keys) keys.push(key);
    else byEtag.set(etag, [key]);
  }

  return [...byEtag.values()].filter((keys) => keys.length > 1).map((keys) => ({
    kind: 'media',
    image_id: row.id,
    keep_key: keys[0],
    delete_keys: keys.slice(1),
    freed_bytes: keys.slice(1).reduce((sum, key) => sum + (objects.get(key)?.size ?? 0), 0),
  }));
}
