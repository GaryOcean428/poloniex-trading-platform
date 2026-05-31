-- 067_monkey_reward_rpe_evidence.sql
-- Persist live reward-rpe close evidence and provide reusable
-- readiness/degradation telemetry.

CREATE TABLE IF NOT EXISTS monkey_reward_rpe_evidence (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  substrate TEXT NOT NULL CHECK (substrate IN ('ts', 'py')),
  realized_pnl_frac DOUBLE PRECISION NOT NULL,
  predicted_pnl_frac DOUBLE PRECISION,
  sigma_residual DOUBLE PRECISION,
  phasic_rpe DOUBLE PRECISION NOT NULL,
  legibility DOUBLE PRECISION,
  regime TEXT,
  regime_persisted DOUBLE PRECISION,
  legacy_dop DOUBLE PRECISION NOT NULL,
  legacy_ser DOUBLE PRECISION NOT NULL,
  legacy_endo DOUBLE PRECISION NOT NULL,
  proposed_dop DOUBLE PRECISION NOT NULL,
  proposed_ser DOUBLE PRECISION NOT NULL,
  proposed_endo DOUBLE PRECISION NOT NULL,
  tonic_baseline DOUBLE PRECISION NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monkey_reward_rpe_evidence_ts
  ON monkey_reward_rpe_evidence(ts DESC);

CREATE INDEX IF NOT EXISTS idx_monkey_reward_rpe_evidence_symbol_ts
  ON monkey_reward_rpe_evidence(symbol, ts DESC);

CREATE INDEX IF NOT EXISTS idx_monkey_reward_rpe_evidence_substrate_ts
  ON monkey_reward_rpe_evidence(substrate, ts DESC);
