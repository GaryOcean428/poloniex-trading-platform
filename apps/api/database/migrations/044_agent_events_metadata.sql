-- 044_agent_events_metadata.sql
--
-- Add the `metadata` jsonb column to agent_events. The reconciler INSERT
-- in stateReconciliationService.ts emits a `metadata` field, but the
-- table was created without it — every reconcile tick was failing with:
--
--   ERROR: column "metadata" of relation "agent_events" does not exist
--   STATEMENT: INSERT INTO agent_events (..., metadata, created_at)
--
-- 2026-05-02 incident: orphaned FAT short positions could not be logged
-- to agent_events because of this schema mismatch, masking the
-- "exchange has positions not tracked in DB" event class. The column
-- was added live in prod via railway run; this migration codifies it
-- for fresh deploys and other environments.
--
-- Idempotent — uses IF NOT EXISTS.

ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS metadata JSONB;
