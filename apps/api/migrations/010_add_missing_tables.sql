-- Migration 010: Add missing tables and fix session_id types
-- Fixes:
--   1. Creates agent_events table (if missing)
--   2. Creates trades table (if missing)
--   3. Adds name column to agent_strategies (if missing)
--   4. Changes session_id columns from UUID to VARCHAR for prefixed session IDs

-- ============================================================
-- 1. Create agent_events table
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    execution_mode VARCHAR(20),
    description TEXT,
    explanation TEXT,
    data_inputs JSONB,
    confidence_score DECIMAL(5, 2),
    risk_score DECIMAL(5, 2),
    resulting_order_id VARCHAR(255),
    pnl_impact DECIMAL(30, 18),
    strategy_version VARCHAR(50),
    market VARCHAR(50),
    timeframe VARCHAR(10),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_events_user_id ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_mode ON agent_events(execution_mode);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC);

-- ============================================================
-- 2. Create trades table
-- ============================================================
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
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    entry_price DECIMAL(30, 18) NOT NULL,
    entry_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    quantity DECIMAL(30, 18) NOT NULL,
    exit_price DECIMAL(30, 18),
    exit_time TIMESTAMP WITH TIME ZONE,
    pnl DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    leverage DECIMAL(10, 2) DEFAULT 1,
    stop_loss DECIMAL(30, 18),
    take_profit DECIMAL(30, 18),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    entry_order_id VARCHAR(255),
    exit_order_id VARCHAR(255),
    notes TEXT,
    trade_type VARCHAR(50) DEFAULT 'market',
    execution_mode VARCHAR(20) DEFAULT 'paper',
    rationale TEXT,
    strategy_version VARCHAR(50),
    agent_session_id VARCHAR(255),
    confidence_score DECIMAL(5, 2),
    risk_score DECIMAL(5, 2),
    fees DECIMAL(30, 18) DEFAULT 0,
    pnl_percent DECIMAL(10, 4),
    simulated BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode ON trades(execution_mode);
CREATE INDEX IF NOT EXISTS idx_trades_agent_session ON trades(agent_session_id);

DROP TRIGGER IF EXISTS update_trades_updated_at ON trades;
CREATE TRIGGER update_trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. Add name column to agent_strategies if missing
-- ============================================================
ALTER TABLE agent_strategies ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Backfill name from strategy_name where available
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_strategies'
          AND column_name = 'strategy_name'
          AND table_schema = current_schema()
    ) THEN
        UPDATE agent_strategies SET name = strategy_name WHERE name IS NULL AND strategy_name IS NOT NULL;
    END IF;
END $$;

-- ============================================================
-- 4. Change session_id columns from UUID to VARCHAR
--    Handles FK constraints safely
-- ============================================================
DO $$
DECLARE
    col_type TEXT;
    fk_record RECORD;
BEGIN
    -- Check if agent_sessions.id is UUID type (from old migration 004)
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'agent_sessions'
      AND column_name = 'id';

    IF col_type = 'uuid' THEN
        -- Drop all FK constraints referencing agent_sessions(id)
        FOR fk_record IN
            SELECT tc.constraint_name, tc.table_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
              AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_name = 'agent_sessions'
              AND ccu.column_name = 'id'
              AND tc.table_schema = current_schema()
        LOOP
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk_record.table_name, fk_record.constraint_name);
        END LOOP;

        -- Convert agent_sessions.id to VARCHAR(255)
        ALTER TABLE agent_sessions ALTER COLUMN id TYPE VARCHAR(255) USING id::text;

        -- Convert session_id columns in related tables
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_strategies' AND column_name = 'session_id' AND table_schema = current_schema()) THEN
            ALTER TABLE agent_strategies ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_learnings' AND column_name = 'session_id' AND table_schema = current_schema()) THEN
            ALTER TABLE agent_learnings ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_activity_log' AND column_name = 'session_id' AND table_schema = current_schema()) THEN
            ALTER TABLE agent_activity_log ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trades' AND column_name = 'agent_session_id' AND table_schema = current_schema() AND data_type = 'uuid') THEN
            ALTER TABLE trades ALTER COLUMN agent_session_id TYPE VARCHAR(255) USING agent_session_id::text;
        END IF;
    ELSE
        -- agent_sessions.id is already VARCHAR; ensure agent_strategies.session_id also is
        SELECT data_type INTO col_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'agent_strategies'
          AND column_name = 'session_id';

        IF col_type = 'uuid' THEN
            ALTER TABLE agent_strategies ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::text;
        END IF;
    END IF;
END $$;
