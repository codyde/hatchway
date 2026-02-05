-- Railway OAuth connections - stores user's Railway OAuth tokens
CREATE TABLE IF NOT EXISTS "railway_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  
  -- Encrypted OAuth tokens
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text,
  "access_token_expires_at" timestamp,
  
  -- Railway user info (from OAuth)
  "railway_user_id" text NOT NULL,
  "railway_email" text,
  "railway_name" text,
  
  -- Selected workspaces from OAuth consent
  "default_workspace_id" text,
  "default_workspace_name" text,
  "granted_workspaces" jsonb,
  
  -- Connection status
  "status" text NOT NULL DEFAULT 'active',
  
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Ensure one connection per user
CREATE UNIQUE INDEX IF NOT EXISTS "railway_connections_user_id_unique" ON "railway_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "railway_connections_railway_user_id_idx" ON "railway_connections" ("railway_user_id");

-- Railway deployments history - tracks deployments to Railway
CREATE TABLE IF NOT EXISTS "railway_deployments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  
  -- Railway resource IDs
  "railway_project_id" text NOT NULL,
  "railway_service_id" text NOT NULL,
  "railway_deployment_id" text NOT NULL,
  "railway_environment_id" text,
  
  -- Deployment info
  "status" text NOT NULL,
  "url" text,
  "commit_sha" text,
  
  -- Timestamps
  "deployed_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "railway_deployments_project_id_idx" ON "railway_deployments" ("project_id");
CREATE INDEX IF NOT EXISTS "railway_deployments_railway_deployment_id_idx" ON "railway_deployments" ("railway_deployment_id");

-- Add Railway fields to projects table
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "railway_project_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "railway_service_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "railway_environment_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "railway_domain" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "railway_deployment_status" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "railway_last_deployed_at" timestamp;
