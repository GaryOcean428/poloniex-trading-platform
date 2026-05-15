-- 048_normalize_autonomous_trades_schema.sql
--
-- Bring autonomous_trades into line with the schema the code actually
-- queries against. Production was ad-hoc-migrated to this shape at
-- some point — the rename never landed as a tracked migration, so
-- fresh volumes (staging on 2026-05-15) shipped with the original
-- 000_base_schema columns and the API logs 30+ "column does not
-- exist" errors per minute on every reconciler / kelly / harvest /
-- backfill query.
--
-- Fully idempotent: each step checks information_schema before
-- acting, so re-applying on production (where every column already
-- exists) is a no-op and re-applying on staging multiple times
-- has the same end state. Wrapped in a DO block so a single transaction
-- carries the whole alignment.
--
-- Columns brought into existence on staging:
--   closed_at     → renamed to exit_time
--   close_reason  → renamed to exit_reason
--   entry_time    (new, backfilled from created_at on existing rows)
--   leverage      (new INTEGER, nullable — cold rows have no value)
--   exit_order_id (new VARCHAR, tracks the close order id)
--   pnl_percentage (new NUMERIC, pnl expressed as %)

DO $$
BEGIN
  -- exit_time: rename closed_at → exit_time when only the old name
  -- exists; add fresh column if neither exists. The code reads
  -- exit_time in 20+ places (reconciler, kelly window, scalp stats,
  -- backfill, dashboard queries).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'exit_time'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'autonomous_trades'
        AND column_name = 'closed_at'
    ) THEN
      ALTER TABLE autonomous_trades RENAME COLUMN closed_at TO exit_time;
    ELSE
      ALTER TABLE autonomous_trades ADD COLUMN exit_time TIMESTAMP;
    END IF;
  END IF;

  -- exit_reason: rename close_reason → exit_reason when only the old
  -- name exists; add fresh column if neither exists. Code references
  -- exit_reason in reconciler joins and dashboard summaries. Keep the
  -- original VARCHAR(50) width during rename — widening is a separate
  -- discussion (some exit_reason strings exceed 50 chars and get
  -- truncated, but that's pre-existing behaviour).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'exit_reason'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'autonomous_trades'
        AND column_name = 'close_reason'
    ) THEN
      ALTER TABLE autonomous_trades RENAME COLUMN close_reason TO exit_reason;
    ELSE
      ALTER TABLE autonomous_trades ADD COLUMN exit_reason VARCHAR(255);
    END IF;
  END IF;

  -- entry_time: add as nullable TIMESTAMP, back-fill from created_at
  -- so existing rows have a usable value. New inserts populate it
  -- explicitly via the API insert path. Code reads entry_time on
  -- reconciler, kelly, and the open-position discovery queries.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'entry_time'
  ) THEN
    ALTER TABLE autonomous_trades ADD COLUMN entry_time TIMESTAMP;
    UPDATE autonomous_trades
       SET entry_time = created_at
     WHERE entry_time IS NULL;
  END IF;

  -- leverage: INTEGER nullable. Code reads via
  -- Number(openRow.leverage) with a Number.isFinite + >0 guard, so
  -- null/0 falls through to a derived leverage. Production has this
  -- column as INTEGER; staying compatible.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'leverage'
  ) THEN
    ALTER TABLE autonomous_trades ADD COLUMN leverage INTEGER;
  END IF;

  -- exit_order_id: the exchange's order id for the CLOSE order
  -- (order_id is the OPEN order). Used by ledger / pnl-attribution
  -- queries on production.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'exit_order_id'
  ) THEN
    ALTER TABLE autonomous_trades ADD COLUMN exit_order_id VARCHAR(255);
  END IF;

  -- pnl_percentage: pnl expressed as a percent of margin / notional
  -- (set by writers). Numeric, nullable.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'autonomous_trades'
      AND column_name = 'pnl_percentage'
  ) THEN
    ALTER TABLE autonomous_trades ADD COLUMN pnl_percentage NUMERIC;
  END IF;
END $$;

-- Indexes on the new/renamed timestamp columns. Partial indexes only
-- on the non-null subset — query patterns ORDER BY exit_time DESC and
-- always filter status='closed' (i.e. exit_time IS NOT NULL anyway),
-- so the partial index is the right shape.
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_exit_time
  ON autonomous_trades(exit_time DESC) WHERE exit_time IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_entry_time
  ON autonomous_trades(entry_time DESC) WHERE entry_time IS NOT NULL;
