-- Add is_censored column to backtest_results.
-- A backtest is censored when a position was force-closed at the end of the
-- backtesting window (backtest_end reason) or hit a liquidation level.
-- Censored results should be down-weighted in ML strategy scoring because the
-- P&L is incomplete (position did not resolve naturally).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name  = 'backtest_results'
          AND column_name = 'is_censored'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN is_censored BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;
