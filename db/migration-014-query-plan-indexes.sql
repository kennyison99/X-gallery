-- Migration 014: Keep hot crawl and feed queries on selective/order-compatible indexes.

CREATE INDEX IF NOT EXISTS idx_crawl_accounts_username_lower
  ON crawl_accounts(lower(username));

DROP INDEX IF EXISTS idx_images_published_reviewed;
CREATE INDEX IF NOT EXISTS idx_images_reviewed_published_id
  ON images(reviewed, published, id DESC);

PRAGMA optimize;
