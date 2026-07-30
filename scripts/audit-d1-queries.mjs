import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '42262e62f0ff1107d0eb78d92a94d873';

const SCENARIOS = [
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
    const raw = execSync(cmd, { env, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
    const parsed = JSON.parse(raw);
    const resultObj = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      results_count: resultObj?.results?.length ?? 0,
      meta: resultObj?.meta ?? {},
    };
  } catch (err) {
    console.error('Error running D1 query benchmark:', err.message);
    return { results_count: 0, meta: { error: err.message } };
  }
}

async function benchmark() {
  console.log('=== D1 Query Row-Read Benchmark Audit ===');
  const report = {
    timestamp: new Date().toISOString(),
    scenarios: [],
  };

  for (const s of SCENARIOS) {
    console.log(`Running scenario: ${s.name}...`);
    const { results_count, meta } = runQuery(s.sql);
    const scenarioResult = {
      id: s.id,
      name: s.name,
      sql: s.sql,
      returned_rows: results_count,
      rows_read: meta.rows_read ?? 0,
      rows_written: meta.rows_written ?? 0,
      duration_ms: meta.duration ?? 0,
      sql_duration_ms: meta.timings?.sql_duration_ms ?? 0,
    };
    report.scenarios.push(scenarioResult);
    console.log(`  -> rows_read: ${scenarioResult.rows_read}, rows_written: ${scenarioResult.rows_written}, duration: ${scenarioResult.duration_ms}ms`);
  }

  const isBaseline = process.argv.includes('--baseline');
  const artifactsDir = path.resolve('artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const outputPath = path.join(artifactsDir, isBaseline ? 'd1-row-read-baseline.json' : 'd1-row-read-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Saved benchmark report to ${outputPath}`);
}

benchmark();
