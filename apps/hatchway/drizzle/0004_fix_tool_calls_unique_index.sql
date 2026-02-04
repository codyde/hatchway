-- Drop the partial unique index with WHERE clause
DROP INDEX IF EXISTS "generation_tool_calls_call_id_unique";

-- Create a complete unique index without WHERE clause
CREATE UNIQUE INDEX "generation_tool_calls_call_id_unique"
  ON "generation_tool_calls" ("session_id", "tool_call_id");
