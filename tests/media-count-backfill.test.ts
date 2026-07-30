import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('media-count-backfill endpoint and CLI script files exist', () => {
  const endpointPath = path.resolve('src/pages/api/admin/media-count-backfill.ts');
  const cliPath = path.resolve('scripts/backfill-media-counts.mjs');

  assert.ok(fs.existsSync(endpointPath), 'src/pages/api/admin/media-count-backfill.ts must exist');
  assert.ok(fs.existsSync(cliPath), 'scripts/backfill-media-counts.mjs must exist');

  const content = fs.readFileSync(endpointPath, 'utf-8');
  assert.ok(content.includes('media_count_version = 0'), 'Must use optimistic guard WHERE media_count_version = 0');
  assert.ok(content.includes('media_counts_ready = 1'), 'Must update media_counts_ready = 1 upon completion');
  assert.ok(content.includes('X-API-Key'), 'Must authenticate via X-API-Key header');
});
