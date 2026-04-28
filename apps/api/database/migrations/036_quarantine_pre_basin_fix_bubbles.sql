-- 036_quarantine_pre_basin_fix_bubbles.sql
--
-- Closes #579. Quarantines bubbles created before commit 589c775
-- (basinDirection saturation fix, deployed 2026-04-27T02:39:32Z).
--
-- Pre-fix bubbles all have basin coordinates encoded under the broken
-- regime where basinDir was structurally pegged at -1.0 across all
-- 21,458 monkey_decisions in the 72h pre-fix window. The bubbles'
-- outcome labels (loss/win) are real, but their geometric retrieval
-- coordinates are warped — `basinDir = -1.0` is the maximum-bearish
-- saturation, so any post-fix tick with even a slight bearish lean
-- retrieves these bubbles as "most similar" and Hebbian update pulls
-- the kernel's neurochemistry toward their outcome.
--
-- Solution: quarantine flag column. Filter quarantined bubbles out of
-- retrieval / sovereignty / bankSize / nearestBasin queries. Forensic
-- preservation: rows stay in the table, can be inspected, can be
-- un-quarantined later if a recovery method is found.
--
-- This is a quarantine, not a DELETE. Recoverable.

-- ───────────────────────────────────────────────────────────────────
-- Add quarantine columns
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS quarantined BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

ALTER TABLE monkey_resonance_bank
    ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ;

-- ───────────────────────────────────────────────────────────────────
-- Quarantine all pre-basin-fix bubbles
-- ───────────────────────────────────────────────────────────────────
-- Cutoff: 2026-04-27T02:39:32Z (commit 589c775 deploy time).
-- Strategic decision: quarantine ALL pre-fix bubbles, not just shorts,
-- because the geometric contamination affects long-side bubbles
-- equally (their basinDir coordinates are the same warped value).

UPDATE monkey_resonance_bank
   SET quarantined       = true,
       quarantine_reason = 'pre_basin_fix_589c775_geometric_contamination',
       quarantined_at    = NOW()
 WHERE created_at < '2026-04-27T02:39:32Z'::timestamptz
   AND quarantined = false;

-- ───────────────────────────────────────────────────────────────────
-- Partial index for fast active-bubble retrieval
-- ───────────────────────────────────────────────────────────────────
-- All read paths now filter `WHERE quarantined = false`. A partial
-- index on the active set keeps retrieval cheap even as the
-- quarantined population grows.

CREATE INDEX IF NOT EXISTS idx_monkey_resonance_bank_active_symbol
    ON monkey_resonance_bank (symbol, last_accessed DESC)
    WHERE quarantined = false;

CREATE INDEX IF NOT EXISTS idx_monkey_resonance_bank_active_created
    ON monkey_resonance_bank (created_at DESC)
    WHERE quarantined = false;
