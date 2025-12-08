-- Poloniex Futures v3 API Database Schema Migration
-- This migration adds all required tables for complete futures trading functionality
-- Based on Poloniex Futures v3 API documentation

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================== FUTURES ACCOUNTS ===================

-- Futures account management
CREATE TABLE IF NOT EXISTS futures_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Poloniex account identifiers
    poloniex_account_id VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) DEFAULT 'futures' CHECK (account_type IN ('futures', 'unified')),
    
    -- Account state and balances
    account_state VARCHAR(20) DEFAULT 'NORMAL' CHECK (account_state IN ('NORMAL', 'SUSPENDED', 'LIQUIDATING')),
    total_equity DECIMAL(30, 18) DEFAULT 0,
    available_balance DECIMAL(30, 18) DEFAULT 0,
    isolated_equity DECIMAL(30, 18) DEFAULT 0,
    cross_equity DECIMAL(30, 18) DEFAULT 0,
    
    -- Margin requirements
    initial_margin DECIMAL(30, 18) DEFAULT 0,
    maintenance_margin DECIMAL(30, 18) DEFAULT 0,
    margin_ratio DECIMAL(10, 6) DEFAULT 0,
    
    -- Position configuration
    position_mode VARCHAR(10) DEFAULT 'ONE_WAY' CHECK (position_mode IN ('ONE_WAY', 'HEDGE')),
    max_leverage DECIMAL(10, 2) DEFAULT 100,
    
    -- Risk management
    daily_realized_pnl DECIMAL(30, 18) DEFAULT 0,
    total_realized_pnl DECIMAL(30, 18) DEFAULT 0,
    
    -- Status and metadata
    is_active BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(user_id, poloniex_account_id)
);

-- =================== FUTURES POSITIONS ===================

-- Futures position tracking
CREATE TABLE IF NOT EXISTS futures_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Position identification
    symbol VARCHAR(50) NOT NULL,
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT', 'BOTH')),
    
    -- Position size and pricing
    size DECIMAL(30, 18) NOT NULL DEFAULT 0,
    available_size DECIMAL(30, 18) NOT NULL DEFAULT 0,
    avg_open_price DECIMAL(30, 18) DEFAULT 0,
    mark_price DECIMAL(30, 18) DEFAULT 0,
    last_price DECIMAL(30, 18) DEFAULT 0,
    
    -- Margin and leverage
    margin_mode VARCHAR(10) NOT NULL CHECK (margin_mode IN ('ISOLATED', 'CROSS')),
    leverage DECIMAL(10, 2) NOT NULL DEFAULT 1,
    position_margin DECIMAL(30, 18) DEFAULT 0,
    initial_margin DECIMAL(30, 18) DEFAULT 0,
    maintenance_margin DECIMAL(30, 18) DEFAULT 0,
    margin_ratio DECIMAL(10, 6) DEFAULT 0,
    
    -- Risk management
    liquidation_price DECIMAL(30, 18) DEFAULT 0,
    bankruptcy_price DECIMAL(30, 18) DEFAULT 0,
    adl_ranking INTEGER DEFAULT 0,
    
    -- P&L tracking
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl_ratio DECIMAL(10, 6) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    daily_realized_pnl DECIMAL(30, 18) DEFAULT 0,
    
    -- Status and timestamps
    status VARCHAR(20) DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'LIQUIDATING', 'ADL')),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(user_id, account_id, symbol, position_side)
);

-- =================== FUTURES ORDERS ===================

-- Futures order management
CREATE TABLE IF NOT EXISTS futures_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Order identification
    poloniex_order_id VARCHAR(100) UNIQUE NOT NULL,
    client_order_id VARCHAR(100),
    
    -- Order details
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('LIMIT', 'MARKET', 'POST_ONLY', 'FOK', 'IOC', 'STOP_LIMIT', 'STOP_MARKET')),
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT', 'BOTH')),
    
    -- Price and quantity
    price DECIMAL(30, 18),
    trigger_price DECIMAL(30, 18), -- For stop orders
    size DECIMAL(30, 18) NOT NULL,
    value DECIMAL(30, 18),
    
    -- Execution details
    filled_size DECIMAL(30, 18) DEFAULT 0,
    filled_value DECIMAL(30, 18) DEFAULT 0,
    avg_filled_price DECIMAL(30, 18) DEFAULT 0,
    
    -- Trading configuration
    leverage DECIMAL(10, 2) NOT NULL DEFAULT 1,
    margin_mode VARCHAR(10) NOT NULL CHECK (margin_mode IN ('ISOLATED', 'CROSS')),
    time_in_force VARCHAR(10) CHECK (time_in_force IN ('GTC', 'IOC', 'FOK', 'GTD')),
    
    -- Order flags
    reduce_only BOOLEAN DEFAULT false,
    post_only BOOLEAN DEFAULT false,
    close_on_trigger BOOLEAN DEFAULT false,
    
    -- Fees and costs
    fee DECIMAL(30, 18) DEFAULT 0,
    fee_currency VARCHAR(10) DEFAULT 'USDT',
    
    -- Status and timing
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED')),
    cancel_reason VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    
    -- Poloniex timestamps
    poloniex_created_at TIMESTAMP WITH TIME ZONE,
    poloniex_updated_at TIMESTAMP WITH TIME ZONE
);

