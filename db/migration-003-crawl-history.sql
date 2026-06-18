-- Migration: Add crawl history columns to crawl_accounts table
-- Records the last crawl run metadata per account for admin display.

ALTER TABLE crawl_accounts ADD COLUMN last_crawl_type TEXT;
ALTER TABLE crawl_accounts ADD COLUMN last_crawl_mode TEXT;
ALTER TABLE crawl_accounts ADD COLUMN last_crawl_count INTEGER DEFAULT 0;
