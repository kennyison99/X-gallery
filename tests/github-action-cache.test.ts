import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/crawl-twitter.yml', import.meta.url),
  'utf8',
);

test('keeps archive cache run-scoped but makes xtractor binary cache stable', () => {
  const archiveBlock = workflow.slice(
    workflow.indexOf('- name: Cache xtractor dedup archive'),
    workflow.indexOf('- name: Set up Python 3.12'),
  );
  const binaryBlock = workflow.slice(
    workflow.indexOf('- name: Cache xtractor binary'),
    workflow.indexOf('- name: Install Pillow'),
  );

  assert.match(archiveBlock, /xtractor-archive-v1-\$\{\{ github\.run_id \}\}/);
  assert.match(
    binaryBlock,
    /xtractor-bin-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ steps\.xtractor_version\.outputs\.version \}\}/,
  );
  assert.doesNotMatch(binaryBlock, /github\.run_id/);
});
