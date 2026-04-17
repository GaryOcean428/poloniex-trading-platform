-- Migration 024: Allow NULL confidence_score in strategy_performance
-- The SLE creates strategies with confidence_score = NULL (they haven't been
-- scored yet). A NOT NULL constraint in production blocks every INSERT,
-- causing all strategy_performance persistence to fail silently.

ALTER TABLE strategy_performance ALTER COLUMN confidence_score DROP NOT NULL;
ALTER TABLE strategy_performance ALTER COLUMN confidence_score SET DEFAULT NULL;
