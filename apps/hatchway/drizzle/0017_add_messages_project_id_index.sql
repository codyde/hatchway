-- Add index on messages.project_id for performance
-- Fixes HATCHWAY-55: Missing database index causes full table scans

CREATE INDEX IF NOT EXISTS "messages_project_id_idx" ON "messages" ("project_id");
