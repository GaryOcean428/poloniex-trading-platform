-- 039_agent_separation.sql
--
-- Agent separation: Agent K (geometry-only kernel) and Agent M
-- (ml control arm) now run side-by-side. Trades need an agent
-- attribution column so the arbiter can compute per-agent PnL
-- windows, and so dashboards can compare K's vs M's performance.
--
-- Backfill: every existing autonomous_trades row was kernel-driven
-- (the kernel's old code path was the only writer). Default 'K' on
-- both the column default and the backfill UPDATE.
--
-- Telemetry table: arbiter_allocation logs the K/M split each time
-- the arbiter is consulted (typically every tick where allocation
-- is non-trivial). Lets us replay how capital flowed between agents.

BEGIN;

-- Column: autonomous_trades.agent
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS agent TEXT NOT NULL DEFAULT 'K';

-- Backfill is implicit via the DEFAULT, but make it explicit so the
-- migration is replay-safe even if someone alters the default later.
UPDATE autonomous_trades SET agent = 'K' WHERE agent IS NULL;

-- Constraint: only K or M (forward-compat: more agent labels can be
-- added by altering the check in a later migration).
ALTER TABLE autonomous_trades
  DROP CONSTRAINT IF EXISTS autonomous_trades_agent_check;
ALTER TABLE autonomous_trades
  ADD CONSTRAINT autonomous_trades_agent_check
  CHECK (agent IN ('K', 'M'));

-- Index for per-agent PnL queries (arbiter window readback,
-- dashboard segmentation).
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_agent
  ON autonomous_trades (agent);
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_agent_status_exit_time
  ON autonomous_trades (agent, status, exit_time DESC);

-- Telemetry table: arbiter_allocation
CREATE TABLE IF NOT EXISTS arbiter_allocation (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  k_share         NUMERIC(10, 6) NOT NULL,
  m_share         NUMERIC(10, 6) NOT NULL,
  k_pnl_window    NUMERIC(18, 6) NOT NULL,
  m_pnl_window    NUMERIC(18, 6) NOT NULL,
  k_trades        INTEGER NOT NULL,
  m_trades        INTEGER NOT NULL,
  total_capital   NUMERIC(18, 6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arbiter_allocation_ts
  ON arbiter_allocation (ts DESC);

COMMIT;

-- Rollback (manual; run if reverting):
-- BEGIN;
-- ALTER TABLE autonomous_trades DROP CONSTRAINT IF EXISTS autonomous_trades_agent_check;
-- DROP INDEX IF EXISTS idx_autonomous_trades_agent;
-- DROP INDEX IF EXISTS idx_autonomous_trades_agent_status_exit_time;
-- ALTER TABLE autonomous_trades DROP COLUMN IF EXISTS agent;
-- DROP TABLE IF EXISTS arbiter_allocation;
-- COMMIT;
