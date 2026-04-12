-- Migration 021: Fix strategy_name NOT NULL constraint on strategy_performance
--
-- Root cause: migration 002 created strategy_performance with
--   strategy_name VARCHAR(100) NOT NULL
-- Migration 018's CREATE TABLE IF NOT EXISTS was silently skipped (table existed).
-- The SLE engine uses strategy_id as the identifier, not strategy_name, so
-- strategy_name should be nullable.  When present, it mirrors strategy_id.

-- 1. Drop NOT NULL on strategy_name (if the column exists and is NOT NULL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_performance'
      AND column_name = 'strategy_name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE strategy_performance ALTER COLUMN strategy_name DROP NOT NULL;
  END IF;
END $$;

-- 2. Backfill strategy_name from strategy_id where strategy_name is NULL
UPDATE strategy_performance
  SET strategy_name = strategy_id
  WHERE strategy_name IS NULL
    AND strategy_id IS NOT NULL;

-- 3. Set a NULL default so future INSERTs that omit strategy_name get NULL
--    instead of a constraint violation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_performance'
      AND column_name = 'strategy_name'
  ) THEN
    ALTER TABLE strategy_performance ALTER COLUMN strategy_name SET DEFAULT NULL;
  END IF;
END $$;
