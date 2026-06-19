import type { ExportedHandler } from '@cloudflare/workers-types';
import astroHandler from '@astrojs/cloudflare/entrypoints/server';

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
async function dispatchCrawlWorkflow(env: Env): Promise<void> {
  if (!env.GH_PAT) return; // skip if not configured
  await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${env.GH_PAT}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
}

/**
 * Custom Worker entrypoint that wraps the Astro handler and adds a `scheduled`
 * handler for cron triggers. The 05:00 UTC cron runs the daily cleanup; the
 * 03:13 UTC cron dispatches the crawl workflow on GitHub as a backup trigger.
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

    // Backup trigger for the daily crawl (03:13 UTC, just before the GitHub
    // Actions schedule at 03:17, so if GitHub's own schedule fires we get a
    // no-op; if it doesn't, this ensures the crawl still runs).
    if (event.cron === '13 3 * * *') {
      ctx.waitUntil(dispatchCrawlWorkflow(env));
      return;
    }
  },
} satisfies ExportedHandler<Env>;
