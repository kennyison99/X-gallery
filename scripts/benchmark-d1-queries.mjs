import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildGalleryQuery, parseGalleryBatchParams } from '../src/lib/gallery-feed.ts';
import { encodeCursor, buildFilterKey } from '../src/lib/cursor.ts';
import { buildAdminPostsQuery, parseAdminPostsParams } from '../src/lib/admin-dashboard.ts';

const db = new DatabaseSync(':memory:');
const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
db.exec(schemaSql);

// Seed 1,000 images
const insertImage = db.prepare(`
  INSERT INTO images (
    id, title, r2_keys, author, author_display_name, author_url, post_url,
    description, likes, created_at, published, photo_bytes, video_bytes,
    photo_count, video_count, media_count_version
  ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, 1)
`);

const authors = ['artist_alice', 'creator_bob', 'animator_charlie', 'illustrator_diana', 'cosplay_eva'];
const tagPool = ['art', 'illustration', 'animation', 'sketch', '3d', 'cosplay', 'vlog', 'daily', 'digital', 'concept'];

const insertTag = db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)');
tagPool.forEach((t, i) => insertTag.run(i + 1, t));

const insertLink = db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)');

console.log('Seeding 1,000 test records...');
for (let i = 1; i <= 1000; i++) {
  const isVideo = i % 3 === 0;
  const isMixed = i % 7 === 0;
  const isPublished = i % 5 !== 0 ? 1 : 0;
  const author = authors[i % authors.length];
  const photoCount = isMixed ? 2 : (isVideo ? 0 : 1);
  const videoCount = isMixed ? 1 : (isVideo ? 1 : 0);
  const r2Keys = isMixed ? `p1_${i}.jpg,p2_${i}.jpg,v_${i}.mp4` : (isVideo ? `v_${i}.mp4` : `p_${i}.jpg`);
  const day = String((i % 28) + 1).padStart(2, '0');
  const hour = String(i % 24).padStart(2, '0');
  const min = String(i % 60).padStart(2, '0');
  const createdAt = `2026-07-${day} ${hour}:${min}:00`;

  insertImage.run(
    i,
    `Post #${i} ${author}`,
    r2Keys,
    author,
    `${author.toUpperCase()} Official`,
    `Description for post ${i} about ${tagPool[i % tagPool.length]}`,
    i * 10,
    createdAt,
    isPublished,
    photoCount * 500000,
    videoCount * 3000000,
    photoCount,
    videoCount
  );

  // Link 1-3 tags
  insertLink.run(i, (i % tagPool.length) + 1);
  if (i % 2 === 0) insertLink.run(i, ((i + 3) % tagPool.length) + 1);
  if (i % 3 === 0) insertLink.run(i, ((i + 7) % tagPool.length) + 1);
}

console.log('Seed complete. Running benchmark matrix...\n');

function runBenchmark(category, name, sql, bindings = []) {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings);
  const planSummary = plan.map(p => p.detail).join(' | ');

  const iterations = 50;
  const start = performance.now();
  let rowCount = 0;
  for (let i = 0; i < iterations; i++) {
    const rows = db.prepare(sql).all(...bindings);
    rowCount = rows.length;
  }
  const totalMs = performance.now() - start;
  const avgMs = (totalMs / iterations).toFixed(3);

  return {
    category,
    name,
    rowCount,
    avgMs: `${avgMs} ms`,
    plan: planSummary
  };
}

const results = [];

// --- Gallery Benchmarks ---
const galleryCases = [
  { name: 'Gallery: default newest', params: 'sort=newest&limit=24' },
  { name: 'Gallery: oldest', params: 'sort=oldest&limit=24' },
  { name: 'Gallery: offset', params: 'sort=newest&offset=48&limit=24' },
  { name: 'Gallery: author', params: 'sort=newest&author=artist_alice&limit=24' },
  { name: 'Gallery: tag', params: 'sort=newest&tag=art&limit=24' },
  { name: 'Gallery: photo', params: 'sort=newest&media=photo&limit=24' },
  { name: 'Gallery: video', params: 'sort=newest&media=video&limit=24' },
  { name: 'Gallery: tag + video', params: 'sort=newest&tag=animation&media=video&limit=24' },
];

for (const c of galleryCases) {
  const p = parseGalleryBatchParams(new URLSearchParams(c.params));
  const q = buildGalleryQuery(p);
  results.push(runBenchmark('Gallery', c.name, q.sql, q.bindings));
}

// Cursor case
const cursorFilterKey = buildFilterKey('gallery', {
  sort: 'newest',
  media: 'all',
  tag: null,
  author: null
});
const cursorStr = encodeCursor({
  v: 1,
  sort: 'newest',
  createdAt: '2026-07-20 12:00:00',
  id: 500,
  filterKey: cursorFilterKey
});
const cursorP = parseGalleryBatchParams(new URLSearchParams(`sort=newest&cursor=${cursorStr}&limit=24`));
const cursorQ = buildGalleryQuery(cursorP);
results.push(runBenchmark('Gallery', 'Gallery: cursor', cursorQ.sql, cursorQ.bindings));

// --- Admin Benchmarks ---
const adminCases = [
  { name: 'Admin: published', url: 'https://example.com/api/admin-posts?published=1&limit=10&offset=0', ready: true },
  { name: 'Admin: pending', url: 'https://example.com/api/admin-posts?published=0&limit=10&offset=0', ready: true },
  { name: 'Admin: search', url: 'https://example.com/api/admin-posts?published=1&search=alice&limit=10&offset=0', ready: true },
  { name: 'Admin: author', url: 'https://example.com/api/admin-posts?published=1&author=artist_alice&limit=10&offset=0', ready: true },
  { name: 'Admin: tag', url: 'https://example.com/api/admin-posts?published=1&tag=cosplay&limit=10&offset=0', ready: true },
  { name: 'Admin: photo (strict)', url: 'https://example.com/api/admin-posts?published=1&media=photo&limit=10&offset=0', ready: true },
  { name: 'Admin: video (contains)', url: 'https://example.com/api/admin-posts?published=1&media=video&limit=10&offset=0', ready: true },
  { name: 'Admin: search + video', url: 'https://example.com/api/admin-posts?published=1&search=alice&media=video&limit=10&offset=0', ready: true },
  { name: 'Admin: author + video', url: 'https://example.com/api/admin-posts?published=1&author=creator_bob&media=video&limit=10&offset=0', ready: true },
  { name: 'Admin: size_desc', url: 'https://example.com/api/admin-posts?published=1&sort=size_desc&limit=10&offset=0', ready: true },
  { name: 'Admin: size_asc', url: 'https://example.com/api/admin-posts?published=1&sort=size_asc&limit=10&offset=0', ready: true },
  { name: 'Admin: deep offset (page 50)', url: 'https://example.com/api/admin-posts?published=1&limit=10&offset=500', ready: true },
];

for (const c of adminCases) {
  const p = parseAdminPostsParams(new URL(c.url));
  const q = buildAdminPostsQuery(p, c.ready);
  results.push(runBenchmark('Admin', c.name, q.pageSql, q.pageBindings));
}

console.table(results.map(r => ({
  Test: r.name,
  Rows: r.rowCount,
  AvgLatency: r.avgMs,
  QueryPlan: r.plan.length > 80 ? r.plan.substring(0, 77) + '...' : r.plan
})));

db.close();
