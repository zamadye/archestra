import { index, pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { agentsTable } from "./agent";

/**
 * Schedule triggers table for cron-based agent scheduling.
 * Supports timezone-aware scheduling with persisted execution history.
 */
const scheduleTriggersTable = pgTable(
  "schedule_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull(),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    messageTemplate: text("message_template").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextDueAt: timestamp("next_due_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("schedule_triggers_agent_id_idx").on(table.agentId),
    index("schedule_triggers_organization_id_idx").on(table.organizationId),
    index("schedule_triggers_enabled_idx").on(table.enabled),
    index("schedule_triggers_next_due_at_idx").on(table.nextDueAt),
  ],
);

/**
 * Schedule trigger runs table for execution history.
 * Stores immutable execution records for each scheduled run.
 */
const scheduleTriggerRunsTable = pgTable(
  "schedule_trigger_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerId: uuid("trigger_id")
      .notNull()
      .references(() => scheduleTriggersTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // 'pending', 'running', 'completed', 'failed'
    startedAt: timestamp("started_at", { mode: "date" }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("schedule_trigger_runs_trigger_id_idx").on(table.triggerId),
    index("schedule_trigger_runs_status_idx").on(table.status),
    index("schedule_trigger_runs_created_at_idx").on(table.createdAt),
  ],
);

export { scheduleTriggersTable, scheduleTriggerRunsTable };
