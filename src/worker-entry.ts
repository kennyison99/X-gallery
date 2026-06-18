import type { ExportedHandler } from '@cloudflare/workers-types';
import astroHandler from '@astrojs/cloudflare/entrypoints/server';

interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  AI: Ai;
  CRAWL_API_KEY?: string;
  CRON_SECRET?: string;
}

/**
 * Custom Worker entrypoint that wraps the Astro handler and adds a `scheduled`
 * handler for the daily cron trigger. The scheduled handler calls the internal
 * /api/cron-cleanup API route through the same Astro handler so the cleanup
 * logic lives in one place.
 */
export default {
  fetch: (astroHandler as any).fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
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
  },
} satisfies ExportedHandler<Env>;
