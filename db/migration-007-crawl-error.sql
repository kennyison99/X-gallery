-- Migration: Store the latest per-account crawl error for admin visibility
ALTER TABLE crawl_accounts ADD COLUMN last_crawl_error TEXT;
