-- Enhanced Backtesting Engine Database Schema
-- This migration adds comprehensive backtesting infrastructure

-- =================== HISTORICAL MARKET DATA ===================
-- Store historical price data for backtesting
CREATE TABLE IF NOT EXISTS historical_market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL, -- 1m, 5m, 15m, 1h, 4h, 1d
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    open DECIMAL(20, 8) NOT NULL,
    high DECIMAL(20, 8) NOT NULL,
    low DECIMAL(20, 8) NOT NULL,
    close DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 8) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint to prevent duplicate candles
CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_data_unique 
ON historical_market_data (symbol, timeframe, timestamp);

-- Performance indexes for historical data queries
CREATE INDEX IF NOT EXISTS idx_historical_data_symbol_timeframe 
ON historical_market_data (symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_historical_data_timestamp 
ON historical_market_data (timestamp);

CREATE INDEX IF NOT EXISTS idx_historical_data_symbol_timestamp 
ON historical_market_data (symbol, timestamp);

-- =================== BACKTEST RESULTS ===================
-- Store backtest run results and metrics
CREATE TABLE IF NOT EXISTS backtest_results (
    id VARCHAR(50) PRIMARY KEY,
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    initial_capital DECIMAL(20, 8) NOT NULL,
    final_value DECIMAL(20, 8) NOT NULL,
    total_return DECIMAL(10, 4) NOT NULL, -- Percentage
    max_drawdown DECIMAL(20, 8) NOT NULL,
    max_drawdown_percent DECIMAL(10, 4) NOT NULL,
    sharpe_ratio DECIMAL(10, 4) NOT NULL,
    sortino_ratio DECIMAL(10, 4) NOT NULL,
    calmar_ratio DECIMAL(10, 4) NOT NULL,
    total_trades INTEGER NOT NULL,
    winning_trades INTEGER NOT NULL,
    losing_trades INTEGER NOT NULL,
    win_rate DECIMAL(5, 2) NOT NULL, -- Percentage
    profit_factor DECIMAL(10, 4) NOT NULL,
    expectancy DECIMAL(10, 4) NOT NULL,
    average_win DECIMAL(20, 8) NOT NULL,
    average_loss DECIMAL(20, 8) NOT NULL,
    config JSONB NOT NULL, -- Strategy and backtest configuration
    metrics JSONB NOT NULL, -- Detailed metrics
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for backtest results
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy 
ON backtest_results (strategy_name);

CREATE INDEX IF NOT EXISTS idx_backtest_results_symbol 
ON backtest_results (symbol);

CREATE INDEX IF NOT EXISTS idx_backtest_results_created_at 
ON backtest_results (created_at);

CREATE INDEX IF NOT EXISTS idx_backtest_results_performance 
ON backtest_results (total_return, sharpe_ratio, max_drawdown_percent);

-- =================== BACKTEST TRADES ===================
-- Store individual trades from backtest runs
CREATE TABLE IF NOT EXISTS backtest_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backtest_id VARCHAR(50) NOT NULL,
    trade_id VARCHAR(50) NOT NULL,
    position_id VARCHAR(50),
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL, -- 'long' or 'short'
    size DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'entry' or 'exit'
    reason VARCHAR(50) NOT NULL, -- 'momentum_long', 'stop_loss', etc.
    fees DECIMAL(20, 8) NOT NULL,
    pnl DECIMAL(20, 8) DEFAULT 0, -- Only for exit trades
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (backtest_id) REFERENCES backtest_results(id) ON DELETE CASCADE
);

-- Indexes for backtest trades
CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest_id 
ON backtest_trades (backtest_id);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_timestamp 
ON backtest_trades (timestamp);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol 
ON backtest_trades (symbol);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_type 
ON backtest_trades (type);

-- =================== BACKTEST EQUITY CURVE ===================
-- Store equity curve data for performance visualization
CREATE TABLE IF NOT EXISTS backtest_equity_curve (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backtest_id VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    total_value DECIMAL(20, 8) NOT NULL,
    cash DECIMAL(20, 8) NOT NULL,
    unrealized_pnl DECIMAL(20, 8) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (backtest_id) REFERENCES backtest_results(id) ON DELETE CASCADE
);

-- Indexes for equity curve
CREATE INDEX IF NOT EXISTS idx_backtest_equity_curve_backtest_id 
ON backtest_equity_curve (backtest_id);

CREATE INDEX IF NOT EXISTS idx_backtest_equity_curve_timestamp 
ON backtest_equity_curve (timestamp);

-- =================== STRATEGY DEFINITIONS ===================
-- Store strategy configurations and parameters
CREATE TABLE IF NOT EXISTS strategy_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL, -- 'momentum', 'mean_reversion', 'breakout', 'custom'
    description TEXT,
    parameters JSONB NOT NULL, -- Strategy-specific parameters
    risk_parameters JSONB NOT NULL, -- Risk management parameters
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for strategy definitions
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_name 
ON strategy_definitions (name);

CREATE INDEX IF NOT EXISTS idx_strategy_definitions_type 
ON strategy_definitions (type);

CREATE INDEX IF NOT EXISTS idx_strategy_definitions_active 
ON strategy_definitions (is_active);

-- =================== STRATEGY PERFORMANCE ===================
-- Track strategy performance across multiple backtest runs
CREATE TABLE IF NOT EXISTS strategy_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    backtest_count INTEGER NOT NULL,
    avg_return DECIMAL(10, 4) NOT NULL,
    avg_sharpe_ratio DECIMAL(10, 4) NOT NULL,
    avg_max_drawdown DECIMAL(10, 4) NOT NULL,
    win_rate DECIMAL(5, 2) NOT NULL,
    confidence_score DECIMAL(5, 2) NOT NULL, -- 0-100 confidence score
    last_backtest_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for strategy performance
CREATE INDEX IF NOT EXISTS idx_strategy_performance_strategy 
ON strategy_performance (strategy_name);

CREATE INDEX IF NOT EXISTS idx_strategy_performance_symbol 
ON strategy_performance (symbol);

CREATE INDEX IF NOT EXISTS idx_strategy_performance_confidence 
ON strategy_performance (confidence_score);

-- =================== PAPER TRADING SESSIONS ===================
-- Store paper trading session data
CREATE TABLE IF NOT EXISTS paper_trading_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_name VARCHAR(100) NOT NULL,
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    initial_capital DECIMAL(20, 8) NOT NULL,
    current_value DECIMAL(20, 8) NOT NULL,
    unrealized_pnl DECIMAL(20, 8) NOT NULL,
    realized_pnl DECIMAL(20, 8) NOT NULL,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'paused', 'stopped'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for paper trading sessions
CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_strategy 
ON paper_trading_sessions (strategy_name);

CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_status 
ON paper_trading_sessions (status);

CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_started_at 
ON paper_trading_sessions (started_at);

-- =================== PAPER TRADING POSITIONS ===================
-- Store paper trading positions
CREATE TABLE IF NOT EXISTS paper_trading_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    position_id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL, -- 'long' or 'short'
    size DECIMAL(20, 8) NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    current_price DECIMAL(20, 8) NOT NULL,
    exit_price DECIMAL(20, 8),
    stop_loss DECIMAL(20, 8),
    take_profit DECIMAL(20, 8),
    unrealized_pnl DECIMAL(20, 8) NOT NULL,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'open', -- 'open', 'closed'
    entry_time TIMESTAMP WITH TIME ZONE NOT NULL,
    exit_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES paper_trading_sessions(id) ON DELETE CASCADE
);

