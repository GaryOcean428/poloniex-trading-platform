-- 061_polo_authoritative_pnl_columns.sql
-- Make Polo getPositionHistory.realizedPnl the canonical source for
-- autonomous_trades.pnl (Polo-derived net when available). The previous synthetic
-- compute (SAFE_PNL_FROM_ROW) becomes gross_pnl for forensic divergence
-- audit only.
--
-- This closes the last exit-side of the gross-vs-net phantom class
-- (entry side was attacked in #983 Commit 1; reward/chemistry now learns
-- from what Polo actually paid the account).
--
-- Reward path (observerFibCoefficient via pushReward) will consume the
-- Polo-authoritative pnl, so tier-1+ chemistry only fires on real money.

BEGIN;

-- Add gross_pnl as the kernel's own synthetic calculation (for audit)
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS gross_pnl NUMERIC;

-- fees_paid = gross_pnl - pnl (when both present). Makes cost of every
-- trade explicit.
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS fees_paid NUMERIC;

-- Initial pnl_source values: 'polo_history' | 'synthetic_fallback'
-- 'polo_history' means we successfully matched a row from
-- getPositionHistory and wrote the realized value.
-- 'synthetic_fallback' means we fell back to the row's own arithmetic
-- (brief window after close before Polo history is available, or
-- during reconciliation for very old ghosts).
-- Migration 063 expands this with the per-fill provenance tags
-- 'polo_gross_minus_close_fees' and 'polo_net_full'.
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS pnl_source TEXT
    CHECK (pnl_source IS NULL OR pnl_source IN ('polo_history', 'synthetic_fallback'));

-- Helpful index for the post-close matching + reward queries
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_pnl_source
  ON autonomous_trades (pnl_source);

-- Backfill note for existing rows: they remain with their current pnl
-- (mostly synthetic from prior logic). New closes after this migration
-- will populate the new columns. A one-time backfill job can be run
-- later to enrich historical rows from Polo history where possible.

COMMIT;

-- After this migration, the canonical surface is:
--   autonomous_trades.pnl          = best available Polo-derived realized PnL
--   autonomous_trades.gross_pnl    = kernel synthetic (for diff audit)
--   autonomous_trades.fees_paid    = gross - net (when available)
--   autonomous_trades.pnl_source   = provenance tag
--
-- The synthetic compute (computeSafePnl / SAFE_PNL_FROM_ROW) is retained
-- as the fallback and for gross_pnl population. It is no longer the
-- primary signal the kernel's chemistry learns from.