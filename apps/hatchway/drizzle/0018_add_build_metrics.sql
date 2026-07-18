CREATE TABLE IF NOT EXISTS "build_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"build_id" text,
	"command_id" text,
	"status" text NOT NULL,
	"agent" text,
	"model" text,
	"total_ms" integer,
	"orchestration_ms" integer,
	"agent_ms" integer,
	"time_to_first_chunk_ms" integer,
	"runner_overhead_ms" integer,
	"total_tokens" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_input_tokens" integer,
	"cache_creation_input_tokens" integer,
	"num_turns" integer,
	"total_cost_usd" text,
	"dependency_install_total_ms" integer,
	"dependency_install_calls" integer,
	"modified_file_count" integer,
	"completed_todo_count" integer,
	"error" text,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "build_metrics" ADD CONSTRAINT "build_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "build_metrics" ADD CONSTRAINT "build_metrics_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_metrics_project_id_idx" ON "build_metrics" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_metrics_session_id_idx" ON "build_metrics" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_metrics_build_id_idx" ON "build_metrics" USING btree ("build_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_metrics_created_at_idx" ON "build_metrics" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "build_metrics_command_id_unique" ON "build_metrics" USING btree ("command_id");
