import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveAdminTab,
  normalizeAuthorHandle,
  formatAuthorName,
  authorSearchText,
  normalizeAuthorInput
} from '../src/lib/admin-dashboard.ts';

test('resolveAdminTab correctly maps hash values and defaults unknown hash to overview', () => {
  assert.equal(resolveAdminTab('#overview'), 'overview');
  assert.equal(resolveAdminTab('#posts'), 'posts');
  assert.equal(resolveAdminTab('#upload'), 'upload');
  assert.equal(resolveAdminTab('#crawler'), 'crawler');
  assert.equal(resolveAdminTab('#auto-tag'), 'auto-tag');
  assert.equal(resolveAdminTab('#unknown'), 'overview');
  assert.equal(resolveAdminTab(''), 'overview');
});

test('normalizeAuthorHandle and author formatting handle empty values and @ prefixes', () => {
  assert.equal(normalizeAuthorHandle('  @GenshinImpact  '), 'GenshinImpact');
  assert.equal(normalizeAuthorHandle('@@@honkaistarrail'), 'honkaistarrail');
  assert.equal(normalizeAuthorHandle(null), '');

  assert.equal(formatAuthorName('原神官方', '@GenshinImpact'), '原神官方@GenshinImpact');
  assert.equal(formatAuthorName('', 'GenshinImpact'), '@GenshinImpact');
  assert.equal(formatAuthorName('原神官方', ''), '原神官方');

  assert.equal(authorSearchText('原神官方', '@GenshinImpact'), '原神官方 genshinimpact');
  assert.deepEqual(normalizeAuthorInput(' @GenshinImpact ', ' 原神官方 '), {
    handle: 'GenshinImpact',
    displayName: '原神官方'
  });
});

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
  assert.ok(content.includes('data-post-status="pending"'), 'Must include pending shortcut listener target');
});

test('admin subcomponents retain element IDs, metadata inputs, crawler controls, and empty-state wording', () => {
  const postManagerPath = path.resolve('src/components/admin/AdminPostManager.astro');
  const uploadPanelPath = path.resolve('src/components/admin/AdminUploadPanel.astro');
  const crawlerPanelPath = path.resolve('src/components/admin/AdminCrawlerPanel.astro');
  
  assert.ok(fs.existsSync(postManagerPath));
  assert.ok(fs.existsSync(uploadPanelPath));
  assert.ok(fs.existsSync(crawlerPanelPath));

  const postManagerContent = fs.readFileSync(postManagerPath, 'utf-8');
  const uploadPanelContent = fs.readFileSync(uploadPanelPath, 'utf-8');
  const crawlerPanelContent = fs.readFileSync(crawlerPanelPath, 'utf-8');

  // Check PostManager IDs, empty-state wording, and selection toolbar buttons
  assert.ok(postManagerContent.includes('id="tab-published"'), 'Must include tab-published');
  assert.ok(postManagerContent.includes('id="tab-pending"'), 'Must include tab-pending');
  assert.ok(postManagerContent.includes('id="bulk-actions-bar"'), 'Must include bulk-actions-bar');
  assert.ok(postManagerContent.includes('id="select-all-checkbox"'), 'Must include select-all-checkbox');
  assert.ok(postManagerContent.includes('id="select-page-btn"'), 'Must include select-page-btn');
  assert.ok(postManagerContent.includes('id="clear-selection-btn"'), 'Must include clear-selection-btn');
  assert.ok(postManagerContent.includes('id="admin-empty-state"'), 'Must include admin-empty-state');
  assert.ok(postManagerContent.includes('資料庫目前無照片'), 'Must include empty state wording');

  // Check UploadPanel input fields
  assert.ok(uploadPanelContent.includes('name="author"'), 'Must include author input');
  assert.ok(uploadPanelContent.includes('name="author_display_name"'), 'Must include author_display_name input');
  assert.ok(uploadPanelContent.includes('name="author_url"'), 'Must include author_url input');
  assert.ok(uploadPanelContent.includes('name="post_url"'), 'Must include post_url input');

  // Check CrawlerPanel controls and canonical handles
  assert.ok(crawlerPanelContent.includes('id="crawl-username"'), 'Must include crawl-username');
  assert.ok(crawlerPanelContent.includes('id="add-crawl-btn"'), 'Must include add-crawl-btn');
  assert.ok(crawlerPanelContent.includes('id="crawl-accounts-list"'), 'Must include crawl-accounts-list');
});

