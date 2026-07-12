-- Migration: Add photo_bytes and video_bytes columns to images table
ALTER TABLE images ADD COLUMN photo_bytes INTEGER DEFAULT 0;
ALTER TABLE images ADD COLUMN video_bytes INTEGER DEFAULT 0;
