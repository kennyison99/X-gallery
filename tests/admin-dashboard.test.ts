import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  authorSearchText,
  formatAuthorName,
  normalizeAuthorHandle,
  normalizeAuthorInput,
  resolveAdminTab,
} from '../src/lib/admin-dashboard.ts';

test('normalizes whitespace and every leading at sign', () => {
  assert.equal(normalizeAuthorHandle('  @@elysia2kawaii  '), 'elysia2kawaii');
});

test('formats nick and handle without duplicate at signs', () => {
  assert.equal(formatAuthorName('笨蛋愛麗絲', '@ailisidabendan'), '笨蛋愛麗絲@ailisidabendan');
  assert.equal(formatAuthorName('', '@@ailisidabendan'), '@ailisidabendan');
});

test('builds searchable text from nick and handle', () => {
  assert.equal(authorSearchText('笨蛋愛麗絲', '@ailisidabendan'), '笨蛋愛麗絲 ailisidabendan');
});

test('resolves supported hashes and defaults invalid hashes to overview', () => {
  assert.equal(resolveAdminTab('#posts'), 'posts');
  assert.equal(resolveAdminTab('upload'), 'upload');
  assert.equal(resolveAdminTab(''), 'overview');
  assert.equal(resolveAdminTab('#unknown'), 'overview');
});

test('normalizes author form fields at API boundaries', () => {
  assert.deepEqual(normalizeAuthorInput(' @@ailisidabendan ', ' 笨蛋愛麗絲 '), {
    handle: 'ailisidabendan',
    displayName: '笨蛋愛麗絲',
  });
  assert.deepEqual(normalizeAuthorInput('@@', 'Alice'), {
    handle: '',
    displayName: 'Alice',
  });
});

test('crawler uploads use the canonical handle after normalization', () => {
  const source = readFileSync(
    new URL('../src/pages/api/crawl-upload.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /generateAutoTags\(authorInput\.handle, description\)/);
  assert.match(source, /`@\$\{authorInput\.handle\} 推文`/);
  assert.doesNotMatch(source, /@\$\{author\}/);
});

test('admin navigation exposes all accessible hash tabs', () => {
  const source = readFileSync(
    new URL('../src/components/admin/AdminDashboardTabs.astro', import.meta.url),
    'utf8',
  );
  for (const tab of ['overview', 'posts', 'upload', 'crawler', 'auto-tag']) {
    assert.match(source, new RegExp(`\\['${tab}',`));
  }
  assert.match(source, /href=\{`#\$\{id\}`\}/);
  assert.match(source, /aria-controls=\{`panel-\$\{id\}`\}/);
});

test('admin dashboard panels keep their existing control anchors', () => {
  const panels = [
    ['AdminOverview.astro', 'overview', 'storage-panel'],
    ['AdminPostManager.astro', 'posts', 'author-filter'],
    ['AdminUploadPanel.astro', 'upload', 'upload-form'],
    ['AdminCrawlerPanel.astro', 'crawler', 'crawl-accounts-list'],
    ['AdminAutoTagPanel.astro', 'auto-tag', 'auto-tag-btn'],
  ] as const;

  for (const [file, tab, controlId] of panels) {
    const source = readFileSync(
      new URL(`../src/components/admin/${file}`, import.meta.url),
      'utf8',
    );
    assert.match(source, new RegExp(`data-admin-panel=["']${tab}["']`));
    assert.match(source, new RegExp(`id=["']${controlId}["']`));
  }
});

test('admin post controls expose nick and canonical author metadata', () => {
  const uploadSource = readFileSync(
    new URL('../src/components/admin/AdminUploadPanel.astro', import.meta.url),
    'utf8',
  );
  const postsSource = readFileSync(
    new URL('../src/pages/api/admin-posts.ts', import.meta.url),
    'utf8',
  );

  assert.match(uploadSource, /name="author_display_name"/);
  assert.match(postsSource, /formatAuthorName\(image\.author_display_name, image\.author\)/);
  assert.match(postsSource, /data-author-display-name="\$\{escapeAttr\(image\.author_display_name \|\| ''\)\}"/);
  assert.match(postsSource, /data-author-search="\$\{escapeAttr\(authorSearch\)\}"/);
});

test('admin dashboard uses a shared responsive stylesheet', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/admin/index.astro', import.meta.url),
    'utf8',
  );
  const styleSource = readFileSync(
    new URL('../src/styles/admin.css', import.meta.url),
    'utf8',
  );

  assert.match(pageSource, /import ['"]\.\.\/\.\.\/styles\/admin\.css['"]/);
  assert.doesNotMatch(pageSource, /<style>/);
  assert.match(styleSource, /\.dashboard-tabs/);
  assert.match(styleSource, /\.overview-grid/);
  assert.match(styleSource, /\.dashboard-panel\[hidden\]/);
  assert.match(styleSource, /prefers-reduced-motion/);
});

test('overview pending shortcut opens the pending post state', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/admin/index.astro', import.meta.url),
    'utf8',
  );
  const overviewSource = readFileSync(
    new URL('../src/components/admin/AdminOverview.astro', import.meta.url),
    'utf8',
  );
  assert.match(overviewSource, /data-post-status="pending"/);
  assert.match(pageSource, /getElementById\('tab-pending'\)\?\.click\(\)/);
});

test('extracted admin panels do not duplicate static control IDs', () => {
  const files = [
    'AdminDashboardTabs.astro',
    'AdminOverview.astro',
    'AdminPostManager.astro',
    'AdminUploadPanel.astro',
    'AdminCrawlerPanel.astro',
    'AdminAutoTagPanel.astro',
  ];
  const seen = new Set<string>();

  for (const file of files) {
    const source = readFileSync(new URL(`../src/components/admin/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\bid="([^"]+)"/g)) {
      assert.equal(seen.has(match[1]), false, `duplicate static id: ${match[1]}`);
      seen.add(match[1]);
    }
  }
});

test('empty post state points to the upload tab instead of a removed left column', () => {
  const source = readFileSync(
    new URL('../src/components/admin/AdminPostManager.astro', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /左側上傳/);
  assert.match(source, /新增貼文分頁上傳/);
});
