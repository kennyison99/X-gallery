import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeMediaItems } from '../scripts/media-items.mjs';

test('removes duplicate media returned for the same tweet', () => {
  const duplicateUrl = 'https://video.twimg.com/ext_tw_video/177/test/video.mp4?tag=12';
  const items = [
    { tweet_id: '177', url: duplicateUrl, type: 'video' },
    { tweet_id: '177', url: duplicateUrl, type: 'video' },
  ];

  assert.deepEqual(dedupeMediaItems(items), [items[0]]);
});

test('preserves distinct media within one tweet', () => {
  const items = [
    { tweet_id: '177', url: 'https://pbs.twimg.com/media/first.jpg', type: 'photo' },
    { tweet_id: '177', url: 'https://pbs.twimg.com/media/second.jpg', type: 'photo' },
  ];

  assert.deepEqual(dedupeMediaItems(items), items);
});

test('preserves the same media identity when it belongs to different tweets', () => {
  const url = 'https://video.twimg.com/ext_tw_video/177/test/video.mp4';
  const items = [
    { tweet_id: '177', url, type: 'video' },
    { tweet_id: '188', url, type: 'video' },
  ];

  assert.deepEqual(dedupeMediaItems(items), items);
});

test('crawler script delegates video conversion to video-transcoder module', async () => {
  const fs = await import('node:fs');
  const crawlerScript = fs.readFileSync('scripts/crawl-twitter.mjs', 'utf8');

  assert.match(crawlerScript, /import\s*\{[^}]*transcodeVideoFile[^}]*\}\s*from\s*["']\.\/video-transcoder\.mjs["']/);
  assert.match(crawlerScript, /await transcodeVideoFile\(mediaPath\)/);
});

test('crawl-upload uses instr instead of LIKE to avoid SQLite 50-byte pattern limit', async () => {
  const fs = await import('node:fs');
  const uploadApiSource = fs.readFileSync('src/pages/api/crawl-upload.ts', 'utf8');

  assert.match(uploadApiSource, /instr\(\s*r2_keys\s*,\s*\?\s*\)\s*>\s*0/);
  assert.doesNotMatch(uploadApiSource, /r2_keys\s+LIKE\s+\?/i);
});

test('SQLite instr correctly matches r2_keys exceeding 50 bytes', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE images (id INTEGER PRIMARY KEY, author TEXT, r2_keys TEXT);');

  const author = 'silva_siufabing';
  const longKey = 'silva_siufabing_2093637112830808447_1.transcoded.mp4'; // 52 characters

  const insert = db.prepare('INSERT INTO images (id, author, r2_keys) VALUES (?, ?, ?)');
  insert.run(1, author, longKey);

  const query = db.prepare('SELECT id FROM images WHERE author = ? AND instr(r2_keys, ?) > 0');
  const found = query.get(author, longKey) as { id: number } | undefined;
  assert.equal(found?.id, 1);

  const notFound = query.get(author, 'silva_siufabing_9999999999999999999_1.transcoded.mp4');
  assert.equal(notFound, undefined);
});


