export function chunkItems<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Batch size must be a positive integer');
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function runSequentialBatches<T>(
  items: T[],
  size: number,
  runBatch: (batch: T[]) => Promise<number>,
  onProgress: (completed: number, total: number) => void
): Promise<number> {
  let completed = 0;

  for (const batch of chunkItems(items, size)) {
    completed += await runBatch(batch);
    onProgress(completed, items.length);
  }

  return completed;
}
