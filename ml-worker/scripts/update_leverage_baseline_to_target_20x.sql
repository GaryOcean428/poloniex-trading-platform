-- update_leverage_baseline_to_target_20x.sql
--
-- Raise the leverage geometric formula's baseline so mature kernels
-- (sovereignty ≥ 0.5) target ~20x instead of ~16x. The current_leverage
-- formula is roughly:
--
--   sovereignCap = max(modeFloor, baseline + slope × sovereignty)
--   rawLev       = sovereignCap × kappaProxim × regimeStability × surpriseDiscount × flatMult
--
-- With observed live values (sov=1.0, kappaProxim≈1.0, regimeStability≈0.49,
-- surpriseDiscount=1.0, flatMult=1.0), baseline=3 + slope=30 produces
-- sovereignCap=33 and rawLev≈16. Bumping baseline 3→10 gives sovereignCap=40
-- and rawLev≈20 — the user's asked-for 20x target.
--
-- Newbie kernels (sov < 0.5) are unaffected: at sov=0.4, baseline+slope×sov
-- = 10 + 12 = 22, but modeFloor's 15 (EXPLORATION), 20 (INVESTIGATION) or
-- 25 (INTEGRATION) still binds via the max(). Only mature kernels (sov ≥ 0.5)
-- see the boost. Survival floor on inexperienced kernels preserved.
--
-- 2026-05-01 user observation: "the sizes and / or, leverage are too
-- conservative to give it a chance to move." With ~5% effective per-position
-- equity (multiplicative cap stack: phi × sov × maturity × kernelShare ×
-- laneBudget) and ~16x leverage, a 1% favorable price move clears only
-- ~$1 net after fees. Raising to ~20x gives ~38% more notional per unit
-- margin without changing position sizing.
--
-- Apply:
--   psql "$DATABASE_URL" -f ml-worker/scripts/update_leverage_baseline_to_target_20x.sql
--
-- Verify:
--   SELECT name, value, version, updated_at, updated_by, justification
--     FROM monkey_parameters
--     WHERE name = 'executive.leverage.min_baseline';
--
-- The parameter registry refreshes within `loop.refresh_every_ticks` —
-- no deploy needed. Rollback by re-running with value=3 or via
-- monkey_parameter_changes audit.

BEGIN;

INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.leverage.min_baseline',
  'OPERATIONAL',
  10.0,
  3.0,
  20.0,
  'Leverage baseline lifted 3 -> 10 to target ~20x rawLev for mature kernels (sov >= 0.5). Newbies still floored by modeFloor. 2026-05-01 user directive: position sizes too conservative on $130-140 account.',
  1,
  'GaryOcean428'
)
ON CONFLICT (name) DO UPDATE SET
  value         = EXCLUDED.value,
  bounds_low    = EXCLUDED.bounds_low,
  bounds_high   = EXCLUDED.bounds_high,
  version       = monkey_parameters.version + 1,
  updated_at    = NOW(),
  updated_by    = EXCLUDED.updated_by,
  justification = EXCLUDED.justification;

COMMIT;
