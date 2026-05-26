-- 060_backfill_quantity_base_asset.sql
--
-- Phantom-PnL fix (2026-05-26): stateReconciliationService stored Poloniex
-- exPos.qty (CONTRACTS) directly into autonomous_trades.quantity, while
-- kernel-direct INSERTs in loop.ts:7871 stored formattedSize (BASE_ASSET).
-- SAFE_PNL_FROM_ROW (safePnlSql.ts:49) computes
--   pnl = quantity * (exit - entry) * sideSign
-- which is correct ONLY for base-asset quantity. Reconciler-adopted rows
-- therefore reported pnl inflated by 1/lotSize:
--   BTC: 1000× (lotSize 0.001 BTC/contract)
--   ETH: 100×  (lotSize 0.01 ETH/contract)
--
-- Observed in production logs 2026-05-26 14:28 UTC:
--   ETH close orderId 582334226029191169: kernel pnl=$1382.29, real $1.06
--   ETH close at 14:30 UTC: kernel pnl=$939.92, real $9.18 → 102.4× ≈ 1/0.01
--
-- This migration converts existing reconciler-stored rows from contracts
-- to base-asset by multiplying by the per-symbol lot size. Kernel-direct
-- rows are detected by their reason prefix and skipped.
--
-- Idempotent via a flag column: `quantity_unit_normalized` defaults to
-- false. The conversion only updates rows where it's still false, then
-- sets it true. Re-running is a no-op.
--
-- Heuristic for reconciler-adopted rows: `reason LIKE 'kernel_adopted|%'`
-- OR `reason LIKE 'manual_open_user|%'` OR `reason LIKE '%|src=reconciler'`.
-- These are the only paths that hit the bad INSERT site.

BEGIN;

-- Add idempotency flag.
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS quantity_unit_normalized BOOLEAN NOT NULL DEFAULT FALSE;

-- Pre-set kernel-direct rows as already-normalized so we don't accidentally
-- convert correct base-asset quantities to even smaller numbers.
-- Kernel-direct rows have `reason LIKE 'monkey|%'` (see loop.ts:7862 prefix).
UPDATE autonomous_trades
SET quantity_unit_normalized = TRUE
WHERE quantity_unit_normalized = FALSE
  AND reason LIKE 'monkey|%';

-- Backfill BTC reconciler-adopted rows: contracts → base-asset (× 0.001).
DO $$
DECLARE
  btc_lot CONSTANT NUMERIC := 0.001;  -- BTCUSDTPERP: 1 contract = 0.001 BTC
  eth_lot CONSTANT NUMERIC := 0.01;   -- ETHUSDTPERP: 1 contract = 0.01 ETH
  btc_count BIGINT;
  eth_count BIGINT;
BEGIN
  -- BTC: convert reconciler-adopted rows.
  UPDATE autonomous_trades
  SET quantity = quantity * btc_lot,
      quantity_unit_normalized = TRUE
  WHERE quantity_unit_normalized = FALSE
    AND symbol = 'BTC_USDT_PERP'
    AND (
      reason LIKE 'kernel_adopted|%'
      OR reason LIKE 'manual_open_user|%'
      OR reason LIKE '%|src=reconciler'
    );
  GET DIAGNOSTICS btc_count = ROW_COUNT;

  -- ETH: convert reconciler-adopted rows.
  UPDATE autonomous_trades
  SET quantity = quantity * eth_lot,
      quantity_unit_normalized = TRUE
  WHERE quantity_unit_normalized = FALSE
    AND symbol = 'ETH_USDT_PERP'
    AND (
      reason LIKE 'kernel_adopted|%'
      OR reason LIKE 'manual_open_user|%'
      OR reason LIKE '%|src=reconciler'
    );
  GET DIAGNOSTICS eth_count = ROW_COUNT;

  RAISE NOTICE 'Phantom-PnL backfill: converted % BTC rows + % ETH rows from contracts to base-asset', btc_count, eth_count;

  -- Recompute pnl for already-closed rows that we just re-unit'd. The
  -- closed rows hold a stale pnl from the broken formula; recompute via
  -- SAFE_PNL_FROM_ROW shape inline (only for rows we just normalized).
  UPDATE autonomous_trades
  SET pnl = quantity * (exit_price - entry_price) *
            CASE WHEN side IN ('buy', 'long') THEN 1::numeric ELSE -1::numeric END
  WHERE quantity_unit_normalized = TRUE
    AND status = 'closed'
    AND exit_price IS NOT NULL
    AND entry_price IS NOT NULL
    AND (
      reason LIKE 'kernel_adopted|%'
      OR reason LIKE 'manual_open_user|%'
      OR reason LIKE '%|src=reconciler'
    );
END $$;

-- Mark any remaining rows (legacy, unknown reason format) as already-normalized
-- so future re-runs of this migration skip them. They're left at their
-- existing quantity. If a future audit finds them mis-unit'd, a targeted
-- migration can address those specifically.
UPDATE autonomous_trades
SET quantity_unit_normalized = TRUE
WHERE quantity_unit_normalized = FALSE;

COMMIT;
