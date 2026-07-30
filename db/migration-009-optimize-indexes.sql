-- Migration 009: Optimize D1 database indexes for gallery feeds and tags
CREATE INDEX IF NOT EXISTS idx_images_published_created
ON images(published, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_images_published_author
ON images(published, author, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_image_tags_tag_image
ON image_tags(tag_id, image_id);

CREATE INDEX IF NOT EXISTS idx_images_post_url
ON images(post_url);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  r2_etag TEXT,
  phash TEXT,
  phash_version INTEGER NOT NULL DEFAULT 1,
  hashed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_assets_unhashed ON media_assets(phash_version, hashed_at, id);
CREATE INDEX IF NOT EXISTS idx_media_assets_image_id ON media_assets(image_id);
