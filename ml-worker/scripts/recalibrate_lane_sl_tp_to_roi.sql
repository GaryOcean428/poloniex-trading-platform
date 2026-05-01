-- recalibrate_lane_sl_tp_to_roi.sql
--
-- v0.8.6 (2026-05-01) — rescale executive.lane.<lane>.{sl_pct,tp_pct}
-- registry rows from "raw price movement %" to "ROI on margin %".
--
-- Background
-- ----------
-- The kernel's should_scalp_exit gate computed pnl_frac = pnl / notional,
-- which is raw price movement % — NOT ROI on margin %. The lane SL
-- defaults (scalp 0.4%, swing 1.5%, trend 4.0%) were interpreted as
-- raw-price thresholds, so at typical 15-20x leverage they almost
-- never tripped: raw price moves stay tiny while ROI on margin scales
-- with leverage. Real production failure (2026-04-30 → 2026-05-01):
-- ETH long sat at -4.4% ROI for 4+ hours without SL firing because
-- raw price only moved -0.30%, well inside the 1.5% swing-SL band.
--
-- Code-side fix: should_scalp_exit / shouldScalpExit now compute
-- roi_frac = (pnl / notional) × leverage and compare against the
-- lane envelope on the ROI scale. _DEFAULT_LANE_*_{SL,TP}_PCT constants
-- in executive.py / LANE_PARAMETER_DEFAULTS in executive.ts are
-- rescaled to match. This SQL is the parameter-registry mirror — it
-- updates the live rows so production reads the new ROI-scale values
-- without needing a redeploy.
--
-- Rescale (preserves order-of-magnitude intent at ~15-20x leverage):
--   scalp: 0.4%  raw → 5%   ROI (sl_pct + tp_pct)
--   swing: 1.5%  raw → 15%  ROI (sl_pct + tp_pct)
--   trend: 4.0%  raw → 40%  ROI (sl_pct + tp_pct)
--
-- PR #627 follow-up: that PR set executive.lane.scalp.tp_pct = 0.03
-- (3%) on the registry to lock scalp profit at +3% ROI under the OLD
-- raw-price semantics. Under the new ROI semantics, 0.03 means "3%
-- ROI lock-in" which is too tight (scalps regularly hit 5%+ ROI).
-- Update that scalp.tp_pct to 0.05 here — restoring the 2026-04-30
-- tape-derived intent under the new semantics.
--
-- Apply (after merge, with autonomy paused if you want zero in-flight
-- ambiguity — the rebound is bounded by ``loop.refresh_every_ticks``):
--   railway ssh
--   psql "$DATABASE_URL" -f ml-worker/scripts/recalibrate_lane_sl_tp_to_roi.sql
--
-- Verify:
--   SELECT name, value, version, updated_at, updated_by, justification
--     FROM monkey_parameters
--    WHERE name LIKE 'executive.lane.%.sl_pct'
--       OR name LIKE 'executive.lane.%.tp_pct'
--    ORDER BY name;
--
-- The Python + TS parameter registries refresh within
-- ``loop.refresh_every_ticks`` ticks — no deploy needed once this
-- script lands. Rollback by re-running with the old raw-price values
-- AND reverting the code changes (the two are tightly coupled).

BEGIN;

-- ── scalp ──────────────────────────────────────────────────────────
INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.scalp.sl_pct',
  'OPERATIONAL',
  0.05,
  0.005,
  0.50,
  'v0.8.6 ROI-scale rescale: 5% ROI on margin SL for scalp (was 0.4% raw price). '
  'Live ETH-long sat at -4.4% ROI for 4+ hours without firing under raw semantics.',
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

INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.scalp.tp_pct',
  'OPERATIONAL',
  0.05,
  0.005,
  0.50,
  'v0.8.6 ROI-scale rescale: 5% ROI on margin TP for scalp (was 3% under old '
  'raw semantics — that 3% as ROI is too tight; scalps hit 5%+ ROI regularly). '
  'Restores the 2026-04-30 tape-derived intent under the new ROI semantics.',
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

-- ── swing ──────────────────────────────────────────────────────────
INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.swing.sl_pct',
  'OPERATIONAL',
  0.15,
  0.01,
  0.80,
  'v0.8.6 ROI-scale rescale: 15% ROI on margin SL for swing (was 1.5% raw price).',
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

INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.swing.tp_pct',
  'OPERATIONAL',
  0.15,
  0.01,
  0.80,
  'v0.8.6 ROI-scale rescale: 15% ROI on margin TP for swing (was 1.5% raw price).',
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

-- ── trend ──────────────────────────────────────────────────────────
INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.trend.sl_pct',
  'OPERATIONAL',
  0.40,
  0.05,
  1.00,
  'v0.8.6 ROI-scale rescale: 40% ROI on margin SL for trend (was 4.0% raw price).',
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

INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.lane.trend.tp_pct',
  'OPERATIONAL',
  0.40,
  0.05,
  1.00,
  'v0.8.6 ROI-scale rescale: 40% ROI on margin TP for trend (was 4.0% raw price).',
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
