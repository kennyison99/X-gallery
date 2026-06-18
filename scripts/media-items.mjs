import path from 'node:path';

export function mediaIdFromUrl(mediaUrl) {
  try {
    const url = new URL(mediaUrl);
    const base = path.basename(url.pathname);
    return base.replace(/\.[a-zA-Z0-9]+$/, '');
  } catch {
    return mediaUrl;
  }
}

export function dedupeMediaItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    const identity = `${String(item.tweet_id)}:${mediaIdFromUrl(item.url)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
