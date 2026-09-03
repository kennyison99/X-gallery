-- Migration 013: Add reviewed flag to images table
-- Enables tracking whether an image has been reviewed by admin or AI,
-- preventing re-reviewing already audited or approved posts.

ALTER TABLE images ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_images_published_reviewed ON images(published, reviewed, id DESC);
