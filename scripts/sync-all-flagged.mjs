import fs from 'node:fs';
import { execSync } from 'node:child_process';

const files = [
  'C:/Users/wtw0212/.gemini/antigravity/brain/51d7631a-a3ad-43f2-a334-66b7c453ef1e/.system_generated/tasks/task-1880.log',
  'C:/Users/wtw0212/.gemini/antigravity/brain/51d7631a-a3ad-43f2-a334-66b7c453ef1e/.system_generated/tasks/task-1969.log',
  'C:/Users/wtw0212/.gemini/antigravity/brain/51d7631a-a3ad-43f2-a334-66b7c453ef1e/.system_generated/tasks/task-2038.log',
];

const allFlagged = new Set();

for (const f of files) {
  if (fs.existsSync(f)) {
    const text = fs.readFileSync(f, 'utf-8');
    const matches = text.matchAll(/✗\s*\[ID:\s*(\d+)\]/g);
    for (const m of matches) {
      allFlagged.add(parseInt(m[1], 10));
    }
  }
}

const flaggedList = [...allFlagged].sort((a, b) => a - b);
console.log(`Found ${flaggedList.length} total unique flagged non-real posts across all scan runs.`);

// Update them in chunks of 100
const chunkSize = 100;
let totalUpdated = 0;

for (let i = 0; i < flaggedList.length; i += chunkSize) {
  const chunk = flaggedList.slice(i, i + chunkSize);
  const sql = `UPDATE images SET published = 0, reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${chunk.join(',')}); UPDATE storage_stats SET directory_version = directory_version + 1;`;
  execSync(`npx wrangler d1 execute gallery-db --remote --command="${sql}" --json`, { stdio: 'inherit' });
  totalUpdated += chunk.length;
  console.log(`✓ Processed chunk ${i / chunkSize + 1} (${chunk.length} items)...`);
}

console.log(`✅ All ${totalUpdated} flagged posts are now confirmed published = 0, reviewed = 1 in D1!`);
