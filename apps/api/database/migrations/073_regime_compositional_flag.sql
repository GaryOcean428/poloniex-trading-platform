-- Migration 073: REGIME-1 #766 — register REGIME_COMPOSITIONAL_LIVE flag
--
-- The flag was first seeded in migration 068 (with value 'true' reflecting the
-- production env at 2026-06-01). This migration registers it with
-- updated_by='migration_073' so it is distinguishable in the audit log.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-application is safe and does NOT
-- overwrite an operator's chosen value.
--
-- Note: REGIME_COMPOSITIONAL_LIVE=false (shadow-only) is the SAFE default.
-- When false, regime_authority still runs for telemetry/shadow-log on every tick;
-- only phaseSuppressEntry enforcement is skipped — legacy chopSuppressEntry applies.
-- Set to 'true' to activate phase×direction suppression via the 3×3 ADR matrix.

INSERT INTO monkey_feature_flags (flag_key, value, updated_by)
VALUES (
  'REGIME_COMPOSITIONAL_LIVE',
  'false',
  'migration_073'
)
ON CONFLICT (flag_key) DO NOTHING;
