-- 037_lane_field_on_resonance_bank.sql
--
-- Closes #586 (kernel decision surface expansion).
-- Adds the `lane` column to monkey_resonance_bank so each bubble can be
-- tagged with the execution lane that was active when it was recorded:
--   scalp   — high-frequency, low-notional
--   swing   — intermediate hold (DEFAULT / backward-compat)
--   trend   — directional multi-session
--   observe — no-trade monitoring
--
-- All pre-existing rows are backfilled to 'swing' — their actual lane.
-- No data loss. This is purely additive.
--
-- Migration is idempotent (ADD COLUMN IF NOT EXISTS).

-- ────────────────────────────────────────────────────────────────────
-- Add lane column
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS lane TEXT NOT NULL DEFAULT 'swing';

-- ────────────────────────────────────────────────────────────────────
-- Backfill: tag every existing bubble as 'swing' (their historical lane)
-- ────────────────────────────────────────────────────────────────────
-- This is a no-op for rows inserted after this migration because the
-- DEFAULT 'swing' covers them. It explicitly sets the value on older
-- rows that had NULL before the DEFAULT was added (shouldn't happen
-- with NOT NULL DEFAULT, but belt-and-suspenders).

UPDATE monkey_resonance_bank
   SET lane = 'swing'
 WHERE lane IS NULL OR lane = '';

-- ────────────────────────────────────────────────────────────────────
-- Index for lane-filtered nearest-neighbour retrieval
-- ────────────────────────────────────────────────────────────────────
-- findNearestBasins(basin, symbol, lane) filters by (symbol, lane).
-- Combined with the existing quarantined=false partial-index semantics
-- this keeps lane-filtered queries cheap even as the bank grows.

CREATE INDEX IF NOT EXISTS idx_monkey_resonance_bank_lane
    ON monkey_resonance_bank (lane, symbol, last_accessed DESC)
    WHERE quarantined = false;
