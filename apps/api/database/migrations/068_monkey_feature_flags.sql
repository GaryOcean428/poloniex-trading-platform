-- Migration 068: Monkey feature-flag control plane
--
-- Moves operator on/off feature controls off Railway env vars and into a
-- DB-backed table the operator drives from the UI (mirrors agent_execution_mode,
-- migration 029). One row per flag for per-flag audit (who/when last changed).
--
-- ONLY operator MANDATE / FEATURE on-off toggles live here. Numeric CALIBRATION
-- thresholds (fast-adverse, harvest %, min-tape-strength, …) are deliberately
-- EXCLUDED — per the P1 doctrine those are observer-derived, never operator knobs.
--
-- `value` is TEXT so the service can parse bool ('true'/'false') today and
-- numeric/CSV values (paper equity, arbiter agents) later without a schema change.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; seeds use ON CONFLICT DO NOTHING so
-- re-application never clobbers an operator's chosen value.

CREATE TABLE IF NOT EXISTS monkey_feature_flags (
    flag_key    TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the operator on/off flags with their CURRENT effective values so that
-- when loop.ts later reads them from the service instead of process.env, live
-- behaviour is preserved exactly. Values reflect the production env / code
-- defaults as of 2026-06-01.
INSERT INTO monkey_feature_flags (flag_key, value, updated_by) VALUES
    ('MONKEY_SHORTS_LIVE',           'true',  'migration_068'),
    ('MONKEY_MARKET_INTEL_LIVE',     'false', 'migration_068'),
    ('MONKEY_FUNDING_GATE_LIVE',     'false', 'migration_068'),
    ('MONKEY_MAKER_CLOSE_LIVE',      'false', 'migration_068'),
    ('MONKEY_WS_PRIVATE_LIVE',       'false', 'migration_068'),
    ('L_VETO_OVER_K_ENABLED',        'false', 'migration_068'),
    ('MONKEY_BRACKET_EXIT_LIVE',     'true',  'migration_068'),
    ('MONKEY_BRACKET_EXTEND_LIVE',   'true',  'migration_068'),
    ('MONKEY_SLOW_BLEED_LIVE',       'true',  'migration_068'),
    ('MONKEY_FAST_ADVERSE_LIVE',     'true',  'migration_068'),
    ('MONKEY_TAPE_OVERRIDE_LIVE',    'true',  'migration_068'),
    ('MONKEY_MTF_BOOTSTRAP',         'true',  'migration_068'),
    ('REGIME_COMPOSITIONAL_LIVE',    'true',  'migration_068'),
    ('REGIME_HELD_EXIT_LIVE',        'true',  'migration_068'),
    ('SCALP_LIMIT_MAKER_LIVE',       'true',  'migration_068'),
    ('SCALP_LIMIT_MAKER_BROAD',      'true',  'migration_068')
ON CONFLICT (flag_key) DO NOTHING;
