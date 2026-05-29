-- 063_qig_warp_expectation_provenance.sql
--
-- #1003/#1008 follow-up: qig_warp_source must never default to
-- QIG_WARP_RUNTIME. Runtime provenance is valid only when the qig-warp
-- adapter actually returned QIG_WARP_RUNTIME.

ALTER TABLE kernel_predictions
  ALTER COLUMN qig_warp_source DROP DEFAULT;

ALTER TABLE kernel_expectation_decisions
  ALTER COLUMN qig_warp_source DROP DEFAULT;

ALTER TABLE kernel_expectation_decisions
  ADD COLUMN IF NOT EXISTS formula_version TEXT;
