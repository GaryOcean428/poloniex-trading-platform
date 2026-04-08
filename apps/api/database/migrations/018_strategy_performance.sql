-- Migration 017: strategy_performance table for ML self-learning engine
-- Tracks continuous performance of all generated strategies across their lifecycle.
-- QIG-informed: includes is_censored flag (censoring-aware fitness) and regime_at_creation.

CREATE TABLE IF NOT EXISTS strategy_performance (
    strategy_id          TEXT        PRIMARY KEY,
    symbol               TEXT        NOT NULL,
    leverage             NUMERIC(6,2) NOT NULL DEFAULT 1,
    timeframe            TEXT        NOT NULL,
    strategy_type        TEXT        NOT NULL,
    regime_at_creation   TEXT        NOT NULL DEFAULT 'unknown',  -- trending | ranging | volatile | unknown

    -- Backtest metrics
    backtest_sharpe      NUMERIC(10,4),
    backtest_wr          NUMERIC(6,4),
    backtest_max_dd      NUMERIC(6,4),

    -- Paper trading metrics
    paper_sharpe         NUMERIC(10,4),
    paper_wr             NUMERIC(6,4),
    paper_pnl            NUMERIC(14,4),
    paper_trades         INTEGER DEFAULT 0,

    -- Live trading metrics (populated after promotion)
    live_sharpe          NUMERIC(10,4),
    live_pnl             NUMERIC(14,4),
    live_trades          INTEGER DEFAULT 0,

    -- Censoring flag (QIG pattern)
    -- TRUE when session ended abnormally: max_drawdown_kill, session_end_forced_close, position_size_limit
    is_censored          BOOLEAN     NOT NULL DEFAULT FALSE,
    censor_reason        TEXT,

    -- Uncensored fitness (only valid sessions)
    uncensored_sharpe    NUMERIC(10,4),
    fitness_divergent    BOOLEAN     NOT NULL DEFAULT FALSE,  -- TRUE when all-data vs uncensored diverge >20%

    -- Promotion tracking
    status               TEXT        NOT NULL DEFAULT 'backtesting',
    -- backtesting | paper_trading | recommended | live | retired | killed | censored_rejected

    confidence_score     NUMERIC(6,2),   -- 0-100 from confidenceScoringService

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_paper_at    TIMESTAMPTZ,
    recommended_live_at  TIMESTAMPTZ,
    promoted_live_at     TIMESTAMPTZ,
    killed_at            TIMESTAMPTZ,
    kill_reason          TEXT,

    -- Lineage
    parent_strategy_id   TEXT,
    generation           INTEGER NOT NULL DEFAULT 0
);

-- Index for ML queries: find best strategies per (symbol, type, timeframe, regime)
CREATE INDEX IF NOT EXISTS idx_sp_symbol_type
    ON strategy_performance (symbol, strategy_type, regime_at_creation, status);

CREATE INDEX IF NOT EXISTS idx_sp_status
    ON strategy_performance (status);

CREATE INDEX IF NOT EXISTS idx_sp_backtest_sharpe
    ON strategy_performance (backtest_sharpe DESC NULLS LAST)
    WHERE status NOT IN ('killed', 'retired');

-- Allow multiple sessions per pair (remove unique constraint if it exists).
-- is_censored / censor_reason columns already added by migration 017_paper_trading_censoring.sql.
DO $$
BEGIN
    -- Allow multiple sessions per pair (remove unique constraint if it exists)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'paper_trading_sessions_symbol_unique'
          AND contype = 'u'
    ) THEN
        ALTER TABLE paper_trading_sessions DROP CONSTRAINT paper_trading_sessions_symbol_unique;
    END IF;
END $$;
