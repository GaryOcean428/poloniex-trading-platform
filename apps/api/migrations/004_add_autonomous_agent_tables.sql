-- Migration: Add Autonomous Trading Agent Tables
-- Description: Create tables for AI-driven autonomous trading system

-- Agent Sessions Table
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'stopped', 'paused')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMP,
  strategies_generated INTEGER DEFAULT 0,
  backtests_completed INTEGER DEFAULT 0,
  paper_trades_executed INTEGER DEFAULT 0,
  live_trades_executed INTEGER DEFAULT 0,
  total_pnl DECIMAL(15, 2) DEFAULT 0,
  config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);

-- Agent Strategies Table
CREATE TABLE IF NOT EXISTS agent_strategies (
  id VARCHAR(255) PRIMARY KEY,
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  strategy_name VARCHAR(255) NOT NULL,
  strategy_code TEXT NOT NULL,
  generation_prompt TEXT,
  claude_response TEXT,
  backtest_score DECIMAL(10, 4),
  paper_trading_score DECIMAL(10, 4),
  live_trading_score DECIMAL(10, 4),
  status VARCHAR(20) NOT NULL CHECK (status IN ('generated', 'backtested', 'paper_trading', 'live', 'retired')),
  created_at TIMESTAMP DEFAULT NOW(),
  promoted_at TIMESTAMP,
  retired_at TIMESTAMP
);

CREATE INDEX idx_agent_strategies_session_id ON agent_strategies(session_id);
CREATE INDEX idx_agent_strategies_status ON agent_strategies(status);
CREATE INDEX idx_agent_strategies_backtest_score ON agent_strategies(backtest_score DESC);

-- Agent Learnings Table
CREATE TABLE IF NOT EXISTS agent_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  learning_type VARCHAR(50) NOT NULL CHECK (learning_type IN ('strategy_success', 'strategy_failure', 'market_pattern', 'risk_event')),
  context JSONB,
  insight TEXT NOT NULL,
  confidence DECIMAL(5, 4) CHECK (confidence >= 0 AND confidence <= 1),
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_learnings_session_id ON agent_learnings(session_id);
CREATE INDEX idx_agent_learnings_type ON agent_learnings(learning_type);
CREATE INDEX idx_agent_learnings_confidence ON agent_learnings(confidence DESC);

-- Agent Activity Log Table
CREATE TABLE IF NOT EXISTS agent_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_activity_log_session_id ON agent_activity_log(session_id);
CREATE INDEX idx_agent_activity_log_type ON agent_activity_log(activity_type);
CREATE INDEX idx_agent_activity_log_created_at ON agent_activity_log(created_at DESC);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to agent_sessions
CREATE TRIGGER update_agent_sessions_updated_at BEFORE UPDATE ON agent_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE agent_sessions IS 'Tracks autonomous trading agent sessions for each user';
COMMENT ON TABLE agent_strategies IS 'Stores AI-generated trading strategies and their performance';
COMMENT ON TABLE agent_learnings IS 'Records insights and learnings from trading outcomes';
COMMENT ON TABLE agent_activity_log IS 'Logs all activities performed by the autonomous agent';
