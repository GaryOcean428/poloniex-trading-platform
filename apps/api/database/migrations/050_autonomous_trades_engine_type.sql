-- 050_autonomous_trades_engine_type.sql
--
-- Add engine_type discriminator to autonomous_trades so /api/agent/performance
-- can cleanly filter live vs paper vs backtest rows. Today the handler at
-- apps/api/src/routes/agent.ts:332 uses a leaky `order_id LIKE 'paper_%'`
-- heuristic that includes any NULL-order_id rows as "live" — conflates
-- ghost rows, manual entries, and real live trades.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, backfill WHERE IS NULL only,
-- index uses IF NOT EXISTS. Re-applying on prod is a no-op.
--
-- Backfill rules (most specific first):
--   order_id LIKE 'paper_%'                     -> 'paper'
--   order_id LIKE 'paper-%'                     -> 'paper' (alt prefix used by paperExchangeSimulator PR #699)
--   order_id ~ '^[0-9]+$' (numeric, real polo)  -> 'live'
--   order_id IS NULL                            -> 'unknown' (likely ghost)
--   otherwise                                   -> 'unknown'

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'engine_type'
  ) THEN
    ALTER TABLE autonomous_trades ADD COLUMN engine_type VARCHAR(20);
  END IF;

  -- Backfill any rows where engine_type is NULL (initial population or
  -- newly-added rows from older code paths). Safe to re-run: WHERE
  -- engine_type IS NULL filter keeps it idempotent.
  UPDATE autonomous_trades
     SET engine_type = CASE
       WHEN order_id LIKE 'paper_%'    THEN 'paper'
       WHEN order_id LIKE 'paper-%'    THEN 'paper'
       WHEN order_id ~ '^[0-9]+$'      THEN 'live'
       WHEN order_id IS NULL           THEN 'unknown'
       ELSE                                  'unknown'
     END
   WHERE engine_type IS NULL;
END $$;

-- Partial index on the hot read path: per-engine recent-closed trades.
-- Existing dashboard queries ORDER BY exit_time DESC and filter by engine_type
-- after the agent.ts handler change ships.
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_engine_exit
  ON autonomous_trades(engine_type, exit_time DESC)
  WHERE exit_time IS NOT NULL;
