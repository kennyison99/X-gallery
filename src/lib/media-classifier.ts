const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

export interface ClassifiedMediaCount {
  photoCount: number;
  videoCount: number;
}

/**
 * Classifies a comma-separated list of r2_keys into photo and video counts.
 */
export function classifyMediaKeys(r2Keys: string | null | undefined): ClassifiedMediaCount {
  if (!r2Keys || typeof r2Keys !== 'string') {
    return { photoCount: 0, videoCount: 0 };
  }

  const keys = r2Keys
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  let photoCount = 0;
  let videoCount = 0;

  for (const key of keys) {
    const ext = key.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
    if (VIDEO_EXTS.has(ext)) {
      videoCount++;
    } else {
      photoCount++;
    }
  }

  return { photoCount, videoCount };
}
