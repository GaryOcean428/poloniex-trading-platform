-- 049_paper_trades.sql
--
-- Add paper_trades table for in-process deterministic paper execution
-- across Monkey and LiveSignal. Fully idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'paper_trades'
  ) THEN
    CREATE TABLE paper_trades (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      engine VARCHAR(20) NOT NULL,
      user_id UUID NOT NULL,
      symbol VARCHAR(50) NOT NULL,
      side VARCHAR(10) NOT NULL,
      entry_price NUMERIC(30, 18) NOT NULL,
      exit_price NUMERIC(30, 18),
      quantity NUMERIC(30, 18) NOT NULL,
      leverage INTEGER,
      entry_time TIMESTAMP NOT NULL DEFAULT NOW(),
      exit_time TIMESTAMP,
      exit_reason VARCHAR(255),
      pnl NUMERIC(30, 18),
      pnl_percentage NUMERIC,
      slippage_bps NUMERIC DEFAULT 0,
      order_id VARCHAR(255),
      metadata JSONB
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_paper_trades_engine_symbol_status
  ON paper_trades(engine, symbol) WHERE exit_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_paper_trades_exit_time
  ON paper_trades(exit_time DESC) WHERE exit_time IS NOT NULL;
