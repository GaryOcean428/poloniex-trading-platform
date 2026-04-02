-- Add DEFAULT 0 to metric columns in backtest_results so that:
-- 1. The route-based INSERT (backtest.ts) can create "running" records before metrics exist
-- 2. The system is resilient to missing metric values
-- Paper trading and futures tables are unaffected (their INSERTs are already correct).

ALTER TABLE backtest_results ALTER COLUMN sortino_ratio SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN calmar_ratio SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN winning_trades SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN losing_trades SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN profit_factor SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN expectancy SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN average_win SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN average_loss SET DEFAULT 0;

-- Allow strategy_name to be NULL for route-based inserts that use strategy_id instead
ALTER TABLE backtest_results ALTER COLUMN strategy_name DROP NOT NULL;

-- Defaults for other metric columns the route-based INSERT omits
ALTER TABLE backtest_results ALTER COLUMN final_value SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN total_return SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN max_drawdown SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN max_drawdown_percent SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN sharpe_ratio SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN total_trades SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN win_rate SET DEFAULT 0;
ALTER TABLE backtest_results ALTER COLUMN config SET DEFAULT '{}';
ALTER TABLE backtest_results ALTER COLUMN metrics SET DEFAULT '{}';
