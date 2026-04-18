-- Migration 029: global agent execution-mode switch
--
-- Single-row table holds the system-wide execution mode. The UI's
-- Execution Mode buttons (AutonomousAgentDashboard) previously only
-- affected per-session config; this table is the authoritative
-- enforcement surface the risk kernel reads on every order.
--
-- Modes:
--   'auto'       — pipeline runs normally (generated → backtest → paper → live)
--   'paper_only' — all live orders are blocked; paper continues
--   'pause'      — all new orders are blocked at every stage

CREATE TABLE IF NOT EXISTS agent_execution_mode (
    id            INTEGER     PRIMARY KEY DEFAULT 1,
    mode          TEXT        NOT NULL DEFAULT 'auto',
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason        TEXT,
    CONSTRAINT agent_execution_mode_single_row CHECK (id = 1),
    CONSTRAINT agent_execution_mode_valid_mode CHECK (mode IN ('auto', 'paper_only', 'pause'))
);

-- Seed the singleton row. ON CONFLICT DO NOTHING makes the migration
-- safe to re-run.
INSERT INTO agent_execution_mode (id, mode, updated_by, reason)
VALUES (1, 'auto', 'migration_029', 'initial seed')
ON CONFLICT (id) DO NOTHING;
