-- Migration 069: exemplar feedback feature flag
--
-- Adds EXEMPLAR_FEEDBACK_ENABLED for #1033 PR2 (kernel consuming CC
-- exemplar decisions to adjust entry threshold).
-- Starts disabled (false) for staged rollout — enable after observing
-- exemplar decision quality in production.
--
-- Schema matches migration 068: flag_key TEXT PK, value TEXT.

INSERT INTO monkey_feature_flags (flag_key, value, updated_by)
VALUES (
  'EXEMPLAR_FEEDBACK_ENABLED',
  'false',
  'migration_069'
) ON CONFLICT (flag_key) DO NOTHING;
