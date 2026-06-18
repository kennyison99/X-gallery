-- Migration: Add author_display_name to images table
-- Stores the Twitter display name (nick) so cards can show "By: nick@handle"
-- instead of just "@handle".

ALTER TABLE images ADD COLUMN author_display_name TEXT;
