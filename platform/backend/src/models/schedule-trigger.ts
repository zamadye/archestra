import { Cron } from "croner";
import { and, desc, eq, lt } from "drizzle-orm";
import db, { schema } from "@/database";
import logger from "@/logging";

export type ScheduleTrigger = typeof schema.scheduleTriggersTable.$inferSelect;
export type NewScheduleTrigger = typeof schema.scheduleTriggersTable.$inferInsert;
export type ScheduleTriggerUpdate = Partial<
  Pick<
    ScheduleTrigger,
    | "cronExpression"
    | "timezone"
    | "messageTemplate"
    | "enabled"
    | "nextDueAt"
  >
>;

export type ScheduleTriggerRun = typeof schema.scheduleTriggerRunsTable.$inferSelect;
export type NewScheduleTriggerRun = typeof schema.scheduleTriggerRunsTable.$inferInsert;
export type ScheduleTriggerRunUpdate = Partial<
  Pick<
    ScheduleTriggerRun,
    | "status"
    | "startedAt"
    | "completedAt"
    | "errorMessage"
  >
>;

export const ScheduleTriggerModel = {
  /**
   * Find a schedule trigger by ID
   */
  async findById(id: string): Promise<ScheduleTrigger | undefined> {
    const [trigger] = await db
      .select()
      .from(schema.scheduleTriggersTable)
      .where(eq(schema.scheduleTriggersTable.id, id))
      .limit(1);

    return trigger;
  },

  /**
   * Find all schedule triggers for a specific agent
   */
  async findByAgentId(agentId: string): Promise<ScheduleTrigger[]> {
    return await db
      .select()
      .from(schema.scheduleTriggersTable)
      .where(eq(schema.scheduleTriggersTable.agentId, agentId));
  },

  /**
   * Find all enabled schedule triggers
   */
  async findAllEnabled(): Promise<ScheduleTrigger[]> {
    return await db
      .select()
      .from(schema.scheduleTriggersTable)
      .where(eq(schema.scheduleTriggersTable.enabled, true));
  },

  /**
   * Find schedule triggers by organization
   */
  async findByOrganizationId(
    organizationId: string,
  ): Promise<ScheduleTrigger[]> {
    return await db
      .select()
      .from(schema.scheduleTriggersTable)
      .where(
        eq(schema.scheduleTriggersTable.organizationId, organizationId),
      );
  },

  /**
   * Create a new schedule trigger
   */
  async create(
    trigger: NewScheduleTrigger,
  ): Promise<ScheduleTrigger> {
    const [created] = await db
      .insert(schema.scheduleTriggersTable)
      .values(trigger)
      .returning();

    return created;
  },

  /**
   * Update a schedule trigger
   */
  async update(
    id: string,
    update: ScheduleTriggerUpdate,
  ): Promise<ScheduleTrigger | undefined> {
    // If updating cron expression or timezone, recalculate nextDueAt
    let nextDueAt = update.nextDueAt;
    if (update.cronExpression || update.timezone) {
      const trigger = await this.findById(id);
      if (trigger) {
        const cron = new Cron(
          update.cronExpression ?? trigger.cronExpression,
          { timezone: update.timezone ?? trigger.timezone },
        );
        nextDueAt = cron.nextRun();
      }
    }

    const [updated] = await db
      .update(schema.scheduleTriggersTable)
      .set({
        ...update,
        ...(nextDueAt !== undefined && { nextDueAt }),
        updatedAt: new Date(),
      })
      .where(eq(schema.scheduleTriggersTable.id, id))
      .returning();

    return updated;
  },

  /**
   * Delete a schedule trigger (cascade deletes runs automatically)
   */
  async delete(id: string): Promise<void> {
    await db
      .delete(schema.scheduleTriggersTable)
      .where(eq(schema.scheduleTriggersTable.id, id));
  },

  /**
   * Enable a schedule trigger
   */
  async enable(id: string): Promise<ScheduleTrigger | undefined> {
    const trigger = await this.findById(id);
    if (!trigger) return undefined;

    const cron = new Cron(trigger.cronExpression, {
      timezone: trigger.timezone,
    });
    const nextDueAt = cron.nextRun();

    const [enabled] = await db
      .update(schema.scheduleTriggersTable)
      .set({ enabled: true, nextDueAt, updatedAt: new Date() })
      .where(eq(schema.scheduleTriggersTable.id, id))
      .returning();

    return enabled;
  },

  /**
   * Disable a schedule trigger
   */
  async disable(id: string): Promise<ScheduleTrigger | undefined> {
    const [disabled] = await db
      .update(schema.scheduleTriggersTable)
      .set({ enabled: false, nextDueAt: null, updatedAt: new Date() })
      .where(eq(schema.scheduleTriggersTable.id, id))
      .returning();

    return disabled;
  },

  /**
   * Create due run records for a trigger transactionally.
   * Updates nextDueAt atomically.
   */
  async createDueRuns(
    triggerId: string,
    count: number,
    nextDueAt: Date,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // Create run records
      if (count > 0) {
        const runs: NewScheduleTriggerRun[] = Array.from({ length: count }, () => ({
          triggerId,
          status: "pending",
        }));

        await tx
          .insert(schema.scheduleTriggerRunsTable)
          .values(runs);
      }

      // Update trigger's nextDueAt
      await tx
        .update(schema.scheduleTriggersTable)
        .set({ nextDueAt, updatedAt: new Date() })
        .where(eq(schema.scheduleTriggersTable.id, triggerId));
    });
  },

  /**
   * Validate a cron expression
   */
  validateCronExpression(cronExpression: string): boolean {
    try {
      new Cron(cronExpression);
      return true;
    } catch {
      return false;
    }
  },
};

