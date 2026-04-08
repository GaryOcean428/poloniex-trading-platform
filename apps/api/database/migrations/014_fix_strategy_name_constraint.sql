-- 014_fix_strategy_name_constraint.sql
-- Fix: agent_strategies has legacy `strategy_name NOT NULL` from old migration 004.
-- The enhanced agent writes to `name` (added in migration 012) but leaves
-- `strategy_name` as NULL, violating the NOT NULL constraint.
-- This migration drops the constraint and backfills from `name`.

-- Drop NOT NULL on strategy_name (if it exists and has NOT NULL)
-- Also backfill and set default — all guarded behind column existence check
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_strategies'
          AND column_name = 'strategy_name'
          AND table_schema = current_schema()
    ) THEN
        -- Drop NOT NULL if set
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'agent_strategies'
              AND column_name = 'strategy_name'
              AND is_nullable = 'NO'
              AND table_schema = current_schema()
        ) THEN
            ALTER TABLE agent_strategies ALTER COLUMN strategy_name DROP NOT NULL;
        END IF;

        -- Backfill: copy name → strategy_name where strategy_name is NULL
        UPDATE agent_strategies
        SET strategy_name = name
        WHERE strategy_name IS NULL
          AND name IS NOT NULL;

        -- Default for future inserts
        ALTER TABLE agent_strategies ALTER COLUMN strategy_name SET DEFAULT '';
    END IF;
END $$;
