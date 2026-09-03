import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { chunkItems, runSequentialBatches } from '../src/lib/batches.ts';

test('AdminPostManager includes bulk-approve UI elements with proper IDs and initial display', () => {
  const postManagerPath = path.resolve('src/components/admin/AdminPostManager.astro');
  assert.ok(fs.existsSync(postManagerPath), 'AdminPostManager.astro must exist');

  const content = fs.readFileSync(postManagerPath, 'utf-8');

  // Verify bulk approve button and progress bar exist
  assert.ok(content.includes('id="bulk-approve-btn"'), 'Must include id="bulk-approve-btn"');
  assert.ok(content.includes('id="bulk-approve-progress"'), 'Must include id="bulk-approve-progress"');
  assert.ok(content.includes('id="bulk-approve-progress-bar"'), 'Must include id="bulk-approve-progress-bar"');
  assert.ok(content.includes('id="bulk-approve-progress-text"'), 'Must include id="bulk-approve-progress-text"');

  // Verify button defaults to hidden until pending/review tab is selected
  assert.ok(content.includes('style="font-size: 0.8rem; padding: 0.3rem 0.75rem; display: none;"'), 'bulk-approve-btn must start with display: none');
  assert.ok(content.includes('核准所選'), 'Must have button text "核准所選"');
});

test('admin index.astro handles bulk approve, tab state persistence, and button visibility', () => {
  const adminIndexPath = path.resolve('src/pages/admin/index.astro');
  assert.ok(fs.existsSync(adminIndexPath), 'index.astro must exist');

  const content = fs.readFileSync(adminIndexPath, 'utf-8');

  // Bindings and event listeners
  assert.ok(content.includes("document.getElementById('bulk-approve-btn')"), 'Must bind bulk-approve-btn element');
  assert.ok(content.includes("document.getElementById('bulk-approve-progress')"), 'Must bind bulk-approve-progress');
  assert.ok(content.includes('/api/admin/bulk-approve'), 'Must call /api/admin/bulk-approve endpoint');

  // Session storage persistence for review/pending subtab
  assert.ok(content.includes("sessionStorage.setItem('admin-post-tab'"), 'Must save active post tab to sessionStorage');
  assert.ok(content.includes("sessionStorage.getItem('admin-post-tab')"), 'Must restore active post tab from sessionStorage');

  // Visibility toggle in switchTab
  assert.ok(content.includes("activeTab === 'pending' ? 'inline-block' : 'none'"), 'Must toggle bulkApproveBtn display based on pending tab');
});

test('bulk approve API endpoint file exists and utilizes conditional bump and D1 batch', () => {
  const bulkApprovePath = path.resolve('src/pages/api/admin/bulk-approve.ts');
  assert.ok(fs.existsSync(bulkApprovePath), 'bulk-approve.ts API file must exist');

  const content = fs.readFileSync(bulkApprovePath, 'utf-8');
  assert.ok(content.includes('createConditionalBumpDirectoryVersionStmt'), 'Must import and use createConditionalBumpDirectoryVersionStmt');
  assert.ok(content.includes('UPDATE images SET published = 1, reviewed = 1'), 'Must update published and reviewed columns');
  assert.ok(content.includes('env.DB.batch'), 'Must use atomic D1 batch execution');
});

test('chunkItems splits large ID list into batches of 50 for bulk approve', () => {
  const ids = Array.from({ length: 125 }, (_, i) => i + 1);
  const chunks = chunkItems(ids, 50);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 50);
  assert.equal(chunks[1].length, 50);
  assert.equal(chunks[2].length, 25);
  assert.deepEqual(chunks[0].slice(0, 3), [1, 2, 3]);
  assert.deepEqual(chunks[2].slice(-1), [125]);
});

test('runSequentialBatches reports sequential progress during batch approve simulation', async () => {
  const progressReports: { completed: number; total: number }[] = [];
  const testIds = [10, 20, 30, 40, 50, 60, 70];

  const total = await runSequentialBatches(
    testIds,
    3,
    async (batch) => batch.length,
    (completed, total) => progressReports.push({ completed, total })
  );

  assert.equal(total, 7);
  assert.deepEqual(progressReports, [
    { completed: 3, total: 7 },
    { completed: 6, total: 7 },
    { completed: 7, total: 7 },
  ]);
});
