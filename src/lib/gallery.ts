interface PhotoSwipeItem {
  src?: string;
  type?: string;
  w?: number;
  h?: number;
  html?: string;
  element?: {
    getAttribute(name: string): string | null;
    querySelector?(selector: string): {
      naturalWidth: number;
      naturalHeight: number;
    } | null;
  };
  [key: string]: unknown;
}

interface ViewportSize {
  width: number;
  height: number;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function preparePhotoSwipeItem<T extends PhotoSwipeItem>(
  item: T,
  viewport: ViewportSize,
): T {
  if (item.element?.getAttribute('data-video') !== '1') {
    const image = item.element?.querySelector?.('img');
    if (image?.naturalWidth && image.naturalHeight && image.naturalWidth > 350) {
      item.w = image.naturalWidth;
      item.h = image.naturalHeight;
    } else {
      // Fallback placeholder size for thumbnails so PhotoSwipe opens in large dimensions initially
      item.w = viewport.width;
      item.h = viewport.height;
    }
    return item;
  }

  const src = escapeHtmlAttribute(item.src ?? '');
  item.type = 'html';
  item.w = Math.min(viewport.width, 1280);
  item.h = Math.min(viewport.height, 720);
  item.html = `
    <div class="pswp__video-wrapper">
      <video src="${src}" controls playsinline></video>
    </div>
  `;

  return item;
}

export function wrapSlideIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}
