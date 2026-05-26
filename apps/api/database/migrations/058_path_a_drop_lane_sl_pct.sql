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
-- Idempotent: deletes only rows that exist.

BEGIN;

-- Audit what we're about to delete (operator-visible in the migration log).
DO $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM monkey_parameters
  WHERE name IN (
    'executive.lane.scalp.sl_pct',
    'executive.lane.swing.sl_pct',
    'executive.lane.trend.sl_pct'
  );
  RAISE NOTICE 'Path A: deleting % sl_pct rows from monkey_parameters', row_count;
END $$;

-- Delete audit trail rows first (foreign key on monkey_parameter_changes.name
-- references monkey_parameters.name — child rows must go before parent).
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
