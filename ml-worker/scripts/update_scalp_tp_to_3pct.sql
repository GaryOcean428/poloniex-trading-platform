-- update_scalp_tp_to_3pct.sql
--
-- Lane parameter envelope (#610) reads ``executive.lane.scalp.tp_pct``
-- from the monkey_parameters registry. Lift the scalp TP from the
-- seeded 0.5% to 3.0% so the scalp lane locks profit at +3% ROI.
--
-- 2026-04-30 trade-tape evidence: scalps regularly hit 3%+ unrealized
-- then give back to TP=0.5% — the lane is leaving real ROI on the
-- table. Trend/swing TP envelopes are untouched.
--
-- Apply:
--   psql "$DATABASE_URL" -f ml-worker/scripts/update_scalp_tp_to_3pct.sql
--
-- Verify:
--   SELECT name, value, version, updated_at, updated_by, justification
--     FROM monkey_parameters WHERE name = 'executive.lane.scalp.tp_pct';
--
-- The Python + TS parameter registries refresh within ``loop.refresh_every_ticks``
-- ticks — no deploy needed. Rollback by re-running with the old value
-- or via the parameter-change audit log (monkey_parameter_changes).

BEGIN;

INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.scalp.tp_pct',
  'OPERATIONAL',
  0.03,
  0.005,
  0.10,
  'Scalp lane TP — 3% ROI lock-in. 2026-04-30 tape shows scalps hit 3%+ then give back at the 0.5% default.',
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
