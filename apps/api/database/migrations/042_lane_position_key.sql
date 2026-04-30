-- Migration 042: Lane-isolated position lifecycle (proposal #10)
--
-- Position is now keyed by (agent, symbol, lane). A K_SWING_LONG and a
-- K_SCALP_SHORT on BTC_USDT_PERP coexist as two distinct positions
-- tracked independently with their own SL/TP, peak-PnL, DCA state, and
-- capital share.
--
-- The user's design principle (proposal #10):
--   "the kernel should still not be impacted by disagreement with ML
--    they are separate. and its perfectly legitimate for a long term
--    long to be held and isolated short short term trades to ride the
--    bumps along the way and vice versa. its the difference between
--    trend/swing trades and scalping."
--
-- Backward compatibility: every pre-#10 row is in the implicit "swing"
-- lane via the column default. The reconciler keeps working without
-- intervention; new rows specify their lane explicitly.

ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS lane TEXT NOT NULL DEFAULT 'swing';

UPDATE autonomous_trades SET lane = 'swing' WHERE lane IS NULL;

ALTER TABLE autonomous_trades
  DROP CONSTRAINT IF EXISTS autonomous_trades_lane_check;
ALTER TABLE autonomous_trades
  ADD CONSTRAINT autonomous_trades_lane_check
    CHECK (lane IN ('scalp', 'swing', 'trend'));

-- Per-(agent, symbol, lane) lookup is the hot path for the lane-aware
-- position lifecycle in monkey_kernel/loop.ts::findOpenMonkeyTrade and
-- the reconciler.
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_agent_symbol_lane_status
  ON autonomous_trades (agent, symbol, lane, status);
