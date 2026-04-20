-- 033_monkey_bus_events.sql
--
-- Append-only audit log for kernel_bus events (v0.6a).
-- 7-day retention via a cron-or-app cleanup task (not included in migration).

BEGIN;

CREATE TABLE IF NOT EXISTS monkey_bus_events (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type      VARCHAR(40) NOT NULL,
  source    VARCHAR(80) NOT NULL,
  symbol    VARCHAR(50),
  payload   JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_monkey_bus_events_at ON monkey_bus_events (at DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_bus_events_type_at ON monkey_bus_events (type, at DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_bus_events_symbol_at ON monkey_bus_events (symbol, at DESC);

COMMIT;
