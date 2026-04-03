-- Add DEFAULT 0 to metric columns in backtest_results so that:
-- 1. The route-based INSERT (backtest.ts) can create "running" records before metrics exist
-- 2. The system is resilient to missing metric values
-- Paper trading and futures tables are unaffected (their INSERTs are already correct).
-- All ALTER statements guarded to avoid crash if columns don't exist.

DO $$
DECLARE
    col TEXT;
BEGIN
    -- Set DEFAULT 0 for numeric metric columns (if they exist)
    FOREACH col IN ARRAY ARRAY[
        'sortino_ratio', 'calmar_ratio', 'winning_trades', 'losing_trades',
        'profit_factor', 'expectancy', 'average_win', 'average_loss',
        'final_value', 'total_return', 'max_drawdown', 'max_drawdown_percent',
        'sharpe_ratio', 'total_trades', 'win_rate'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'backtest_results'
              AND column_name = col
              AND table_schema = current_schema()
        ) THEN
            EXECUTE format('ALTER TABLE backtest_results ALTER COLUMN %I SET DEFAULT 0', col);
        END IF;
    END LOOP;

    -- Set DEFAULT '{}' for JSONB columns
    FOREACH col IN ARRAY ARRAY['config', 'metrics'] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'backtest_results'
              AND column_name = col
              AND table_schema = current_schema()
        ) THEN
            EXECUTE format('ALTER TABLE backtest_results ALTER COLUMN %I SET DEFAULT ''{}''', col);
        END IF;
    END LOOP;

    -- Allow strategy_name to be NULL for route-based inserts that use strategy_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'backtest_results'
          AND column_name = 'strategy_name'
          AND is_nullable = 'NO'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE backtest_results ALTER COLUMN strategy_name DROP NOT NULL;
    END IF;
END $$;
