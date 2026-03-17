-- Persist individual backtest runs so they survive server restarts.
-- In-memory Map is still used for real-time progress of active backtests;
-- completed / failed runs are written here for history queries.

CREATE TABLE IF NOT EXISTS backtest_results (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  strategy_id     TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  initial_capital NUMERIC NOT NULL DEFAULT 10000,
  timeframe       TEXT NOT NULL DEFAULT '1h',
  status          TEXT NOT NULL DEFAULT 'running',
  progress        INTEGER NOT NULL DEFAULT 0,
  results         JSONB,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_user_id ON backtest_results (user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy_id ON backtest_results (strategy_id);
