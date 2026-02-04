ALTER TABLE "running_processes" ADD COLUMN "runner_id" text;--> statement-breakpoint
CREATE INDEX "projects_runner_id_idx" ON "projects" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_last_activity_idx" ON "projects" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "running_processes_runner_id_idx" ON "running_processes" USING btree ("runner_id");