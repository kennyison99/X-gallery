import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('cron-cleanup and fix-links endpoints bound query sizes', () => {
  const cronPath = path.resolve('src/pages/api/cron-cleanup.ts');
  const fixLinksPath = path.resolve('src/pages/api/fix-links.ts');

  assert.ok(fs.existsSync(cronPath));
  assert.ok(fs.existsSync(fixLinksPath));

  const cronContent = fs.readFileSync(cronPath, 'utf-8');
  assert.ok(cronContent.includes('published = 0'), 'Must filter published = 0 in cleanup');
  assert.ok(cronContent.includes('LIMIT 100'), 'Must bound pending deletion and tag cleanup with LIMIT 100');

  const fixLinksContent = fs.readFileSync(fixLinksPath, 'utf-8');
  assert.ok(fixLinksContent.includes('LIMIT ?'), 'Must bound fix-links GET with query limit');
});