-- Indexes for paper trading positions
CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_session_id 
ON paper_trading_positions (session_id);

CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_symbol 
ON paper_trading_positions (symbol);

CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_status 
ON paper_trading_positions (status);

CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_entry_time 
ON paper_trading_positions (entry_time);

-- =================== PAPER TRADING TRADES ===================
-- Store paper trading trade executions
CREATE TABLE IF NOT EXISTS paper_trading_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    position_id VARCHAR(50) NOT NULL,
    trade_id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL, -- 'long' or 'short'
    size DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'entry' or 'exit'
    reason VARCHAR(50) NOT NULL, -- 'signal', 'stop_loss', 'take_profit'
    fees DECIMAL(20, 8) NOT NULL,
    pnl DECIMAL(20, 8) DEFAULT 0, -- Only for exit trades
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES paper_trading_sessions(id) ON DELETE CASCADE
);

-- Indexes for paper trading trades
CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_session_id 
ON paper_trading_trades (session_id);

CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_timestamp 
ON paper_trading_trades (timestamp);

CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_symbol 
ON paper_trading_trades (symbol);

CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_type 
ON paper_trading_trades (type);

-- =================== CONFIDENCE SCORING ===================
-- Store confidence scores for strategies and market conditions
CREATE TABLE IF NOT EXISTS confidence_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    market_conditions JSONB NOT NULL, -- Current market state
    historical_performance JSONB NOT NULL, -- Past performance metrics
    confidence_score DECIMAL(5, 2) NOT NULL, -- 0-100 confidence score
    risk_score DECIMAL(5, 2) NOT NULL, -- 0-100 risk score
    recommended_position_size DECIMAL(5, 4) NOT NULL, -- 0-1 portfolio fraction
    factors JSONB NOT NULL, -- Factors influencing the score
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for confidence scores
CREATE INDEX IF NOT EXISTS idx_confidence_scores_strategy 
ON confidence_scores (strategy_name);

CREATE INDEX IF NOT EXISTS idx_confidence_scores_symbol 
ON confidence_scores (symbol);

CREATE INDEX IF NOT EXISTS idx_confidence_scores_calculated_at 
ON confidence_scores (calculated_at);

CREATE INDEX IF NOT EXISTS idx_confidence_scores_confidence 
ON confidence_scores (confidence_score);

