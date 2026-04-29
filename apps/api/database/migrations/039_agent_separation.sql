-- Migration 039: Agent K (kernel) / Agent M (ml) separation
--
-- Adds the schema needed to track which agent placed each trade and
-- to record per-tick capital allocation telemetry from the arbiter.
--
-- 1. autonomous_trades.agent — 'K' (kernel, geometry-only) or 'M'
--    (ml, threshold-based). Default 'K' so existing rows attribute
--    to the kernel (everything pre-separation was kernel-driven).
-- 2. arbiter_allocation — per-tick snapshot of K/M capital share +
--    rolling-window PnL totals + trade counts. Used for offline
--    analysis of how the arbiter responds to performance.

ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS agent TEXT NOT NULL DEFAULT 'K';

ALTER TABLE autonomous_trades
  ADD CONSTRAINT autonomous_trades_agent_check
    CHECK (agent IN ('K', 'M'));

CREATE INDEX IF NOT EXISTS idx_autonomous_trades_agent_created
  ON autonomous_trades (agent, created_at DESC);

CREATE TABLE IF NOT EXISTS arbiter_allocation (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  symbol VARCHAR(50) NOT NULL,
  total_capital_usdt DECIMAL(20, 8) NOT NULL,
  k_share DECIMAL(6, 4) NOT NULL,
  m_share DECIMAL(6, 4) NOT NULL,
  k_pnl_window_total DECIMAL(20, 8) NOT NULL,
  m_pnl_window_total DECIMAL(20, 8) NOT NULL,
  k_trades_in_window INTEGER NOT NULL,
  m_trades_in_window INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arbiter_allocation_recorded
  ON arbiter_allocation (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_arbiter_allocation_symbol_recorded
  ON arbiter_allocation (symbol, recorded_at DESC);
