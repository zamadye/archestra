import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ScheduleTriggerModel,
  ScheduleTriggerRunModel,
  AgentModel,
} from "@/models";
import logger from "@/logging";
import { taskQueueService } from "@/task-queue";

// Validation schemas
const CreateScheduleTriggerSchema = z.object({
  cronExpression: z.string().min(1),
  timezone: z.string().default("UTC"),
  messageTemplate: z.string().min(1),
  enabled: z.boolean().default(true),
});

const UpdateScheduleTriggerSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  timezone: z.string().optional(),
  messageTemplate: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export default async function scheduleTriggersRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/agents/:agentId/schedule-triggers - List triggers for agent
  fastify.get(
    "/:agentId/schedule-triggers",
    async (
      request: FastifyRequest<{ Params: { agentId: string } }>,
      reply: FastifyReply,
    ) => {
      const { agentId } = request.params;
      const { userId, organizationId } = request.user;

      // Verify agent exists and user has access
      const agent = await AgentModel.findById(agentId);
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }
      if (agent.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const triggers = await ScheduleTriggerModel.findByAgentId(agentId);
      return reply.send(triggers);
    },
  );

  // POST /api/agents/:agentId/schedule-triggers - Create trigger
  fastify.post(
    "/:agentId/schedule-triggers",
    async (
      request: FastifyRequest<{
        Params: { agentId: string };
        Body: z.infer<typeof CreateScheduleTriggerSchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const { agentId } = request.params;
      const { userId, organizationId } = request.user;

      // Verify agent exists and user has access
      const agent = await AgentModel.findById(agentId);
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }
      if (agent.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Validate request body
      const body = CreateScheduleTriggerSchema.parse(request.body);

      // Validate cron expression
      if (!ScheduleTriggerModel.validateCronExpression(body.cronExpression)) {
        return reply.status(400).send({ error: "Invalid cron expression" });
      }

      // Create trigger
      const trigger = await ScheduleTriggerModel.create({
        agentId,
        organizationId,
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        messageTemplate: body.messageTemplate,
        actorUserId: userId,
        enabled: body.enabled,
      });

      logger.info(
        { triggerId: trigger.id, agentId, userId },
        "Schedule trigger created",
      );

      return reply.status(201).send(trigger);
    },
  );

  // GET /api/schedule-triggers/:triggerId - Get single trigger
  fastify.get(
    "/schedule-triggers/:triggerId",
    async (
      request: FastifyRequest<{ Params: { triggerId: string } }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      return reply.send(trigger);
    },
  );

  // PATCH /api/schedule-triggers/:triggerId - Update trigger
  fastify.patch(
    "/schedule-triggers/:triggerId",
    async (
      request: FastifyRequest<{
        Params: { triggerId: string };
        Body: z.infer<typeof UpdateScheduleTriggerSchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Validate request body
      const body = UpdateScheduleTriggerSchema.parse(request.body);

      // Validate cron expression if provided
      if (
        body.cronExpression &&
        !ScheduleTriggerModel.validateCronExpression(body.cronExpression)
      ) {
        return reply.status(400).send({ error: "Invalid cron expression" });
      }

      const updated = await ScheduleTriggerModel.update(triggerId, body);
      if (!updated) {
        return reply.status(404).send({ error: "Trigger not found" });
      }

      logger.info(
        { triggerId, userId: request.user.userId },
        "Schedule trigger updated",
      );

      return reply.send(updated);
    },
  );

  // DELETE /api/schedule-triggers/:triggerId - Delete trigger
  fastify.delete(
    "/schedule-triggers/:triggerId",
    async (
      request: FastifyRequest<{ Params: { triggerId: string } }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      await ScheduleTriggerModel.delete(triggerId);

      logger.info(
        { triggerId, userId: request.user.userId },
        "Schedule trigger deleted",
      );

      return reply.status(204).send();
    },
  );

  // POST /api/schedule-triggers/:triggerId/enable - Enable trigger
  fastify.post(
    "/schedule-triggers/:triggerId/enable",
    async (
      request: FastifyRequest<{ Params: { triggerId: string } }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const enabled = await ScheduleTriggerModel.enable(triggerId);
      if (!enabled) {
        return reply.status(404).send({ error: "Trigger not found" });
      }

      logger.info(
        { triggerId, userId: request.user.userId },
        "Schedule trigger enabled",
      );

      return reply.send(enabled);
    },
  );

  // POST /api/schedule-triggers/:triggerId/disable - Disable trigger
  fastify.post(
    "/schedule-triggers/:triggerId/disable",
    async (
      request: FastifyRequest<{ Params: { triggerId: string } }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const disabled = await ScheduleTriggerModel.disable(triggerId);
      if (!disabled) {
        return reply.status(404).send({ error: "Trigger not found" });
      }

      logger.info(
        { triggerId, userId: request.user.userId },
        "Schedule trigger disabled",
      );

      return reply.send(disabled);
    },
  );

  // POST /api/schedule-triggers/:triggerId/execute - Manual run
  fastify.post(
    "/schedule-triggers/:triggerId/execute",
    async (
      request: FastifyRequest<{ Params: { triggerId: string } }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (!trigger.enabled) {
        return reply.status(400).send({ error: "Trigger is disabled" });
      }

      // Create a manual run
      const run = await ScheduleTriggerRunModel.create({
        triggerId,
        status: "pending",
      });

      // Enqueue execution
      await taskQueueService.enqueue({
        taskType: "schedule_trigger_run_execute",
        payload: { runId: run.id },
      });

      logger.info(
        { triggerId, runId: run.id, userId: request.user.userId },
        "Manual schedule trigger run enqueued",
      );

      return reply.status(202).send({ runId: run.id });
    },
  );

  // GET /api/schedule-triggers/:triggerId/runs - Get run history
  fastify.get(
    "/schedule-triggers/:triggerId/runs",
    async (
      request: FastifyRequest<{
        Params: { triggerId: string };
        Querystring: { limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { triggerId } = request.params;
      const { organizationId } = request.user;
      const limit = request.query.limit
        ? parseInt(request.query.limit, 10)
        : 50;

      const trigger = await ScheduleTriggerModel.findById(triggerId);
      if (!trigger) {
        return reply.status(404).send({ error: "Trigger not found" });
      }
      if (trigger.organizationId !== organizationId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const runs = await ScheduleTriggerRunModel.findByTriggerId(
        triggerId,
        Math.min(limit, 100),
      );

      return reply.send(runs);
    },
  );
}
