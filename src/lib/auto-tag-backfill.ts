import { generateAutoTags } from './auto-tags.ts';

export interface AutoTagImage {
  id: number;
  author: string | null;
  description: string | null;
}

export interface AutoTagLink {
  imageId: number;
  tagName: string;
}

export function createAutoTagBatch(images: AutoTagImage[]): {
  tagNames: string[];
  links: AutoTagLink[];
} {
  const tagNames = new Set<string>();
  const links: AutoTagLink[] = [];

  for (const image of images) {
    for (const tagName of generateAutoTags(image.author, image.description)) {
      tagNames.add(tagName);
      links.push({ imageId: image.id, tagName });
    }
  }

  return { tagNames: [...tagNames], links };
}

export function normalizeAutoTagBatchInput(input: unknown): { cursor: number; limit: number } {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawCursor = Number(body.cursor);
  const rawLimit = Number(body.limit);
  const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.floor(rawCursor) : 0;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), 50)
    : 50;

  return { cursor, limit };
}
