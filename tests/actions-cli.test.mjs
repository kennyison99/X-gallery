import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('maintenance CLIs fail on setup or account errors and succeed on empty results', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gallery-cli-'));
  mkdirSync(path.join(cwd, 'scripts'));
  try {
    for (const script of ['crawl-twitter', 'fix-db-links']) {
      const sourceUrl = new URL(`../scripts/${script}.mjs`, import.meta.url);
      // Stub external services; run the real main loop and CLI error handler.
      const source = readFileSync(sourceUrl, 'utf8')
        .replace(/^import .*xtractor-lib\.mjs";\r?\n/m, '')
        .replace(/from "(\.\.?\/[^\"]+)"/g, (_, specifier) => `from ${JSON.stringify(new URL(specifier, sourceUrl).href)}`)
        .replace('if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()', 'main()');
      for (const failure of ['setup', 'account', 'none']) {
        const payload = script === 'crawl-twitter'
          ? { accounts: [{ username: 'test', enabled: true }] }
          : [{ author: 'test', id: 1, post_url: 'https://x.com/test/status/123' }];
        const code = `
          globalThis.fetch = async () => Response.json(${JSON.stringify(payload)});
          const ensureXtractor = async () => {
            if (${JSON.stringify(failure)} === 'setup') throw new Error('setup failed');
            return { version: 'test' };
          };
          const runXtractor = async () => {
            if (${JSON.stringify(failure)} === 'account') throw new Error('account failed');
            return { media: [] };
          };
          const extractAllMedia = async () => (await runXtractor()).media;
          ${source}
        `;
        const result = spawnSync(process.execPath, ['--input-type=module'], {
          input: code,
          cwd,
          env: { ...process.env, SITE_URL: 'https://example.test', CRAWL_API_KEY: 'test', TWITTER_COOKIES: 'auth_token=test', CRAWL_RECOVERY_FILE: '' },
          encoding: 'utf8',
          timeout: 10_000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, failure === 'none' ? 0 : 1, `${script}/${failure}: ${result.stderr}`);
        if (script === 'crawl-twitter' && failure !== 'setup') {
          const detect = spawnSync(process.execPath, ['--input-type=module'], {
            cwd,
            input: `process.argv.push('--detect');\n${code}`,
            env: { ...process.env, SITE_URL: 'https://example.test', CRAWL_API_KEY: 'test', TWITTER_COOKIES: 'auth_token=test', CRAWL_RECOVERY_FILE: '' },
            encoding: 'utf8',
            timeout: 10_000,
          });
          assert.ifError(detect.error);
          assert.equal(detect.status, 0, detect.stderr);
          const plan = JSON.parse(readFileSync(path.join(cwd, 'scripts/.crawl-plan.json'), 'utf8'));
          assert.equal(plan.shards.length, failure === 'account' ? 1 : 0);
          if (failure === 'account') assert.equal(plan.shards[0][0].extracted.error, 'account failed');
        }
        if (script === 'crawl-twitter' && failure === 'none') {
          const planPath = path.join(cwd, 'scripts/.crawl-plan.json');
          writeFileSync(planPath, JSON.stringify({ archive: {}, shards: [[{
            account: { username: 'test', enabled: true, crawl_all: false },
            extracted: { media: [], latest: { postId: '200', date: '' }, skipped: false },
          }]] }));
          const worker = spawnSync(process.execPath, ['--input-type=module'], {
            cwd,
            input: `process.argv.push('--plan=' + ${JSON.stringify(planPath)}, '--shard=0');\n${code}`
              .replace("return { version: 'test' };", "throw new Error('Worker must not initialize xtractor');")
              .replace("return { media: [] };", "throw new Error('Worker must not repeat discovery');")
              .replace('globalThis.fetch = async () =>', "globalThis.fetch = async (url) => { if (url.endsWith('/api/crawl-accounts')) throw new Error('Worker must use assigned accounts'); return")
              .replace(`Response.json(${JSON.stringify(payload)});`, `Response.json(${JSON.stringify(payload)}); };`),
            env: { ...process.env, SITE_URL: 'https://example.test', CRAWL_API_KEY: 'test', TWITTER_COOKIES: 'auth_token=test', CRAWL_RECOVERY_FILE: '' },
            encoding: 'utf8',
            timeout: 10_000,
          });
          assert.ifError(worker.error);
          assert.equal(worker.status, 0, worker.stderr);
          const archive = JSON.parse(readFileSync(path.join(cwd, 'scripts/.xtractor-archive.json'), 'utf8'));
          assert.equal(archive.__accounts.test.latest.postId, '200');
          writeFileSync(path.join(cwd, 'scripts/.xtractor-archive.json'), JSON.stringify({ ...archive, known: 1 }));
          const alreadyArchived = spawnSync(process.execPath, ['--input-type=module'], {
            cwd,
            input: `process.argv.push('--detect');\n${code}`.replace('return { media: [] };',
              "return { media: [{ tweet_id: '201', type: 'photo', url: 'https://pbs.twimg.com/media/known.jpg' }] };"),
            env: { ...process.env, SITE_URL: 'https://example.test', CRAWL_API_KEY: 'test', TWITTER_COOKIES: 'auth_token=test', CRAWL_RECOVERY_FILE: '' },
            encoding: 'utf8',
            timeout: 10_000,
          });
          assert.ifError(alreadyArchived.error);
          assert.equal(alreadyArchived.status, 0, alreadyArchived.stderr);
          const skippedPlan = JSON.parse(readFileSync(planPath, 'utf8'));
          assert.equal(skippedPlan.shards.length, 0);
          assert.equal(skippedPlan.archive.__accounts.test.latest.postId, '201');
        }
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
