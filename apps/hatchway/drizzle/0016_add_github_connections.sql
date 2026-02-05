-- GitHub OAuth connections for repository operations
-- Separate from login authentication - specifically for GitHub API access

CREATE TABLE IF NOT EXISTS "github_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  
  -- Encrypted OAuth tokens
  "access_token_encrypted" text NOT NULL,
  
  -- GitHub user info (from OAuth)
  "github_user_id" text NOT NULL,
  "github_username" text NOT NULL,
  "github_email" text,
  "github_avatar_url" text,
  
  -- OAuth scopes granted
  "scopes" text,
  
  -- Connection status: 'active' | 'disconnected' | 'expired'
  "status" text DEFAULT 'active' NOT NULL,
  
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Each user can only have one GitHub connection
CREATE UNIQUE INDEX IF NOT EXISTS "github_connections_user_id_unique" ON "github_connections" ("user_id");

-- Index for looking up by GitHub user ID
CREATE INDEX IF NOT EXISTS "github_connections_github_user_id_idx" ON "github_connections" ("github_user_id");
