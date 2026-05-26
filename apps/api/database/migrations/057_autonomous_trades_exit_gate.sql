-- 057_autonomous_trades_exit_gate.sql
--
-- Add exit_gate column to autonomous_trades for per-gate attribution
-- of scalp_exit closes. The outer `exit_reason` is too coarse — it's
-- typically 'scalp_exit' across many distinct inner gates:
--   - bracket_tp / bracket_sl / trailing_harvest / trend_flip_harvest
--   - conviction_failed / regime_change / phi_collapse / stale_bleed
--     / directional_disagreement
--   - regime_held_exit, scalp_classic, profit_harvest, aggregate_harvest
--
-- Per the 2026-05-26 exit-asymmetry audit: 300 scalp_exit closes, rr_ratio
-- 0.65 (losses 1.5× wins at average, 2× at median, slightly longer hold).
-- The cause is gate-attribution-opaque without this column — the audit
-- can't distinguish whether conviction_failed fires on small wins vs
-- bracket_sl handling losses.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
ALTER TABLE autonomous_trades ADD COLUMN IF NOT EXISTS exit_gate VARCHAR(40);

-- Index for analysis queries — we'll be grouping by exit_gate often.
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_exit_gate
  ON autonomous_trades(exit_gate)
  WHERE exit_gate IS NOT NULL;