export const ScheduleTriggerRunModel = {
  /**
   * Find a schedule trigger run by ID
   */
  async findById(id: string): Promise<ScheduleTriggerRun | undefined> {
    const [run] = await db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(eq(schema.scheduleTriggerRunsTable.id, id))
      .limit(1);

    return run;
  },

  /**
   * Find all runs for a trigger, ordered by creation time (newest first)
   */
  async findByTriggerId(
    triggerId: string,
    limit = 50,
  ): Promise<ScheduleTriggerRun[]> {
    return await db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(eq(schema.scheduleTriggerRunsTable.triggerId, triggerId))
      .orderBy(desc(schema.scheduleTriggerRunsTable.createdAt))
      .limit(limit);
  },

  /**
   * Find pending runs for a trigger
   */
  async findPendingByTriggerId(
    triggerId: string,
  ): Promise<ScheduleTriggerRun[]> {
    return await db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(
        and(
          eq(schema.scheduleTriggerRunsTable.triggerId, triggerId),
          eq(schema.scheduleTriggerRunsTable.status, "pending"),
        ),
      );
  },

  /**
   * Create a new run record
   */
  async create(run: NewScheduleTriggerRun): Promise<ScheduleTriggerRun> {
    const [created] = await db
      .insert(schema.scheduleTriggerRunsTable)
      .values(run)
      .returning();

    return created;
  },

  /**
   * Update a run record
   */
  async update(
    id: string,
    update: ScheduleTriggerRunUpdate,
  ): Promise<ScheduleTriggerRun | undefined> {
    const [updated] = await db
      .update(schema.scheduleTriggerRunsTable)
      .set(update)
      .where(eq(schema.scheduleTriggerRunsTable.id, id))
      .returning();

    return updated;
  },

  /**
   * Delete old run records (for cleanup)
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await db
      .delete(schema.scheduleTriggerRunsTable)
      .where(lt(schema.scheduleTriggerRunsTable.createdAt, date));

    return result.rowCount ?? 0;
  },
};
