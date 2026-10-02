import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { splitCrawlWork, archiveDelta, mergeCrawlArchives } from '../scripts/crawl-plan.mjs';

test('splits zero, one, and many accounts into at most two disjoint balanced shards', () => {
  for (let count = 0; count <= 9; count++) {
    const work = Array.from({ length: count }, (_, i) => ({ account: { username: `account${i}` } }));
    const shards = splitCrawlWork(work);
    assert.equal(shards.length, Math.min(2, count));
    assert.deepEqual(new Set(shards.flat()), new Set(work));
    assert.equal(shards.flat().length, count);
    if (count > 1) assert.ok(Math.abs(shards[0].length - shards[1].length) <= 1);
  }
});

test('merges partial progress and retries without overwriting another shard or regressing checkpoints', () => {
  const base = { existing: 1, __accounts: { alice: { latest: { postId: '10' } }, bob: { latest: { postId: '20' } } } };
  const alice = { ...base, a: 1, __accounts: { ...base.__accounts, alice: { latest: { postId: '11' } } } };
  const bob = { ...base, b: 1, __accounts: { ...base.__accounts, bob: { latest: { postId: '21' } } } };
  const retry = { ...base, retry: 1 }; // Failed before advancing any account checkpoint.
  const merged = mergeCrawlArchives(base, [
    archiveDelta(base, alice, ['Alice']),
    archiveDelta(base, bob, ['bob']),
    archiveDelta(base, retry, ['alice']),
  ]);
  assert.deepEqual(merged, { existing: 1, a: 1, b: 1, retry: 1, __accounts: {
    alice: { latest: { postId: '11' } }, bob: { latest: { postId: '21' } },
  } });
  assert.equal(base.__accounts.alice.latest.postId, '10');
});

test('keeps shared-media accounts together and historical work serial', () => {
  const entry = (username, ids) => ({ account: { username }, extracted: { media: ids.map((id) => ({ url: `https://pbs.twimg.com/media/${id}.jpg` })) } });
  const shared = [entry('alice', ['a']), entry('bob', ['b']), entry('carol', ['a', 'b'])];
  const unrelated = entry('dave', ['d']);
  const shards = splitCrawlWork([...shared, unrelated]);
  assert.deepEqual(shards, [shared, [unrelated]]);
  const history = { account: { username: 'history', crawl_all: true } };
  assert.deepEqual(splitCrawlWork([...shared, history]), [[...shared, history]]);
});

test('failed recovery removes stale archive markers and a successful retry restores them', () => {
  const base = { recovered: 1 };
  const failed = archiveDelta(base, { __recoveryTouched: ['recovered'] }, ['alice']);
  assert.equal(mergeCrawlArchives(base, [failed]).recovered, undefined);
  const succeeded = archiveDelta(base, { recovered: 1, __recoveryTouched: ['recovered'] }, ['alice']);
  assert.equal(mergeCrawlArchives(base, [failed, succeeded]).recovered, 1);
});

test('merge CLI saves available progress but fails when a shard snapshot is missing', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gallery-merge-'));
  try {
    mkdirSync(path.join(cwd, 'scripts/.crawl-results/crawl-archive-0-1'), { recursive: true });
    const plan = { archive: { existing: 1 }, shards: [[{ account: { username: 'alice' } }], [{ account: { username: 'bob' } }]] };
    writeFileSync(path.join(cwd, 'scripts/.crawl-plan.json'), JSON.stringify(plan));
    writeFileSync(path.join(cwd, 'scripts/.crawl-results/crawl-archive-0-1/.crawl-shard-archive.json'), JSON.stringify({ a: 1 }));
    const script = fileURLToPath(new URL('../scripts/crawl-plan.mjs', import.meta.url));
    const partial = spawnSync(process.execPath, [script, '--merge'], { cwd, encoding: 'utf8' });
    assert.ifError(partial.error);
    assert.equal(partial.status, 1, partial.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, 'scripts/.xtractor-archive.json'), 'utf8')), { existing: 1, a: 1, __accounts: {} });
    mkdirSync(path.join(cwd, 'scripts/.crawl-results/crawl-archive-1-2'));
    writeFileSync(path.join(cwd, 'scripts/.crawl-results/crawl-archive-1-2/.crawl-shard-archive.json'), JSON.stringify({ b: 1 }));
    const complete = spawnSync(process.execPath, [script, '--merge'], { cwd, encoding: 'utf8' });
    assert.ifError(complete.error);
    assert.equal(complete.status, 0, complete.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, 'scripts/.xtractor-archive.json'), 'utf8')), { existing: 1, a: 1, b: 1, __accounts: {} });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
