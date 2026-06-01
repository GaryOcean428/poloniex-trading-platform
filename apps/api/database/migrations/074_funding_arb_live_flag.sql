-- Migration 074: funding-arb live entry flag
--
-- Adds FUNDING_ARB_LIVE for #794 Class B #7.
-- Starts disabled; enable after validating funding-arb observer telemetry
-- on live data (signalFires / zScore / betaEthVsBtc logged at INFO level
-- on every signal detection).
--
-- Schema matches migration 068: flag_key TEXT PK, value TEXT.

INSERT INTO monkey_feature_flags (flag_key, value, updated_by)
VALUES (
  'FUNDING_ARB_LIVE',
  'false',
  'migration_074'
) ON CONFLICT (flag_key) DO NOTHING;
