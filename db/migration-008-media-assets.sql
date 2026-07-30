-- Migration 008: Create media_assets table for persistent perceptual hashing (pHash)
CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  r2_etag TEXT,
  phash TEXT,
  phash_version INTEGER NOT NULL DEFAULT 1,
  hashed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_assets_unhashed
ON media_assets(phash_version, hashed_at, id);

CREATE INDEX IF NOT EXISTS idx_images_published_id
ON images(published, id);

CREATE INDEX IF NOT EXISTS idx_media_assets_image_id
ON media_assets(image_id);
