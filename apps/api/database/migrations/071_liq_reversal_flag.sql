-- Migration 071: liquidation-cascade reversal feature flag
--
-- Adds MONKEY_LIQ_REVERSAL_LIVE for #795 Class B #8.
-- Starts disabled; enable after validating cascade observer telemetry
-- on live data (dominantSide / totalNotional / clusterThreshold logged
-- at DEBUG level on every cluster detection).
--
-- Schema matches migration 068: flag_key TEXT PK, value TEXT.

INSERT INTO monkey_feature_flags (flag_key, value, updated_by)
VALUES (
  'MONKEY_LIQ_REVERSAL_LIVE',
  'false',
  'migration_071'
) ON CONFLICT (flag_key) DO NOTHING;
