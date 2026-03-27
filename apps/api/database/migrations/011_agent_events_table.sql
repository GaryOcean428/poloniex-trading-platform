-- Migration 011: Create agent_events table for audit trail
-- Tracks all agent decisions, actions, and state transitions
--
-- NOTE: agent_sessions.id may be UUID (from old migration 004) or VARCHAR (from 007).
-- To avoid FK type mismatch errors, we create without FK and let migration 012/013
-- handle the session_id type alignment.

DO $$
DECLARE
    sessions_id_type TEXT;
BEGIN
    -- Only create if table doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events' AND table_schema = current_schema()) THEN
        -- Check agent_sessions.id type to decide FK strategy
        SELECT data_type INTO sessions_id_type
        FROM information_schema.columns
        WHERE table_name = 'agent_sessions' AND column_name = 'id' AND table_schema = current_schema();

        IF sessions_id_type = 'character varying' THEN
            -- Safe to add FK with VARCHAR
            CREATE TABLE agent_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id VARCHAR(255) REFERENCES agent_sessions(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                event_type VARCHAR(50) NOT NULL,
                execution_mode VARCHAR(20),
                description TEXT NOT NULL,
                explanation TEXT,
                data_inputs JSONB,
                confidence_score DECIMAL(5, 2),
                risk_score DECIMAL(5, 2),
                resulting_order_id VARCHAR(255),
                pnl_impact DECIMAL(30, 18),
                strategy_version VARCHAR(50),
                market VARCHAR(50),
                timeframe VARCHAR(10),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        ELSE
            -- UUID or unknown type — create without FK, migration 013 will fix types
            CREATE TABLE agent_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id VARCHAR(255),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                event_type VARCHAR(50) NOT NULL,
                execution_mode VARCHAR(20),
                description TEXT NOT NULL,
                explanation TEXT,
                data_inputs JSONB,
                confidence_score DECIMAL(5, 2),
                risk_score DECIMAL(5, 2),
                resulting_order_id VARCHAR(255),
                pnl_impact DECIMAL(30, 18),
                strategy_version VARCHAR(50),
                market VARCHAR(50),
                timeframe VARCHAR(10),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        END IF;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_user ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_mode ON agent_events(execution_mode);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at DESC);

COMMENT ON TABLE agent_events IS 'Immutable audit trail of all agent actions and decisions';
