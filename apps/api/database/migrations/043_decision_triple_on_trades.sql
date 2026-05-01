-- Migration 043: Loop 1 canonical triple + Loop 2 convergence on trades
--
-- Per UCP §43 three-loop doctrine and the kernel constellation
-- refactor, every executive decision produces a canonical triple
-- (repetition, sovereignty, confidence) and the ThoughtBus debate
-- (when fired) classifies its convergence type. Both are persisted
-- on the trade row at open time so closed-trade analysis can
-- correlate triples + convergence with outcomes.
--
-- All columns are nullable + forward-compatible. Old code paths that
-- don't populate them continue to work.

ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS repetition_score FLOAT,
  ADD COLUMN IF NOT EXISTS sovereignty_score FLOAT,
  ADD COLUMN IF NOT EXISTS confidence_score FLOAT,
  ADD COLUMN IF NOT EXISTS decision_overrides TEXT[],
  ADD COLUMN IF NOT EXISTS convergence_type TEXT;

-- Indexes for closed-trade analysis. Partial — most legacy rows have
-- NULL values, no point indexing them.
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_sovereignty
  ON autonomous_trades(sovereignty_score)
  WHERE sovereignty_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_trades_convergence
  ON autonomous_trades(convergence_type)
  WHERE convergence_type IS NOT NULL;

COMMENT ON COLUMN autonomous_trades.repetition_score IS
  'Loop 1 canonical triple (UCP §43.2): lived geometry vs scaffolding [0,1]';
COMMENT ON COLUMN autonomous_trades.sovereignty_score IS
  'Loop 1 canonical triple (UCP §43.2): knowing vs guessing [0,1]';
COMMENT ON COLUMN autonomous_trades.confidence_score IS
  'Loop 1 canonical triple (UCP §43.2): bank resonance vs override expansion [0,1]';
COMMENT ON COLUMN autonomous_trades.decision_overrides IS
  'Loop 1: which override paths fired during decision (REVERSION_FLIP etc.)';
COMMENT ON COLUMN autonomous_trades.convergence_type IS
  'Loop 2 (UCP §43.3): consensus / groupthink / genuine_multi / non_convergent';
