-- Autonomous Trading System Tables

-- Trading configurations
CREATE TABLE IF NOT EXISTS autonomous_trading_configs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  initial_capital DECIMAL(20, 8) NOT NULL,
  max_risk_per_trade DECIMAL(5, 2) NOT NULL DEFAULT 2.0,
  max_drawdown DECIMAL(5, 2) NOT NULL DEFAULT 10.0,
  target_daily_return DECIMAL(5, 2) NOT NULL DEFAULT 1.0,
  symbols TEXT[] NOT NULL DEFAULT ARRAY['BTC_USDT_PERP', 'ETH_USDT_PERP'],
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Trade history
CREATE TABLE IF NOT EXISTS autonomous_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL, -- 'long' or 'short'
  entry_price DECIMAL(20, 8) NOT NULL,
  exit_price DECIMAL(20, 8),
  quantity DECIMAL(20, 8) NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 1,
  stop_loss DECIMAL(20, 8),
  take_profit DECIMAL(20, 8),
  confidence DECIMAL(5, 2),
  reason TEXT,
  order_id VARCHAR(255),
  exit_order_id VARCHAR(255),
  pnl DECIMAL(20, 8),
  pnl_percentage DECIMAL(10, 4),
  status VARCHAR(20) DEFAULT 'open', -- 'open', 'closed', 'cancelled'
  exit_reason VARCHAR(50), -- 'stop_loss', 'take_profit', 'trend_reversal', 'manual'
  entry_time TIMESTAMP DEFAULT NOW(),
  exit_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Performance metrics
CREATE TABLE IF NOT EXISTS autonomous_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_equity DECIMAL(20, 8) NOT NULL,
  total_return DECIMAL(10, 4) NOT NULL,
  drawdown DECIMAL(10, 4) NOT NULL,
  win_rate DECIMAL(5, 2),
  profit_factor DECIMAL(10, 4),
  sharpe_ratio DECIMAL(10, 4),
  max_drawdown DECIMAL(10, 4),
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Market analysis cache
CREATE TABLE IF NOT EXISTS market_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(50) NOT NULL,
  trend VARCHAR(20),
  volatility VARCHAR(20),
  momentum DECIMAL(10, 4),
  support DECIMAL(20, 8),
  resistance DECIMAL(20, 8),
  ml_direction VARCHAR(10),
  ml_confidence DECIMAL(5, 2),
  ml_target_price DECIMAL(20, 8),
  analysis_data JSONB,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_user_id ON autonomous_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_symbol ON autonomous_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_status ON autonomous_trades(status);
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_entry_time ON autonomous_trades(entry_time);

CREATE INDEX IF NOT EXISTS idx_autonomous_performance_user_id ON autonomous_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_performance_timestamp ON autonomous_performance(timestamp);

CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol ON market_analysis_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_market_analysis_timestamp ON market_analysis_cache(timestamp);

-- Add comments
COMMENT ON TABLE autonomous_trading_configs IS 'Configuration for fully autonomous trading per user';
COMMENT ON TABLE autonomous_trades IS 'History of all autonomous trades executed';
COMMENT ON TABLE autonomous_performance IS 'Performance metrics tracked over time';
COMMENT ON TABLE market_analysis_cache IS 'Cached market analysis to reduce API calls';
