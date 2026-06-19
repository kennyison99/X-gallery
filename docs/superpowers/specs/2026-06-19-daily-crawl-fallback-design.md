# Daily Crawl Fallback Design

## Goal

Run the Twitter crawl daily during the Hong Kong noon hour without issuing a duplicate backup run during normal operation.

## Schedule

- GitHub Actions is the primary scheduler at `04:07 UTC` (`12:07 HKT`).
- Cloudflare Cron runs at `04:20 UTC` (`12:20 HKT`) as the backup.
- The existing cleanup cron at `05:00 UTC` is unchanged.

## Backup Decision

At `04:20 UTC`, the Worker lists recent runs for `crawl-twitter.yml`. If a `schedule` run was created in the previous 60 minutes, it does nothing. If no such run exists, it dispatches the workflow on `main`.

GitHub API lookup failures fail open: the Worker dispatches the backup so a temporary API problem does not cause the daily crawl to be missed. Dispatch failures are thrown so Cloudflare observability records them.

## Verification

Unit tests cover recent, old, and absent scheduled runs. Type checking and the production build verify the Worker integration. After deployment, Cloudflare's configured cron triggers and GitHub's workflow schedule are checked from their live control planes.
