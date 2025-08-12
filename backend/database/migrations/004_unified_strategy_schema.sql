-- Migration 004: Unified Strategy Schema
-- Updates autonomous_strategies table to match the unified Strategy interface
-- Aligns database schema with shared/types/strategy.ts

-- First, let's add the missing columns to match the unified Strategy interface
ALTER TABLE autonomous_strategies
ADD COLUMN IF NOT EXISTS algorithm VARCHAR(100) DEFAULT 'Custom',
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Update existing records to have proper algorithm field
UPDATE autonomous_strategies
SET algorithm = 'Custom'
WHERE algorithm IS NULL;

-- Update existing records to have proper active field
UPDATE autonomous_strategies
SET active = true
WHERE active IS NULL;

-- Add performance columns to match StrategyPerformance interface
ALTER TABLE autonomous_strategies
ADD COLUMN IF NOT EXISTS total_pnl DECIMAL(30, 18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS win_rate DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS trades_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS sharpe_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_drawdown DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS profit_factor DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_win DECIMAL(30, 18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_loss DECIMAL(30, 18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS largest_win DECIMAL(30, 18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS largest_loss DECIMAL(30, 18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_holding_period DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS profit_per_trade DECIMAL(30, 18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS win_loss_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS recovery_factor DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS calmar_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS sortino_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS kelly_criterion DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS volatility DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS beta DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS alpha DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS information_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tracking_error DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS upside_potential_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS downside_risk DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS conditional_value_at_risk DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS value_at_risk DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS expected_shortfall DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tail_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS common_sense_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS gain_to_pain_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS profit_stability DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS consistency_score DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS risk_adjusted_return DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS risk_return_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS profit_consistency DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS loss_consistency DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS trade_frequency DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS system_quality_number DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS robustness_score DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS edge_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS market_efficiency_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS signal_strength DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS noise_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS signal_noise_ratio DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS prediction_accuracy DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS model_quality DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS overfitting_score DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS robustness_test DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS out_of_sample_performance DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS walk_forward_efficiency DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monte_carlo_simulation DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS stress_test_performance DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS regime_performance JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS correlation_matrix JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS benchmark_comparison JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS seasonal_performance JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS performance_metrics JSONB DEFAULT '{}';

-- Add constraints for data integrity
ALTER TABLE autonomous_strategies
ADD CONSTRAINT chk_algorithm CHECK (algorithm IN ('MovingAverageCrossover', 'RSI', 'MACD', 'BollingerBands', 'Custom')),
ADD CONSTRAINT chk_type CHECK (type IN ('manual', 'automated', 'ml', 'dqn')),
ADD CONSTRAINT chk_status CHECK (status IN ('created', 'backtesting', 'backtested', 'paper_trading', 'live', 'retired', 'error')),
ADD CONSTRAINT chk_symbol CHECK (symbol ~ '^[A-Z]{2,10}$'),
ADD CONSTRAINT chk_timeframe CHECK (timeframe IN ('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w')),
ADD CONSTRAINT chk_fitness_score CHECK (fitness_score >= 0 AND fitness_score <= 1),
ADD CONSTRAINT chk_generation CHECK (generation >= 0),
ADD CONSTRAINT chk_win_rate CHECK (win_rate >= 0 AND win_rate <= 1),
ADD CONSTRAINT chk_sharpe_ratio CHECK (sharpe_ratio > -10 AND sharpe_ratio < 10),
ADD CONSTRAINT chk_max_drawdown CHECK (max_drawdown >= 0 AND max_drawdown <= 1),
ADD CONSTRAINT chk_profit_factor CHECK (profit_factor > 0),
ADD CONSTRAINT chk_kelly_criterion CHECK (kelly_criterion >= 0 AND kelly_criterion <= 1);

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_algorithm ON autonomous_strategies(algorithm);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_active ON autonomous_strategies(active);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_total_pnl ON autonomous_strategies(total_pnl DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_win_rate ON autonomous_strategies(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_trades_count ON autonomous_strategies(trades_count DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_sharpe_ratio ON autonomous_strategies(sharpe_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_max_drawdown ON autonomous_strategies(max_drawdown ASC);

-- Create a view for unified strategy data
CREATE OR REPLACE VIEW unified_strategies AS
SELECT
    id,
    name,
    type,
    algorithm,
    symbol,
    timeframe,
    active,
    parameters,
    performance,
    status,
    fitness_score,
    generation,
    total_pnl,
    win_rate,
    trades_count,
    sharpe_ratio,
    max_drawdown,
    profit_factor,
    created_at,
    updated_at,
    backtest_completed_at,
    paper_trading_started_at,
    live_promotion_at,
    retired_at
FROM autonomous_strategies
ORDER BY created_at DESC;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON autonomous_strategies TO postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;

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
    'MIGRATION_004',
    'Unified Strategy Schema Migration',
    'SYSTEM',
    'SYSTEM',
    'UPDATE_SCHEMA',
    'SUCCESS',
    CURRENT_TIMESTAMP
FROM users u
JOIN futures_accounts fa ON u.id = fa.user_id
WHERE u.username = 'GaryOcean'
LIMIT 1;

-- Migration completed successfully
COMMENT ON TABLE autonomous_strategies IS 'Unified strategy table matching shared/types/strategy.ts interface';
