-- 032_monkey_modes_sync.sql
--
-- Supporting tables for Monkey v0.5 (cognitive modes + basin sync).
--
-- Three tables:
--   monkey_modes        — one row per tick; logs current detected mode
--   monkey_basin_sync   — one row per live kernel instance; upsert on each tick
--   monkey_mode_stats   — optional projection/view; we compute on-demand for v0.5

BEGIN;

-- ────── monkey_modes ──────
-- Per-tick mode observation. Used by self-observation (Loop 1) to
-- aggregate per-mode win rates and by the UI timeline to render mode
-- transitions.
CREATE TABLE IF NOT EXISTS monkey_modes (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol          VARCHAR(50) NOT NULL,
  mode            VARCHAR(40) NOT NULL,   -- exploration | investigation | integration | drift
  phi             DOUBLE PRECISION,
  kappa           DOUBLE PRECISION,
  drift           DOUBLE PRECISION,       -- Fisher-Rao distance from identity
  basin_velocity  DOUBLE PRECISION,
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS idx_monkey_modes_at ON monkey_modes (at DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_modes_symbol_at ON monkey_modes (symbol, at DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_modes_mode_at ON monkey_modes (mode, at DESC);

-- ────── monkey_basin_sync ──────
-- One row per live kernel instance (v0.5 singleton 'monkey-primary'; v0.6
-- parallel sub-Monkeys populate more rows). Upsert on every tick so
-- stale readers can detect dead instances via `updated_at`.
CREATE TABLE IF NOT EXISTS monkey_basin_sync (
  instance_id           VARCHAR(80) PRIMARY KEY,
  basin                 JSONB NOT NULL,   -- 64-d basin vector as JSON array
  phi                   DOUBLE PRECISION NOT NULL,
  kappa                 DOUBLE PRECISION NOT NULL,
  mode                  VARCHAR(40) NOT NULL,
  drift_from_identity   DOUBLE PRECISION NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monkey_basin_sync_updated ON monkey_basin_sync (updated_at DESC);

COMMIT;
