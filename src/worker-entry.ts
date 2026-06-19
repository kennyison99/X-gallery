import type { ExportedHandler } from '@cloudflare/workers-types';
import astroHandler from '@astrojs/cloudflare/entrypoints/server';
import { hasRecentScheduledRun, type WorkflowRunSummary } from './lib/github-crawl-schedule';

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  CRAWL_API_KEY?: string;
  CRON_SECRET?: string;
  GH_PAT?: string;
}

// GitHub repo for workflow dispatch (owner/repo format).
const GH_REPO = 'kennyison99/X-gallery';
const GH_WORKFLOW_ID = 'crawl-twitter.yml';

/**
 * Dispatch the "Crawl Twitter Images" workflow on GitHub as a backup to the
 * GitHub Actions schedule (which can be delayed or skipped during peak load).
 * Uses a Personal Access Token stored as GH_PAT secret.
 */
const githubHeaders = (token: string): Record<string, string> => ({
  'Accept': 'application/vnd.github+json',
  'Authorization': `Bearer ${token}`,
  'User-Agent': 'x-gallery-worker',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function hasPrimaryCrawlRun(env: Env, now: Date): Promise<boolean> {
  if (!env.GH_PAT) return false;

  const response = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW_ID}/runs?event=schedule&per_page=10`,
    { headers: githubHeaders(env.GH_PAT) },
  );
  if (!response.ok) {
    throw new Error(`GitHub workflow runs lookup failed: ${response.status}`);
  }

  const data = await response.json<{ workflow_runs?: WorkflowRunSummary[] }>();
  return hasRecentScheduledRun(data.workflow_runs ?? [], now);
}

async function dispatchCrawlWorkflow(env: Env, now: Date): Promise<void> {
  if (!env.GH_PAT) return; // skip if not configured

  try {
    if (await hasPrimaryCrawlRun(env, now)) return;
  } catch (error) {
    console.error('Unable to check the primary crawl run; dispatching backup.', error);
  }

  const response = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders(env.GH_PAT),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch failed: ${response.status}`);
  }
}

/**
 * Custom Worker entrypoint that wraps the Astro handler and adds a `scheduled`
 * handler for cron triggers. The 05:00 UTC cron runs the daily cleanup; the
 * 04:20 UTC cron dispatches the crawl workflow on GitHub as a backup trigger.
 */
export default {
  fetch: (astroHandler as any).fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    // Daily pending-review cleanup (05:00 UTC).
    if (event.cron === '0 5 * * *') {
      ctx.waitUntil(
        (astroHandler as any).fetch(
          new Request('https://internal.local/api/cron-cleanup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Cron-Secret': env.CRON_SECRET ?? '',
            },
          }),
          env,
          ctx,
        ),
      );
      return;
    }

    // At 12:20 HKT, dispatch only when the 12:07 GitHub schedule did not run.
    if (event.cron === '20 4 * * *') {
      ctx.waitUntil(dispatchCrawlWorkflow(env, new Date(event.scheduledTime)));
      return;
    }
  },
} satisfies ExportedHandler<Env>;
