-- 056_backfill_phantom_pnl_rows.sql
--
-- #931 follow-up: backfill the historical phantom + drift rows in
-- autonomous_trades where the recorded pnl diverges from the value
-- computable from the row's own data (quantity, entry_price, exit_price,
-- side).
--
-- 7-day audit 2026-05-19 → 2026-05-26 produced:
--   • 776 monkey close rows total
--   • 30 rows diverged > $0.50 from qty × (exit − entry) × sideSign
--   • 2 phantoms > $50 (2026-05-24 02:36 BTC: +$374.12 / true +$0.0026;
--                        2026-05-25 16:16 BTC: +$315.21 / true −$1.03)
--   • Avg drift $1.09/row (systematic — likely fees not subtracted,
--     out of scope for this backfill)
--
-- This migration only corrects rows where the divergence is > $5 — the
-- phantom-class anomalies that polluted the chemistry reward feed via
-- pushReward → autonomic dopamine/gaba. The <$5 systematic drift is
-- left in place; once fees + slippage accounting is added, a future
-- backfill can correct those too.
--
-- Idempotent: rows whose pnl already matches the calc are unchanged.
-- Safe to re-run.

BEGIN;

-- Audit log — capture the rows we're about to correct so the operator
-- can see exactly what changed. Reads must run BEFORE the UPDATE.
CREATE TEMPORARY TABLE _phantom_pnl_backfill_log AS
SELECT
  id,
  symbol,
  side,
  exit_time,
  exit_reason,
  pnl              AS old_pnl,
  CASE side
    WHEN 'buy'   THEN quantity * (exit_price - entry_price)
    WHEN 'long'  THEN quantity * (exit_price - entry_price)
    WHEN 'sell'  THEN quantity * (entry_price - exit_price)
    WHEN 'short' THEN quantity * (entry_price - exit_price)
  END              AS new_pnl,
  quantity,
  entry_price,
  exit_price
FROM autonomous_trades
WHERE engine_type LIKE 'monkey%'
  AND pnl IS NOT NULL
  AND exit_price IS NOT NULL
  AND entry_price IS NOT NULL
  AND ABS(pnl - CASE side
    WHEN 'buy'   THEN quantity * (exit_price - entry_price)
    WHEN 'long'  THEN quantity * (exit_price - entry_price)
    WHEN 'sell'  THEN quantity * (entry_price - exit_price)
    WHEN 'short' THEN quantity * (entry_price - exit_price)
  END) > 5.0;

-- Surface what we're about to correct (rows + total $ correction).
DO $$
DECLARE
  row_count BIGINT;
  total_correction NUMERIC;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(old_pnl - new_pnl), 0)
  INTO row_count, total_correction
  FROM _phantom_pnl_backfill_log;
  RAISE NOTICE '#931 backfill: % rows to correct, net $% ledger reduction',
    row_count, ROUND(total_correction::numeric, 2);
END $$;

-- Apply the correction — pnl recomputed from row's own data.
UPDATE autonomous_trades AS t
SET pnl = CASE t.side
    WHEN 'buy'   THEN t.quantity * (t.exit_price - t.entry_price)
    WHEN 'long'  THEN t.quantity * (t.exit_price - t.entry_price)
    WHEN 'sell'  THEN t.quantity * (t.entry_price - t.exit_price)
    WHEN 'short' THEN t.quantity * (t.entry_price - t.exit_price)
  END
FROM _phantom_pnl_backfill_log AS b
WHERE t.id = b.id;

-- Audit table dropped automatically at COMMIT (TEMPORARY).
COMMIT;
