-- Migration 025: Append-only strategy lifecycle event log
--
-- Captures every state transition (status change, promotion, demotion, kill,
-- recalibration) as an immutable event row. Two jobs:
--
--   1. Audit trail — explains WHY a strategy changed state, which has been
--      invisible historically (issue #447-449: "strategies vanish with just
--      'retired' as the explanation").
--
--   2. Source-of-truth for promotion/demotion engine — concurrent writers
--      (10 parallel strategies) no longer contend on row-level locks in
--      strategy_performance; they append events and a projection layer
--      materialises current state.
--
-- Also pre-provisions engine_version (git SHA) so every row written going
-- forward is attributable to specific code. Commit 3 will add engine_version
-- to legacy tables; this table is born with it.

CREATE TABLE IF NOT EXISTS strategy_state_events (
    id              BIGSERIAL PRIMARY KEY,
    strategy_id     TEXT        NOT NULL,
    from_status     TEXT,                      -- NULL for initial creation event
    to_status       TEXT        NOT NULL,
    reason          TEXT        NOT NULL,      -- short machine-parseable reason code
    detail          TEXT,                      -- free-form human explanation
    metadata        JSONB,                     -- metrics snapshot, trade count, etc.
    engine_version  VARCHAR(40) NOT NULL,      -- git SHA at time of event
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_state_events_strategy_created
    ON strategy_state_events(strategy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_state_events_to_status
    ON strategy_state_events(to_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_state_events_engine_version
    ON strategy_state_events(engine_version);

-- Convenience view: latest event per strategy.
-- Used by promotion engine to decide current state without contending on
-- strategy_performance.
CREATE OR REPLACE VIEW strategy_current_state AS
SELECT DISTINCT ON (strategy_id)
    strategy_id,
    to_status           AS current_status,
    reason              AS last_reason,
    metadata            AS last_metadata,
    engine_version      AS last_engine_version,
    created_at          AS last_transition_at
FROM strategy_state_events
ORDER BY strategy_id, created_at DESC;
