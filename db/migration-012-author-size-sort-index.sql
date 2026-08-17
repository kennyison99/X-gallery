-- Migration 012: Composite expression index for author-filtered size sorting
-- Addresses production D1 hotspot where author + size_desc sorting had to scan ~2,823 rows across the generic size index.

CREATE INDEX IF NOT EXISTS idx_images_published_author_nocase_size_desc
ON images (
  published,
  author COLLATE NOCASE,
  (COALESCE(photo_bytes, 0) + COALESCE(video_bytes, 0)) DESC,
  created_at DESC,
  id DESC
);
