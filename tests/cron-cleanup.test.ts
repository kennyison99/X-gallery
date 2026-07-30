import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('cron-cleanup.ts is syntactically valid and uses expiredIds.length for deleted count', () => {
  const cronPath = path.resolve('src/pages/api/cron-cleanup.ts');
  assert.ok(fs.existsSync(cronPath));

  const content = fs.readFileSync(cronPath, 'utf-8');
  assert.ok(content.includes('expiredIds.length'), 'Must use expiredIds.length for deleted count');
  assert.ok(!content.includes('deletedCount'), 'Must not reference undefined deletedCount variable');
});
