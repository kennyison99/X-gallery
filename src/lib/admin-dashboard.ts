export const ADMIN_TABS = ['overview', 'posts', 'upload', 'crawler', 'auto-tag'] as const;
export type AdminTab = typeof ADMIN_TABS[number];

export function normalizeAuthorHandle(value: unknown): string {
  return String(value ?? '').trim().replace(/^@+/, '').trim();
}

export function formatAuthorName(displayName: unknown, handle: unknown): string {
  const cleanDisplayName = String(displayName ?? '').trim();
  const cleanHandle = normalizeAuthorHandle(handle);
  if (!cleanHandle) return cleanDisplayName;
  return cleanDisplayName ? `${cleanDisplayName}@${cleanHandle}` : `@${cleanHandle}`;
}

export function authorSearchText(displayName: unknown, handle: unknown): string {
  return `${String(displayName ?? '').trim()} ${normalizeAuthorHandle(handle)}`.trim().toLowerCase();
}

export function normalizeAuthorInput(handle: unknown, displayName: unknown) {
  return {
    handle: normalizeAuthorHandle(handle),
    displayName: String(displayName ?? '').trim(),
  };
}

export function resolveAdminTab(hash: string): AdminTab {
  const candidate = hash.replace(/^#/, '') as AdminTab;
  return ADMIN_TABS.includes(candidate) ? candidate : 'overview';
}
