import { NoOutputGeneratedError } from "ai";
import logger from "@/logging";
import { ScheduleTriggerModel, ScheduleTriggerRunModel } from "@/models";
import { executeA2AMessage } from "@/agents/a2a-executor";
import type { ScheduleTriggerRunExecutePayload } from "@/types";

/**
 * Execute a schedule trigger run by invoking the target agent with the configured message.
 */
export async function handleScheduleTriggerRunExecute(
  payload: ScheduleTriggerRunExecutePayload,
): Promise<void> {
  const { runId } = payload;

  logger.info({ runId }, "Executing schedule trigger run");

  // Fetch the run record
  const run = await ScheduleTriggerRunModel.findById(runId);
  if (!run) {
    logger.error({ runId }, "Schedule trigger run not found");
    return;
  }

  // Skip if already completed
  if (run.status === "completed" || run.status === "failed") {
    logger.info({ runId, status: run.status }, "Run already completed, skipping");
    return;
  }

  // Fetch trigger and agent
  const trigger = await ScheduleTriggerModel.findById(run.triggerId);
  if (!trigger) {
    await ScheduleTriggerRunModel.update(runId, {
      status: "failed",
      errorMessage: "Trigger not found",
      completedAt: new Date(),
    });
    logger.error({ runId, triggerId: run.triggerId }, "Trigger not found");
    return;
  }

  if (!trigger.enabled) {
    await ScheduleTriggerRunModel.update(runId, {
      status: "failed",
      errorMessage: "Trigger is disabled",
      completedAt: new Date(),
    });
    logger.info({ runId, triggerId: trigger.id }, "Trigger disabled, skipping run");
    return;
  }

  // Update run status to running
  await ScheduleTriggerRunModel.update(runId, {
    status: "running",
    startedAt: new Date(),
  });

  try {
    // Execute the agent with the message template
    const result = await executeA2AMessage({
      agentId: trigger.agentId,
      message: trigger.messageTemplate,
      organizationId: trigger.organizationId,
      userId: trigger.actorUserId,
      sessionId: `schedule-trigger-${trigger.id}`,
      source: "schedule_trigger",
    });

    logger.info(
      {
        runId,
        triggerId: trigger.id,
        agentId: trigger.agentId,
        messageId: result.messageId,
        textLength: result.text.length,
      },
      "Schedule trigger run completed successfully",
    );

    // Update run status to completed
    await ScheduleTriggerRunModel.update(runId, {
      status: "completed",
      completedAt: new Date(),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Handle NoOutputGeneratedError as a soft failure (not an error)
    if (error instanceof NoOutputGeneratedError) {
      logger.info(
        {
          runId,
          triggerId: trigger.id,
          agentId: trigger.agentId,
        },
        "Schedule trigger run completed with no output",
      );
      await ScheduleTriggerRunModel.update(runId, {
        status: "completed",
        completedAt: new Date(),
      });
    } else {
      logger.error(
        {
          runId,
          triggerId: trigger.id,
          agentId: trigger.agentId,
          error: errorMessage,
        },
        "Schedule trigger run failed",
      );

      await ScheduleTriggerRunModel.update(runId, {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      });
    }
  }
}
