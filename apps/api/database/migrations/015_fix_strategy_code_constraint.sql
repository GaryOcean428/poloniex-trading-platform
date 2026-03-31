-- 015_fix_strategy_code_constraint.sql
-- Fix: agent_strategies has legacy `strategy_code NOT NULL` from old migration 004.
-- The enhanced agent writes to `code` (added in migration 012) but leaves
-- `strategy_code` as NULL, violating the NOT NULL constraint.
-- Same pattern as 014 (strategy_name). Fix both remaining legacy NOT NULL columns.

-- Drop NOT NULL on strategy_code
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_strategies'
          AND column_name = 'strategy_code'
          AND is_nullable = 'NO'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE agent_strategies ALTER COLUMN strategy_code DROP NOT NULL;
    END IF;
END $$;

-- Backfill: copy code → strategy_code where strategy_code is NULL
UPDATE agent_strategies
SET strategy_code = code
WHERE strategy_code IS NULL
  AND code IS NOT NULL;

ALTER TABLE agent_strategies ALTER COLUMN strategy_code SET DEFAULT '';

-- Also drop NOT NULL on generation_prompt and claude_response if they exist
-- (old migration 004 columns that the new code never writes to)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_strategies'
          AND column_name = 'generation_prompt'
          AND is_nullable = 'NO'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE agent_strategies ALTER COLUMN generation_prompt DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_strategies'
          AND column_name = 'claude_response'
          AND is_nullable = 'NO'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE agent_strategies ALTER COLUMN claude_response DROP NOT NULL;
    END IF;
END $$;
