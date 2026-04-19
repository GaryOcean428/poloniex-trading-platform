-- Migration 026: engine_version provenance + soft-delete + purge audit
--
-- Every row produced by the backtesting/paper/live pipeline is now tagged
-- with the git SHA of the engine that produced it. This is the foundation
-- for the legacy-backtest purge: "clean slate" metrics only aggregate rows
-- whose engine_version >= <current>. Legacy rows from before the realistic-
-- costs commit can be filtered, soft-deleted, then hard-deleted once the
-- 7-day rollback window has passed without incident.
--
-- Scope:
--   1. engine_version VARCHAR(40) added to backtest_results, strategy_performance,
--      autonomous_trades, paper_trading_sessions.
--   2. deleted_at TIMESTAMPTZ for soft-delete on the same tables.
--   3. data_purges audit table — one row per purge operation, immutable.

-- ───────── backtest_results ─────────
ALTER TABLE backtest_results
  ADD COLUMN IF NOT EXISTS engine_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_backtest_results_engine_version
  ON backtest_results(engine_version)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_results_deleted_at
  ON backtest_results(deleted_at);

-- ───────── strategy_performance ─────────
ALTER TABLE strategy_performance
  ADD COLUMN IF NOT EXISTS engine_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_strategy_performance_engine_version
  ON strategy_performance(engine_version)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_strategy_performance_deleted_at
  ON strategy_performance(deleted_at);

-- ───────── autonomous_trades ─────────
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS engine_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_autonomous_trades_engine_version
  ON autonomous_trades(engine_version)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_trades_deleted_at
  ON autonomous_trades(deleted_at);

-- ───────── paper_trading_sessions ─────────
ALTER TABLE paper_trading_sessions
  ADD COLUMN IF NOT EXISTS engine_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_engine_version
  ON paper_trading_sessions(engine_version)
  WHERE deleted_at IS NULL;

-- ───────── data_purges audit ─────────
-- One row per purge operation. Immutable (no UPDATE trigger).
CREATE TABLE IF NOT EXISTS data_purges (
    id                BIGSERIAL   PRIMARY KEY,
    purge_kind        TEXT        NOT NULL,      -- 'legacy_backtests', 'hard_delete', etc.
    target_table      TEXT        NOT NULL,
    rows_affected     INTEGER     NOT NULL,
    phase             TEXT        NOT NULL,      -- 'soft_delete' | 'hard_delete' | 'backup_only'
    engine_version    VARCHAR(40) NOT NULL,      -- git SHA at time of purge
    reason            TEXT        NOT NULL,
    backup_path       TEXT,                       -- local + S3 path (nullable if backup-only)
    backup_checksum   TEXT,
    operator          TEXT        NOT NULL,      -- user or 'system'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_purges_created_at
  ON data_purges(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_purges_kind
  ON data_purges(purge_kind, created_at DESC);
