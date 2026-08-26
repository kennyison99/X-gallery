import assert from 'node:assert/strict';
import test from 'node:test';

import { hasRecentScheduledRun } from '../src/lib/github-crawl-schedule.ts';

const now = new Date('2026-06-19T04:30:00.000Z');

test('recognizes a scheduled run created during the two-hour backup window', () => {
  const runs = [{ event: 'schedule', created_at: '2026-06-19T04:07:00.000Z' }];

  assert.equal(hasRecentScheduledRun(runs, now), true);
});

test('ignores scheduled runs older than the backup window', () => {
  const runs = [{ event: 'schedule', created_at: '2026-06-19T02:29:59.000Z' }];

  assert.equal(hasRecentScheduledRun(runs, now), false);
});

test('ignores manual workflow dispatches', () => {
  const runs = [{ event: 'workflow_dispatch', created_at: '2026-06-19T04:10:00.000Z' }];

  assert.equal(hasRecentScheduledRun(runs, now), false);
});

test('allows backup when no workflow runs exist', () => {
  assert.equal(hasRecentScheduledRun([], now), false);
});
