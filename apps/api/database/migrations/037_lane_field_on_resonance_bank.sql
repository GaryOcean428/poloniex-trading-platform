-- 037_lane_field_on_resonance_bank.sql
-- Add execution lane to resonance bank entries.
-- Default 'swing' backfills all existing rows (their historical lane).

ALTER TABLE monkey_resonance_bank
  ADD COLUMN IF NOT EXISTS lane TEXT NOT NULL DEFAULT 'swing';

-- Composite index for lane-conditioned nearest-neighbour queries.
-- findNearestBasins(basin, symbol, lane) scans by (lane, symbol, last_accessed).
CREATE INDEX IF NOT EXISTS idx_resonance_bank_lane_symbol_accessed
  ON monkey_resonance_bank (lane, symbol, last_accessed DESC);
