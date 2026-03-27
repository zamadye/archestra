import { Cron } from "croner";
import logger from "@/logging";
import { ScheduleTriggerModel, ScheduleTriggerRunModel, TaskModel } from "@/models";
import { taskQueueService } from "@/task-queue";
import type { CheckDueScheduleTriggersPayload } from "@/types";

const MAX_BACKFILL_RUNS = 100; // Bounded catch-up to prevent queue flooding
const LOOKAHEAD_SECONDS = 60; // Only schedule runs within 1 minute ahead

/**
 * Check for due schedule triggers and enqueue execution tasks.
 * This is called periodically by the task queue.
 */
export async function handleCheckDueScheduleTriggers(
  payload: CheckDueScheduleTriggersPayload = {},
): Promise<void> {
  const maxBackfill = payload.maxBackfillRuns ?? MAX_BACKFILL_RUNS;
  const enabledTriggers = await ScheduleTriggerModel.findAllEnabled();

  for (const trigger of enabledTriggers) {
    try {
      await processTrigger(trigger, maxBackfill);
    } catch (error) {
      logger.error(
        {
          triggerId: trigger.id,
          agentId: trigger.agentId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to process schedule trigger",
      );
    }
  }
}

/**
 * Process a single trigger: check if due, claim slot, and enqueue runs.
 * Uses transactional locking to prevent duplicate runs across multiple pods.
 */
async function processTrigger(
  trigger: Awaited<ReturnType<typeof ScheduleTriggerModel.findById>>,
  maxBackfill: number,
): Promise<void> {
  if (!trigger) return;

  // Parse cron expression with timezone support
  const cron = new Cron(trigger.cronExpression, { timezone: trigger.timezone });

  // Calculate next due time
  let nextDueAt = trigger.nextDueAt
    ? cron.nextRun(trigger.nextDueAt)
    : cron.nextRun();

  // If trigger has no nextDueAt and we're past the first run, use now as reference
  if (!nextDueAt && !trigger.nextDueAt) {
    nextDueAt = cron.nextRun();
  }

  if (!nextDueAt) {
    logger.warn(
      {
        triggerId: trigger.id,
        cronExpression: trigger.cronExpression,
        timezone: trigger.timezone,
      },
      "Cron expression produces no future runs",
    );
    return;
  }

  const now = new Date();

  // Check if nextDueAt is within our processing window (past or within 1 minute)
  if (nextDueAt.getTime() - now.getTime() > LOOKAHEAD_SECONDS * 1000) {
    // Not due yet, nothing to do
    return;
  }

  // Calculate how many runs have been missed (for backfill)
  const missedRunsCount = calculateMissedRunsCount(cron, trigger.nextDueAt, now);

  // Limit backfill to prevent flooding after long downtime
  const runsToCreate = Math.min(missedRunsCount, maxBackfill);

  // Create run records and update nextDueAt transactionally
  await ScheduleTriggerModel.createDueRuns(trigger.id, runsToCreate, nextDueAt);

  // Enqueue execution tasks for each created run
  const pendingRuns = await ScheduleTriggerRunModel.findPendingByTriggerId(
    trigger.id,
  );

  for (const run of pendingRuns) {
    const hasPendingTask = await TaskModel.hasPendingOrProcessing(
      "schedule_trigger_run_execute",
      run.id,
    );
    if (!hasPendingTask) {
      await taskQueueService.enqueue({
        taskType: "schedule_trigger_run_execute",
        payload: { runId: run.id },
        scheduledFor: run.createdAt,
      });
      logger.info(
        {
          triggerId: trigger.id,
          runId: run.id,
          agentId: trigger.agentId,
        },
        "Enqueued schedule trigger run execution",
      );
    }
  }

  logger.info(
    {
      triggerId: trigger.id,
      agentId: trigger.agentId,
      runsCreated: runsToCreate,
    },
    "Processed due schedule trigger",
  );
}

/**
 * Calculate how many scheduled runs were missed between last nextDueAt and now.
 * This implements bounded catch-up logic.
 */
function calculateMissedRunsCount(
  cron: Cron,
  lastNextDueAt: Date | null,
  now: Date,
): number {
  if (!lastNextDueAt) {
    return 1; // First run
  }

  let count = 0;
  let nextRun = cron.nextRun(lastNextDueAt);
  const maxIterations = MAX_BACKFILL_RUNS + 10; // Safety limit

  while (
    nextRun &&
    nextRun <= now &&
    count < maxIterations
  ) {
    count++;
    nextRun = cron.nextRun(nextRun);
  }

  return count;
}
