-- 067_monkey_reward_shadow.sql
-- Persist dark-mode reward-rpe observer rows and provide a reusable
-- validation harness for readiness/revert gates.

CREATE TABLE IF NOT EXISTS monkey_reward_shadow (
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

CREATE INDEX IF NOT EXISTS idx_monkey_reward_shadow_ts
  ON monkey_reward_shadow(ts DESC);

CREATE INDEX IF NOT EXISTS idx_monkey_reward_shadow_symbol_ts
  ON monkey_reward_shadow(symbol, ts DESC);

CREATE INDEX IF NOT EXISTS idx_monkey_reward_shadow_substrate_ts
  ON monkey_reward_shadow(substrate, ts DESC);
