CREATE TABLE IF NOT EXISTS "generation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "build_id" text NOT NULL,
  "operation_type" text,
  "status" text NOT NULL DEFAULT 'active',
  "started_at" timestamp NOT NULL DEFAULT now(),
  "ended_at" timestamp,
  "summary" text,
  "raw_state" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "generation_sessions_build_id_unique"
  ON "generation_sessions" ("build_id");

CREATE INDEX IF NOT EXISTS "generation_sessions_project_id_idx"
  ON "generation_sessions" ("project_id");

CREATE TABLE IF NOT EXISTS "generation_todos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "generation_sessions"("id") ON DELETE CASCADE,
  "todo_index" integer NOT NULL,
  "content" text NOT NULL,
  "active_form" text,
  "status" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "generation_todos_session_index_unique"
  ON "generation_todos" ("session_id", "todo_index");

CREATE INDEX IF NOT EXISTS "generation_todos_session_id_idx"
  ON "generation_todos" ("session_id");

CREATE TABLE IF NOT EXISTS "generation_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "generation_sessions"("id") ON DELETE CASCADE,
  "todo_index" integer NOT NULL,
  "tool_call_id" text,
  "name" text NOT NULL,
  "input" jsonb,
  "output" jsonb,
  "state" text NOT NULL,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "ended_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "generation_tool_calls_call_id_unique"
  ON "generation_tool_calls" ("session_id", "tool_call_id")
  WHERE "tool_call_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "generation_tool_calls_session_id_idx"
  ON "generation_tool_calls" ("session_id");

CREATE TABLE IF NOT EXISTS "generation_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "generation_sessions"("id") ON DELETE CASCADE,
  "todo_index" integer NOT NULL,
  "text_id" text,
  "kind" text NOT NULL DEFAULT 'text',
  "content" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "generation_notes_session_id_idx"
  ON "generation_notes" ("session_id");

CREATE UNIQUE INDEX IF NOT EXISTS "generation_notes_text_id_unique"
  ON "generation_notes" ("session_id", "text_id")
  WHERE "text_id" IS NOT NULL;

