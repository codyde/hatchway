CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_allocations" (
	"port" integer PRIMARY KEY NOT NULL,
	"framework" text NOT NULL,
	"project_id" uuid,
	"reserved_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"original_prompt" text,
	"icon" text DEFAULT 'Folder',
	"status" text DEFAULT 'pending' NOT NULL,
	"project_type" text,
	"path" text NOT NULL,
	"run_command" text,
	"port" integer,
	"dev_server_pid" integer,
	"dev_server_port" integer,
	"dev_server_status" text DEFAULT 'stopped',
	"generation_state" text,
	"last_activity_at" timestamp DEFAULT now(),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_allocations" ADD CONSTRAINT "port_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
	NEW."updated_at" = NOW();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trigger_projects_updated_at
BEFORE UPDATE ON "projects"
FOR EACH ROW
EXECUTE PROCEDURE set_projects_updated_at();
