-- Migration: Add updated_at column to images and create crawl_accounts table
-- Run this on existing databases to add the new features

-- Add updated_at column to images table (if not exists)
ALTER TABLE images ADD COLUMN updated_at TEXT;

-- Create crawl_accounts table
CREATE TABLE IF NOT EXISTS crawl_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 1,
  last_crawled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
