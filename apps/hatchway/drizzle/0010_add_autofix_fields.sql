-- Add auto-fix tracking fields to generation_sessions
ALTER TABLE "generation_sessions" ADD COLUMN "is_auto_fix" boolean DEFAULT false;
ALTER TABLE "generation_sessions" ADD COLUMN "auto_fix_error" text;
