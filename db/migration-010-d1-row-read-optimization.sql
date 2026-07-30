-- Migration 010: D1 Row-Read Optimization
-- Adds photo_count, video_count, media_count_version to images
-- Adds directory_version and media_counts_ready to storage_stats
-- Canonicalizes created_at timestamps to YYYY-MM-DD HH:MM:SS
-- Adds partial & composite NOCASE indexes

ALTER TABLE images ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN video_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN media_count_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE storage_stats ADD COLUMN directory_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE storage_stats ADD COLUMN media_counts_ready INTEGER NOT NULL DEFAULT 0;

-- Canonicalize legacy null or mixed-format timestamps to YYYY-MM-DD HH:MM:SS
UPDATE images SET created_at = COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), '1970-01-01 00:00:00');

-- Partial index for pending posts
CREATE INDEX IF NOT EXISTS idx_images_pending_created_id
ON images(created_at, id)
WHERE published = 0;

-- Full composite NOCASE index for author filtering across published and pending
CREATE INDEX IF NOT EXISTS idx_images_published_author_nocase_created_id
ON images(published, author COLLATE NOCASE, created_at DESC, id DESC);

PRAGMA optimize;
