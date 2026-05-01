-- recalibrate_lane_sl_tp_to_roi.sql
--
-- v0.8.6 (2026-05-01) — rescale executive.lane.<lane>.{sl_pct,tp_pct}
-- registry rows from "raw price movement %" to "ROI on margin %".
-- v0.8.7 (2026-05-01) — scalp TP/SL set to symmetric 1:1 R:R per user
-- directive (option a: 3% / 3%). Subagent A's 0.05/0.05 → 0.03/0.03.
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
--   scalp: 0.4%  raw → 3%   ROI (v0.8.7: 1:1 R:R per user directive)
--   swing: 1.5%  raw → 15%  ROI (sl_pct + tp_pct)
--   trend: 4.0%  raw → 40%  ROI (sl_pct + tp_pct)
--
-- v0.8.7 scalp note: PR #627 originally set executive.lane.scalp.tp_pct
-- = 0.03 under raw-price semantics. v0.8.6 (Subagent A) bumped it to
-- 0.05 under ROI semantics; v0.8.7 (this revision) reverts both
-- scalp.tp_pct AND scalp.sl_pct to 0.03 per the user's symmetric 1:1
-- R:R directive. Live tape evidence (2026-05-01 16:11-16:17, 22% win
-- rate, $77→$386 escalating notionals on a $97 account) drove the
-- reversion: tighter symmetric scalps + the regime-hysteresis fix
-- + the notional ceiling are the trio that has to land together.
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
  0.03,
  0.005,
  0.50,
  'v0.8.7 user directive (option a, symmetric 1:1 R:R): 3% ROI on margin SL for '
  'scalp (was 0.05 in Subagent A revision). Pairs with 0.03 tp_pct.',
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
  0.03,
  0.005,
  0.50,
  'v0.8.7 user directive (option a, symmetric 1:1 R:R): 3% ROI on margin TP for '
  'scalp. Reverted from Subagent A''s 0.05 — user keeps the original PR #627 '
  'value as the floor under the new ROI semantics. Pairs with 0.03 sl_pct.',
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

-- ── v0.8.7 regime hysteresis stability requirement ────────────────
INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.regime_stability_ticks_for_exit',
  'OPERATIONAL',
  3,
  1,
  20,
  'v0.8.7 regime-hysteresis: minimum number of consecutive ticks where '
  'regimeNow != regimeAtOpen before the held-position regime_change exit '
  'fires. Combined with FR-distance > 1/π and confidence > 1/φ gates. '
  'Live tape 2026-05-01: 22% win rate with every close via single-tick '
  'regime_change; this defaults to 3 to demand sustained divergence.',
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

-- ── v0.8.7 notional-ceiling fallback (Kelly cap supplement) ───────
INSERT INTO monkey_parameters (
  name, category, value, bounds_low, bounds_high, justification, version, updated_by
) VALUES (
  'executive.notional_ceiling_ratio',
  'OPERATIONAL',
  4.0,
  1.0,
  20.0,
  'v0.8.7 notional-ceiling: cap single-position notional at this multiple '
  'of account balance. Backstops the Kelly cap which is non-binding at '
  'cold start (< 5 closed trades per lane). Live tape 2026-05-01 showed '
  '$77 → $386 escalating notionals on a $97 account (4× balance).',
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
