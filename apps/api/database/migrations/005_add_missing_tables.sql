-- 005_add_missing_tables.sql
-- Fixes autonomous_trading_configs schema to match FullyAutonomousTrader service expectations
-- Creates user_api_credentials (required by 006), autonomous_trades, autonomous_performance

-- =================== FIX autonomous_trading_configs ===================
-- 000_base_schema created a minimal table; the service expects many more columns

ALTER TABLE autonomous_trading_configs
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS initial_capital DECIMAL(30, 18) DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS max_risk_per_trade DECIMAL(10, 4) DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_drawdown DECIMAL(10, 4) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS target_daily_return DECIMAL(10, 4) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS symbols TEXT[] DEFAULT ARRAY['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP'],
  ADD COLUMN IF NOT EXISTS paper_trading BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS stop_loss_percent DECIMAL(10, 4) DEFAULT 2,
  ADD COLUMN IF NOT EXISTS take_profit_percent DECIMAL(10, 4) DEFAULT 4,
  ADD COLUMN IF NOT EXISTS leverage DECIMAL(10, 2) DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_concurrent_positions INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS trading_cycle_seconds INTEGER DEFAULT 60,
  ADD COLUMN IF NOT EXISTS confidence_threshold DECIMAL(10, 4) DEFAULT 65,
  ADD COLUMN IF NOT EXISTS signal_score_threshold DECIMAL(10, 4) DEFAULT 30;

-- enableAutonomousTrading uses ON CONFLICT (user_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'autonomous_trading_configs_user_id_key'
  ) THEN
    ALTER TABLE autonomous_trading_configs ADD CONSTRAINT autonomous_trading_configs_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- =================== user_api_credentials ===================
-- Required by migration 006_add_encryption_fields.sql

CREATE TABLE IF NOT EXISTS user_api_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exchange VARCHAR(50) NOT NULL DEFAULT 'poloniex',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    api_secret_encrypted TEXT NOT NULL DEFAULT '',
    passphrase_encrypted TEXT,
    is_active BOOLEAN DEFAULT true,
    label VARCHAR(100),
    permissions JSONB DEFAULT '{}',
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, exchange)
);

CREATE INDEX IF NOT EXISTS idx_user_api_credentials_user ON user_api_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_credentials_active ON user_api_credentials(is_active) WHERE is_active = true;

-- =================== autonomous_trades ===================
-- Used by FullyAutonomousTrader.executeSignals() and managePositions()

CREATE TABLE IF NOT EXISTS autonomous_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    entry_price DECIMAL(30, 18) NOT NULL,
    exit_price DECIMAL(30, 18),
    quantity DECIMAL(30, 18) NOT NULL,
    stop_loss DECIMAL(30, 18),
    take_profit DECIMAL(30, 18),
    confidence DECIMAL(10, 4),
    reason TEXT,
    order_id VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    close_reason VARCHAR(50),
    pnl DECIMAL(30, 18),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_autonomous_trades_user_status ON autonomous_trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_symbol ON autonomous_trades(symbol);

-- =================== autonomous_performance ===================
-- Used by FullyAutonomousTrader.updatePerformanceMetrics()

CREATE TABLE IF NOT EXISTS autonomous_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_equity DECIMAL(30, 18),
    total_return DECIMAL(10, 4),
    drawdown DECIMAL(10, 4),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_autonomous_performance_user ON autonomous_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_performance_time ON autonomous_performance(timestamp DESC);