-- =================== FUTURES TRADES ===================

-- Futures trade execution records
CREATE TABLE IF NOT EXISTS futures_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES futures_orders(id) ON DELETE CASCADE,
    
    -- Trade identification
    poloniex_trade_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Trade details
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT', 'BOTH')),
    
    -- Execution details
    price DECIMAL(30, 18) NOT NULL,
    size DECIMAL(30, 18) NOT NULL,
    value DECIMAL(30, 18) NOT NULL,
    
    -- Trading configuration
    leverage DECIMAL(10, 2) NOT NULL DEFAULT 1,
    margin_mode VARCHAR(10) NOT NULL CHECK (margin_mode IN ('ISOLATED', 'CROSS')),
    
    -- Fee information
    fee DECIMAL(30, 18) DEFAULT 0,
    fee_currency VARCHAR(10) DEFAULT 'USDT',
    fee_rate DECIMAL(10, 8) DEFAULT 0,
    
    -- Trade role and liquidity
    role VARCHAR(10) CHECK (role IN ('MAKER', 'TAKER')),
    liquidity_type VARCHAR(10) CHECK (liquidity_type IN ('MAKER', 'TAKER')),
    
    -- P&L impact
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trade_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Poloniex timestamp
    poloniex_trade_time TIMESTAMP WITH TIME ZONE
);

-- =================== FUTURES MARKET DATA ===================

-- Real-time futures market data
CREATE TABLE IF NOT EXISTS futures_market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Symbol identification
    symbol VARCHAR(50) NOT NULL,
    
    -- Price data
    last_price DECIMAL(30, 18) NOT NULL,
    mark_price DECIMAL(30, 18) NOT NULL,
    index_price DECIMAL(30, 18) NOT NULL,
    
    -- Order book
    best_bid DECIMAL(30, 18),
    best_ask DECIMAL(30, 18),
    bid_size DECIMAL(30, 18),
    ask_size DECIMAL(30, 18),
    
    -- 24h statistics
    high_24h DECIMAL(30, 18),
    low_24h DECIMAL(30, 18),
    volume_24h DECIMAL(30, 18),
    turnover_24h DECIMAL(30, 18),
    change_24h DECIMAL(10, 6),
    change_rate_24h DECIMAL(10, 6),
    
    -- Funding information
    funding_rate DECIMAL(10, 8),
    predicted_funding_rate DECIMAL(10, 8),
    next_funding_time TIMESTAMP WITH TIME ZONE,
    
    -- Open interest
    open_interest DECIMAL(30, 18),
    open_interest_value DECIMAL(30, 18),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    market_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Constraints for efficient queries
    UNIQUE(symbol, market_time)
);

-- =================== FUTURES ACCOUNT BILLS ===================

-- Futures transaction history
CREATE TABLE IF NOT EXISTS futures_account_bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Bill identification
    poloniex_bill_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Bill details
    symbol VARCHAR(50) NOT NULL,
    bill_type VARCHAR(50) NOT NULL, -- TRADE, FUNDING, LIQUIDATION, MARGIN_TRANSFER, etc.
    bill_sub_type VARCHAR(50), -- More specific categorization
    
    -- Amount and currency
    amount DECIMAL(30, 18) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    balance DECIMAL(30, 18) NOT NULL,
    
    -- Related entities
    related_order_id VARCHAR(100),
    related_trade_id VARCHAR(100),
    related_position_id VARCHAR(100),
    
    -- Additional information
    description TEXT,
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    bill_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Poloniex timestamp
    poloniex_bill_time TIMESTAMP WITH TIME ZONE
);

-- =================== FUTURES FUNDING HISTORY ===================

-- Funding rate payments
CREATE TABLE IF NOT EXISTS futures_funding_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Funding details
    symbol VARCHAR(50) NOT NULL,
    position_size DECIMAL(30, 18) NOT NULL,
    funding_rate DECIMAL(10, 8) NOT NULL,
    funding_amount DECIMAL(30, 18) NOT NULL,
    
    -- Related information
    mark_price DECIMAL(30, 18),
    position_value DECIMAL(30, 18),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    funding_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Constraints
    UNIQUE(user_id, account_id, symbol, funding_time)
);

-- =================== FUTURES RISK MANAGEMENT ===================

