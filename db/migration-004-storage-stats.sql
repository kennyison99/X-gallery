-- Migration: Add storage_stats table for R2 capacity tracking
-- Maintains a running total of bytes stored in the R2 bucket so the admin
-- UI can display used / 10GB. Incremented on upload, decremented on delete.

CREATE TABLE IF NOT EXISTS storage_stats (
  id INTEGER PRIMARY KEY,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO storage_stats (id, total_bytes) VALUES (1, 0);
