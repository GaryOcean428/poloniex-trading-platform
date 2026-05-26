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

-- Backfill reconciler-adopted rows for every symbol in the canonical
-- Poloniex Futures v3 catalog: contracts → base-asset (× lotSize).
DO $$
DECLARE
  converted_count BIGINT;
BEGIN
  UPDATE autonomous_trades t
  SET quantity = t.quantity * lots.lot_size,
      quantity_unit_normalized = TRUE
  FROM (
    VALUES
      ('BTC_USDT_PERP', 0.001::numeric),
      ('ETH_USDT_PERP', 0.01::numeric),
      ('SOL_USDT_PERP', 0.1::numeric),
      ('XRP_USDT_PERP', 10::numeric),
      ('BCH_USDT_PERP', 0.01::numeric),
      ('LTC_USDT_PERP', 0.1::numeric),
      ('TRX_USDT_PERP', 100::numeric),
      ('BNB_USDT_PERP', 0.01::numeric),
      ('DOGE_USDT_PERP', 100::numeric),
      ('AVAX_USDT_PERP', 0.1::numeric),
      ('APT_USDT_PERP', 0.1::numeric),
      ('LINK_USDT_PERP', 0.1::numeric),
      ('UNI_USDT_PERP', 1::numeric),
      ('XMR_USDT_PERP', 0.01::numeric),
      ('1000PEPE_USDT_PERP', 1000::numeric),
      ('1000SHIB_USDT_PERP', 1000::numeric)
  ) AS lots(symbol, lot_size)
  WHERE t.quantity_unit_normalized = FALSE
    AND t.symbol = lots.symbol
    AND (
      t.reason LIKE 'kernel_adopted|%'
      OR t.reason LIKE 'manual_open_user|%'
      OR t.reason LIKE '%|src=reconciler'
    );
  GET DIAGNOSTICS converted_count = ROW_COUNT;

  RAISE NOTICE 'Phantom-PnL backfill: converted % reconciler rows from contracts to base-asset', converted_count;

  -- Recompute pnl for already-closed rows that we just re-unit'd. The
  -- closed rows hold a stale pnl from the broken formula; recompute via
  -- SAFE_PNL_FROM_ROW shape inline (only for rows we just normalized).
  UPDATE autonomous_trades t
  SET pnl = t.quantity * (t.exit_price - t.entry_price) *
            CASE WHEN t.side IN ('buy', 'long') THEN 1::numeric ELSE -1::numeric END
  FROM (
    VALUES
      ('BTC_USDT_PERP'), ('ETH_USDT_PERP'), ('SOL_USDT_PERP'), ('XRP_USDT_PERP'),
      ('BCH_USDT_PERP'), ('LTC_USDT_PERP'), ('TRX_USDT_PERP'), ('BNB_USDT_PERP'),
      ('DOGE_USDT_PERP'), ('AVAX_USDT_PERP'), ('APT_USDT_PERP'), ('LINK_USDT_PERP'),
      ('UNI_USDT_PERP'), ('XMR_USDT_PERP'), ('1000PEPE_USDT_PERP'), ('1000SHIB_USDT_PERP')
  ) AS lots(symbol)
  WHERE t.quantity_unit_normalized = TRUE
    AND t.symbol = lots.symbol
    AND status = 'closed'
    AND exit_price IS NOT NULL
    AND entry_price IS NOT NULL
    AND (
      t.reason LIKE 'kernel_adopted|%'
      OR t.reason LIKE 'manual_open_user|%'
      OR t.reason LIKE '%|src=reconciler'
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