-- =================== MARKET ANALYSIS ===================
-- Store market analysis and conditions
CREATE TABLE IF NOT EXISTS market_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 8) NOT NULL,
    technical_indicators JSONB NOT NULL, -- RSI, MACD, Bollinger Bands, etc.
    market_conditions JSONB NOT NULL, -- Trend, volatility, momentum
    sentiment_score DECIMAL(5, 2), -- -100 to +100 sentiment score
    volatility_score DECIMAL(5, 2), -- 0-100 volatility score
    trend_strength DECIMAL(5, 2), -- 0-100 trend strength
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for market analysis
CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol 
ON market_analysis (symbol);

CREATE INDEX IF NOT EXISTS idx_market_analysis_timestamp 
ON market_analysis (timestamp);

CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol_timestamp 
ON market_analysis (symbol, timestamp);

-- =================== AUTOMATED TRIGGERS ===================
-- Add triggers for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at columns
CREATE TRIGGER update_backtest_results_updated_at 
    BEFORE UPDATE ON backtest_results 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategy_definitions_updated_at 
    BEFORE UPDATE ON strategy_definitions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategy_performance_updated_at 
    BEFORE UPDATE ON strategy_performance 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_paper_trading_sessions_updated_at 
    BEFORE UPDATE ON paper_trading_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_paper_trading_positions_updated_at 
    BEFORE UPDATE ON paper_trading_positions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_historical_market_data_updated_at 
    BEFORE UPDATE ON historical_market_data 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== PERFORMANCE VIEWS ===================
-- Create views for common queries

-- Strategy performance summary
CREATE OR REPLACE VIEW strategy_performance_summary AS
SELECT 
    s.name,
    s.type,
    s.description,
    COALESCE(sp.avg_return, 0) as avg_return,
    COALESCE(sp.avg_sharpe_ratio, 0) as avg_sharpe_ratio,
    COALESCE(sp.avg_max_drawdown, 0) as avg_max_drawdown,
    COALESCE(sp.win_rate, 0) as win_rate,
    COALESCE(sp.confidence_score, 0) as confidence_score,
    COALESCE(sp.backtest_count, 0) as backtest_count,
    sp.last_backtest_date,
    s.created_at,
    s.updated_at
FROM strategy_definitions s
LEFT JOIN strategy_performance sp ON s.name = sp.strategy_name
WHERE s.is_active = true;

-- Recent backtest results
CREATE OR REPLACE VIEW recent_backtest_results AS
SELECT 
    id,
    strategy_name,
    symbol,
    timeframe,
    start_date,
    end_date,
    initial_capital,
    final_value,
    total_return,
    max_drawdown_percent,
    sharpe_ratio,
    total_trades,
    win_rate,
    created_at
FROM backtest_results
ORDER BY created_at DESC;

-- Active paper trading sessions
CREATE OR REPLACE VIEW active_paper_trading_sessions AS
SELECT 
    pts.id,
    pts.session_name,
    pts.strategy_name,
    pts.symbol,
    pts.timeframe,
    pts.initial_capital,
    pts.current_value,
    pts.unrealized_pnl,
    pts.realized_pnl,
    pts.total_trades,
    pts.winning_trades,
    CASE 
        WHEN pts.total_trades > 0 THEN (pts.winning_trades::DECIMAL / pts.total_trades * 100)
        ELSE 0
    END as win_rate,
    pts.started_at,
    pts.updated_at
FROM paper_trading_sessions pts
WHERE pts.status = 'active';

-- Paper trading position summary
CREATE OR REPLACE VIEW paper_trading_position_summary AS
SELECT 
    ptp.session_id,
    ptp.symbol,
    COUNT(*) as total_positions,
    COUNT(CASE WHEN ptp.status = 'open' THEN 1 END) as open_positions,
    COUNT(CASE WHEN ptp.status = 'closed' THEN 1 END) as closed_positions,
    SUM(ptp.unrealized_pnl) as total_unrealized_pnl,
    SUM(ptp.realized_pnl) as total_realized_pnl,
    AVG(ptp.unrealized_pnl) as avg_unrealized_pnl,
    AVG(ptp.realized_pnl) as avg_realized_pnl
FROM paper_trading_positions ptp
GROUP BY ptp.session_id, ptp.symbol;

-- =================== COMMENTS ===================
-- Add comments for documentation
COMMENT ON TABLE historical_market_data IS 'Stores historical OHLCV data for backtesting';
COMMENT ON TABLE backtest_results IS 'Stores backtest run results and performance metrics';
COMMENT ON TABLE backtest_trades IS 'Stores individual trades from backtest runs';
COMMENT ON TABLE backtest_equity_curve IS 'Stores equity curve data for performance visualization';
COMMENT ON TABLE strategy_definitions IS 'Stores strategy configurations and parameters';
COMMENT ON TABLE strategy_performance IS 'Tracks strategy performance across multiple runs';
COMMENT ON TABLE paper_trading_sessions IS 'Stores paper trading session data';
COMMENT ON TABLE paper_trading_positions IS 'Stores paper trading positions';
COMMENT ON TABLE paper_trading_trades IS 'Stores paper trading trade executions';
COMMENT ON TABLE confidence_scores IS 'Stores confidence scores for strategies and market conditions';
COMMENT ON TABLE market_analysis IS 'Stores market analysis and technical indicators';

-- Grant permissions (adjust as needed for your user management)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;