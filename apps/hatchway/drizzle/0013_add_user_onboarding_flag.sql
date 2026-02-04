-- Migration: Add onboarding flag to users table
-- This tracks whether a user has completed the onboarding flow

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_completed_onboarding" boolean NOT NULL DEFAULT false;