test('admin overview includes media_counts_ready rollout gate check and consolidated table aggregations', () => {
  const adminIndexPath = path.resolve('src/pages/admin/index.astro');
  const directoryDataPath = path.resolve('src/lib/directory-data.ts');
  assert.ok(fs.existsSync(adminIndexPath));
  assert.ok(fs.existsSync(directoryDataPath));

  const adminContent = fs.readFileSync(adminIndexPath, 'utf-8');
  assert.ok(adminContent.includes('media_counts_ready'), 'Must check media_counts_ready in storage_stats');
  assert.ok(adminContent.includes('getAdminOverviewStats'), 'Must call getAdminOverviewStats in admin index.astro');

  const directoryContent = fs.readFileSync(directoryDataPath, 'utf-8');
  assert.ok(directoryContent.includes('SUM(photo_count)'), 'Must aggregate SUM(photo_count)');
  assert.ok(directoryContent.includes('SUM(video_count)'), 'Must aggregate SUM(video_count)');
  assert.ok(directoryContent.includes('SUM(photo_bytes)'), 'Must aggregate SUM(photo_bytes)');
  assert.ok(directoryContent.includes('SUM(video_bytes)'), 'Must aggregate SUM(video_bytes)');
});

test('admin-posts.ts uses NOCASE collation, renders drag select handles, and disables image dragging', () => {
  const adminPostsPath = path.resolve('src/pages/api/admin-posts.ts');
  assert.ok(fs.existsSync(adminPostsPath));

  const content = fs.readFileSync(adminPostsPath, 'utf-8');
  assert.ok(content.includes('COLLATE NOCASE'), 'Must use COLLATE NOCASE for author filter query');
  assert.ok(content.includes('getDirectoryData'), 'Must use getDirectoryData for tag sanitization');
  assert.ok(content.includes('data-drag-select-handle'), 'Must render data-drag-select-handle for touch drag selection');
  assert.ok(content.includes('draggable="false"'), 'Must set draggable="false" on thumbnail images');
});

test('admin index.astro client script contains complete Pointer Drag Engine wiring, primary button checks, and sync final frame computation', () => {
  const adminIndexPath = path.resolve('src/pages/admin/index.astro');
  assert.ok(fs.existsSync(adminIndexPath));

  const content = fs.readFileSync(adminIndexPath, 'utf-8');
  const scriptContent = content.split('<script>')[1] || '';

  // Verify selection helpers are imported inside client <script>, NOT frontmatter
  assert.ok(scriptContent.includes("from '../../lib/admin-selection'"), 'Must import admin-selection inside client <script>');
  assert.ok(scriptContent.includes('computePageSelectionState'), 'Client script must reference computePageSelectionState');
  assert.ok(scriptContent.includes('applySelectionMode'), 'Client script must reference applySelectionMode');
  assert.ok(scriptContent.includes('rectOverlap'), 'Client script must reference rectOverlap');
  assert.ok(scriptContent.includes('getSelectionRect'), 'Client script must reference getSelectionRect');

  // Verify Pointer Events engine handlers and capture
  assert.ok(scriptContent.includes("addEventListener('pointerdown'"), 'Must bind pointerdown listener');
  assert.ok(scriptContent.includes("addEventListener('pointermove'"), 'Must bind pointermove listener');
  assert.ok(scriptContent.includes("addEventListener('pointerup'"), 'Must bind pointerup listener');
  assert.ok(scriptContent.includes("addEventListener('pointercancel'"), 'Must bind pointercancel listener');
  assert.ok(scriptContent.includes("addEventListener('dragstart'"), 'Must bind dragstart listener to prevent native image drag');
  assert.ok(scriptContent.includes('setPointerCapture'), 'Must call setPointerCapture');
  assert.ok(scriptContent.includes('releasePointerCapture'), 'Must call releasePointerCapture');
  assert.ok(scriptContent.includes('requestAnimationFrame'), 'Must use requestAnimationFrame for RAF throttling');

  // Verify primary pointer checks and sync final frame calculation on pointerup
  assert.ok(scriptContent.includes('isPrimary'), 'Must verify e.isPrimary on pointerdown');
  assert.ok(scriptContent.includes('button !== 0'), 'Must verify e.button === 0 for mouse drag initiation');
  assert.ok(scriptContent.includes('processDragFrame(latestPointerX, latestPointerY)'), 'Must execute processDragFrame synchronously on pointerup');

  // Verify variables and cleanup definitions
  assert.ok(scriptContent.includes('let suppressNextClick'), 'Must declare suppressNextClick variable');
  assert.ok(scriptContent.includes('function resetDragUi()'), 'Must define resetDragUi function');
  assert.ok(scriptContent.includes("document.body.style.userSelect = ''"), 'resetDragUi must restore document.body.style.userSelect');
  assert.ok(scriptContent.includes('function cancelActiveDrag()'), 'Must define cancelActiveDrag function');
  assert.ok(scriptContent.includes('cancelActiveDrag();'), 'Must invoke cancelActiveDrag in view switch and loadPosts');
  assert.ok(scriptContent.includes('drag-select-box'), 'Must manage dynamic marquee drag-select-box');
});
