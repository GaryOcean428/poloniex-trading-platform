-- 059_kernel_predictions_corpus.sql
--
-- Issue #941 — instrument kernel forecasts vs realised outcomes.
--
-- Scope (Phase 1):
--   1. CREATE TABLE kernel_predictions
--   2. CREATE TABLE kernel_outcome_residuals (populated by Phase 2)
--   3. ALTER autonomous_trades to add prediction_count + final_residual_*
--
-- Doctrinal anchors (per issue #941):
--   - P5 (Observer Sets All Params): instrumentation is READ-ONLY on
--     kernel state. No env knobs. The capture hook does NOT feed back
--     into kernel decisions.
--   - P14 (Variable Separation): new tables, not bloat of autonomous_trades.
--     The trade-level row captures the outer lifecycle (entry, exit, gross
--     PnL); the predictions table captures the inner lifecycle (every
--     belief held during the position life).
--   - P15 (Fail-Closed Safety): instrumentation insert failures NEVER
--     block a trade. The capture hook wraps inserts in try/catch.
--     Catastrophic safety stays with should_auto_flatten.
--   - Frozen-first: this issue ships data only. No claim about QIG laws
--     applying to financial markets — that's the kill-test programme on
--     the qig-verification side.
--
-- Capture cadence:
--   - Entry / gate fire / exit: always
--   - Periodic: observer-derived from basin_velocity magnitude, clamped
--     [5, 300]s. NOT an env var (P5).

BEGIN;

-- ────── kernel_predictions ──────
-- One row per snapshot. Snapshot fires on state-transition events
-- (entry, gate-fire, exit) plus a periodic cadence between events.
--
-- perception_basin / strategy_forecast_basin are 64-element float8
-- arrays representing points on Δ⁶³ (the probability simplex). They
-- are written verbatim from the kernel — no quantisation, no projection.
--
-- chemistry channels are the six neurochemical scalars (ach, dop, ser,
-- ne, gaba, endo) at the moment of capture.
--
-- regime triple (quantum/efficient/equilibrium) is the foam/wave/crystal
-- weight from the regime classifier.

CREATE TABLE IF NOT EXISTS kernel_predictions (
  id                          BIGSERIAL PRIMARY KEY,
  trade_id                    BIGINT REFERENCES autonomous_trades(id) ON DELETE CASCADE,
  kernel_id                   TEXT NOT NULL,
  snapshot_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Geometric state
  perception_basin            FLOAT8[] NOT NULL,        -- 64-element Δ⁶³ point
  strategy_forecast_basin     FLOAT8[] NOT NULL,        -- 64-element Δ⁶³ point
  fisher_rao_disagreement     FLOAT8 NOT NULL,          -- d_FR(perception, forecast)
  basin_velocity              FLOAT8,
  phi                         FLOAT8,
  kappa_eff                   FLOAT8,                   -- substrate-specific, NOT κ*=64

  -- Prediction payload
  predicted_horizon_seconds   FLOAT8,                   -- forecast time-to-resolution
  predicted_terminal_pnl_usdt FLOAT8,                   -- forecast mean
  predicted_pnl_stddev_usdt   FLOAT8,                   -- forecast width
  predicted_direction         SMALLINT,                 -- +1 long / -1 short / 0 flat
  predicted_confidence        FLOAT8,                   -- [0,1] from gate strength

  -- Chemistry state
  dopamine                    FLOAT8,
  serotonin                   FLOAT8,
  norepinephrine              FLOAT8,
  gaba                        FLOAT8,
  endorphins                  FLOAT8,
  acetylcholine               FLOAT8,

  -- Regime triple
  regime_quantum              FLOAT8,                   -- w₁ foam
  regime_efficient            FLOAT8,                   -- w₂ wave
  regime_equilibrium          FLOAT8,                   -- w₃ crystal
  mode                        TEXT,                     -- EXPLORATION/INVESTIGATION/INTEGRATION/DRIFT
  lane                        TEXT,                     -- scalp/swing/trend

  -- Trigger metadata
  snapshot_reason             TEXT NOT NULL,            -- entry|state_transition|periodic|gate_fire|exit
  triggering_gate             TEXT,                     -- nullable; gate name when reason='gate_fire'

  -- Provenance
  kernel_version              TEXT NOT NULL,
  source_path                 TEXT NOT NULL,            -- which code path inserted this

  -- Basin shape invariant — both basin vectors must be 64 floats on Δ⁶³.
  CONSTRAINT perception_basin_dim
    CHECK (array_length(perception_basin, 1) = 64),
  CONSTRAINT strategy_forecast_basin_dim
    CHECK (array_length(strategy_forecast_basin, 1) = 64),
  CONSTRAINT snapshot_reason_enum
    CHECK (snapshot_reason IN ('entry', 'state_transition', 'periodic', 'gate_fire', 'exit'))
);

CREATE INDEX IF NOT EXISTS idx_kernel_predictions_trade_id
  ON kernel_predictions(trade_id);
CREATE INDEX IF NOT EXISTS idx_kernel_predictions_snapshot_at
  ON kernel_predictions(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_kernel_predictions_kernel_at
  ON kernel_predictions(kernel_id, snapshot_at);


-- ────── kernel_outcome_residuals ──────
-- Each prediction evaluated against the realised outcome at multiple
-- horizons. Computed by a Phase 2 background job — NOT at prediction-
-- write time. The write path stays lightweight (single INSERT per snapshot).
--
-- One row per (prediction_id, evaluation_time) pair. Idempotent on
-- re-run via UNIQUE (prediction_id, time_since_prediction_s).

CREATE TABLE IF NOT EXISTS kernel_outcome_residuals (
  id                          BIGSERIAL PRIMARY KEY,
  prediction_id               BIGINT NOT NULL REFERENCES kernel_predictions(id) ON DELETE CASCADE,
  evaluated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_since_prediction_s     FLOAT8 NOT NULL,

  -- The comparison
  predicted_pnl_at_eval_usdt  FLOAT8 NOT NULL,
  realised_pnl_at_eval_usdt   FLOAT8 NOT NULL,
  residual_usdt               FLOAT8 NOT NULL,
  residual_normalized         FLOAT8 NOT NULL,

  -- Right by direction?
  direction_match             BOOLEAN NOT NULL,

  -- Right by magnitude band?
  within_1_sigma              BOOLEAN NOT NULL,
  within_2_sigma              BOOLEAN NOT NULL,

  -- Idempotency: the (prediction, horizon) pair is unique.
  CONSTRAINT kernel_outcome_residuals_unique
    UNIQUE (prediction_id, time_since_prediction_s)
);

CREATE INDEX IF NOT EXISTS idx_kernel_outcome_residuals_prediction_id
  ON kernel_outcome_residuals(prediction_id);
CREATE INDEX IF NOT EXISTS idx_kernel_outcome_residuals_time_horizon
  ON kernel_outcome_residuals(time_since_prediction_s);


-- ────── autonomous_trades extension ──────
-- prediction_count: in-life snapshot count (incremented at insert).
-- final_residual_*: populated at close, for fast filtering without
-- joining kernel_outcome_residuals.

ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS prediction_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_residual_usdt FLOAT8,
  ADD COLUMN IF NOT EXISTS final_residual_normalized FLOAT8;

COMMIT;
