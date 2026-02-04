-- Add GitHub integration fields to projects table
ALTER TABLE "projects" ADD COLUMN "github_repo" text;
ALTER TABLE "projects" ADD COLUMN "github_url" text;
ALTER TABLE "projects" ADD COLUMN "github_branch" text;
ALTER TABLE "projects" ADD COLUMN "github_last_pushed_at" timestamp;
ALTER TABLE "projects" ADD COLUMN "github_auto_push" boolean DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "github_last_sync_at" timestamp;
ALTER TABLE "projects" ADD COLUMN "github_meta" jsonb;
