interface PhotoSwipeItem {
  src?: string;
  type?: string;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
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
  viewport?: ViewportSize,
): T {
  if (item.element?.getAttribute('data-video') !== '1') {
    const image = item.element?.querySelector?.('img');
    if (image?.naturalWidth && image.naturalHeight) {
      // Scale up the thumbnail dimensions to a high-resolution size
      // while preserving the exact aspect ratio of the image.
      const targetMax = 2400;
      const maxDim = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = targetMax / maxDim;
      const factor = Math.max(1, scale);
      
      const targetW = Math.round(image.naturalWidth * factor);
      const targetH = Math.round(image.naturalHeight * factor);
      
      item.w = targetW;
      item.h = targetH;
      item.width = targetW;
      item.height = targetH;
    } else {
      // Fallback if no image element is found
      const fallbackW = viewport?.width ?? 1200;
      const fallbackH = viewport?.height ?? 900;
      item.w = fallbackW;
      item.h = fallbackH;
      item.width = fallbackW;
      item.height = fallbackH;
    }
    return item;
  }

  const src = escapeHtmlAttribute(item.src ?? '');
  item.type = 'html';
  const vidW = Math.min(viewport?.width ?? 1280, 1280);
  const vidH = Math.min(viewport?.height ?? 720, 720);
  item.w = vidW;
  item.h = vidH;
  item.width = vidW;
  item.height = vidH;
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
