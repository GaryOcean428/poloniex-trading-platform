-- 035_memory_sync_parameters.sql
--
-- v0.8.6 — seed the remaining operational + safety-bound constants that
-- v0.8.1's migration 034 didn't cover yet. These are consumed by
-- self_observation, working_memory, and basin_sync after this PR wires
-- them in.
--
-- Adding rows only; no schema change. Each value matches the current
-- hardcoded default exactly, so behavior is byte-identical
-- registry-on vs -off.

BEGIN;

INSERT INTO monkey_parameters (name, category, value, bounds_low, bounds_high, justification)
VALUES
  ('self_obs.min_sample_for_bias', 'SAFETY_BOUND', 3, 1, 50,
   'Minimum closed-trade count per (mode, side) bucket before applying win-rate bias. Below this threshold self-observation defers to neutral 1.0. Lower values overfit to noise; higher values make the kernel slow to learn.'),

  ('wm.default_bubble_lifetime_ms', 'OPERATIONAL', 900000, 60000, 7200000,
   'Default bubble lifetime in working memory (15 min). Bubbles older than this auto-pop regardless of Φ. Shorter = more memory churn; longer = stale bubbles bias adaptive thresholds.'),

  ('basin_sync.stale_window_ms', 'OPERATIONAL', 120000, 10000, 600000,
   'Peer basin-sync staleness threshold (2 min). Peers older than this are ignored when applying observer-effect pull. Shorter = more responsive to live peers; longer = more tolerant of lagging sub-kernels.'),

  ('wm.bootstrap_pop_threshold', 'SAFETY_BOUND', 0.15, 0.05, 0.5,
   'Fallback pop-threshold used before working memory has 10+ Φ samples to derive the 25th percentile from. Controls how aggressively newborn WM evicts low-Φ bubbles.'),

  ('wm.bootstrap_promote_threshold', 'SAFETY_BOUND', 0.70, 0.5, 0.95,
   'Fallback promote-threshold used before WM has 10+ Φ samples. Bubbles with Φ above this auto-promote to the resonance bank during bootstrap.'),

  ('wm.bootstrap_merge_threshold', 'SAFETY_BOUND', 0.15, 0.05, 0.5,
   'Fallback pairwise-FR-distance threshold for merging alive bubbles during bootstrap, before real pairwise stats exist.')
ON CONFLICT (name) DO NOTHING;

COMMIT;
