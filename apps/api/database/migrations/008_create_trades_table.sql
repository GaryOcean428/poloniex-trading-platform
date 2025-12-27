-- Migration 008: Create trades table for autonomous trading
-- This table is used by the autonomous trading system to track all trades

-- Ensure the update trigger function exists (it should already exist from other migrations)
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
    trade_type VARCHAR(50) DEFAULT 'market', -- 'market', 'limit', 'stop', etc.
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_trades_updated_at 
    BEFORE UPDATE ON trades 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON trades TO postgres;

COMMENT ON TABLE trades IS 'Main trades table for autonomous trading system';
COMMENT ON COLUMN trades.pnl IS 'Total profit/loss for the trade';
COMMENT ON COLUMN trades.realized_pnl IS 'Realized profit/loss (for closed trades)';
COMMENT ON COLUMN trades.unrealized_pnl IS 'Unrealized profit/loss (for open trades)';
