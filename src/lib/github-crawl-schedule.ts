export interface WorkflowRunSummary {
  event: string;
  created_at: string;
}

const BACKUP_LOOKBACK_MS = 60 * 60 * 1000;

export function hasRecentScheduledRun(
  runs: WorkflowRunSummary[],
  now: Date,
): boolean {
  const cutoff = now.getTime() - BACKUP_LOOKBACK_MS;

  return runs.some((run) => {
    if (run.event !== 'schedule') return false;

    const createdAt = Date.parse(run.created_at);
    return Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= now.getTime();
  });
}
