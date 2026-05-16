-- 053_basin_sync_extended_observables.sql
--
-- Consensus Layer 4 (CONSENSUS-6) — extend monkey_basin_sync with the
-- richer cross-observation field per CC red-team refinement #4:
-- "pass {basin, phi, kappa, regime_weights, neurochemistry_snapshot}
-- between kernels — basin-level + state-level, not proposal-level".
--
-- Both columns nullable so existing rows (pre-bump) keep working; new
-- writes from TS Monkey + Py Monkey populate them per tick.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS, safe to re-apply.

BEGIN;

ALTER TABLE monkey_basin_sync
  ADD COLUMN IF NOT EXISTS regime_weights JSONB;

ALTER TABLE monkey_basin_sync
  ADD COLUMN IF NOT EXISTS neurochemistry JSONB;

COMMENT ON COLUMN monkey_basin_sync.regime_weights IS
  'Three-regime mixture weights {quantum, efficient, equilibrium} at this tick. '
  'Consumed by consensus arbiter (CONSENSUS-7) to weight peer proposals by '
  'regime alignment.';

COMMENT ON COLUMN monkey_basin_sync.neurochemistry IS
  'Six-chemical snapshot {acetylcholine, dopamine, serotonin, norepinephrine, '
  'gaba, endorphins} at this tick. Consumed by Ocean overseer (CONSENSUS-8) '
  'for aggregate-consensus desync-foresight monitoring.';

COMMIT;
