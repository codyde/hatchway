ALTER TABLE "generation_sessions"
  ADD COLUMN IF NOT EXISTS "request_message_id" uuid;

DO $$ BEGIN
  ALTER TABLE "generation_sessions"
    ADD CONSTRAINT "generation_sessions_request_message_id_messages_id_fk"
    FOREIGN KEY ("request_message_id") REFERENCES "messages"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "generation_sessions_request_message_id_idx"
  ON "generation_sessions" ("request_message_id");
