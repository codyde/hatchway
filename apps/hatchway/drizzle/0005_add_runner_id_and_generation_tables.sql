CREATE TABLE "running_processes" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"pid" integer NOT NULL,
	"port" integer,
	"command" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_health_check" timestamp,
	"health_check_fail_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"build_id" text NOT NULL,
	"operation_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"summary" text,
	"raw_state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"todo_index" integer NOT NULL,
	"content" text NOT NULL,
	"active_form" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"todo_index" integer NOT NULL,
	"tool_call_id" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"state" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"todo_index" integer NOT NULL,
	"text_id" text,
	"kind" text DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "runner_id" text;--> statement-breakpoint
ALTER TABLE "running_processes" ADD CONSTRAINT "running_processes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_todos" ADD CONSTRAINT "generation_todos_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tool_calls" ADD CONSTRAINT "generation_tool_calls_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_notes" ADD CONSTRAINT "generation_notes_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_sessions_project_id_idx" ON "generation_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_sessions_build_id_unique" ON "generation_sessions" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "generation_todos_session_id_idx" ON "generation_todos" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_todos_session_index_unique" ON "generation_todos" USING btree ("session_id","todo_index");--> statement-breakpoint
CREATE INDEX "generation_tool_calls_session_id_idx" ON "generation_tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_tool_calls_call_id_unique" ON "generation_tool_calls" USING btree ("session_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "generation_notes_session_id_idx" ON "generation_notes" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_notes_text_id_unique" ON "generation_notes" USING btree ("session_id","text_id") WHERE "generation_notes"."text_id" is not null;