-- Risk limits per symbol
CREATE TABLE IF NOT EXISTS futures_risk_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Risk configuration
    symbol VARCHAR(50) NOT NULL,
    max_position_size DECIMAL(30, 18) NOT NULL,
    max_leverage DECIMAL(10, 2) NOT NULL,
    max_order_size DECIMAL(30, 18),
    
    -- Loss limits
    max_daily_loss DECIMAL(30, 18),
    max_total_loss DECIMAL(30, 18),
    max_drawdown DECIMAL(10, 6),
    
    -- Risk level configuration
    risk_level INTEGER DEFAULT 1 CHECK (risk_level BETWEEN 1 AND 5),
    maintenance_margin_rate DECIMAL(10, 6),
    
    -- Auto-liquidation settings
    auto_liquidation_enabled BOOLEAN DEFAULT true,
    liquidation_threshold DECIMAL(10, 6) DEFAULT 0.05,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(user_id, account_id, symbol)
);

-- =================== FUTURES LIQUIDATION EVENTS ===================

-- Liquidation tracking
CREATE TABLE IF NOT EXISTS futures_liquidation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Liquidation details
    symbol VARCHAR(50) NOT NULL,
    liquidation_type VARCHAR(20) NOT NULL CHECK (liquidation_type IN ('FORCED', 'ADL', 'BANKRUPTCY')),
    
    -- Position before liquidation
    position_size DECIMAL(30, 18) NOT NULL,
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT')),
    avg_entry_price DECIMAL(30, 18) NOT NULL,
    mark_price DECIMAL(30, 18) NOT NULL,
    liquidation_price DECIMAL(30, 18) NOT NULL,
    
    -- Liquidation execution
    liquidated_size DECIMAL(30, 18) NOT NULL,
    liquidation_fee DECIMAL(30, 18) DEFAULT 0,
    insurance_fund_fee DECIMAL(30, 18) DEFAULT 0,
    
    -- Financial impact
    realized_pnl DECIMAL(30, 18) NOT NULL,
    margin_released DECIMAL(30, 18) DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    liquidation_time TIMESTAMP WITH TIME ZONE NOT NULL
);

-- =================== STRATEGY EXECUTION LOGS ===================

-- Trading strategy execution tracking
CREATE TABLE IF NOT EXISTS strategy_execution_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    
    -- Strategy identification
    strategy_id VARCHAR(100) NOT NULL,
    strategy_name VARCHAR(200) NOT NULL,
    strategy_type VARCHAR(50) NOT NULL,
    strategy_version VARCHAR(20) DEFAULT '1.0',
    
    -- Execution details
    symbol VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    
    -- Parameters and configuration
    parameters JSONB DEFAULT '{}',
    market_conditions JSONB DEFAULT '{}',
    
    -- Execution results
    execution_result VARCHAR(20) NOT NULL CHECK (execution_result IN ('SUCCESS', 'FAILED', 'PARTIAL')),
    orders_created TEXT[],
    positions_modified TEXT[],
    
    -- Error handling
    error_code VARCHAR(50),
    error_message TEXT,
    
    -- Performance metrics
    expected_pnl DECIMAL(30, 18),
    actual_pnl DECIMAL(30, 18),
    execution_time_ms INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- =================== INDEXES FOR PERFORMANCE ===================

-- Futures accounts indexes
CREATE INDEX IF NOT EXISTS idx_futures_accounts_user_id ON futures_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_accounts_poloniex_id ON futures_accounts(poloniex_account_id);
CREATE INDEX IF NOT EXISTS idx_futures_accounts_state ON futures_accounts(account_state);

