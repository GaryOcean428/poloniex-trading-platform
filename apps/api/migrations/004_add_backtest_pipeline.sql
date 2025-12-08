-- Create backtest_pipeline_results table
CREATE TABLE IF NOT EXISTS backtest_pipeline_results (
  id SERIAL PRIMARY KEY,
  strategy_id VARCHAR(255) UNIQUE NOT NULL,
  results JSONB NOT NULL,
  average_score DECIMAL(5,2) NOT NULL,
  recommendation VARCHAR(50) NOT NULL CHECK (recommendation IN ('deploy', 'optimize', 'reject')),
  reasoning TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_pipeline_strategy_id ON backtest_pipeline_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtest_pipeline_recommendation ON backtest_pipeline_results(recommendation);
CREATE INDEX IF NOT EXISTS idx_backtest_pipeline_score ON backtest_pipeline_results(average_score DESC);
