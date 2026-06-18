-- Migration: Add crawl_all column to crawl_accounts table
-- Run this on existing databases to support individual account crawl range setting

ALTER TABLE crawl_accounts ADD COLUMN crawl_all INTEGER DEFAULT 0;
