import assert from 'node:assert/strict';
import test from 'node:test';

const backfillModule = await import('../src/lib/auto-tag-backfill.ts').catch(() => ({}));
const batchModule = await import('../src/lib/batches.ts').catch(() => ({}));

const createAutoTagBatch = backfillModule.createAutoTagBatch ?? (() => ({ tagNames: [], links: [] }));
const normalizeAutoTagBatchInput = backfillModule.normalizeAutoTagBatchInput ?? (() => ({}));
const chunkItems = batchModule.chunkItems ?? (() => []);
const runSequentialBatches = batchModule.runSequentialBatches ?? (async () => 0);

test('creates unique auto-tag assignments for an image batch', () => {
  assert.deepEqual(
    createAutoTagBatch([
      { id: 3, author: 'Alice', description: '黑丝写真' },
      { id: 8, author: 'Bob', description: null }
    ]),
    {
      tagNames: ['黑絲', '絲襪', '寫真'],
      links: [
        { imageId: 3, tagName: '黑絲' },
        { imageId: 3, tagName: '絲襪' },
        { imageId: 3, tagName: '寫真' }
      ]
    }
  );
});

test('normalizes auto-tag cursor and clamps batch size', () => {
  assert.deepEqual(normalizeAutoTagBatchInput({ cursor: -10, limit: 500 }), { cursor: 0, limit: 50 });
  assert.deepEqual(normalizeAutoTagBatchInput({ cursor: 25, limit: 20 }), { cursor: 25, limit: 20 });
});

test('chunks bulk delete IDs into groups of fifty', () => {
  const ids = Array.from({ length: 105 }, (_, index) => index + 1);
  assert.deepEqual(chunkItems(ids, 50).map((chunk: number[]) => chunk.length), [50, 50, 5]);
});

test('reports only confirmed batches and stops after a failure', async () => {
  const confirmed: number[] = [];
  let calls = 0;

  await assert.rejects(
    runSequentialBatches(
      [1, 2, 3, 4, 5],
      2,
      async (batch: number[]) => {
        calls++;
        if (calls === 2) throw new Error('network failure');
        return batch.length;
      },
      (completed: number) => confirmed.push(completed)
    ),
    /network failure/
  );

  assert.equal(calls, 2);
  assert.deepEqual(confirmed, [2]);
});
