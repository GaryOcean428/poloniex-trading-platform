-- Add censoring detection columns to backtest_results and paper_trading_sessions.
--
-- Borrowed from QIG bridge-law validation: a measurement is "censored" when
-- the observation hit the ceiling/floor of the measurement window and therefore
-- doesn't represent the true value.  One censored point destroyed an R²=0.95
-- fit (R² dropped to 0.41).  The same artefact exists in trading backtests:
--   • position force-closed at window end   → result is censored
--   • position size limit hit               → return is censored
--   • max-drawdown limit hit during session → P&L is censored
--
-- Callers should filter WHERE is_censored = FALSE (or NULL) when fitting
-- performance models, and compare the two fits to detect reliability issues.

-- backtest_results --------------------------------------------------------
ALTER TABLE backtest_results
    ADD COLUMN IF NOT EXISTS is_censored      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS censoring_reason TEXT    DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_results_is_censored
    ON backtest_results (is_censored);

-- paper_trading_sessions --------------------------------------------------
ALTER TABLE paper_trading_sessions
    ADD COLUMN IF NOT EXISTS is_censored      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS censoring_reason TEXT    DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_is_censored
    ON paper_trading_sessions (is_censored);
