-- Migration 027: Promotion / demotion engine state
--
-- Adds columns and tables needed for the multi-metric promotion pipeline:
--
--   * strategy_performance gains tier / demotion / recalibration fields
--     so the promotion engine can track each strategy's earn-in history
--     without contending on a hot row (new events go to
--     strategy_state_events; these fields are the derived projection).
--
--   * bandit_class_counters — Beta(wins, losses) posterior per
--     (strategy_class × regime) pair that drives Thompson sampling in
--     the generator.
--
--   * frozen_cohorts — genome archive of retired champions per regime.
--     Reactivated when the same regime recurs.

-- ───────── strategy_performance: tier + demotion state ─────────
ALTER TABLE strategy_performance
  ADD COLUMN IF NOT EXISTS live_tier             SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demotion_count        SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_demotion_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifetime_realised_pnl NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recalibration_cycles  SMALLINT    NOT NULL DEFAULT 0;

-- Allow the new 'recalibrating' status. strategy_performance.status is
-- an un-constrained TEXT column in the base schema, so no CHECK needed.
-- We just make sure common queries can filter by it.
CREATE INDEX IF NOT EXISTS idx_strategy_performance_status_tier
  ON strategy_performance(status, live_tier)
  WHERE deleted_at IS NULL;

-- ───────── bandit_class_counters ─────────
-- Thompson bandit posterior. One row per (class, regime) pair.
-- Updated on every terminal trade outcome by the promotion engine.
CREATE TABLE IF NOT EXISTS bandit_class_counters (
    strategy_class   TEXT        NOT NULL,
    regime           TEXT        NOT NULL,
    wins             INTEGER     NOT NULL DEFAULT 1,   -- Beta(α,β): α=1 starting prior
    losses           INTEGER     NOT NULL DEFAULT 1,   --           β=1 starting prior
    last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (strategy_class, regime)
);

-- ───────── frozen_cohorts ─────────
-- Champion archive. When a strategy is retired while it had positive
-- lifetime_realised_pnl, its genome + regime tag is snapshotted here
-- so the bandit can re-activate it if the regime recurs.
CREATE TABLE IF NOT EXISTS frozen_cohorts (
    id                BIGSERIAL   PRIMARY KEY,
    strategy_id       TEXT        NOT NULL,
    strategy_class    TEXT        NOT NULL,
    regime            TEXT        NOT NULL,
    signal_genome     JSONB       NOT NULL,
    lifetime_pnl      NUMERIC(14,4) NOT NULL,
    live_trades       INTEGER     NOT NULL,
    paper_trades      INTEGER     NOT NULL,
    frozen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    frozen_reason     TEXT        NOT NULL,
    engine_version    VARCHAR(40) NOT NULL,
    reactivated_count SMALLINT    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_frozen_cohorts_regime_pnl
  ON frozen_cohorts(regime, lifetime_pnl DESC);

CREATE INDEX IF NOT EXISTS idx_frozen_cohorts_strategy
  ON frozen_cohorts(strategy_id);
