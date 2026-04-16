-- Migration 023: Move SLE runtime schema fixes to a proper migration
-- Previously these ran on every SLE startup in ensureSchemaDefaults()

-- 1. Set DEFAULT 0 on numeric columns that SLE omits from INSERT
ALTER TABLE strategy_performance ALTER COLUMN backtest_count SET DEFAULT 0;
ALTER TABLE strategy_performance ALTER COLUMN avg_return SET DEFAULT 0;
ALTER TABLE strategy_performance ALTER COLUMN avg_sharpe_ratio SET DEFAULT 0;
ALTER TABLE strategy_performance ALTER COLUMN avg_max_drawdown SET DEFAULT 0;
ALTER TABLE strategy_performance ALTER COLUMN win_rate SET DEFAULT 0;

-- 2. Drop NOT NULL on columns not always provided
ALTER TABLE strategy_performance ALTER COLUMN avg_max_drawdown DROP NOT NULL;
ALTER TABLE strategy_performance ALTER COLUMN win_rate DROP NOT NULL;
ALTER TABLE strategy_performance ALTER COLUMN last_backtest_date DROP NOT NULL;

-- 3. Drop view before widening columns (PG blocks ALTER on view-referenced columns)
DROP VIEW IF EXISTS strategy_performance_summary CASCADE;

-- 4. Widen numeric columns to NUMERIC(12,6) for precision
DO $$
DECLARE
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'backtest_sharpe', 'backtest_wr', 'backtest_max_dd',
    'paper_sharpe', 'paper_wr', 'paper_pnl',
    'live_sharpe', 'live_pnl',
    'uncensored_sharpe', 'confidence_score',
    'avg_sharpe_ratio', 'avg_return'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE strategy_performance ALTER COLUMN %I TYPE NUMERIC(12,6)', col);
    EXCEPTION WHEN undefined_column THEN
      NULL; -- Column may not exist yet on fresh installs
    END;
  END LOOP;
END $$;

-- 5. Recreate the summary view
CREATE OR REPLACE VIEW strategy_performance_summary AS
SELECT s.name, s.type, s.description,
    COALESCE(sp.avg_return, 0) as avg_return,
    COALESCE(sp.avg_sharpe_ratio, 0) as avg_sharpe_ratio,
    COALESCE(sp.avg_max_drawdown, 0) as avg_max_drawdown,
    COALESCE(sp.win_rate, 0) as win_rate,
    COALESCE(sp.confidence_score, 0) as confidence_score,
    COALESCE(sp.backtest_count, 0) as backtest_count,
    sp.last_backtest_date, s.created_at, s.updated_at
FROM strategy_definitions s
LEFT JOIN strategy_performance sp ON s.name = sp.strategy_name
WHERE s.is_active = true;

-- 6. Ensure signal_genome column exists (also in migration 021, but safe to repeat)
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS signal_genome JSONB;
