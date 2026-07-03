export function normalizeCrawlUsername(input: string | null | undefined): string {
  let username = (input || '').trim().replace(/^@+/, '');

  if (username.includes('/') || username.includes('http')) {
    try {
      const cleanUrl = username.startsWith('http') ? username : `https://${username}`;
      const url = new URL(cleanUrl);
      const paths = url.pathname.split('/').filter(Boolean);
      if (paths.length > 0) username = paths[0];
    } catch {
      const match = username.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/i);
      if (match) username = match[1];
    }
  }

  return username.replace(/^@+/, '').toLowerCase();
}
