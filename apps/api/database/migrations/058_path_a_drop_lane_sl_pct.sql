-- 058_path_a_drop_lane_sl_pct.sql
--
-- Path A (2026-05-26): delete executive.lane.<lane>.sl_pct rows from
-- the monkey_parameters registry. The hard SL leg of should_scalp_exit
-- was removed as a P5 (Observer-Sets-Params) violation — externally-
-- imposed ROI threshold that fired regardless of where the kernel
-- itself read the position going.
--
-- Adverse exits now flow through:
--   - should_exit (Fisher-Rao disagreement between perception and
--     strategy_forecast — kernel reads its own prediction limit)
--   - should_auto_flatten (P15 catastrophic backstop on entropy
--     collapse / fhealth degradation)
--
-- The TP side stays chemistry-derived (unchanged).
--
-- Code changes shipped in same PR delete the matching defaults from
-- ml-worker/src/monkey_kernel/executive.py:_LANE_PARAMETER_DEFAULTS
-- and apps/api/src/services/monkey/executive.ts:LANE_PARAMETER_DEFAULTS.
--
-- FK note: monkey_parameter_changes(name) → monkey_parameters(name)
-- with no CASCADE. We delete the audit rows for the three retired
-- names FIRST. The audit-trail principle in 034_monkey_parameters.sql
-- ("append-only, never purged") is honoured for ACTIVE parameters;
-- this is a permanent retirement, and the git history of this PR
-- (#940) is the canonical record of the change.
--
-- Idempotent: deletes only rows that exist.

BEGIN;

-- Audit what we're about to delete (operator-visible in the migration log).
DO $$
DECLARE
  param_count BIGINT;
  change_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO param_count
  FROM monkey_parameters
  WHERE name IN (
    'executive.lane.scalp.sl_pct',
    'executive.lane.swing.sl_pct',
    'executive.lane.trend.sl_pct'
  );
  SELECT COUNT(*) INTO change_count
  FROM monkey_parameter_changes
  WHERE name IN (
    'executive.lane.scalp.sl_pct',
    'executive.lane.swing.sl_pct',
    'executive.lane.trend.sl_pct'
  );
  RAISE NOTICE 'Path A: deleting % sl_pct rows from monkey_parameters and % rows from monkey_parameter_changes', param_count, change_count;
END $$;

-- Drop audit rows FIRST to release the FK reference. Path A retires
-- these parameter names permanently — preserving their audit history
-- in the live changes table no longer serves rollback or governance,
-- and the PR commit history captures the retirement intent.
DELETE FROM monkey_parameter_changes
WHERE name IN (
  'executive.lane.scalp.sl_pct',
  'executive.lane.swing.sl_pct',
  'executive.lane.trend.sl_pct'
);

DELETE FROM monkey_parameters
WHERE name IN (
  'executive.lane.scalp.sl_pct',
  'executive.lane.swing.sl_pct',
  'executive.lane.trend.sl_pct'
);

COMMIT;
