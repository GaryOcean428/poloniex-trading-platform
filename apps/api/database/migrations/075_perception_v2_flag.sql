-- Migration 075: SENSE-2 perception market microstructure flag
--
-- Adds PERCEPTION_V2_LIVE for #768 + #769.
-- When false (default), dims 59-63 remain at 0.5 neutral and dims 39-45
-- remain at NOISE_FLOOR_VALUE. When true (or inputs provided by loop.ts),
-- dims 59-63 encode funding rate, book imbalance, BTC beacon and time-of-day,
-- and dims 39-45 encode drawdown trajectory + execution quality.
--
-- Loop.ts must provide PerceptionInputsV2/V3 fields when enabled.
-- Schema matches migration 068: flag_key TEXT PK, value TEXT.

INSERT INTO monkey_feature_flags (flag_key, value, updated_by)
VALUES (
  'PERCEPTION_V2_LIVE',
  'false',
  'migration_075'
) ON CONFLICT (flag_key) DO NOTHING;
