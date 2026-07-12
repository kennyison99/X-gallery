import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('base schema includes persisted photo and video byte columns', () => {
  const schema = read('../db/schema.sql');

  assert.match(schema, /photo_bytes INTEGER DEFAULT 0/);
  assert.match(schema, /video_bytes INTEGER DEFAULT 0/);
});

test('size backfill stays under the Cloudflare Access protected admin path', () => {
  const protectedEndpoint = new URL('../src/pages/admin/api/backfill-sizes.ts', import.meta.url);
  const publicEndpoint = new URL('../src/pages/api/admin/backfill-sizes.ts', import.meta.url);
  const overview = read('../src/components/admin/AdminOverview.astro');

  assert.equal(existsSync(protectedEndpoint), true);
  assert.equal(existsSync(publicEndpoint), false);
  assert.match(overview, /fetch\(['"]\/admin\/api\/backfill-sizes['"]/);
  assert.doesNotMatch(overview, /prompt\(['"]請輸入管理 API key/);
});

test('post edits validate before deleting existing R2 objects', () => {
  const source = read('../src/pages/api/images/[id].ts');
  const putSource = source.slice(source.indexOf('export const PUT'));
  const emptyGuard = putSource.indexOf('keptKeys.length === 0 && validFiles.length === 0');
  const capacityGuard = putSource.indexOf('wouldExceedStorage(netIncomingBytes)');
  const firstDelete = putSource.indexOf('env.BUCKET.delete(key)');

  assert.ok(emptyGuard >= 0, 'missing pre-mutation empty-post guard');
  assert.ok(capacityGuard >= 0, 'missing pre-mutation net capacity guard');
  assert.ok(firstDelete >= 0, 'missing old-object deletion');
  assert.ok(emptyGuard < firstDelete, 'empty-post validation must run before R2 deletion');
  assert.ok(capacityGuard < firstDelete, 'capacity validation must run before R2 deletion');
});
