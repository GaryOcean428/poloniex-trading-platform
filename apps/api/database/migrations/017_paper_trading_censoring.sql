-- Migration 017: Add censoring columns to paper_trading_sessions
--
-- A paper trading session is "censored" when its true outcome is unknown because:
--   1. It hit the max drawdown kill threshold (could have lost more)
--   2. A position was force-closed at session end (winning streak or loss streak truncated)
--   3. It hit the position size limit and couldn't open new trades
--
-- This follows the QIG censoring pattern: computing Sharpe/WR without flagging censored
-- sessions can destroy model quality (see issue #410 where one censored point dropped R² 0.95→0.41).
--
-- Censored sessions are excluded from live-promotion fitness calculations.

ALTER TABLE paper_trading_sessions
  ADD COLUMN IF NOT EXISTS is_censored BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS censor_reason TEXT;

-- Index for filtering uncensored sessions in performance queries
CREATE INDEX IF NOT EXISTS idx_paper_sessions_censored
  ON paper_trading_sessions (is_censored)
  WHERE is_censored = FALSE;

COMMENT ON COLUMN paper_trading_sessions.is_censored IS
  'TRUE when session outcome is censored: hit max drawdown kill, position size limit, or had open positions force-closed at session end. Censored sessions are excluded from live promotion fitness calculations.';

COMMENT ON COLUMN paper_trading_sessions.censor_reason IS
  'One of: max_drawdown_kill, position_size_limit, session_end_forced_close. NULL when not censored.';
