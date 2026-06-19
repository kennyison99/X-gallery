# Daily Crawl Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule the daily crawl for 12:07 HKT with a deduplicated Cloudflare backup at 12:20 HKT.

**Architecture:** GitHub Actions remains the primary scheduler. A testable helper inspects recent workflow runs, and the Worker's later cron dispatches only when no recent scheduled run exists.

**Tech Stack:** GitHub Actions YAML, Cloudflare Workers, TypeScript, Node test runner, Wrangler

---

### Task 1: Test the backup decision

**Files:**
- Create: `tests/github-crawl-schedule.test.ts`
- Create: `src/lib/github-crawl-schedule.ts`

- [ ] Write tests proving recent scheduled runs suppress backup while old or absent runs allow it.
- [ ] Run the focused test and confirm it fails before the helper exists.
- [ ] Implement the minimal pure decision helper.
- [ ] Run the focused test and confirm it passes.

### Task 2: Integrate schedules and GitHub lookup

**Files:**
- Modify: `.github/workflows/crawl-twitter.yml`
- Modify: `src/worker-entry.ts`
- Modify: `wrangler.jsonc`

- [ ] Change the primary cron to `7 4 * * *`.
- [ ] Change the backup cron to `20 4 * * *`.
- [ ] Query recent workflow runs before dispatch and fail open on lookup errors.
- [ ] Throw on failed dispatch responses for observability.

### Task 3: Verify and deploy

**Files:**
- Modify: `docs/superpowers/plans/2026-06-19-daily-crawl-fallback.md`

- [ ] Run the full test suite, TypeScript checks, and production build.
- [ ] Deploy with Wrangler and verify live cron triggers.
- [ ] Commit and push the scoped changes without staging unrelated log files.
