import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('admin index.astro retains full component structure and subcomponents', () => {
  const adminIndexPath = path.resolve('src/pages/admin/index.astro');
  assert.ok(fs.existsSync(adminIndexPath));

  const content = fs.readFileSync(adminIndexPath, 'utf-8');
  // Check subcomponent imports and layout tags
  assert.ok(content.includes('<AdminDashboardTabs'), 'Must include AdminDashboardTabs component');
  assert.ok(content.includes('<AdminOverview'), 'Must include AdminOverview component');
  assert.ok(content.includes('<AdminUploadPanel'), 'Must include AdminUploadPanel component');
  assert.ok(content.includes('<AdminPostManager'), 'Must include AdminPostManager component');
  assert.ok(content.includes('<AdminAutoTagPanel'), 'Must include AdminAutoTagPanel component');
  assert.ok(content.includes('<AdminCrawlerPanel'), 'Must include AdminCrawlerPanel component');

  // Check tab navigation script attributes
  assert.ok(content.includes('data-admin-panel'), 'Must include data-admin-panel attribute for tabs');
  assert.ok(content.includes('data-admin-tab'), 'Must include data-admin-tab attribute for tabs');
});

test('admin index.astro includes media_counts_ready rollout gate check and table aggregations', () => {
  const adminIndexPath = path.resolve('src/pages/admin/index.astro');
  assert.ok(fs.existsSync(adminIndexPath));

  const content = fs.readFileSync(adminIndexPath, 'utf-8');
  assert.ok(content.includes('media_counts_ready'), 'Must check media_counts_ready in storage_stats');
  assert.ok(content.includes('SUM(photo_count)'), 'Must aggregate SUM(photo_count)');
  assert.ok(content.includes('SUM(video_count)'), 'Must aggregate SUM(video_count)');
  assert.ok(content.includes('fallbackPhotos'), 'Must accumulate fallbackPhotos in unbackfilled state');
  assert.ok(content.includes('fallbackVideos'), 'Must accumulate fallbackVideos in unbackfilled state');
});

test('admin-posts.ts uses NOCASE collation for author index matching and directory cache', () => {
  const adminPostsPath = path.resolve('src/pages/api/admin-posts.ts');
  assert.ok(fs.existsSync(adminPostsPath));

  const content = fs.readFileSync(adminPostsPath, 'utf-8');
  assert.ok(content.includes('COLLATE NOCASE'), 'Must use COLLATE NOCASE for author filter query');
  assert.ok(content.includes('getDirectoryData'), 'Must use getDirectoryData for tag sanitization');
});
