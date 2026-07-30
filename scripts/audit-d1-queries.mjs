import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '42262e62f0ff1107d0eb78d92a94d873';

const BASELINE_SCENARIOS = [
  {
    id: 'gallery_page1_offset',
    name: 'Public Gallery First Page (Offset 0)',
    sql: 'SELECT id, title, r2_keys, author, author_display_name, likes, created_at FROM images WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT 49;',
  },
  {
    id: 'gallery_deep_offset',
    name: 'Public Gallery Deep Page (Offset 1000)',
    sql: 'SELECT id, title, r2_keys, author, author_display_name, likes, created_at FROM images WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT 49 OFFSET 1000;',
  },
  {
    id: 'public_distinct_authors',
    name: 'Public Distinct Authors Directory Scan',
    sql: 'SELECT DISTINCT author FROM images WHERE published = 1;',
  },
  {
    id: 'admin_overview_full_scan',
    name: 'Admin Overview Media Keys Scan',
    sql: 'SELECT author, author_display_name, r2_keys FROM images;',
  },
  {
    id: 'admin_posts_count',
    name: 'Admin Posts Count Query',
    sql: 'SELECT COUNT(*) as total FROM images WHERE published = 1;',
  },
  {
    id: 'search_keyword_like',
    name: 'Keyword Search Substring Scan',
    sql: "SELECT id, title, description, author FROM images WHERE published = 1 AND (title LIKE '%原神%' OR description LIKE '%原神%' OR author LIKE '%原神%') ORDER BY created_at DESC, id DESC LIMIT 49;",
  },
];

function runQuery(sql) {
  const cmd = `npx wrangler d1 execute gallery-db --remote --json --command=${JSON.stringify(sql)}`;
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };
  try {
    const raw = execSync(cmd, { env, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    const parsed = JSON.parse(raw);
    const resultObj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (resultObj?.error) {
      throw new Error(`D1 Query Error: ${resultObj.error}`);
    }
    return {
      results: resultObj?.results ?? [],
      meta: resultObj?.meta ?? {},
    };
  } catch (err: any) {
    return { results: [], meta: { error: err.message || String(err) } };
  }
}

async function benchmark() {
  console.log('=== D1 Query Row-Read Empirical Benchmark Audit ===');

  // 1. Run Baseline Scenarios
  console.log('\n--- Running Baseline Scenarios ---');
  const baselineReport = { timestamp: new Date().toISOString(), scenarios: [] };
  for (const s of BASELINE_SCENARIOS) {
    console.log(`Running baseline: ${s.name}...`);
    const { results, meta } = runQuery(s.sql);
    const item = {
      id: s.id,
      name: s.name,
      sql: s.sql,
      returned_rows: results.length,
      rows_read: meta.rows_read ?? 0,
      rows_written: meta.rows_written ?? 0,
      duration_ms: meta.duration ?? 0,
      sql_duration_ms: meta.timings?.sql_duration_ms ?? 0,
    };
    baselineReport.scenarios.push(item);
    console.log(`  -> rows_read: ${item.rows_read}, returned: ${item.returned_rows}, duration: ${item.duration_ms}ms`);
  }

  // 2. Fetch anchor row at offset 1000 for realistic keyset cursor query
  const anchorRes = runQuery('SELECT created_at, id FROM images WHERE published = 1 ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 1000;');
  const anchorRow = anchorRes.results[0] || { created_at: '2026-01-01 00:00:00', id: 10000 };

  const OPTIMIZED_SCENARIOS = [
    {
      id: 'gallery_keyset_cursor',
      name: 'Public Gallery Keyset Cursor Pagination (Deep Page)',
      sql: `SELECT id, title, r2_keys, author, author_display_name, likes, created_at FROM images WHERE published = 1 AND (created_at < '${anchorRow.created_at}' OR (created_at = '${anchorRow.created_at}' AND id < ${anchorRow.id})) ORDER BY created_at DESC, id DESC LIMIT 49;`,
    },
    {
      id: 'public_directory_version_check',
      name: 'Public Directory Version Read (Cache Hit)',
      sql: 'SELECT directory_version FROM storage_stats WHERE id = 1;',
    },
    {
      id: 'admin_overview_o1_sums',
      name: 'Admin Overview Media Counts Aggregation',
      sql: 'SELECT COUNT(*) as total, SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END) as published, SUM(CASE WHEN published = 0 THEN 1 ELSE 0 END) as pending, SUM(photo_count) as total_photos, SUM(video_count) as total_videos FROM images;',
    },
    {
      id: 'admin_author_stats_group_by',
      name: 'Admin Author Stats GROUP BY Aggregation',
      sql: 'SELECT author, MAX(author_display_name) as author_display_name, SUM(photo_count) as photos, SUM(video_count) as videos, SUM(photo_bytes) as photo_bytes, SUM(video_bytes) as video_bytes FROM images GROUP BY author ORDER BY author ASC;',
    },
    {
      id: 'search_page_first_cte',
      name: 'Search Page-First Subquery & Tag Matching',
      sql: "WITH paged_ids AS (SELECT i.id, i.created_at FROM images i WHERE i.published = 1 AND (i.title LIKE '%原神%' OR i.description LIKE '%原神%' OR i.author LIKE '%原神%' OR EXISTS (SELECT 1 FROM image_tags it_q JOIN tags t_q ON it_q.tag_id = t_q.id WHERE it_q.image_id = i.id AND t_q.name LIKE '%原神%')) ORDER BY i.created_at DESC, i.id DESC LIMIT 49) SELECT i.id, i.title, i.r2_keys, i.author, i.author_display_name, i.likes, i.created_at, GROUP_CONCAT(t.name) as tags_list FROM paged_ids p JOIN images i ON p.id = i.id LEFT JOIN image_tags it ON i.id = it.image_id LEFT JOIN tags t ON it.tag_id = t.id GROUP BY i.id ORDER BY i.created_at DESC, i.id DESC;",
    },
  ];

  console.log('\n--- Running Real Empirical Optimized Scenarios ---');
  const optimizedReport = { timestamp: new Date().toISOString(), scenarios: [] };
  for (const s of OPTIMIZED_SCENARIOS) {
    console.log(`Running optimized: ${s.name}...`);
    const { results, meta } = runQuery(s.sql);
    const item = {
      id: s.id,
      name: s.name,
      sql: s.sql,
      returned_rows: results.length,
      rows_read: meta.rows_read ?? 0,
      rows_written: meta.rows_written ?? 0,
      duration_ms: meta.duration ?? 0,
      sql_duration_ms: meta.timings?.sql_duration_ms ?? 0,
    };
    optimizedReport.scenarios.push(item);
    console.log(`  -> rows_read: ${item.rows_read}, returned: ${item.returned_rows}, duration: ${item.duration_ms}ms`);
  }

  const artifactsDir = path.resolve('artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(artifactsDir, 'd1-row-read-baseline.json'), JSON.stringify(baselineReport, null, 2), 'utf-8');
  fs.writeFileSync(path.join(artifactsDir, 'd1-row-read-optimized.json'), JSON.stringify(optimizedReport, null, 2), 'utf-8');
  console.log('\nSaved empirical benchmark reports to artifacts/d1-row-read-baseline.json and artifacts/d1-row-read-optimized.json');
}

benchmark();
