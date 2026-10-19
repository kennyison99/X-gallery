import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { normalizeAuthorHandle } from '../src/lib/admin-dashboard.ts';

test('Option A: key transformation strips author prefix when moving to account folder', () => {
  function getNewKey(key: string, author: string): string {
    if (key.includes('/')) return key;
    const cleanAuthor = normalizeAuthorHandle(author).replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
    const prefix = `${cleanAuthor}_`;
    const stripped = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    return `${cleanAuthor}/${stripped}`;
  }

  // Crawled image with author prefix
  assert.equal(
    getNewKey('foglantau_20260403_004421_2039866560538726683_01.jpg', 'foglantau'),
    'foglantau/20260403_004421_2039866560538726683_01.jpg'
  );

  // Author with leading @
  assert.equal(
    getNewKey('foglantau_20260403_01.jpg', '@foglantau'),
    'foglantau/20260403_01.jpg'
  );

  // Transcoded video with author prefix
  assert.equal(
    getNewKey('silva_siufabing_2093637112830808447_1.transcoded.mp4', 'silva_siufabing'),
    'silva_siufabing/2093637112830808447_1.transcoded.mp4'
  );

  // Web manual upload without author prefix
  assert.equal(
    getNewKey('1718700000000-photo.png', 'my_account'),
    'my_account/1718700000000-photo.png'
  );

  // Already migrated key in folder
  assert.equal(
    getNewKey('foglantau/20260403_01.jpg', 'foglantau'),
    'foglantau/20260403_01.jpg'
  );
});

test('Database migration updates both images.r2_keys and media_assets.r2_key', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE images (id INTEGER PRIMARY KEY, author TEXT, r2_keys TEXT);
    CREATE TABLE media_assets (id INTEGER PRIMARY KEY, image_id INTEGER, r2_key TEXT);
    CREATE TABLE storage_stats (id INTEGER PRIMARY KEY, directory_version INTEGER DEFAULT 1);
    INSERT INTO storage_stats (id, directory_version) VALUES (1, 1);
  `);

  const insertImage = db.prepare('INSERT INTO images (id, author, r2_keys) VALUES (?, ?, ?)');
  const insertMedia = db.prepare('INSERT INTO media_assets (id, image_id, r2_key) VALUES (?, ?, ?)');

  // Post 1: two crawled images
  insertImage.run(1, 'alice', 'alice_01.jpg,alice_02.jpg');
  insertMedia.run(1, 1, 'alice_01.jpg');
  insertMedia.run(2, 1, 'alice_02.jpg');

  // Post 2: already migrated
  insertImage.run(2, 'bob', 'bob/01.jpg');
  insertMedia.run(3, 2, 'bob/01.jpg');

  // Simulate migration logic
  const rows = db.prepare('SELECT id, author, r2_keys FROM images ORDER BY id ASC').all() as any[];
  for (const row of rows) {
    const cleanAuthor = normalizeAuthorHandle(row.author).replace(/[^a-zA-Z0-9_-]/g, '_');
    const oldKeys = row.r2_keys.split(',').map((k: string) => k.trim()).filter(Boolean);
    const newKeys = [];

    for (const key of oldKeys) {
      if (key.includes('/')) {
        newKeys.push(key);
        continue;
      }
      const prefix = `${cleanAuthor}_`;
      const stripped = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      const targetKey = `${cleanAuthor}/${stripped}`;

      db.prepare('UPDATE media_assets SET r2_key = ? WHERE r2_key = ?').run(targetKey, key);
      newKeys.push(targetKey);
    }

    if (newKeys.join(',') !== row.r2_keys) {
      db.prepare('UPDATE images SET r2_keys = ? WHERE id = ?').run(newKeys.join(','), row.id);
    }
  }

  // Verify Post 1
  const updated1 = db.prepare('SELECT r2_keys FROM images WHERE id = 1').get() as any;
  assert.equal(updated1.r2_keys, 'alice/01.jpg,alice/02.jpg');

  const media1 = db.prepare('SELECT r2_key FROM media_assets WHERE image_id = 1').all() as any[];
  assert.deepEqual(media1.map((m: any) => m.r2_key), ['alice/01.jpg', 'alice/02.jpg']);

  // Verify Post 2 untouched
  const updated2 = db.prepare('SELECT r2_keys FROM images WHERE id = 2').get() as any;
  assert.equal(updated2.r2_keys, 'bob/01.jpg');

  const media2 = db.prepare('SELECT r2_key FROM media_assets WHERE image_id = 2').all() as any[];
  assert.deepEqual(media2.map((m: any) => m.r2_key), ['bob/01.jpg']);
});
