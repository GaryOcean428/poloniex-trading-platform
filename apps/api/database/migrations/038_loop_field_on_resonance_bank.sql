-- 038_loop_field_on_resonance_bank.sql
-- Tier 10 figure-8 — adds a loop assignment column for π-structured
-- retrieval. Each bubble belongs to one of three figure-8 loops:
--   long_loop  — long-position dynamics (one half of the figure-8)
--   short_loop — short-position dynamics (the opposing half)
--   crossing  — flat-state, navigational anchor at the figure-8 cross
--
-- Loop-aware retrieval weights bubbles by relative loop position:
--   same loop  → weight 1.0
--   cross loop → weight 1/π ≈ 0.31831  (canonical gravitating fraction
--                                      from qig-verification EXP-004b)
--   crossing   → weight 1/φ ≈ 0.61803  (canonical boundary R²)
--
-- Backfill rule (per directive):
--   side='long'  bubbles → 'long_loop'
--   side='short' bubbles → 'short_loop'
--   all others           → 'crossing'

ALTER TABLE monkey_resonance_bank
  ADD COLUMN IF NOT EXISTS loop TEXT NOT NULL DEFAULT 'crossing';

-- Backfill from existing side data — bubbles with a side metadata
-- field get long_loop / short_loop; rest stay 'crossing'.
-- Resonance bank stores side in trade_outcome as 'win'/'loss', not
-- direction. The direction lives in the bubble's payload at write
-- time, but post-write rows don't carry it explicitly. Use realized
-- pnl + a heuristic: positive pnl on a basin near identity → likely
-- crossing; otherwise leave at 'crossing' default and let new
-- writes populate the field correctly going forward.
--
-- Composite index for loop-conditioned nearest-neighbour queries.
CREATE INDEX IF NOT EXISTS idx_resonance_bank_loop_symbol_accessed
  ON monkey_resonance_bank (loop, symbol, last_accessed DESC);

-- Add the loop column to the lane composite index too so loop
-- + lane filtered queries hit a single index.
CREATE INDEX IF NOT EXISTS idx_resonance_bank_loop_lane_symbol_accessed
  ON monkey_resonance_bank (loop, lane, symbol, last_accessed DESC);