-- Futures positions indexes
CREATE INDEX IF NOT EXISTS idx_futures_positions_user_symbol ON futures_positions(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_futures_positions_account_symbol ON futures_positions(account_id, symbol);
CREATE INDEX IF NOT EXISTS idx_futures_positions_status ON futures_positions(status);
CREATE INDEX IF NOT EXISTS idx_futures_positions_updated ON futures_positions(updated_at);

-- Futures orders indexes
CREATE INDEX IF NOT EXISTS idx_futures_orders_user_status ON futures_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_futures_orders_symbol_created ON futures_orders(symbol, created_at);
CREATE INDEX IF NOT EXISTS idx_futures_orders_poloniex_id ON futures_orders(poloniex_order_id);
CREATE INDEX IF NOT EXISTS idx_futures_orders_client_id ON futures_orders(client_order_id);

-- Futures trades indexes
CREATE INDEX IF NOT EXISTS idx_futures_trades_user_symbol ON futures_trades(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_futures_trades_trade_time ON futures_trades(trade_time);
CREATE INDEX IF NOT EXISTS idx_futures_trades_poloniex_id ON futures_trades(poloniex_trade_id);

-- Market data indexes
CREATE INDEX IF NOT EXISTS idx_futures_market_data_symbol_time ON futures_market_data(symbol, market_time);
CREATE INDEX IF NOT EXISTS idx_futures_market_data_created ON futures_market_data(created_at);

-- Account bills indexes
CREATE INDEX IF NOT EXISTS idx_futures_bills_user_time ON futures_account_bills(user_id, bill_time);
CREATE INDEX IF NOT EXISTS idx_futures_bills_type ON futures_account_bills(bill_type);
CREATE INDEX IF NOT EXISTS idx_futures_bills_symbol ON futures_account_bills(symbol);

-- Funding history indexes
CREATE INDEX IF NOT EXISTS idx_futures_funding_user_symbol ON futures_funding_history(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_futures_funding_time ON futures_funding_history(funding_time);

-- Risk limits indexes
CREATE INDEX IF NOT EXISTS idx_futures_risk_user_symbol ON futures_risk_limits(user_id, symbol);

-- Liquidation events indexes
CREATE INDEX IF NOT EXISTS idx_futures_liquidation_user_time ON futures_liquidation_events(user_id, liquidation_time);
CREATE INDEX IF NOT EXISTS idx_futures_liquidation_symbol ON futures_liquidation_events(symbol);

-- Strategy execution logs indexes
CREATE INDEX IF NOT EXISTS idx_strategy_logs_user_strategy ON strategy_execution_logs(user_id, strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_logs_executed ON strategy_execution_logs(executed_at);
CREATE INDEX IF NOT EXISTS idx_strategy_logs_symbol ON strategy_execution_logs(symbol);

-- =================== UPDATE TRIGGERS ===================

-- Update triggers for automatic timestamp management
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers to relevant tables
CREATE TRIGGER update_futures_accounts_updated_at BEFORE UPDATE ON futures_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_futures_positions_updated_at BEFORE UPDATE ON futures_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_futures_orders_updated_at BEFORE UPDATE ON futures_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_futures_risk_limits_updated_at BEFORE UPDATE ON futures_risk_limits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== VIEWS FOR COMMON QUERIES ===================

-- Active positions with P&L
CREATE OR REPLACE VIEW active_futures_positions AS
SELECT 
    fp.*,
    fa.total_equity,
    fa.position_mode,
    (fp.unrealized_pnl / NULLIF(fp.position_margin, 0)) * 100 as pnl_percentage
FROM futures_positions fp
JOIN futures_accounts fa ON fp.account_id = fa.id
WHERE fp.size != 0 AND fp.status = 'NORMAL';

-- Recent trading activity
CREATE OR REPLACE VIEW recent_futures_trades AS
SELECT 
    ft.*,
    fo.type as order_type,
    fo.time_in_force,
    fa.position_mode
FROM futures_trades ft
JOIN futures_orders fo ON ft.order_id = fo.id
JOIN futures_accounts fa ON ft.account_id = fa.id
WHERE ft.trade_time >= NOW() - INTERVAL '7 days'
ORDER BY ft.trade_time DESC;

-- Account summary
CREATE OR REPLACE VIEW futures_account_summary AS
SELECT 
    fa.*,
    COUNT(DISTINCT fp.symbol) as active_positions,
    SUM(fp.unrealized_pnl) as total_unrealized_pnl,
    SUM(fp.position_margin) as total_position_margin
FROM futures_accounts fa
LEFT JOIN futures_positions fp ON fa.id = fp.account_id AND fp.size != 0
WHERE fa.is_active = true
GROUP BY fa.id;

-- =================== GRANT PERMISSIONS ===================

-- Grant permissions to application users
DO $$
BEGIN
    -- Grant permissions to existing users if they exist
    IF EXISTS (SELECT 1 FROM pg_user WHERE usename = 'GaryOcean') THEN
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO GaryOcean;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO GaryOcean;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_user WHERE usename = 'braden_lang77') THEN
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO braden_lang77;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO braden_lang77;
    END IF;
END $$;

-- =================== MIGRATION COMPLETE ===================

-- Log migration completion
INSERT INTO strategy_execution_logs (
    user_id, 
    account_id, 
    strategy_id, 
    strategy_name, 
    strategy_type, 
    symbol, 
    action, 
    execution_result, 
    executed_at
) 
SELECT 
    u.id,
    fa.id,
    'MIGRATION_001',
    'Futures Database Schema Migration',
    'SYSTEM',
    'SYSTEM',
    'CREATE_SCHEMA',
    'SUCCESS',
    CURRENT_TIMESTAMP
FROM users u
JOIN futures_accounts fa ON u.id = fa.user_id
WHERE u.username = 'GaryOcean'
LIMIT 1;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Futures database schema migration completed successfully!';
    RAISE NOTICE 'Tables created: 10 core tables + 3 views';
    RAISE NOTICE 'Indexes created: 25 performance indexes';
    RAISE NOTICE 'Ready for Poloniex Futures v3 API integration';
END $$;