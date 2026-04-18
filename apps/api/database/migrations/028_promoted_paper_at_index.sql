-- Migration 028: partial index supporting the trades-floor probe's
-- shouldExpectPaperTrades() lookup.
--
-- The probe runs every 60s. Its query takes MAX(promoted_paper_at) over
-- strategy_performance rows where deleted_at IS NULL. Without this
-- index PG does a partial sequential scan — cheap today but unpredictable
-- as the table grows. Sourcery flagged the DB-load profile on PR #489.
--
-- Partial index (promoted_paper_at IS NOT NULL) keeps the index small;
-- DESC order matches the MAX access pattern.

CREATE INDEX IF NOT EXISTS idx_strategy_performance_promoted_paper_at
  ON strategy_performance(promoted_paper_at DESC)
  WHERE deleted_at IS NULL AND promoted_paper_at IS NOT NULL;
