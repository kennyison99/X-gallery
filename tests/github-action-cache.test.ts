import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/crawl-twitter.yml', import.meta.url),
  'utf8',
);

const stepBlock = (name: string) => {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.ok(start >= 0, `Missing step: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

test('keeps archive cache run-scoped but makes xtractor binary cache stable', () => {
  const archiveBlock = stepBlock('Cache xtractor dedup archive');
  const binaryBlock = stepBlock('Cache xtractor binary');

  assert.match(archiveBlock, /xtractor-archive-v1-\$\{\{ github\.run_id \}\}/);
  assert.match(archiveBlock, /github\.run_attempt/);
  assert.match(archiveBlock, /actions\/cache\/restore@v4/);
  const saveBlock = stepBlock('Save xtractor dedup archive');
  assert.match(saveBlock, /always\(\)/);
  assert.match(saveBlock, /actions\/cache\/save@v4/);
  assert.match(saveBlock, /github\.run_attempt/);
  assert.match(
    binaryBlock,
    /xtractor-bin-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ steps\.xtractor_version\.outputs\.version \}\}/,
  );
  assert.doesNotMatch(binaryBlock, /github\.run_id/);
});
