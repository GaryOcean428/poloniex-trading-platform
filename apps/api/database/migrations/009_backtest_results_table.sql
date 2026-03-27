-- Persist individual backtest runs so they survive server restarts.
-- In-memory Map is still used for real-time progress of active backtests;
-- completed / failed runs are written here for history queries.
--
-- NOTE: backtest_results table already exists from migration 002 with a different
-- schema (id VARCHAR(50), strategy_name, symbol, timeframe, final_value, etc.)
-- Using ALTER TABLE to add missing columns instead of CREATE TABLE IF NOT EXISTS
-- which would silently skip and then fail on index creation for non-existent columns.

-- Add missing columns to backtest_results table from migration 002
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS strategy_id TEXT;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running';
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS results JSONB;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Now indexes will succeed because columns exist
CREATE INDEX IF NOT EXISTS idx_backtest_results_user_id ON backtest_results (user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy_id ON backtest_results (strategy_id);
