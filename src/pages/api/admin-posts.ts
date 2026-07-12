import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { authorSearchText, formatAuthorName, normalizeAuthorHandle } from '../../lib/admin-dashboard';

// Admin post list with server-side pagination, filtering, and sorting.
// Returns HTML fragments (table rows + grid cards) for AJAX insertion.
//
// Query params:
//   offset, limit, published (1|0), search, author, tag, media (photo|video), sort (newest|oldest)

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const isVideoKey = (key: string) => VIDEO_EXTS.has((key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''));

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function parseParams(url: URL) {
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
  const published = url.searchParams.get('published') === '0' ? 0 : 1;
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
  const author = (url.searchParams.get('author') ?? '').trim().toLowerCase();
  const tag = (url.searchParams.get('tag') ?? '').trim();
  const media = url.searchParams.get('media') ?? '';
  const sort = url.searchParams.get('sort') ?? 'newest';
  return { offset, limit, published, search, author, tag, media, sort };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export const GET: APIRoute = async ({ url }) => {
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = url.origin;
  const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('[::1]');
  const getPreviewUrl = (key: string) => {
    const mediaUrl = `/api/r2/${encodeURIComponent(key)}`;
    if (isLocal) return mediaUrl;
    return `https://wsrv.nl/?url=${encodeURIComponent(new URL(mediaUrl, origin).href)}&w=300&output=webp`;
  };

  const params = parseParams(url);

  // Build WHERE clauses
  const conditions: string[] = ['i.published = ?'];
  const bindings: unknown[] = [params.published];

  if (params.search) {
    conditions.push('(LOWER(i.title) LIKE ? OR LOWER(i.author) LIKE ? OR LOWER(i.description) LIKE ? OR LOWER(i.author_display_name) LIKE ?)');
    const pat = `%${params.search}%`;
    bindings.push(pat, pat, pat, pat);
  }

  if (params.author) {
    conditions.push('LOWER(i.author) = ?');
    bindings.push(params.author);
  }

  if (params.tag) {
    conditions.push(`i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE t.name = ?)`);
    bindings.push(params.tag);
  }

  if (params.media === 'photo' || params.media === 'video') {
    // R2 keys are comma-separated in a TEXT column; use LIKE for a rough filter.
    if (params.media === 'video') {
      conditions.push(`i.r2_keys LIKE '%.mp4%' OR i.r2_keys LIKE '%.webm%' OR i.r2_keys LIKE '%.mov%' OR i.r2_keys LIKE '%.m4v%'`);
    } else {
      conditions.push(`(i.r2_keys NOT LIKE '%.mp4%' AND i.r2_keys NOT LIKE '%.webm%' AND i.r2_keys NOT LIKE '%.mov%' AND i.r2_keys NOT LIKE '%.m4v%')`);
    }
  }

  const where = conditions.join(' AND ');

  // Count total matching rows (for pagination info)
  const countSql = `SELECT COUNT(*) as total FROM images i WHERE ${where}`;
  const countRow = await env.DB.prepare(countSql).bind(...bindings).first<{ total: number }>();
  const total = countRow?.total ?? 0;

  // Fetch the current page
  const pageBindings = [...bindings, params.limit, params.offset];

  let orderBy = 'i.created_at DESC, i.id DESC';
  if (params.sort === 'oldest') {
    orderBy = 'i.created_at ASC, i.id ASC';
  } else if (params.sort === 'size_desc') {
    orderBy = '(COALESCE(i.photo_bytes, 0) + COALESCE(i.video_bytes, 0)) DESC, i.created_at DESC, i.id DESC';
  } else if (params.sort === 'size_asc') {
    orderBy = '(COALESCE(i.photo_bytes, 0) + COALESCE(i.video_bytes, 0)) ASC, i.created_at DESC, i.id DESC';
  }

  const pageSql = `
    SELECT i.*, group_concat(t.name) AS tags_list
    FROM images i
    LEFT JOIN image_tags it ON i.id = it.image_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE ${where}
    GROUP BY i.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`;
  const { results = [] } = await env.DB.prepare(pageSql).bind(...pageBindings).all<any>();

  // Fetch author set to filter author handles from tags
  const authorsQuery = await env.DB.prepare('SELECT DISTINCT LOWER(author) as author FROM images').all<{ author: string }>();
  const authorSet = new Set((authorsQuery.results ?? []).map((r) => r.author));

  // Build HTML
  let tableRows = '';
  let gridCards = '';

  for (const image of results) {
    const keys = image.r2_keys ? image.r2_keys.split(',').map((k: string) => k.trim()).filter(Boolean) : [];
    const firstKey = keys[0] || '';
    const totalCount = keys.length;
    const firstIsVideo = /\.(mp4|webm|mov|m4v)$/i.test(firstKey);
    const hasPhoto = keys.some((k: string) => !isVideoKey(k));
    const hasVideo = keys.some((k: string) => isVideoKey(k));
    const tags: string[] = image.tags_list
      ? image.tags_list.split(',').filter((tag: string) => !authorSet.has(tag.trim().toLowerCase()))
      : [];

    // Pending remaining time
    let remainingText = '';
    let isCritical = false;
    if (image.published === 0) {
      const createdTime = new Date(image.created_at).getTime();
      const expireTime = createdTime + 3 * 24 * 60 * 60 * 1000;
      const remainingMs = expireTime - Date.now();
      if (remainingMs <= 0) {
        remainingText = '即將刪除';
        isCritical = true;
      } else {
        const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
        if (remainingHours < 24) {
          remainingText = `剩餘 ${remainingHours} 小時`;
          isCritical = true;
        } else {
          const remainingDays = Math.floor(remainingHours / 24);
          const extraHours = remainingHours % 24;
          remainingText = `剩餘 ${remainingDays} 天 ${extraHours} 小時`;
        }
      }
    }

    const dateStr = new Date(image.created_at).toLocaleDateString();
    const authorHandle = normalizeAuthorHandle(image.author);
    const authorSearch = authorSearchText(image.author_display_name, image.author);
    const authorDisplay = formatAuthorName(image.author_display_name, image.author);
    const r2Url = `/api/r2/${encodeURIComponent(firstKey)}`;
    const previewUrl = getPreviewUrl(firstKey);
    const titleAttr = escapeAttr(image.title || '無標題');
    const descAttr = escapeAttr(image.description || '');

    const totalBytes = (image.photo_bytes || 0) + (image.video_bytes || 0);
    const sizeStr = formatBytes(totalBytes);

    // Table row
    tableRows += `<tr class="image-row" data-id="${image.id}" data-published="${image.published}" data-has-photo="${hasPhoto}" data-has-video="${hasVideo}" data-author="${escapeAttr(authorHandle)}" data-author-display-name="${escapeAttr(image.author_display_name || '')}" data-author-search="${escapeAttr(authorSearch)}">
  <td style="text-align: center; vertical-align: middle;">
    <input type="checkbox" class="image-select-checkbox" data-id="${image.id}" style="cursor: pointer;" />
  </td>
  <td>
    <div class="thumb-container" style="position: relative; width: 48px; height: 48px; cursor: pointer;">
      ${firstIsVideo
        ? `<video data-src="${r2Url}" class="admin-thumb" preload="metadata" muted playsinline></video>`
        : `<img data-src="${previewUrl}" alt="${titleAttr}" class="admin-thumb" />`}
      ${totalCount > 1 ? `<span class="thumb-count-badge">+${totalCount - 1}</span>` : ''}
    </div>
  </td>
  <td>
    <div class="image-title">${escapeHtml(image.title || '無標題')}</div>
    <div class="image-author">
      ${escapeHtml(authorDisplay)}
      ${image.published === 0 ? `<span class="pending-badge ${isCritical ? 'critical' : ''}" style="margin-left: 0.5rem; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: bold; background-color: ${isCritical ? 'rgba(229, 57, 53, 0.15)' : 'rgba(255, 179, 0, 0.15)'}; color: ${isCritical ? '#e53935' : '#ffb300'}; border: 1px solid ${isCritical ? '#e53935' : '#ffb300'};">⏰ ${remainingText}</span>` : ''}
    </div>
    ${image.description ? `<div class="image-desc-preview" title="${descAttr}">${escapeHtml(image.description)}</div>` : ''}
    <div class="image-date">${dateStr} • 💾 ${sizeStr}</div>
  </td>
  <td>
    <div class="table-tags">
      ${tags.map((tag) => `<span class="table-tag">#${escapeHtml(tag)}</span>`).join('')}
    </div>
  </td>
  <td style="text-align: right;">
    <div class="table-actions" style="display: flex; gap: 0.3rem; justify-content: flex-end; align-items: center;">
      ${image.published === 0 ? `<button class="btn btn-success approve-btn" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;" data-id="${image.id}">核准</button>` : ''}
      <button class="btn edit-btn" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;" data-id="${image.id}" data-title="${titleAttr}" data-description="${descAttr}" data-author="${escapeAttr(authorHandle)}" data-author-display-name="${escapeAttr(image.author_display_name || '')}" data-author-url="${escapeAttr(image.author_url || '')}" data-post-url="${escapeAttr(image.post_url || '')}" data-tags="${escapeAttr(tags.join(','))}" data-keys="${escapeAttr(image.r2_keys || '')}">編輯</button>
      <button class="btn btn-danger delete-btn" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;" data-id="${image.id}">刪除</button>
    </div>
  </td>
 </tr>`;

    // Grid card
    gridCards += `<div class="grid-image-card" data-id="${image.id}" data-published="${image.published}" data-has-photo="${hasPhoto}" data-has-video="${hasVideo}" data-author="${escapeAttr(authorHandle)}" data-author-display-name="${escapeAttr(image.author_display_name || '')}" data-author-search="${escapeAttr(authorSearch)}">
  <div class="grid-card-select-overlay">
    <input type="checkbox" class="image-select-checkbox grid-select-checkbox" data-id="${image.id}" style="cursor: pointer;" />
  </div>
  <div class="grid-card-media">
    ${firstIsVideo
      ? `<video data-src="${r2Url}" class="grid-thumb" preload="metadata" muted playsinline></video>`
      : `<img data-src="${previewUrl}" alt="${titleAttr}" class="grid-thumb" />`}
    ${totalCount > 1 ? `<span class="grid-thumb-count-badge">+${totalCount - 1}</span>` : ''}
    <span class="grid-thumb-size-badge">💾 ${sizeStr}</span>
    <div class="grid-card-hover-overlay">
      <div class="grid-card-info">
        <div class="grid-card-title" title="${titleAttr}">${escapeHtml(image.title || '無標題')}</div>
        <div class="grid-card-author">${escapeHtml(authorDisplay)}</div>
      </div>
      <div class="grid-card-actions">
        ${image.published === 0 ? `<button class="btn btn-success approve-btn grid-action-btn" data-id="${image.id}" title="核准">✓</button>` : ''}
        <button class="btn edit-btn grid-action-btn" data-id="${image.id}" data-title="${titleAttr}" data-description="${descAttr}" data-author="${escapeAttr(authorHandle)}" data-author-display-name="${escapeAttr(image.author_display_name || '')}" data-author-url="${escapeAttr(image.author_url || '')}" data-post-url="${escapeAttr(image.post_url || '')}" data-tags="${escapeAttr(tags.join(','))}" data-keys="${escapeAttr(image.r2_keys || '')}" title="編輯">✏️</button>
        <button class="btn btn-danger delete-btn grid-action-btn" data-id="${image.id}" title="刪除">🗑️</button>
      </div>
    </div>
  </div>
 </div>`;
  }

  const hasMore = params.offset + results.length < total;
  const end = params.offset + results.length;

  return new Response(JSON.stringify({
    table_rows: tableRows,
    grid_cards: gridCards,
    total,
    offset: params.offset,
    limit: params.limit,
    has_more: hasMore,
    showing_start: total > 0 ? params.offset + 1 : 0,
    showing_end: end,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
