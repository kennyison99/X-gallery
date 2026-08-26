# Three-Hour Crawl Fallback Design

## Goal

Run the Twitter crawl every three hours without issuing a duplicate backup run during normal operation.

## Schedule

- GitHub Actions is the primary scheduler at minute `07`, every three hours: `01:07`, `04:07`, `07:07`, `10:07`, `13:07`, `16:07`, `19:07`, and `22:07 UTC`.
- Cloudflare Cron runs 23 minutes later, at minute `30`: `01:30`, `04:30`, `07:30`, `10:30`, `13:30`, `16:30`, `19:30`, and `22:30 UTC`, as the backup.
- The existing cleanup cron at `05:00 UTC` is unchanged.

## Backup Decision

At each backup time, the Worker lists recent runs for `crawl-twitter.yml`. If a `schedule` run was created in the previous two hours, it does nothing. If no such run exists, it dispatches the workflow on `main`.

GitHub API lookup failures fail open: the Worker dispatches the backup so a temporary API problem does not cause the daily crawl to be missed. Dispatch failures are thrown so Cloudflare observability records them.

## Verification

Unit tests cover recent, old, and absent scheduled runs. Type checking and the production build verify the Worker integration. After deployment, Cloudflare's configured cron triggers and GitHub's workflow schedule are checked from their live control planes.
