import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildGalleryQuery, parseGalleryBatchParams } from '../src/lib/gallery-feed.ts';
import { buildAdminPostsQuery, parseAdminPostsParams } from '../src/lib/admin-dashboard.ts';

describe('D1 Row-Read & Query Optimization Suite', () => {
  it('Gallery Query: CTE selects only i.id and outer query joins images for GalleryRow fields', () => {
    const params = parseGalleryBatchParams(new URLSearchParams('sort=newest&limit=24'));
    const query = buildGalleryQuery(params);

    // CTE should only select i.id
    assert.match(query.sql, /WITH page_images AS\s*\(\s*SELECT i\.id\s+FROM images i/i);
    assert.doesNotMatch(query.sql, /WITH page_images AS\s*\(\s*SELECT i\.\*/i);
    assert.match(
      query.sql,
      /FROM images i INDEXED BY idx_images_published_created/i,
      'unfiltered gallery feed must pin the order-compatible index',
    );

    // Outer query joins images table on p.id = i.id
    assert.match(query.sql, /FROM page_images p\s+JOIN images i ON p\.id = i\.id/i);

    // Explicitly selects required GalleryRow fields
    assert.match(query.sql, /i\.id,\s*i\.title,\s*i\.r2_keys,\s*i\.author,\s*i\.author_display_name/i);
    assert.match(query.sql, /group_concat\(t\.name\) AS tags_list/i);
  });

  it('Admin Posts API: implements page-first CTE and fixes media filter OR precedence', () => {
    // 1. Direct query builder testing with mediaCountsReady = true
    const photoParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&media=photo&limit=10'));
    const photoQuery = buildAdminPostsQuery(photoParams, true);

    assert.match(photoQuery.pageSql, /WITH page AS\s*\(\s*SELECT i\.id\s+FROM images i\s+WHERE/i);
    assert.match(photoQuery.pageSql, /FROM page p\s+JOIN images i ON p\.id = i\.id/i);
    assert.match(photoQuery.where, /i\.photo_count > 0 AND i\.video_count = 0/);

    const defaultParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&sort=newest&limit=10'));
    const defaultQuery = buildAdminPostsQuery(defaultParams, true);
    assert.match(
      defaultQuery.pageSql,
      /FROM images i INDEXED BY idx_images_published_created/i,
      'default admin page must pin the order-compatible index',
    );

    const videoParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&media=video&limit=10'));
    const videoQuery = buildAdminPostsQuery(videoParams, true);
    assert.match(videoQuery.where, /i\.video_count > 0/);

    // 2. Direct query builder testing with mediaCountsReady = false (fallback path with OR precedence fix)
    const fallbackVideoParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&media=video&limit=10'));
    const fallbackVideoQuery = buildAdminPostsQuery(fallbackVideoParams, false);
    assert.match(fallbackVideoQuery.where, /\(i\.r2_keys LIKE '%\.mp4%'\s+OR\s+i\.r2_keys LIKE '%\.webm%'/);
  });

  it('Upload & Edit Tag Batching: uses uniqueTags with json_each and D1.batch()', () => {
    const uploadSource = readFileSync(new URL('../src/pages/api/images.ts', import.meta.url), 'utf8');
    const editSource = readFileSync(new URL('../src/pages/api/images/[id].ts', import.meta.url), 'utf8');

    // Upload path
    assert.match(uploadSource, /const uniqueTags = \[\.\.\.new Set\(tags\)\];/);
    assert.match(uploadSource, /INSERT OR IGNORE INTO tags\(name\) SELECT value FROM json_each\(\?\)/);
    assert.match(uploadSource, /INSERT OR IGNORE INTO image_tags\(image_id, tag_id\)/);
    assert.match(uploadSource, /await env\.DB\.batch\(batchStmts\)/);

    // Edit path
    assert.match(editSource, /const uniqueTags = \[\.\.\.new Set\(tags\)\];/);
    assert.match(editSource, /DELETE FROM image_tags WHERE image_id = \?/);
    assert.match(editSource, /INSERT OR IGNORE INTO tags\(name\) SELECT value FROM json_each\(\?\)/);
    assert.match(editSource, /INSERT OR IGNORE INTO image_tags\(image_id, tag_id\)/);
    assert.match(editSource, /await env\.DB\.batch\(batchStmts\)/);
  });

  it('In-Memory SQLite Execution & Query Plan Matrix', () => {
    const db = new DatabaseSync(':memory:');
    const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
    db.exec(schemaSql);

    // Seed test data
    const insertImageStmt = db.prepare(`
      INSERT INTO images (
        id, title, r2_keys, author, author_display_name, author_url, post_url,
        description, likes, created_at, published, photo_bytes, video_bytes,
        photo_count, video_count, media_count_version
      ) VALUES (?, ?, ?, ?, ?, '', '', ?, 0, ?, ?, ?, ?, ?, ?, 1)
    `);

    // Insert 50 images with diverse attributes
    for (let i = 1; i <= 50; i++) {
      const isVideo = i % 3 === 0;
      const isMixed = i % 5 === 0;
      const isPublished = i % 4 !== 0 ? 1 : 0;
      const author = i % 2 === 0 ? 'artist_alice' : 'creator_bob';
      const r2Keys = isMixed
        ? `img_${i}_1.jpg,video_${i}.mp4`
        : (isVideo ? `video_${i}.mp4` : `img_${i}.jpg`);
      const photoCount = isMixed ? 1 : (isVideo ? 0 : 1);
      const videoCount = isMixed ? 1 : (isVideo ? 1 : 0);
      const createdAt = `2026-08-${String(i).padStart(2, '0')} 12:00:00`;

      insertImageStmt.run(
        i,
        `Post #${i}`,
        r2Keys,
        author,
        author.toUpperCase(),
        `Description for post ${i} with special keywords`,
        createdAt,
        isPublished,
        photoCount * 500000,
        videoCount * 2000000,
        photoCount,
        videoCount
      );
    }

    // Insert tags and links
    const tags = ['art', 'illustration', 'animation', 'sketch', '3d'];
    const insertTagStmt = db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)');
    tags.forEach((t, idx) => insertTagStmt.run(idx + 1, t));

    const insertLinkStmt = db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)');
    for (let i = 1; i <= 50; i++) {
      insertLinkStmt.run(i, (i % tags.length) + 1);
      if (i % 2 === 0) insertLinkStmt.run(i, ((i + 1) % tags.length) + 1);
    }

    // Reproduce production schema drift: existing indexes had statistics, while this
    // newer index did not, and it started hijacking published-only feed queries.
    db.exec('ANALYZE');
    db.exec('CREATE INDEX idx_images_published_reviewed ON images(published, reviewed, id DESC)');

    // 1. Test Gallery Query execution on SQLite
    const galleryParams = parseGalleryBatchParams(new URLSearchParams('sort=newest&limit=10'));
    const galleryQ = buildGalleryQuery(galleryParams);
    const galleryRows = db.prepare(galleryQ.sql).all(...galleryQ.bindings) as any[];

    assert.equal(galleryRows.length, 11); // limit + 1
    assert.ok(galleryRows[0].id > galleryRows[1].id); // DESC order
    assert.ok(galleryRows[0].tags_list !== undefined); // tags aggregated

    // 2. EXPLAIN QUERY PLAN verification for Gallery
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${galleryQ.sql}`).all(...galleryQ.bindings) as any[];
    const planDetails = plan.map(p => p.detail).join('; ');
    assert.ok(planDetails.includes('idx_images_published_created'), 'Gallery query plan should use idx_images_published_created');

    // 3. Test Tag Filter Gallery Query
    const tagParams = parseGalleryBatchParams(new URLSearchParams('tag=art&limit=10'));
    const tagQ = buildGalleryQuery(tagParams);
    const tagRows = db.prepare(tagQ.sql).all(...tagQ.bindings) as any[];
    assert.ok(tagRows.length > 0);
    assert.ok(tagRows.every(r => r.tags_list.includes('art')));

    // 4. Test Media Filter Gallery Query (video)
    const videoParams = parseGalleryBatchParams(new URLSearchParams('media=video&limit=10'));
    const videoQ = buildGalleryQuery(videoParams);
    const videoRows = db.prepare(videoQ.sql).all(...videoQ.bindings) as any[];
    assert.ok(videoRows.length > 0);

    // 5. Test Admin Posts Query with buildAdminPostsQuery on SQLite
    const adminParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&media=photo&limit=10&offset=0'));
    const adminQ = buildAdminPostsQuery(adminParams, true);
    const adminRows = db.prepare(adminQ.pageSql).all(...adminQ.pageBindings) as any[];
    assert.ok(adminRows.length > 0);
    // Strict photo-only: no video files
    assert.ok(adminRows.every(r => r.photo_count > 0 && r.video_count === 0));

    const adminDefaultParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&sort=newest&limit=10&offset=0'));
    const adminDefaultQ = buildAdminPostsQuery(adminDefaultParams, true);
    const adminDefaultPlan = db.prepare(`EXPLAIN QUERY PLAN ${adminDefaultQ.pageSql}`).all(...adminDefaultQ.pageBindings) as any[];
    const adminDefaultPlanDetails = adminDefaultPlan.map(p => p.detail).join('; ');
    assert.ok(
      adminDefaultPlanDetails.includes('idx_images_published_created'),
      `default admin query plan must use idx_images_published_created, got: ${adminDefaultPlanDetails}`
    );
    assert.ok(
      !adminDefaultPlanDetails.includes('idx_images_published_reviewed'),
      `default admin query plan must not use the reviewed index, got: ${adminDefaultPlanDetails}`
    );

    // Test Admin Count Query
    const adminCountRows = db.prepare(adminQ.countSql).all(...adminQ.countBindings) as any[];
    assert.ok(adminCountRows.length > 0 && adminCountRows[0].total > 0);

    // 6. Test JSON_EACH Tag Batching in SQLite
    const newImageId = 999;
    insertImageStmt.run(newImageId, 'Batch Tag Test', 'test.jpg', 'test_user', 'Test User', 'desc', '2026-08-30 00:00:00', 1, 100, 0, 1, 0);

    const testTags = ['new_tag_1', 'new_tag_2', 'art'];
    const uniqueTagsJson = JSON.stringify(testTags);
    const linksJson = JSON.stringify(testTags.map(tagName => ({ imageId: newImageId, tagName })));

    db.prepare('INSERT OR IGNORE INTO tags(name) SELECT value FROM json_each(?)').run(uniqueTagsJson);
    db.prepare(`
      INSERT OR IGNORE INTO image_tags(image_id, tag_id)
      SELECT json_extract(j.value, '$.imageId'), t.id
      FROM json_each(?) j
      JOIN tags t ON t.name = json_extract(j.value, '$.tagName')
    `).run(linksJson);

    const insertedLinks = db.prepare(`
      SELECT t.name FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE it.image_id = ?
    `).all(newImageId) as any[];

    assert.equal(insertedLinks.length, 3);
    assert.deepEqual(insertedLinks.map(l => l.name).sort(), ['art', 'new_tag_1', 'new_tag_2']);

    // 7. EXPLAIN QUERY PLAN verification for Admin size_desc using expression index
    const adminSizeDescParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&sort=size_desc&limit=10&offset=0'));
    const adminSizeDescQ = buildAdminPostsQuery(adminSizeDescParams, true);
    const sizeDescPlan = db.prepare(`EXPLAIN QUERY PLAN ${adminSizeDescQ.pageSql}`).all(...adminSizeDescQ.pageBindings) as any[];
    const sizeDescPlanDetails = sizeDescPlan.map(p => p.detail).join('; ');

    assert.ok(
      sizeDescPlanDetails.includes('idx_images_published_size_desc'),
      `size_desc query plan must use idx_images_published_size_desc, got: ${sizeDescPlanDetails}`
    );
    const innerPagePlan = sizeDescPlan.find(p => p.detail.includes('COVERING INDEX idx_images_published_size_desc'));
    assert.ok(innerPagePlan, 'Inner page CTE must use COVERING INDEX idx_images_published_size_desc to paginate top rows without full table scan');

    // Verify size_desc execution returns descending size order
    const sizeDescRows = db.prepare(adminSizeDescQ.pageSql).all(...adminSizeDescQ.pageBindings) as any[];
    assert.equal(sizeDescRows.length, 10);
    const firstRowSize = (sizeDescRows[0].photo_bytes || 0) + (sizeDescRows[0].video_bytes || 0);
    const secondRowSize = (sizeDescRows[1].photo_bytes || 0) + (sizeDescRows[1].video_bytes || 0);
    assert.ok(firstRowSize >= secondRowSize, `firstRowSize (${firstRowSize}) should be >= secondRowSize (${secondRowSize})`);

    // 8. EXPLAIN QUERY PLAN verification for Admin author + size_desc using composite expression index
    const authorSizeDescParams = parseAdminPostsParams(new URL('https://example.com/api/admin-posts?published=1&author=artist_alice&sort=size_desc&limit=10&offset=0'));
    const authorSizeDescQ = buildAdminPostsQuery(authorSizeDescParams, true);
    const authorSizePlan = db.prepare(`EXPLAIN QUERY PLAN ${authorSizeDescQ.pageSql}`).all(...authorSizeDescQ.pageBindings) as any[];
    const authorSizePlanDetails = authorSizePlan.map(p => p.detail).join('; ');

    assert.ok(
      authorSizePlanDetails.includes('idx_images_published_author_nocase_size_desc'),
      `author + size_desc query plan must use idx_images_published_author_nocase_size_desc, got: ${authorSizePlanDetails}`
    );
    const authorInnerPagePlan = authorSizePlan.find(p => p.detail.includes('idx_images_published_author_nocase_size_desc'));
    assert.ok(authorInnerPagePlan, 'Inner page CTE must use idx_images_published_author_nocase_size_desc');

    // Verify execution returns only artist_alice posts in descending size order
    const authorSizeRows = db.prepare(authorSizeDescQ.pageSql).all(...authorSizeDescQ.pageBindings) as any[];
    assert.ok(authorSizeRows.length > 0);
    assert.ok(authorSizeRows.every(r => r.author.toLowerCase() === 'artist_alice'));

    // 9. Frequent crawl completion updates must not scan every configured account.
    const crawlUpdatePlan = db.prepare(`
      EXPLAIN QUERY PLAN
      UPDATE crawl_accounts
      SET last_crawled_at = datetime('now')
      WHERE lower(username) = lower(?)
    `).all('artist_alice') as any[];
    const crawlUpdatePlanDetails = crawlUpdatePlan.map(p => p.detail).join('; ');
    assert.ok(
      crawlUpdatePlanDetails.includes('idx_crawl_accounts_username_lower'),
      `crawl account update must use normalized username index, got: ${crawlUpdatePlanDetails}`
    );

    // 10. The reviewed-first index serves moderation without competing with
    // published-only feed ordering.
    const reviewedIndexColumns = db.prepare(`
      SELECT name FROM pragma_index_info('idx_images_reviewed_published_id') ORDER BY seqno
    `).all() as Array<{ name: string }>;
    assert.deepEqual(
      reviewedIndexColumns.map((column) => column.name),
      ['reviewed', 'published', 'id'],
    );

    db.exec('DROP INDEX idx_images_published_reviewed');
    const reviewedPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id FROM images
      WHERE reviewed = 0 AND published = 1
      ORDER BY id DESC
      LIMIT 50
    `).all() as any[];
    const reviewedPlanDetails = reviewedPlan.map(p => p.detail).join('; ');
    assert.ok(
      reviewedPlanDetails.includes('idx_images_reviewed_published_id'),
      `moderation query must use reviewed-first index, got: ${reviewedPlanDetails}`
    );

    db.close();
  });
});
