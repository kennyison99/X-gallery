import fs from 'node:fs';
import { execSync } from 'node:child_process';

const data = JSON.parse(fs.readFileSync(new URL('./uncommitted-checkpoint-14.json', import.meta.url), 'utf-8'));
const { passedIds = [], flaggedIds = [] } = data;

console.log(`Applying uncommitted Checkpoint #14 to D1: ${passedIds.length} passed, ${flaggedIds.length} flagged...`);

if (flaggedIds.length > 0) {
  const sql = `UPDATE images SET published = 0, reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${flaggedIds.join(',')});`;
  execSync(`npx wrangler d1 execute gallery-db --remote --command="${sql}" --json`, { stdio: 'inherit' });
  console.log(`✓ Flagged ${flaggedIds.length} posts moved to review.`);
}

const chunkSize = 100;
for (let i = 0; i < passedIds.length; i += chunkSize) {
  const chunk = passedIds.slice(i, i + chunkSize);
  const sql = `UPDATE images SET reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${chunk.join(',')});`;
  execSync(`npx wrangler d1 execute gallery-db --remote --command="${sql}" --json`, { stdio: 'inherit' });
  console.log(`✓ Approved chunk ${i / chunkSize + 1} (${chunk.length} posts) marked reviewed = 1.`);
}

console.log('✅ Checkpoint #14 fully applied to D1!');
