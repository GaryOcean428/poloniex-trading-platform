-- Migration 019: Fix missing strategy_id column on strategy_performance
--
-- Root cause: migration 002 created strategy_performance with PK (id UUID).
-- Migration 018's CREATE TABLE IF NOT EXISTS was silently skipped, and the
-- ALTER TABLE ADD COLUMN block omitted strategy_id (it was only in CREATE TABLE).
-- The application code (strategyLearningEngine.ts) requires strategy_id for
-- INSERT ... ON CONFLICT (strategy_id) upserts.

-- 1. Add the missing strategy_id column
ALTER TABLE strategy_performance
  ADD COLUMN IF NOT EXISTS strategy_id TEXT;

-- 2. Backfill strategy_id from strategy_name for any existing rows
--    (strategy_name was the identifier in migration 002's schema)
UPDATE strategy_performance
  SET strategy_id = strategy_name
  WHERE strategy_id IS NULL
    AND strategy_name IS NOT NULL;

-- 3. Backfill remaining NULLs with the UUID id cast to text
UPDATE strategy_performance
  SET strategy_id = id::TEXT
  WHERE strategy_id IS NULL
    AND id IS NOT NULL;

-- 4. Set NOT NULL after backfill (idempotent via DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategy_performance'
      AND column_name = 'strategy_id'
      AND is_nullable = 'YES'
  ) THEN
    -- Delete any rows that still have NULL strategy_id before adding constraint
    DELETE FROM strategy_performance WHERE strategy_id IS NULL;
    ALTER TABLE strategy_performance ALTER COLUMN strategy_id SET NOT NULL;
  END IF;
END $$;

-- 5. Add UNIQUE constraint on strategy_id (required for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategy_performance_strategy_id_key'
      AND conrelid = 'strategy_performance'::regclass
  ) THEN
    ALTER TABLE strategy_performance
      ADD CONSTRAINT strategy_performance_strategy_id_key UNIQUE (strategy_id);
  END IF;
END $$;

-- 6. Add index on strategy_id for query performance
CREATE INDEX IF NOT EXISTS idx_sp_strategy_id
  ON strategy_performance (strategy_id);
