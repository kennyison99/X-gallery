import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('admin index.astro includes media_counts_ready rollout gate check and O(1) table aggregation', () => {
  const adminIndexPath = path.resolve('src/pages/admin/index.astro');
  assert.ok(fs.existsSync(adminIndexPath));

  const content = fs.readFileSync(adminIndexPath, 'utf-8');
  assert.ok(content.includes('media_counts_ready'), 'Must check media_counts_ready in storage_stats');
  assert.ok(content.includes('SUM(photo_count)'), 'Must aggregate SUM(photo_count)');
  assert.ok(content.includes('SUM(video_count)'), 'Must aggregate SUM(video_count)');
});

test('admin-posts.ts uses NOCASE collation for author index matching and directory cache', () => {
  const adminPostsPath = path.resolve('src/pages/api/admin-posts.ts');
  assert.ok(fs.existsSync(adminPostsPath));

  const content = fs.readFileSync(adminPostsPath, 'utf-8');
  assert.ok(content.includes('COLLATE NOCASE'), 'Must use COLLATE NOCASE for author filter query');
  assert.ok(content.includes('getDirectoryData'), 'Must use getDirectoryData for tag sanitization');
});
