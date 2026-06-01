-- 070_mode_profile_params.sql
-- Moves MODE_PROFILES operational thresholds to monkey_parameters for #763.
-- Safety bounds (sovereignCapFloor, canEnter) remain as hardcoded TS defaults.
-- Each row: name format = 'mode.<MODE>.<param>'
--
-- P5: Observer sets all params.
-- P14: All parameter governance via monkey_parameters table.
-- P25: Only safety bounds may be hardcoded; operational thresholds go here.

BEGIN;

INSERT INTO monkey_parameters (name, category, value, bounds_low, bounds_high, justification)
VALUES
  -- EXPLORATION
  ('mode.EXPLORATION.tpBaseFrac',         'OPERATIONAL', 0.004,  0.001, 0.05,
   'Take-profit base fraction for EXPLORATION mode (volatile/flat scalp). #763 MODES-1.'),
  ('mode.EXPLORATION.slRatio',            'OPERATIONAL', 0.6,    0.1,   1.0,
   'Stop-loss ratio (fraction of TP) for EXPLORATION mode. #763 MODES-1.'),
  ('mode.EXPLORATION.entryThresholdScale','OPERATIONAL', 0.9,    0.1,   5.0,
   'Entry threshold multiplier for EXPLORATION mode (<1 = enter easier). #763 MODES-1.'),
  ('mode.EXPLORATION.sizeFloor',          'OPERATIONAL', 0.20,   0.0,   1.0,
   'Position size floor (fraction of equity) for EXPLORATION mode. #763 MODES-1.'),
  ('mode.EXPLORATION.tickMs',             'OPERATIONAL', 15000,  1000,  300000,
   'Tick cadence ms for EXPLORATION mode. #763 MODES-1.'),

  -- INVESTIGATION
  ('mode.INVESTIGATION.tpBaseFrac',         'OPERATIONAL', 0.008,  0.001, 0.05,
   'Take-profit base fraction for INVESTIGATION mode (trend forming). #763 MODES-1.'),
  ('mode.INVESTIGATION.slRatio',            'OPERATIONAL', 0.5,    0.1,   1.0,
   'Stop-loss ratio (fraction of TP) for INVESTIGATION mode. #763 MODES-1.'),
  ('mode.INVESTIGATION.entryThresholdScale','OPERATIONAL', 1.0,    0.1,   5.0,
   'Entry threshold multiplier for INVESTIGATION mode. #763 MODES-1.'),
  ('mode.INVESTIGATION.sizeFloor',          'OPERATIONAL', 0.25,   0.0,   1.0,
   'Position size floor (fraction of equity) for INVESTIGATION mode. #763 MODES-1.'),
  ('mode.INVESTIGATION.tickMs',             'OPERATIONAL', 30000,  1000,  300000,
   'Tick cadence ms for INVESTIGATION mode. #763 MODES-1.'),

  -- INTEGRATION
  ('mode.INTEGRATION.tpBaseFrac',         'OPERATIONAL', 0.020,  0.001, 0.1,
   'Take-profit base fraction for INTEGRATION mode (trend confirmed). #763 MODES-1.'),
  ('mode.INTEGRATION.slRatio',            'OPERATIONAL', 0.3,    0.1,   1.0,
   'Stop-loss ratio (fraction of TP) for INTEGRATION mode. #763 MODES-1.'),
  ('mode.INTEGRATION.entryThresholdScale','OPERATIONAL', 1.1,    0.1,   5.0,
   'Entry threshold multiplier for INTEGRATION mode. #763 MODES-1.'),
  ('mode.INTEGRATION.sizeFloor',          'OPERATIONAL', 0.30,   0.0,   1.0,
   'Position size floor (fraction of equity) for INTEGRATION mode. #763 MODES-1.'),
  ('mode.INTEGRATION.tickMs',             'OPERATIONAL', 60000,  1000,  300000,
   'Tick cadence ms for INTEGRATION mode. #763 MODES-1.'),

  -- DRIFT (safety: canEnter=false and sovereignCapFloor=1 remain hardcoded per P25;
  --         operational params still registry-managed)
  ('mode.DRIFT.tpBaseFrac',         'OPERATIONAL', 0.005,  0.001, 0.05,
   'Take-profit base fraction for DRIFT mode (observe-only). #763 MODES-1.'),
  ('mode.DRIFT.slRatio',            'OPERATIONAL', 0.6,    0.1,   1.0,
   'Stop-loss ratio (fraction of TP) for DRIFT mode. #763 MODES-1.'),
  ('mode.DRIFT.entryThresholdScale','OPERATIONAL', 99,     10,    1000,
   'Entry threshold scale for DRIFT mode (high value effectively disables entry). #763 MODES-1.'),
  ('mode.DRIFT.sizeFloor',          'OPERATIONAL', 0,      0.0,   1.0,
   'Position size floor for DRIFT mode (zero = no new positions). #763 MODES-1.'),
  ('mode.DRIFT.tickMs',             'OPERATIONAL', 60000,  1000,  300000,
   'Tick cadence ms for DRIFT mode. #763 MODES-1.')

ON CONFLICT (name) DO NOTHING;

COMMIT;
