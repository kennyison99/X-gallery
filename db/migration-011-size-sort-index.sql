-- Migration 011: Add expression index for admin post manager size sorting
-- Optimizes ORDER BY (COALESCE(photo_bytes, 0) + COALESCE(video_bytes, 0)) DESC

CREATE INDEX IF NOT EXISTS idx_images_published_size_desc
ON images (
  published,
  (COALESCE(photo_bytes, 0) + COALESCE(video_bytes, 0)) DESC,
  created_at DESC,
  id DESC
);
