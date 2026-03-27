-- Create schedule_triggers table for cron-based agent scheduling
CREATE TABLE "schedule_triggers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL,
  "cron_expression" text NOT NULL,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "message_template" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "next_due_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

-- Create indexes for schedule_triggers
CREATE INDEX "schedule_triggers_agent_id_idx" ON "schedule_triggers" USING btree ("agent_id");
CREATE INDEX "schedule_triggers_organization_id_idx" ON "schedule_triggers" USING btree ("organization_id");
CREATE INDEX "schedule_triggers_enabled_idx" ON "schedule_triggers" USING btree ("enabled");
CREATE INDEX "schedule_triggers_next_due_at_idx" ON "schedule_triggers" USING btree ("next_due_at");

-- Create schedule_trigger_runs table for execution history
CREATE TABLE "schedule_trigger_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trigger_id" uuid NOT NULL REFERENCES "schedule_triggers"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

-- Create indexes for schedule_trigger_runs
CREATE INDEX "schedule_trigger_runs_trigger_id_idx" ON "schedule_trigger_runs" USING btree ("trigger_id");
CREATE INDEX "schedule_trigger_runs_status_idx" ON "schedule_trigger_runs" USING btree ("status");
CREATE INDEX "schedule_trigger_runs_created_at_idx" ON "schedule_trigger_runs" USING btree ("created_at");

-- Create trigger to update updated_at timestamp on schedule_triggers
CREATE OR REPLACE FUNCTION update_schedule_triggers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER schedule_triggers_updated_at_trigger
  BEFORE UPDATE ON "schedule_triggers"
  FOR EACH ROW
  EXECUTE FUNCTION update_schedule_triggers_updated_at();
