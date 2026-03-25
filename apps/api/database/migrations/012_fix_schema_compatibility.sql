-- Migration 012: Fix schema compatibility between old and new migrations
-- Resolves errors:
--   1. relation "agent_events" does not exist
--   2. column ast.name does not exist (agent_strategies)
--   3. relation "trades" does not exist
--
-- Root cause: Old migration (apps/api/migrations/004) created agent_strategies
-- with strategy_name column and UUID types. New migration (007) uses
-- CREATE TABLE IF NOT EXISTS so it silently skips if the old table exists.
-- Migrations 008, 010, and 011 may also have been skipped.

-- ============================================================
-- 1. Add missing columns to agent_strategies
--    (needed when old migration 004 created the table)
-- ============================================================
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS name VARCHAR(200);
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS timeframe VARCHAR(10);
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS type VARCHAR(20);
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS indicators JSONB;
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS performance JSONB DEFAULT '{"winRate": 0, "profitFactor": 0, "totalTrades": 0, "totalReturn": 0}';
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS sub_strategies JSONB;
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Backfill name from strategy_name where available (safely handle missing column)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_strategies' AND column_name = 'strategy_name'
    ) THEN
        UPDATE agent_strategies SET name = strategy_name WHERE name IS NULL AND strategy_name IS NOT NULL;
    END IF;
END $$;

-- Create indexes that may be missing
CREATE INDEX IF NOT EXISTS idx_agent_strategies_symbol ON agent_strategies(symbol);

-- ============================================================
-- 2. Create trades table if it doesn't exist
--    (mirrors migration 008)
-- ============================================================
-- Ensure trigger function exists (CREATE OR REPLACE is idempotent;
-- PostgreSQL has no CREATE FUNCTION IF NOT EXISTS)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id VARCHAR(255),

    -- Trade details
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL', 'LONG', 'SHORT')),

    -- Entry details
    entry_price DECIMAL(30, 18) NOT NULL,
    entry_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    quantity DECIMAL(30, 18) NOT NULL,

    -- Exit details
    exit_price DECIMAL(30, 18),
    exit_time TIMESTAMP WITH TIME ZONE,

    -- P&L tracking
    pnl DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,

    -- Trade configuration
    leverage DECIMAL(10, 2) DEFAULT 1,
    stop_loss DECIMAL(30, 18),
    take_profit DECIMAL(30, 18),

    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled', 'pending')),

    -- Related order IDs
    entry_order_id VARCHAR(255),
    exit_order_id VARCHAR(255),

    -- Additional metadata
    notes TEXT,
    trade_type VARCHAR(50) DEFAULT 'market',

    -- Execution mode columns (from migration 010)
    execution_mode VARCHAR(20) DEFAULT 'paper' CHECK (execution_mode IN ('backtest', 'paper', 'live')),
    rationale TEXT,
    strategy_version VARCHAR(50),
    agent_session_id VARCHAR(100),
    confidence_score DECIMAL(5, 2),
    risk_score DECIMAL(5, 2),
    fees DECIMAL(30, 18) DEFAULT 0,
    pnl_percent DECIMAL(10, 4),
    simulated BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for trades
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode ON trades(execution_mode);
CREATE INDEX IF NOT EXISTS idx_trades_agent_session ON trades(agent_session_id);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode_status ON trades(execution_mode, status);

-- Add update trigger for trades
DROP TRIGGER IF EXISTS update_trades_updated_at ON trades;
CREATE TRIGGER update_trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. Create agent_events table if it doesn't exist
--    (mirrors migration 011, with flexible FK handling)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Event details
    event_type VARCHAR(50) NOT NULL,
    execution_mode VARCHAR(20),

    -- Event data
    description TEXT NOT NULL,
    explanation TEXT,
    data_inputs JSONB,
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

-- Create indexes for agent_events
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_user ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_mode ON agent_events(execution_mode);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at DESC);

-- ============================================================
-- 4. Ensure execution_mode columns exist on trades
--    (in case trades table existed but migration 010 was skipped)
-- ============================================================
ALTER TABLE trades ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'paper';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_version VARCHAR(50);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS agent_session_id VARCHAR(100);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_score DECIMAL(5, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fees DECIMAL(30, 18) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS pnl_percent DECIMAL(10, 4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT true;

-- Ensure execution_mode CHECK constraint exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'trades_execution_mode_check'
    ) THEN
        ALTER TABLE trades ADD CONSTRAINT trades_execution_mode_check
            CHECK (execution_mode IN ('backtest', 'paper', 'live'));
    END IF;
END $$;

-- Comments
COMMENT ON TABLE trades IS 'Main trades table for autonomous trading system';
COMMENT ON TABLE agent_events IS 'Immutable audit trail of all agent actions and decisions';
