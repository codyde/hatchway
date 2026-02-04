-- Phase 1: Add status timestamp for timeout detection
ALTER TABLE "projects" ADD COLUMN "dev_server_status_updated_at" timestamp DEFAULT now();

-- Phase 2: Create server_operations table for operation tracking
CREATE TABLE IF NOT EXISTS "server_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "operation" text NOT NULL, -- 'start', 'stop', 'restart'
  "status" text NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'ack', 'completed', 'failed', 'timeout'
  "runner_id" text,
  "port" integer,
  "pid" integer,
  "error" text,
  "failure_reason" text, -- 'port_in_use', 'health_check_timeout', 'immediate_crash', etc.
  "retry_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "sent_at" timestamp,
  "ack_at" timestamp,
  "completed_at" timestamp
);

-- Index for finding operations by project
CREATE INDEX "server_operations_project_id_idx" ON "server_operations" ("project_id");

-- Index for finding pending/sent operations that may need timeout handling
CREATE INDEX "server_operations_status_idx" ON "server_operations" ("status");

-- Index for finding latest operation per project
CREATE INDEX "server_operations_created_at_idx" ON "server_operations" ("created_at" DESC);
