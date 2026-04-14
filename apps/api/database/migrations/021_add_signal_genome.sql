-- Migration: Add signal_genome JSONB column to strategy_performance
-- This column stores the composable signal genome (entry/exit conditions + risk params)
-- that replaces the hardcoded strategy_type switch for signal generation.

ALTER TABLE strategy_performance
  ADD COLUMN IF NOT EXISTS signal_genome JSONB;

COMMENT ON COLUMN strategy_performance.signal_genome IS
  'Composable signal genome: JSON with entryConditions, exitConditions, and risk parameters. '
  'When present, the backtest engine evaluates this genome instead of switching on strategy_type.';
