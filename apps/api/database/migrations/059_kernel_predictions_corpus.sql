-- 059_kernel_predictions_corpus.sql
--
-- Prediction / expectation corpus for QIG kill-test analysis.
-- Read-side instrumentation only: the trading path writes snapshots of
-- what the kernel believed and later jobs score realised outcomes.

CREATE TABLE IF NOT EXISTS kernel_predictions (
  id                          BIGSERIAL PRIMARY KEY,
  trade_id                    UUID REFERENCES autonomous_trades(id) ON DELETE CASCADE,
  kernel_id                   TEXT NOT NULL,
  snapshot_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  perception_basin            FLOAT8[] NOT NULL,
  strategy_forecast_basin     FLOAT8[] NOT NULL,
  fisher_rao_disagreement     FLOAT8 NOT NULL,
  basin_velocity              FLOAT8,
  phi                         FLOAT8,
  kappa_eff                   FLOAT8,

  predicted_horizon_seconds   FLOAT8,
  predicted_terminal_pnl_usdt FLOAT8,
  predicted_pnl_stddev_usdt   FLOAT8,
  predicted_direction         SMALLINT,
  predicted_confidence        FLOAT8,

  dopamine                    FLOAT8,
  serotonin                   FLOAT8,
  norepinephrine              FLOAT8,
  gaba                        FLOAT8,
  endorphins                  FLOAT8,
  acetylcholine               FLOAT8,

  regime_quantum              FLOAT8,
  regime_efficient            FLOAT8,
  regime_equilibrium          FLOAT8,
  mode                        TEXT,
  lane                        TEXT,

  snapshot_reason             TEXT NOT NULL,
  triggering_gate             TEXT,

  kernel_version              TEXT NOT NULL,
  source_path                 TEXT NOT NULL,

  CONSTRAINT kernel_predictions_perception_basin_64
    CHECK (array_length(perception_basin, 1) = 64),
  CONSTRAINT kernel_predictions_strategy_forecast_basin_64
    CHECK (array_length(strategy_forecast_basin, 1) = 64)
);

CREATE INDEX IF NOT EXISTS idx_kernel_predictions_trade_id
  ON kernel_predictions(trade_id);
CREATE INDEX IF NOT EXISTS idx_kernel_predictions_snapshot_at
  ON kernel_predictions(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_kernel_predictions_kernel_at
  ON kernel_predictions(kernel_id, snapshot_at);

CREATE TABLE IF NOT EXISTS kernel_outcome_residuals (
  id                          BIGSERIAL PRIMARY KEY,
  prediction_id               BIGINT NOT NULL REFERENCES kernel_predictions(id) ON DELETE CASCADE,
  evaluated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_since_prediction_s     FLOAT8 NOT NULL,

  predicted_pnl_at_eval_usdt  FLOAT8 NOT NULL,
  realised_pnl_at_eval_usdt   FLOAT8 NOT NULL,
  residual_usdt               FLOAT8 NOT NULL,
  residual_normalized         FLOAT8 NOT NULL,

  direction_match             BOOLEAN NOT NULL,
  within_1_sigma              BOOLEAN NOT NULL,
  within_2_sigma              BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kernel_outcome_residuals_prediction_id
  ON kernel_outcome_residuals(prediction_id);
CREATE INDEX IF NOT EXISTS idx_kernel_outcome_residuals_time_horizon
  ON kernel_outcome_residuals(time_since_prediction_s);

ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS prediction_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_residual_usdt FLOAT8,
  ADD COLUMN IF NOT EXISTS final_residual_normalized FLOAT8;
