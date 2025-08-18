-- Migration 003: Autonomous Trading System Schema
-- Creates tables for autonomous strategy generation, optimization, and profit banking

-- Trading configuration table
CREATE TABLE IF NOT EXISTS trading_config (
    id SERIAL PRIMARY KEY,
    initial_balance DECIMAL(15, 8) NOT NULL DEFAULT 10000,
    risk_tolerance JSONB NOT NULL DEFAULT '{"maxDrawdown": 0.15, "riskPerTrade": 0.02, "maxPositionSize": 0.1}',
    banking_config JSONB NOT NULL DEFAULT '{"enabled": true, "bankingPercentage": 0.30, "minimumProfitThreshold": 50}',
    emergency_stop_enabled BOOLEAN DEFAULT false,
    emergency_stop_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO trading_config (id, initial_balance, risk_tolerance, banking_config) 
VALUES (1, 10000, 
    '{"maxDrawdown": 0.15, "riskPerTrade": 0.02, "maxPositionSize": 0.1, "profitBankingPercent": 0.30}',
    '{"enabled": true, "bankingPercentage": 0.30, "minimumProfitThreshold": 50, "maximumSingleTransfer": 10000, "bankingInterval": 21600000, "emergencyStopThreshold": 0.25, "maxDailyBanking": 50000}'
) ON CONFLICT (id) DO NOTHING;

-- Autonomous strategies table
CREATE TABLE IF NOT EXISTS autonomous_strategies (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    indicators JSONB NOT NULL,
    parameters JSONB NOT NULL,
    performance JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'created',
    fitness_score DECIMAL(10, 6) DEFAULT 0,
    generation INTEGER DEFAULT 0,
    parent_id VARCHAR(255),
    parents JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    backtest_completed_at TIMESTAMP,
    paper_trading_started_at TIMESTAMP,
    live_promotion_at TIMESTAMP,
    retired_at TIMESTAMP,
    retirement_reason TEXT,
    error_message TEXT
);

-- Index for performance queries
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_status ON autonomous_strategies(status);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_generation ON autonomous_strategies(generation);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_fitness ON autonomous_strategies(fitness_score DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_symbol ON autonomous_strategies(symbol);

-- Strategy generations table
CREATE TABLE IF NOT EXISTS strategy_generations (
    id SERIAL PRIMARY KEY,
    generation_number INTEGER NOT NULL,
    population_size INTEGER NOT NULL,
    average_fitness DECIMAL(10, 6),
    best_fitness DECIMAL(10, 6),
    diversity_score DECIMAL(10, 6),
    mutation_rate DECIMAL(5, 4),
    crossover_rate DECIMAL(5, 4),
    strategies_created INTEGER DEFAULT 0,
    strategies_backtested INTEGER DEFAULT 0,
    strategies_promoted INTEGER DEFAULT 0,
    strategies_retired INTEGER DEFAULT 0,
    total_profit DECIMAL(15, 8) DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    duration_seconds INTEGER
);

-- Strategy performance history
CREATE TABLE IF NOT EXISTS strategy_performance_history (
    id SERIAL PRIMARY KEY,
    strategy_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stage VARCHAR(50) NOT NULL, -- 'backtest', 'paper_trading', 'live'
    profit DECIMAL(15, 8),
    total_trades INTEGER,
    winning_trades INTEGER,
    losing_trades INTEGER,
    win_rate DECIMAL(5, 4),
    sharpe_ratio DECIMAL(10, 6),
    max_drawdown DECIMAL(5, 4),
    confidence_score DECIMAL(5, 2),
    session_id VARCHAR(255),
    FOREIGN KEY (strategy_id) REFERENCES autonomous_strategies(id) ON DELETE CASCADE
);

-- Index for performance queries
CREATE INDEX IF NOT EXISTS idx_strategy_performance_strategy ON strategy_performance_history(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_timestamp ON strategy_performance_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_stage ON strategy_performance_history(stage);

-- Banking history table
CREATE TABLE IF NOT EXISTS banking_history (
    id BIGINT PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    amount DECIMAL(15, 8) NOT NULL,
    total_profit DECIMAL(15, 8) NOT NULL,
    futures_balance_before DECIMAL(15, 8),
    futures_balance_after DECIMAL(15, 8),
    transfer_id VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error TEXT,
    transaction_hash VARCHAR(255),
    confirmation_blocks INTEGER DEFAULT 0,
    daily_total_before DECIMAL(15, 8) DEFAULT 0,
    banking_trigger VARCHAR(50) DEFAULT 'automatic' -- 'automatic', 'manual', 'emergency'
);

-- Index for banking queries
CREATE INDEX IF NOT EXISTS idx_banking_history_timestamp ON banking_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_banking_history_status ON banking_history(status);

-- Daily banking summary
CREATE TABLE IF NOT EXISTS daily_banking_summary (
    date DATE PRIMARY KEY,
    total_banked DECIMAL(15, 8) DEFAULT 0,
    total_transfers INTEGER DEFAULT 0,
    successful_transfers INTEGER DEFAULT 0,
    failed_transfers INTEGER DEFAULT 0,
    average_transfer_size DECIMAL(15, 8) DEFAULT 0,
    max_transfer_size DECIMAL(15, 8) DEFAULT 0,
    total_profit_generated DECIMAL(15, 8) DEFAULT 0,
    banking_efficiency DECIMAL(5, 4) DEFAULT 0 -- successful / total
);

-- Strategy optimization queue
CREATE TABLE IF NOT EXISTS strategy_optimization_queue (
    id SERIAL PRIMARY KEY,
    strategy_id VARCHAR(255) NOT NULL,
    queue_type VARCHAR(50) NOT NULL, -- 'backtest', 'paper_trading', 'live_promotion'
    priority INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    result JSONB,
    FOREIGN KEY (strategy_id) REFERENCES autonomous_strategies(id) ON DELETE CASCADE
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_optimization_queue_type_status ON strategy_optimization_queue(queue_type, status);
CREATE INDEX IF NOT EXISTS idx_optimization_queue_priority ON strategy_optimization_queue(priority DESC);

-- Market conditions history
CREATE TABLE IF NOT EXISTS market_conditions_history (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    symbol VARCHAR(20) NOT NULL,
    volatility JSONB,
    trend JSONB,
    liquidity JSONB,
    risk_level VARCHAR(20),
    market_phase VARCHAR(50), -- 'trending', 'ranging', 'volatile', 'calm'
    sentiment_score DECIMAL(5, 4),
    volume_profile JSONB,
    price_action JSONB
);

-- Index for market conditions queries
CREATE INDEX IF NOT EXISTS idx_market_conditions_timestamp ON market_conditions_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_conditions_symbol ON market_conditions_history(symbol);

-- System performance metrics
CREATE TABLE IF NOT EXISTS system_performance_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_strategies INTEGER DEFAULT 0,
    active_strategies INTEGER DEFAULT 0,
    live_strategies INTEGER DEFAULT 0,
    total_profit DECIMAL(15, 8) DEFAULT 0,
    daily_profit DECIMAL(15, 8) DEFAULT 0,
    total_banked DECIMAL(15, 8) DEFAULT 0,
    win_rate DECIMAL(5, 4) DEFAULT 0,
    sharpe_ratio DECIMAL(10, 6) DEFAULT 0,
    max_drawdown DECIMAL(5, 4) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    successful_generations INTEGER DEFAULT 0,
    failed_generations INTEGER DEFAULT 0,
    system_uptime_seconds INTEGER DEFAULT 0,
    cpu_usage DECIMAL(5, 2) DEFAULT 0,
    memory_usage DECIMAL(5, 2) DEFAULT 0
);

-- Index for system metrics queries
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_performance_metrics(timestamp DESC);

-- Emergency stops log
CREATE TABLE IF NOT EXISTS emergency_stops_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trigger_type VARCHAR(50) NOT NULL, -- 'drawdown', 'manual', 'system_error'
    trigger_value DECIMAL(15, 8),
    threshold_value DECIMAL(15, 8),
    affected_strategies INTEGER DEFAULT 0,
    system_state JSONB,
    resolution_time TIMESTAMP,
    resolution_notes TEXT,
    auto_resolved BOOLEAN DEFAULT false
);

-- Strategy diversity metrics
CREATE TABLE IF NOT EXISTS strategy_diversity_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    generation INTEGER NOT NULL,
    diversity_score DECIMAL(10, 6),
    unique_indicators INTEGER,
    unique_symbols INTEGER,
    unique_timeframes INTEGER,
    correlation_matrix JSONB,
    overfitting_risk DECIMAL(5, 4),
    diversity_actions JSONB -- actions taken to maintain diversity
);

-- Functions for automatic updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_trading_config_updated_at 
    BEFORE UPDATE ON trading_config 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_autonomous_strategies_updated_at 
    BEFORE UPDATE ON autonomous_strategies 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for easy querying
CREATE OR REPLACE VIEW active_strategies_summary AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(fitness_score) as avg_fitness,
    AVG((performance->>'profit')::DECIMAL) as avg_profit,
    AVG((performance->>'winRate')::DECIMAL) as avg_win_rate
FROM autonomous_strategies 
WHERE status IN ('live', 'paper_trading', 'backtested')
GROUP BY status;

CREATE OR REPLACE VIEW daily_performance_summary AS
SELECT 
    DATE(timestamp) as date,
    SUM(amount) as total_banked,
    COUNT(*) as total_transfers,
    AVG(amount) as avg_transfer_size,
    SUM(total_profit) as total_profit_generated
FROM banking_history 
WHERE status = 'completed'
GROUP BY DATE(timestamp)
ORDER BY date DESC;

CREATE OR REPLACE VIEW strategy_performance_summary AS
SELECT 
    s.id,
    s.name,
    s.type,
    s.symbol,
    s.status,
    s.generation,
    s.fitness_score,
    (s.performance->>'profit')::DECIMAL as profit,
    (s.performance->>'winRate')::DECIMAL as win_rate,
    (s.performance->>'sharpeRatio')::DECIMAL as sharpe_ratio,
    (s.performance->>'maxDrawdown')::DECIMAL as max_drawdown,
    (s.performance->>'confidence')::DECIMAL as confidence_score,
    s.created_at,
    s.live_promotion_at,
    CASE 
        WHEN s.status = 'live' THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - s.live_promotion_at))/3600
        ELSE 0 
    END as hours_live
FROM autonomous_strategies s
ORDER BY s.fitness_score DESC NULLS LAST;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Insert sample data for testing
INSERT INTO strategy_generations (generation_number, population_size, average_fitness, best_fitness, diversity_score, mutation_rate, crossover_rate)
VALUES (0, 20, 0.0, 0.0, 1.0, 0.1, 0.7);

COMMIT;