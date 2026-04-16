-- Migration 022: Add paper_trade column and performance indexes
-- Fixes BP-3 (paper_trade column missing) and Sourcery index recommendation

-- Add paper_trade boolean column to autonomous_trades
ALTER TABLE autonomous_trades
  ADD COLUMN IF NOT EXISTS paper_trade BOOLEAN DEFAULT true;

-- Backfill: mark existing trades as paper if order_id starts with 'paper_'
UPDATE autonomous_trades
  SET paper_trade = (order_id LIKE 'paper_%')
  WHERE paper_trade IS NULL OR paper_trade = true;

-- Composite index for performance queries: WHERE user_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_user_created_desc
  ON autonomous_trades (user_id, created_at DESC);
