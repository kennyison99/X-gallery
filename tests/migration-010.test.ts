import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('migration-010 includes required columns, index definitions, and timestamp canonicalization', () => {
  const migrationPath = path.resolve('db/migration-010-d1-row-read-optimization.sql');
  assert.ok(fs.existsSync(migrationPath), 'migration-010-d1-row-read-optimization.sql must exist');

  const content = fs.readFileSync(migrationPath, 'utf-8');

  // Verify new columns
  assert.ok(content.includes('photo_count INTEGER NOT NULL DEFAULT 0'), 'Must add photo_count column');
  assert.ok(content.includes('video_count INTEGER NOT NULL DEFAULT 0'), 'Must add video_count column');
  assert.ok(content.includes('media_count_version INTEGER NOT NULL DEFAULT 0'), 'Must add media_count_version column');
  assert.ok(content.includes('directory_version INTEGER NOT NULL DEFAULT 1'), 'Must add directory_version column');
  assert.ok(content.includes('media_counts_ready INTEGER NOT NULL DEFAULT 0'), 'Must add media_counts_ready column');

  // Verify timestamp canonicalization
  assert.ok(content.includes("UPDATE images SET created_at = COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), '1970-01-01 00:00:00')"), 'Must canonicalize timestamps');

  // Verify indexes
  assert.ok(content.includes('idx_images_pending_created_id'), 'Must create pending created_id index');
  assert.ok(content.includes('idx_images_published_author_nocase_created_id'), 'Must create published NOCASE index');
});
