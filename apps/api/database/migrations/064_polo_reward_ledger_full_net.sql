-- 064_polo_reward_ledger_full_net.sql
-- Renumbered from 063 (Copilot's original) because #1022 took 063 first
-- for `063_qig_warp_expectation_provenance.sql`.
-- Distinguish Polo position-history provenance from the per-fill
-- gross-minus-fees reward-ledger path, and add explicit telemetry for
-- close-fees-only versus full-net PnL.

BEGIN;

ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS pnl_net_close_fees_only NUMERIC,
  ADD COLUMN IF NOT EXISTS pnl_net_full NUMERIC,
  ADD COLUMN IF NOT EXISTS open_fees_paid NUMERIC,
  ADD COLUMN IF NOT EXISTS funding_paid NUMERIC;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'autonomous_trades'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%pnl_source%'
  LOOP
    EXECUTE format('ALTER TABLE autonomous_trades DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

UPDATE autonomous_trades
   SET pnl_source = 'polo_gross_minus_close_fees'
 WHERE pnl_source = 'polo_history'
   AND gross_pnl IS NOT NULL
   AND fees_paid IS NOT NULL;

ALTER TABLE autonomous_trades
  ADD CONSTRAINT autonomous_trades_pnl_source_check
  CHECK (
    pnl_source IS NULL
    OR pnl_source IN (
      'polo_history',
      'polo_gross_minus_close_fees',
      'polo_net_full',
      'synthetic_fallback'
    )
  );

COMMIT;
