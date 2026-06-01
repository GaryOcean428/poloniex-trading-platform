-- 072_symbol_fill_quality.sql
-- Evidence collection for #827: per-symbol maker fill quality.
-- Tracks slippage, resting time, and directional outcome per close.
-- Read-only telemetry: never blocks trading.
CREATE TABLE IF NOT EXISTS symbol_fill_quality (
  id              BIGSERIAL PRIMARY KEY,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL,              -- long | short
  order_type      TEXT NOT NULL,              -- maker | taker
  entry_price     FLOAT8 NOT NULL,
  fill_price      FLOAT8 NOT NULL,
  slippage_frac   FLOAT8 NOT NULL,            -- (fill - entry) / entry, signed
  resting_ms      BIGINT,                     -- null if taker or unknown
  outcome_pnl     FLOAT8,                     -- null until close
  -- autonomous_trades.id is UUID (000_base_schema) — the FK column MUST match
  -- it. The original BIGINT made the constraint un-creatable, which aborted the
  -- whole migration run ("refusing to start API") and blocked every deploy. 072
  -- had never applied (it failed on the first deploy that reached it), so
  -- fixing the type in place is safe.
  trade_id        UUID REFERENCES autonomous_trades(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sfq_symbol_time ON symbol_fill_quality (symbol, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfq_order_type ON symbol_fill_quality (symbol, order_type, captured_at DESC);
