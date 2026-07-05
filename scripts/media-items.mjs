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

export function latestPostSignature(items) {
  const item = items.find((media) => media?.tweet_id);
  if (!item) return null;
  return {
    postId: String(item.tweet_id),
    date: item.date ? String(item.date) : "",
  };
}

export function samePostSignature(a, b) {
  if (!a || !b || a.postId !== b.postId) return false;
  return !a.date || !b.date || a.date === b.date;
}

function isNewerPost(item, previousLatest) {
  if (!previousLatest?.postId || !item?.tweet_id) return true;
  try {
    return BigInt(String(item.tweet_id)) > BigInt(String(previousLatest.postId));
  } catch {
    return item.date && previousLatest.date ? String(item.date) > String(previousLatest.date) : true;
  }
}

export function newerThanLatest(items, previousLatest) {
  return previousLatest ? items.filter((item) => isNewerPost(item, previousLatest)) : items;
}
