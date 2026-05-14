-- turn_on_trend_lane.sql
--
-- Flip the trend lane ON. Was structurally disabled (budgetFrac=0.0)
-- since the lane envelope was introduced — set to 0.10 (10% of equity)
-- per 2026-05-05 user directive.
--
-- chooseLane's trend score is phi × sovereignty × |tapeTrend|, so the
-- trend lane only wins the softmax when:
--   - the kernel sees coherent macro flow (high Φ)
--   - the kernel is mature (high sovereignty)
--   - the tape is strongly directional (large |tapeTrend|)
--
-- Conservative experimental start at 10%. The Arbiter (capital
-- allocation across K/M/T agents) will adjust based on PnL track record
-- — if trend agents underperform, allocation shrinks. If they outperform,
-- allocation grows.
--
-- The notional ceiling (NOTIONAL_CEILING_RATIO = 4× equity) remains the
-- hard cap on simultaneous multi-lane exposure. Sum across lanes is now
-- 1.10 (scalp 0.50 + swing 0.50 + trend 0.10) — exceeds 1.0 by intent;
-- the ceiling enforces simultaneous-open discipline.
--
-- Apply:
--   psql "$DATABASE_URL" -f ml-worker/scripts/turn_on_trend_lane.sql
--
-- Verify:
--   SELECT name, value, version, updated_at, updated_by, justification
--     FROM monkey_parameters
--     WHERE name = 'executive.lane.trend.budget_frac';
--
-- Rollback (back to 0.0 structurally disabled):
--   UPDATE monkey_parameters
--      SET value = 0.0, version = version + 1, updated_at = NOW()
--    WHERE name = 'executive.lane.trend.budget_frac';
--
-- Plus revert the corresponding TS default in executive.ts and the test
-- in laneIsolation.test.ts (TS does not yet read the registry — both
-- sides are kept in lockstep manually until the registry-port lands).

BEGIN;

INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.trend.budget_frac',
  'OPERATIONAL',
  0.10,
  0.0,
  0.50,
  '2026-05-05 user directive: flip trend lane on. 10% of equity allocation. Conservative experimental start; can be raised after Arbiter accumulates 5+ trend closes per agent.',
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
