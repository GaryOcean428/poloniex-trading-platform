-- Migration 007: Agent Sessions and Strategies Tables
-- Creates tables for enhanced autonomous agent with AI strategy generation

-- Agent sessions table
CREATE TABLE IF NOT EXISTS agent_sessions (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'running', -- 'running', 'stopped', 'paused'
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stopped_at TIMESTAMP WITH TIME ZONE,
    
    -- Statistics
    strategies_generated INTEGER DEFAULT 0,
    backtests_completed INTEGER DEFAULT 0,
    paper_trades_executed INTEGER DEFAULT 0,
    live_trades_executed INTEGER DEFAULT 0,
    total_pnl DECIMAL(20, 8) DEFAULT 0,
    
    -- Configuration
    config JSONB NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Agent strategies table
CREATE TABLE IF NOT EXISTS agent_strategies (
    id VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    
    -- Strategy info
    name VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'single', 'combo'
    symbol VARCHAR(50) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    indicators JSONB NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'generated', -- 'generated', 'backtested', 'paper_trading', 'live', 'retired'
    
    -- Performance
    performance JSONB DEFAULT '{"winRate": 0, "profitFactor": 0, "totalTrades": 0, "totalReturn": 0}',
    
    -- For combo strategies
    sub_strategies JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    promoted_at TIMESTAMP WITH TIME ZONE,
    retired_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Agent settings table (for persistent agent configuration)
CREATE TABLE IF NOT EXISTS agent_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Persistence settings
    run_mode VARCHAR(20) NOT NULL DEFAULT 'manual', -- 'never', 'manual', 'always'
    auto_start_on_login BOOLEAN DEFAULT false,
    continue_when_logged_out BOOLEAN DEFAULT false,
    
    -- Agent configuration
    config JSONB NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT false,
    last_started_at TIMESTAMP WITH TIME ZONE,
    last_stopped_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_agent_strategies_session_id ON agent_strategies(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_strategies_status ON agent_strategies(status);
CREATE INDEX IF NOT EXISTS idx_agent_strategies_symbol ON agent_strategies(symbol);
CREATE INDEX IF NOT EXISTS idx_agent_settings_user_id ON agent_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_settings_run_mode ON agent_settings(run_mode);
CREATE INDEX IF NOT EXISTS idx_agent_settings_active ON agent_settings(is_active);

-- Create update triggers
CREATE OR REPLACE FUNCTION update_agent_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_agent_strategies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_agent_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_sessions_updated_at ON agent_sessions;
CREATE TRIGGER update_agent_sessions_updated_at
    BEFORE UPDATE ON agent_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_sessions_updated_at();

DROP TRIGGER IF EXISTS update_agent_strategies_updated_at ON agent_strategies;
CREATE TRIGGER update_agent_strategies_updated_at
    BEFORE UPDATE ON agent_strategies
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_strategies_updated_at();

DROP TRIGGER IF EXISTS update_agent_settings_updated_at ON agent_settings;
CREATE TRIGGER update_agent_settings_updated_at
    BEFORE UPDATE ON agent_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_settings_updated_at();

-- Add comments
COMMENT ON TABLE agent_sessions IS 'Autonomous agent trading sessions';
COMMENT ON TABLE agent_strategies IS 'AI-generated trading strategies';
COMMENT ON TABLE agent_settings IS 'Persistent agent configuration per user';
COMMENT ON COLUMN agent_strategies.type IS 'single = single indicator strategy, combo = multi-strategy combination';
COMMENT ON COLUMN agent_settings.run_mode IS 'never = disabled, manual = user controlled, always = run 24/7';
