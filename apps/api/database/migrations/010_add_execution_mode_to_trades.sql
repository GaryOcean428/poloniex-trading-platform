-- Migration 010: Add execution_mode and rationale to trades table
-- Supports separating backtest, paper, and live trade tracking

-- Add execution_mode column
ALTER TABLE trades ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'paper' CHECK (execution_mode IN ('backtest', 'paper', 'live'));

-- Add rationale column for trade decision explanation
ALTER TABLE trades ADD COLUMN IF NOT EXISTS rationale TEXT;

-- Add strategy_version column
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_version VARCHAR(50);

-- Add agent_session_id column (FK added only if agent_sessions table exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'trades' AND column_name = 'agent_session_id' AND table_schema = current_schema()
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'agent_sessions' AND table_schema = current_schema()
        ) THEN
            ALTER TABLE trades ADD COLUMN agent_session_id VARCHAR(100) REFERENCES agent_sessions(id) ON DELETE SET NULL;
        ELSE
            ALTER TABLE trades ADD COLUMN agent_session_id VARCHAR(100);
        END IF;
    END IF;
END $$;

-- Add confidence_score for trade decisions
ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5, 2);

-- Add risk_score for trade risk assessment
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_score DECIMAL(5, 2);

-- Add fee tracking
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fees DECIMAL(30, 18) DEFAULT 0;

-- Add pnl_percent for percentage returns
ALTER TABLE trades ADD COLUMN IF NOT EXISTS pnl_percent DECIMAL(10, 4);

-- Add simulated flag
ALTER TABLE trades ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT true;

-- Create index on execution_mode for filtered queries
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode ON trades(execution_mode);
CREATE INDEX IF NOT EXISTS idx_trades_agent_session ON trades(agent_session_id);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode_status ON trades(execution_mode, status);

COMMENT ON COLUMN trades.execution_mode IS 'Whether this trade is from backtest, paper trading, or live trading';
COMMENT ON COLUMN trades.rationale IS 'Agent explanation for why this trade was taken';
COMMENT ON COLUMN trades.simulated IS 'True for paper/backtest trades, false for live trades';
