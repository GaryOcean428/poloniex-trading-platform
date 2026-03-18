-- Migration 011: Create agent_events table for audit trail
-- Tracks all agent decisions, actions, and state transitions

CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL, -- 'state_change', 'trade_decision', 'risk_action', 'health_alert', 'mode_change', 'error'
    execution_mode VARCHAR(20), -- 'backtest', 'paper', 'live'
    
    -- Event data
    description TEXT NOT NULL,
    explanation TEXT, -- Human-readable reason
    data_inputs JSONB, -- Summary of inputs that led to this event
    confidence_score DECIMAL(5, 2),
    risk_score DECIMAL(5, 2),
    
    -- Resulting action
    resulting_order_id VARCHAR(255),
    pnl_impact DECIMAL(30, 18),
    
    -- Metadata
    strategy_version VARCHAR(50),
    market VARCHAR(50),
    timeframe VARCHAR(10),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_user ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_mode ON agent_events(execution_mode);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at DESC);

COMMENT ON TABLE agent_events IS 'Immutable audit trail of all agent actions and decisions';
