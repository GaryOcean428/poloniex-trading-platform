-- 030_bandit_leverage_dimension.sql
-- Extend Thompson bandit key from (strategy_class, regime) to
-- (strategy_class, regime, leverage_bucket). Allows the posterior to
-- learn that low/mid/high leverage regimes on the same (signal, regime)
-- pair behave differently. Buckets: low (<=3x), mid (4-10x), high (>=11x).

-- 1. Add the new column, defaulting existing rows to 'mid' (the old
--    liveSignalEngine default was 3x, which sits at the low/mid boundary;
--    'mid' is the conservative classification that keeps existing
--    exploration-phase rows usable rather than resetting everything).
ALTER TABLE bandit_class_counters
  ADD COLUMN IF NOT EXISTS leverage_bucket VARCHAR(10) NOT NULL DEFAULT 'mid';

-- 2. Drop and recreate the primary key to include leverage_bucket.
ALTER TABLE bandit_class_counters
  DROP CONSTRAINT IF EXISTS bandit_class_counters_pkey;

ALTER TABLE bandit_class_counters
  ADD PRIMARY KEY (strategy_class, regime, leverage_bucket);

-- 3. Index for the loadBanditCounter lookup path.
CREATE INDEX IF NOT EXISTS idx_bandit_class_counters_lookup
  ON bandit_class_counters (strategy_class, regime, leverage_bucket);
