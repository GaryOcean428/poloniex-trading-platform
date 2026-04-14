-- 000_base_schema.sql
-- Consolidated base schema: all tables required by the application.
-- This file represents the FINAL state of all migrations (001-021) and
-- both migration directories (apps/api/database/migrations/ and apps/api/migrations/).
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE for functions/views, and DO $$ blocks for constraints.

-- =================== EXTENSIONS ===================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================== SHARED TRIGGER FUNCTIONS ===================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =================== USERS ===================
-- Core user accounts. Referenced by most other tables via user_id.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    permissions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_users_updated_at();

-- =================== FUTURES ACCOUNTS ===================

CREATE TABLE IF NOT EXISTS futures_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    poloniex_account_id VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) DEFAULT 'futures' CHECK (account_type IN ('futures', 'unified')),
    account_state VARCHAR(20) DEFAULT 'NORMAL' CHECK (account_state IN ('NORMAL', 'SUSPENDED', 'LIQUIDATING')),
    total_equity DECIMAL(30, 18) DEFAULT 0,
    available_balance DECIMAL(30, 18) DEFAULT 0,
    isolated_equity DECIMAL(30, 18) DEFAULT 0,
    cross_equity DECIMAL(30, 18) DEFAULT 0,
    initial_margin DECIMAL(30, 18) DEFAULT 0,
    maintenance_margin DECIMAL(30, 18) DEFAULT 0,
    margin_ratio DECIMAL(10, 6) DEFAULT 0,
    position_mode VARCHAR(10) DEFAULT 'ONE_WAY' CHECK (position_mode IN ('ONE_WAY', 'HEDGE')),
    max_leverage DECIMAL(10, 2) DEFAULT 100,
    daily_realized_pnl DECIMAL(30, 18) DEFAULT 0,
    total_realized_pnl DECIMAL(30, 18) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, poloniex_account_id)
);

CREATE INDEX IF NOT EXISTS idx_futures_accounts_user_id ON futures_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_accounts_active ON futures_accounts(is_active);

DROP TRIGGER IF EXISTS update_futures_accounts_updated_at ON futures_accounts;
CREATE TRIGGER update_futures_accounts_updated_at
    BEFORE UPDATE ON futures_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== FUTURES POSITIONS ===================

CREATE TABLE IF NOT EXISTS futures_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    symbol VARCHAR(50) NOT NULL,
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT', 'BOTH')),
    size DECIMAL(30, 18) NOT NULL DEFAULT 0,
    available_size DECIMAL(30, 18) NOT NULL DEFAULT 0,
    avg_open_price DECIMAL(30, 18) DEFAULT 0,
    mark_price DECIMAL(30, 18) DEFAULT 0,
    last_price DECIMAL(30, 18) DEFAULT 0,
    margin_mode VARCHAR(10) NOT NULL CHECK (margin_mode IN ('ISOLATED', 'CROSS')),
    leverage DECIMAL(10, 2) NOT NULL DEFAULT 1,
    position_margin DECIMAL(30, 18) DEFAULT 0,
    initial_margin DECIMAL(30, 18) DEFAULT 0,
    maintenance_margin DECIMAL(30, 18) DEFAULT 0,
    margin_ratio DECIMAL(10, 6) DEFAULT 0,
    liquidation_price DECIMAL(30, 18) DEFAULT 0,
    bankruptcy_price DECIMAL(30, 18) DEFAULT 0,
    adl_ranking INTEGER DEFAULT 0,
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl_ratio DECIMAL(10, 6) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    daily_realized_pnl DECIMAL(30, 18) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'LIQUIDATING', 'ADL')),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, account_id, symbol, position_side)
);

CREATE INDEX IF NOT EXISTS idx_futures_positions_user_id ON futures_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_positions_symbol ON futures_positions(symbol);

DROP TRIGGER IF EXISTS update_futures_positions_updated_at ON futures_positions;
CREATE TRIGGER update_futures_positions_updated_at
    BEFORE UPDATE ON futures_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== FUTURES ORDERS ===================

CREATE TABLE IF NOT EXISTS futures_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    poloniex_order_id VARCHAR(100) UNIQUE NOT NULL,
    client_order_id VARCHAR(100),
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('LIMIT', 'MARKET', 'POST_ONLY', 'FOK', 'IOC', 'STOP_LIMIT', 'STOP_MARKET')),
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT', 'BOTH')),
    price DECIMAL(30, 18),
    trigger_price DECIMAL(30, 18),
    size DECIMAL(30, 18) NOT NULL,
    value DECIMAL(30, 18),
    filled_size DECIMAL(30, 18) DEFAULT 0,
    filled_value DECIMAL(30, 18) DEFAULT 0,
    avg_filled_price DECIMAL(30, 18) DEFAULT 0,
    leverage DECIMAL(10, 2) NOT NULL DEFAULT 1,
    margin_mode VARCHAR(10) NOT NULL CHECK (margin_mode IN ('ISOLATED', 'CROSS')),
    time_in_force VARCHAR(10) CHECK (time_in_force IN ('GTC', 'IOC', 'FOK', 'GTD')),
    reduce_only BOOLEAN DEFAULT false,
    post_only BOOLEAN DEFAULT false,
    close_on_trigger BOOLEAN DEFAULT false,
    fee DECIMAL(30, 18) DEFAULT 0,
    fee_currency VARCHAR(10) DEFAULT 'USDT',
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED')),
    cancel_reason VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    poloniex_created_at TIMESTAMP WITH TIME ZONE,
    poloniex_updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_futures_orders_user_id ON futures_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_orders_symbol ON futures_orders(symbol);
CREATE INDEX IF NOT EXISTS idx_futures_orders_status ON futures_orders(status);

DROP TRIGGER IF EXISTS update_futures_orders_updated_at ON futures_orders;
CREATE TRIGGER update_futures_orders_updated_at
    BEFORE UPDATE ON futures_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== FUTURES TRADES ===================

CREATE TABLE IF NOT EXISTS futures_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES futures_orders(id) ON DELETE CASCADE,
    poloniex_trade_id VARCHAR(100) UNIQUE NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT', 'BOTH')),
    price DECIMAL(30, 18) NOT NULL,
    size DECIMAL(30, 18) NOT NULL,
    value DECIMAL(30, 18) NOT NULL,
    leverage DECIMAL(10, 2) NOT NULL DEFAULT 1,
    margin_mode VARCHAR(10) NOT NULL CHECK (margin_mode IN ('ISOLATED', 'CROSS')),
    fee DECIMAL(30, 18) DEFAULT 0,
    fee_currency VARCHAR(10) DEFAULT 'USDT',
    fee_rate DECIMAL(10, 8) DEFAULT 0,
    role VARCHAR(10) CHECK (role IN ('MAKER', 'TAKER')),
    liquidity_type VARCHAR(10) CHECK (liquidity_type IN ('MAKER', 'TAKER')),
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trade_time TIMESTAMP WITH TIME ZONE NOT NULL,
    poloniex_trade_time TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_futures_trades_user_id ON futures_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_trades_symbol ON futures_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_futures_trades_order_id ON futures_trades(order_id);

-- =================== FUTURES MARKET DATA ===================

CREATE TABLE IF NOT EXISTS futures_market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(50) NOT NULL,
    last_price DECIMAL(30, 18) NOT NULL,
    mark_price DECIMAL(30, 18) NOT NULL,
    index_price DECIMAL(30, 18) NOT NULL,
    best_bid DECIMAL(30, 18),
    best_ask DECIMAL(30, 18),
    bid_size DECIMAL(30, 18),
    ask_size DECIMAL(30, 18),
    high_24h DECIMAL(30, 18),
    low_24h DECIMAL(30, 18),
    volume_24h DECIMAL(30, 18),
    turnover_24h DECIMAL(30, 18),
    change_24h DECIMAL(10, 6),
    change_rate_24h DECIMAL(10, 6),
    funding_rate DECIMAL(10, 8),
    predicted_funding_rate DECIMAL(10, 8),
    next_funding_time TIMESTAMP WITH TIME ZONE,
    open_interest DECIMAL(30, 18),
    open_interest_value DECIMAL(30, 18),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    market_time TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(symbol, market_time)
);

CREATE INDEX IF NOT EXISTS idx_futures_market_data_symbol ON futures_market_data(symbol);

-- =================== FUTURES ACCOUNT BILLS ===================

CREATE TABLE IF NOT EXISTS futures_account_bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    poloniex_bill_id VARCHAR(100) UNIQUE NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    bill_type VARCHAR(50) NOT NULL,
    bill_sub_type VARCHAR(50),
    amount DECIMAL(30, 18) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    balance DECIMAL(30, 18) NOT NULL,
    related_order_id VARCHAR(100),
    related_trade_id VARCHAR(100),
    related_position_id VARCHAR(100),
    description TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    bill_time TIMESTAMP WITH TIME ZONE NOT NULL,
    poloniex_bill_time TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_futures_account_bills_user_id ON futures_account_bills(user_id);
CREATE INDEX IF NOT EXISTS idx_futures_account_bills_type ON futures_account_bills(bill_type);

-- =================== FUTURES FUNDING HISTORY ===================

CREATE TABLE IF NOT EXISTS futures_funding_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    symbol VARCHAR(50) NOT NULL,
    position_size DECIMAL(30, 18) NOT NULL,
    funding_rate DECIMAL(10, 8) NOT NULL,
    funding_amount DECIMAL(30, 18) NOT NULL,
    mark_price DECIMAL(30, 18),
    position_value DECIMAL(30, 18),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    funding_time TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(user_id, account_id, symbol, funding_time)
);

-- =================== FUTURES RISK LIMITS ===================

CREATE TABLE IF NOT EXISTS futures_risk_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    symbol VARCHAR(50) NOT NULL,
    max_position_size DECIMAL(30, 18) NOT NULL,
    max_leverage DECIMAL(10, 2) NOT NULL,
    max_order_size DECIMAL(30, 18),
    max_daily_loss DECIMAL(30, 18),
    max_total_loss DECIMAL(30, 18),
    max_drawdown DECIMAL(10, 6),
    risk_level INTEGER DEFAULT 1 CHECK (risk_level BETWEEN 1 AND 5),
    maintenance_margin_rate DECIMAL(10, 6),
    auto_liquidation_enabled BOOLEAN DEFAULT true,
    liquidation_threshold DECIMAL(10, 6) DEFAULT 0.05,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, account_id, symbol)
);

DROP TRIGGER IF EXISTS update_futures_risk_limits_updated_at ON futures_risk_limits;
CREATE TRIGGER update_futures_risk_limits_updated_at
    BEFORE UPDATE ON futures_risk_limits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== FUTURES LIQUIDATION EVENTS ===================

CREATE TABLE IF NOT EXISTS futures_liquidation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    symbol VARCHAR(50) NOT NULL,
    liquidation_type VARCHAR(20) NOT NULL CHECK (liquidation_type IN ('FORCED', 'ADL', 'BANKRUPTCY')),
    position_size DECIMAL(30, 18) NOT NULL,
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('LONG', 'SHORT')),
    avg_entry_price DECIMAL(30, 18) NOT NULL,
    mark_price DECIMAL(30, 18) NOT NULL,
    liquidation_price DECIMAL(30, 18) NOT NULL,
    liquidated_size DECIMAL(30, 18) NOT NULL,
    liquidation_fee DECIMAL(30, 18) DEFAULT 0,
    insurance_fund_fee DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) NOT NULL,
    margin_released DECIMAL(30, 18) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    liquidation_time TIMESTAMP WITH TIME ZONE NOT NULL
);

-- =================== STRATEGY EXECUTION LOGS ===================

CREATE TABLE IF NOT EXISTS strategy_execution_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES futures_accounts(id) ON DELETE CASCADE,
    strategy_id VARCHAR(100) NOT NULL,
    strategy_name VARCHAR(200) NOT NULL,
    strategy_type VARCHAR(50) NOT NULL,
    strategy_version VARCHAR(20) DEFAULT '1.0',
    symbol VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    parameters JSONB DEFAULT '{}',
    market_conditions JSONB DEFAULT '{}',
    execution_result VARCHAR(20) NOT NULL CHECK (execution_result IN ('SUCCESS', 'FAILED', 'PARTIAL')),
    orders_created TEXT[],
    positions_modified TEXT[],
    error_code VARCHAR(50),
    error_message TEXT,
    expected_pnl DECIMAL(30, 18),
    actual_pnl DECIMAL(30, 18),
    execution_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_strategy_execution_logs_user_id ON strategy_execution_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_execution_logs_strategy_id ON strategy_execution_logs(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_execution_logs_executed_at ON strategy_execution_logs(executed_at DESC);

-- =================== HISTORICAL MARKET DATA ===================

CREATE TABLE IF NOT EXISTS historical_market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    open DECIMAL(20, 8) NOT NULL,
    high DECIMAL(20, 8) NOT NULL,
    low DECIMAL(20, 8) NOT NULL,
    close DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 8) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_data_unique ON historical_market_data(symbol, timeframe, timestamp);
CREATE INDEX IF NOT EXISTS idx_historical_data_symbol_timeframe ON historical_market_data(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_historical_data_timestamp ON historical_market_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_historical_data_symbol_timestamp ON historical_market_data(symbol, timestamp);

DROP TRIGGER IF EXISTS update_historical_market_data_updated_at ON historical_market_data;
CREATE TRIGGER update_historical_market_data_updated_at
    BEFORE UPDATE ON historical_market_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== BACKTEST RESULTS ===================
-- Final schema: includes all columns added by migrations 002, 009, 016, 017.

CREATE TABLE IF NOT EXISTS backtest_results (
    id VARCHAR(50) PRIMARY KEY,
    strategy_name VARCHAR(100),
    strategy_id TEXT,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    initial_capital DECIMAL(20, 8) NOT NULL,
    final_value DECIMAL(20, 8) NOT NULL DEFAULT 0,
    total_return DECIMAL(10, 4) NOT NULL DEFAULT 0,
    max_drawdown DECIMAL(20, 8) NOT NULL DEFAULT 0,
    max_drawdown_percent DECIMAL(10, 4) NOT NULL DEFAULT 0,
    sharpe_ratio DECIMAL(10, 4) NOT NULL DEFAULT 0,
    sortino_ratio DECIMAL(10, 4) NOT NULL DEFAULT 0,
    calmar_ratio DECIMAL(10, 4) NOT NULL DEFAULT 0,
    total_trades INTEGER NOT NULL DEFAULT 0,
    winning_trades INTEGER NOT NULL DEFAULT 0,
    losing_trades INTEGER NOT NULL DEFAULT 0,
    win_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
    profit_factor DECIMAL(10, 4) NOT NULL DEFAULT 0,
    expectancy DECIMAL(10, 4) NOT NULL DEFAULT 0,
    average_win DECIMAL(20, 8) NOT NULL DEFAULT 0,
    average_loss DECIMAL(20, 8) NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{}',
    metrics JSONB NOT NULL DEFAULT '{}',
    -- Columns added by migration 009
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    progress INTEGER NOT NULL DEFAULT 0,
    results JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    -- Censoring columns (migration 017)
    is_censored BOOLEAN NOT NULL DEFAULT FALSE,
    censoring_reason TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy ON backtest_results(strategy_name);
CREATE INDEX IF NOT EXISTS idx_backtest_results_symbol ON backtest_results(symbol);
CREATE INDEX IF NOT EXISTS idx_backtest_results_created_at ON backtest_results(created_at);
CREATE INDEX IF NOT EXISTS idx_backtest_results_performance ON backtest_results(total_return, sharpe_ratio, max_drawdown_percent);
CREATE INDEX IF NOT EXISTS idx_backtest_results_user_id ON backtest_results(user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy_id ON backtest_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_is_censored ON backtest_results(is_censored);

DROP TRIGGER IF EXISTS update_backtest_results_updated_at ON backtest_results;
CREATE TRIGGER update_backtest_results_updated_at
    BEFORE UPDATE ON backtest_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== BACKTEST TRADES ===================

CREATE TABLE IF NOT EXISTS backtest_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backtest_id VARCHAR(50) NOT NULL,
    trade_id VARCHAR(50) NOT NULL,
    position_id VARCHAR(50),
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    size DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(20) NOT NULL,
    reason VARCHAR(50) NOT NULL,
    fees DECIMAL(20, 8) NOT NULL,
    pnl DECIMAL(20, 8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (backtest_id) REFERENCES backtest_results(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest_id ON backtest_trades(backtest_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_timestamp ON backtest_trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol ON backtest_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_type ON backtest_trades(type);

-- =================== BACKTEST EQUITY CURVE ===================

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

CREATE INDEX IF NOT EXISTS idx_backtest_equity_curve_backtest_id ON backtest_equity_curve(backtest_id);
CREATE INDEX IF NOT EXISTS idx_backtest_equity_curve_timestamp ON backtest_equity_curve(timestamp);

-- =================== STRATEGY DEFINITIONS ===================

CREATE TABLE IF NOT EXISTS strategy_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    parameters JSONB NOT NULL,
    risk_parameters JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_definitions_name ON strategy_definitions(name);
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_type ON strategy_definitions(type);
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_active ON strategy_definitions(is_active);

DROP TRIGGER IF EXISTS update_strategy_definitions_updated_at ON strategy_definitions;
CREATE TRIGGER update_strategy_definitions_updated_at
    BEFORE UPDATE ON strategy_definitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== STRATEGY PERFORMANCE ===================
-- Final schema from migration 018/019/021.
-- PK is strategy_id TEXT (not UUID id).
-- strategy_name is nullable (migration 021 dropped NOT NULL).

CREATE TABLE IF NOT EXISTS strategy_performance (
    strategy_id          TEXT        PRIMARY KEY,
    strategy_name        TEXT        DEFAULT NULL,
    symbol               TEXT        NOT NULL DEFAULT '',
    leverage             NUMERIC(6,2) NOT NULL DEFAULT 1,
    timeframe            TEXT        NOT NULL DEFAULT '',
    strategy_type        TEXT        NOT NULL DEFAULT '',
    regime_at_creation   TEXT        NOT NULL DEFAULT 'unknown',
    backtest_sharpe      NUMERIC(10,4),
    backtest_wr          NUMERIC(6,4),
    backtest_max_dd      NUMERIC(6,4),
    paper_sharpe         NUMERIC(10,4),
    paper_wr             NUMERIC(6,4),
    paper_pnl            NUMERIC(14,4),
    paper_trades         INTEGER DEFAULT 0,
    live_sharpe          NUMERIC(10,4),
    live_pnl             NUMERIC(14,4),
    live_trades          INTEGER DEFAULT 0,
    is_censored          BOOLEAN     NOT NULL DEFAULT FALSE,
    censor_reason        TEXT,
    uncensored_sharpe    NUMERIC(10,4),
    fitness_divergent    BOOLEAN     NOT NULL DEFAULT FALSE,
    status               TEXT        NOT NULL DEFAULT 'backtesting',
    confidence_score     NUMERIC(6,2),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_paper_at    TIMESTAMPTZ,
    recommended_live_at  TIMESTAMPTZ,
    promoted_live_at     TIMESTAMPTZ,
    killed_at            TIMESTAMPTZ,
    kill_reason          TEXT,
    parent_strategy_id   TEXT,
    generation           INTEGER NOT NULL DEFAULT 0,
    -- Additional columns from migration 002 (kept for compatibility)
    avg_return           DECIMAL(10, 4),
    avg_sharpe_ratio     DECIMAL(10, 4),
    avg_max_drawdown     DECIMAL(10, 4),
    win_rate             DECIMAL(5, 2),
    backtest_count       INTEGER,
    last_backtest_date   TIMESTAMP WITH TIME ZONE,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Composable signal genome (JSONB) — stores entry/exit conditions and risk params
    signal_genome        JSONB
);

CREATE INDEX IF NOT EXISTS idx_sp_symbol_type ON strategy_performance(symbol, strategy_type, regime_at_creation, status);
CREATE INDEX IF NOT EXISTS idx_sp_status ON strategy_performance(status);
CREATE INDEX IF NOT EXISTS idx_sp_backtest_sharpe ON strategy_performance(backtest_sharpe DESC NULLS LAST) WHERE status NOT IN ('killed', 'retired');
CREATE INDEX IF NOT EXISTS idx_sp_strategy_id ON strategy_performance(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_strategy ON strategy_performance(strategy_name);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_symbol ON strategy_performance(symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_confidence ON strategy_performance(confidence_score);

DROP TRIGGER IF EXISTS update_strategy_performance_updated_at ON strategy_performance;
CREATE TRIGGER update_strategy_performance_updated_at
    BEFORE UPDATE ON strategy_performance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== PAPER TRADING SESSIONS ===================
-- Final schema: includes censoring columns (is_censored, censor_reason) from migration 017.

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
    status VARCHAR(20) DEFAULT 'active',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    -- Censoring columns (QIG pattern — migration 017)
    is_censored BOOLEAN NOT NULL DEFAULT FALSE,
    censor_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_strategy ON paper_trading_sessions(strategy_name);
CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_status ON paper_trading_sessions(status);
CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_started_at ON paper_trading_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_paper_trading_sessions_is_censored ON paper_trading_sessions(is_censored);
CREATE INDEX IF NOT EXISTS idx_paper_sessions_censored ON paper_trading_sessions(is_censored) WHERE is_censored = FALSE;

DROP TRIGGER IF EXISTS update_paper_trading_sessions_updated_at ON paper_trading_sessions;
CREATE TRIGGER update_paper_trading_sessions_updated_at
    BEFORE UPDATE ON paper_trading_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== PAPER TRADING POSITIONS ===================

CREATE TABLE IF NOT EXISTS paper_trading_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    position_id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    size DECIMAL(20, 8) NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    current_price DECIMAL(20, 8) NOT NULL,
    exit_price DECIMAL(20, 8),
    stop_loss DECIMAL(20, 8),
    take_profit DECIMAL(20, 8),
    unrealized_pnl DECIMAL(20, 8) NOT NULL,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'open',
    entry_time TIMESTAMP WITH TIME ZONE NOT NULL,
    exit_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES paper_trading_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_session_id ON paper_trading_positions(session_id);
CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_symbol ON paper_trading_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_status ON paper_trading_positions(status);
CREATE INDEX IF NOT EXISTS idx_paper_trading_positions_entry_time ON paper_trading_positions(entry_time);

DROP TRIGGER IF EXISTS update_paper_trading_positions_updated_at ON paper_trading_positions;
CREATE TRIGGER update_paper_trading_positions_updated_at
    BEFORE UPDATE ON paper_trading_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== PAPER TRADING TRADES ===================

CREATE TABLE IF NOT EXISTS paper_trading_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    position_id VARCHAR(50) NOT NULL,
    trade_id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    size DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(20) NOT NULL,
    reason VARCHAR(50) NOT NULL,
    fees DECIMAL(20, 8) NOT NULL,
    pnl DECIMAL(20, 8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES paper_trading_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_session_id ON paper_trading_trades(session_id);
CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_timestamp ON paper_trading_trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_symbol ON paper_trading_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_paper_trading_trades_type ON paper_trading_trades(type);

-- =================== CONFIDENCE SCORES ===================

CREATE TABLE IF NOT EXISTS confidence_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    market_conditions JSONB NOT NULL,
    historical_performance JSONB NOT NULL,
    confidence_score DECIMAL(5, 2) NOT NULL,
    risk_score DECIMAL(5, 2) NOT NULL,
    recommended_position_size DECIMAL(5, 4) NOT NULL,
    factors JSONB NOT NULL,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confidence_scores_strategy ON confidence_scores(strategy_name);
CREATE INDEX IF NOT EXISTS idx_confidence_scores_symbol ON confidence_scores(symbol);
CREATE INDEX IF NOT EXISTS idx_confidence_scores_calculated_at ON confidence_scores(calculated_at);
CREATE INDEX IF NOT EXISTS idx_confidence_scores_confidence ON confidence_scores(confidence_score);

-- =================== MARKET ANALYSIS ===================

CREATE TABLE IF NOT EXISTS market_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 8) NOT NULL,
    technical_indicators JSONB NOT NULL,
    market_conditions JSONB NOT NULL,
    sentiment_score DECIMAL(5, 2),
    volatility_score DECIMAL(5, 2),
    trend_strength DECIMAL(5, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol ON market_analysis(symbol);
CREATE INDEX IF NOT EXISTS idx_market_analysis_timestamp ON market_analysis(timestamp);
CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol_timestamp ON market_analysis(symbol, timestamp);

-- =================== MARKET ANALYSIS CACHE ===================

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

CREATE INDEX IF NOT EXISTS idx_market_analysis_cache_symbol ON market_analysis_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_market_analysis_cache_timestamp ON market_analysis_cache(timestamp);

-- =================== TRADING CONFIG ===================

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

INSERT INTO trading_config (id, initial_balance, risk_tolerance, banking_config)
VALUES (1, 10000,
    '{"maxDrawdown": 0.15, "riskPerTrade": 0.02, "maxPositionSize": 0.1, "profitBankingPercent": 0.30}',
    '{"enabled": true, "bankingPercentage": 0.30, "minimumProfitThreshold": 50, "maximumSingleTransfer": 10000, "bankingInterval": 21600000, "emergencyStopThreshold": 0.25, "maxDailyBanking": 50000}'
) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_trading_config_updated_at ON trading_config;
CREATE TRIGGER update_trading_config_updated_at
    BEFORE UPDATE ON trading_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== AUTONOMOUS STRATEGIES ===================
-- Final schema: migration 003 base + many columns from migration 004.

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
    algorithm VARCHAR(100) DEFAULT 'Custom',
    active BOOLEAN DEFAULT true,
    total_pnl DECIMAL(30, 18) DEFAULT 0,
    win_rate DECIMAL(10, 6) DEFAULT 0,
    trades_count INTEGER DEFAULT 0,
    sharpe_ratio DECIMAL(10, 6) DEFAULT 0,
    max_drawdown DECIMAL(10, 6) DEFAULT 0,
    profit_factor DECIMAL(10, 6) DEFAULT 0,
    avg_win DECIMAL(30, 18) DEFAULT 0,
    avg_loss DECIMAL(30, 18) DEFAULT 0,
    largest_win DECIMAL(30, 18) DEFAULT 0,
    largest_loss DECIMAL(30, 18) DEFAULT 0,
    avg_holding_period DECIMAL(10, 2) DEFAULT 0,
    profit_per_trade DECIMAL(30, 18) DEFAULT 0,
    win_loss_ratio DECIMAL(10, 6) DEFAULT 0,
    recovery_factor DECIMAL(10, 6) DEFAULT 0,
    calmar_ratio DECIMAL(10, 6) DEFAULT 0,
    sortino_ratio DECIMAL(10, 6) DEFAULT 0,
    kelly_criterion DECIMAL(10, 6) DEFAULT 0,
    volatility DECIMAL(10, 6) DEFAULT 0,
    beta DECIMAL(10, 6) DEFAULT 0,
    alpha DECIMAL(10, 6) DEFAULT 0,
    information_ratio DECIMAL(10, 6) DEFAULT 0,
    tracking_error DECIMAL(10, 6) DEFAULT 0,
    upside_potential_ratio DECIMAL(10, 6) DEFAULT 0,
    downside_risk DECIMAL(10, 6) DEFAULT 0,
    conditional_value_at_risk DECIMAL(10, 6) DEFAULT 0,
    value_at_risk DECIMAL(10, 6) DEFAULT 0,
    expected_shortfall DECIMAL(10, 6) DEFAULT 0,
    tail_ratio DECIMAL(10, 6) DEFAULT 0,
    common_sense_ratio DECIMAL(10, 6) DEFAULT 0,
    gain_to_pain_ratio DECIMAL(10, 6) DEFAULT 0,
    profit_stability DECIMAL(10, 6) DEFAULT 0,
    consistency_score DECIMAL(10, 6) DEFAULT 0,
    risk_adjusted_return DECIMAL(10, 6) DEFAULT 0,
    risk_return_ratio DECIMAL(10, 6) DEFAULT 0,
    profit_consistency DECIMAL(10, 6) DEFAULT 0,
    loss_consistency DECIMAL(10, 6) DEFAULT 0,
    trade_frequency DECIMAL(10, 6) DEFAULT 0,
    system_quality_number DECIMAL(10, 6) DEFAULT 0,
    robustness_score DECIMAL(10, 6) DEFAULT 0,
    edge_ratio DECIMAL(10, 6) DEFAULT 0,
    market_efficiency_ratio DECIMAL(10, 6) DEFAULT 0,
    signal_strength DECIMAL(10, 6) DEFAULT 0,
    noise_ratio DECIMAL(10, 6) DEFAULT 0,
    signal_noise_ratio DECIMAL(10, 6) DEFAULT 0,
    prediction_accuracy DECIMAL(10, 6) DEFAULT 0,
    model_quality DECIMAL(10, 6) DEFAULT 0,
    overfitting_score DECIMAL(10, 6) DEFAULT 0,
    robustness_test DECIMAL(10, 6) DEFAULT 0,
    out_of_sample_performance DECIMAL(10, 6) DEFAULT 0,
    walk_forward_efficiency DECIMAL(10, 6) DEFAULT 0,
    monte_carlo_simulation DECIMAL(10, 6) DEFAULT 0,
    stress_test_performance DECIMAL(10, 6) DEFAULT 0,
    regime_performance JSONB DEFAULT '{}',
    correlation_matrix JSONB DEFAULT '{}',
    benchmark_comparison JSONB DEFAULT '{}',
    seasonal_performance JSONB DEFAULT '{}',
    performance_metrics JSONB DEFAULT '{}',
    error_message TEXT,
    retirement_reason TEXT,
    backtest_completed_at TIMESTAMP,
    paper_trading_started_at TIMESTAMP,
    live_promotion_at TIMESTAMP,
    retired_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_status ON autonomous_strategies(status);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_generation ON autonomous_strategies(generation);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_fitness ON autonomous_strategies(fitness_score DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_symbol ON autonomous_strategies(symbol);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_algorithm ON autonomous_strategies(algorithm);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_active ON autonomous_strategies(active);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_total_pnl ON autonomous_strategies(total_pnl DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_win_rate ON autonomous_strategies(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_sharpe_ratio ON autonomous_strategies(sharpe_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_strategies_max_drawdown ON autonomous_strategies(max_drawdown ASC);

DROP TRIGGER IF EXISTS update_autonomous_strategies_updated_at ON autonomous_strategies;
CREATE TRIGGER update_autonomous_strategies_updated_at
    BEFORE UPDATE ON autonomous_strategies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== STRATEGY GENERATIONS ===================

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

CREATE INDEX IF NOT EXISTS idx_strategy_generations_number ON strategy_generations(generation_number);

INSERT INTO strategy_generations (generation_number, population_size, average_fitness, best_fitness, diversity_score, mutation_rate, crossover_rate)
SELECT 0, 20, 0.0, 0.0, 1.0, 0.1, 0.7
WHERE NOT EXISTS (SELECT 1 FROM strategy_generations WHERE generation_number = 0);

-- =================== STRATEGY PERFORMANCE HISTORY ===================

CREATE TABLE IF NOT EXISTS strategy_performance_history (
    id SERIAL PRIMARY KEY,
    strategy_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stage VARCHAR(50) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_strategy_performance_strategy ON strategy_performance_history(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_timestamp ON strategy_performance_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_stage ON strategy_performance_history(stage);

-- =================== BANKING HISTORY ===================

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
    banking_trigger VARCHAR(50) DEFAULT 'automatic'
);

CREATE INDEX IF NOT EXISTS idx_banking_history_timestamp ON banking_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_banking_history_status ON banking_history(status);

-- =================== DAILY BANKING SUMMARY ===================

CREATE TABLE IF NOT EXISTS daily_banking_summary (
    date DATE PRIMARY KEY,
    total_banked DECIMAL(15, 8) DEFAULT 0,
    total_transfers INTEGER DEFAULT 0,
    successful_transfers INTEGER DEFAULT 0,
    failed_transfers INTEGER DEFAULT 0,
    average_transfer_size DECIMAL(15, 8) DEFAULT 0,
    max_transfer_size DECIMAL(15, 8) DEFAULT 0,
    total_profit_generated DECIMAL(15, 8) DEFAULT 0,
    banking_efficiency DECIMAL(5, 4) DEFAULT 0
);

-- =================== STRATEGY OPTIMIZATION QUEUE ===================

CREATE TABLE IF NOT EXISTS strategy_optimization_queue (
    id SERIAL PRIMARY KEY,
    strategy_id VARCHAR(255) NOT NULL,
    queue_type VARCHAR(50) NOT NULL,
    priority INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    result JSONB,
    FOREIGN KEY (strategy_id) REFERENCES autonomous_strategies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_optimization_queue_type_status ON strategy_optimization_queue(queue_type, status);
CREATE INDEX IF NOT EXISTS idx_optimization_queue_priority ON strategy_optimization_queue(priority DESC);

-- =================== MARKET CONDITIONS HISTORY ===================

CREATE TABLE IF NOT EXISTS market_conditions_history (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    symbol VARCHAR(20) NOT NULL,
    volatility JSONB,
    trend JSONB,
    liquidity JSONB,
    risk_level VARCHAR(20),
    market_phase VARCHAR(50),
    sentiment_score DECIMAL(5, 4),
    volume_profile JSONB,
    price_action JSONB
);

CREATE INDEX IF NOT EXISTS idx_market_conditions_timestamp ON market_conditions_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_conditions_symbol ON market_conditions_history(symbol);

-- =================== SYSTEM PERFORMANCE METRICS ===================

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

CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_performance_metrics(timestamp DESC);

-- =================== EMERGENCY STOPS LOG ===================

CREATE TABLE IF NOT EXISTS emergency_stops_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_value DECIMAL(15, 8),
    threshold_value DECIMAL(15, 8),
    affected_strategies INTEGER DEFAULT 0,
    system_state JSONB,
    resolution_time TIMESTAMP,
    resolution_notes TEXT,
    auto_resolved BOOLEAN DEFAULT false
);

-- =================== STRATEGY DIVERSITY METRICS ===================

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
    diversity_actions JSONB
);

-- =================== AUTONOMOUS TRADING CONFIGS ===================
-- Final schema: migration 000 base + columns from migrations 005 and 009.
-- Uses 'enabled' column (not 'is_active') to match service code.

CREATE TABLE IF NOT EXISTS autonomous_trading_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) DEFAULT '',
    strategy_type VARCHAR(100) DEFAULT 'default',
    config JSONB NOT NULL DEFAULT '{}',
    risk_params JSONB DEFAULT '{}',
    enabled BOOLEAN DEFAULT false,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    initial_capital DECIMAL(30, 18) DEFAULT 10000,
    max_risk_per_trade DECIMAL(10, 4) DEFAULT 2,
    max_drawdown DECIMAL(10, 4) DEFAULT 10,
    target_daily_return DECIMAL(10, 4) DEFAULT 1,
    symbols TEXT[] DEFAULT ARRAY['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP'],
    paper_trading BOOLEAN DEFAULT true,
    stop_loss_percent DECIMAL(10, 4) DEFAULT 2,
    take_profit_percent DECIMAL(10, 4) DEFAULT 4,
    leverage DECIMAL(10, 2) DEFAULT 3,
    max_concurrent_positions INTEGER DEFAULT 3,
    trading_cycle_seconds INTEGER DEFAULT 60,
    confidence_threshold DECIMAL(10, 4) DEFAULT 65,
    signal_score_threshold DECIMAL(10, 4) DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT autonomous_trading_configs_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_autonomous_trading_configs_user ON autonomous_trading_configs(user_id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'autonomous_trading_configs'
          AND column_name = 'enabled'
          AND table_schema = current_schema()
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_autonomous_trading_configs_active
            ON autonomous_trading_configs(enabled) WHERE enabled = true;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_autonomous_trading_configs_updated_at ON autonomous_trading_configs;
CREATE TRIGGER trg_autonomous_trading_configs_updated_at
    BEFORE UPDATE ON autonomous_trading_configs
    FOR EACH ROW EXECUTE FUNCTION update_users_updated_at();

-- =================== USER API CREDENTIALS ===================
-- Final schema: migration 005 + encryption_iv/tag from migration 006.

CREATE TABLE IF NOT EXISTS user_api_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exchange VARCHAR(50) NOT NULL DEFAULT 'poloniex',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    api_secret_encrypted TEXT NOT NULL DEFAULT '',
    passphrase_encrypted TEXT,
    encryption_iv TEXT NOT NULL DEFAULT '',
    encryption_tag TEXT NOT NULL DEFAULT '',
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

DROP TRIGGER IF EXISTS update_user_api_credentials_updated_at ON user_api_credentials;
CREATE TRIGGER update_user_api_credentials_updated_at
    BEFORE UPDATE ON user_api_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== AUTONOMOUS TRADES ===================
-- Used by FullyAutonomousTrader.executeSignals() and managePositions().

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
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_user_id ON autonomous_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_trades_status ON autonomous_trades(status);

-- =================== AUTONOMOUS PERFORMANCE ===================
-- Used by FullyAutonomousTrader.updatePerformanceMetrics().

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
CREATE INDEX IF NOT EXISTS idx_autonomous_performance_user_id ON autonomous_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_performance_timestamp ON autonomous_performance(timestamp);

-- =================== API CREDENTIALS ===================
-- From apps/api/migrations/003 with permissions (005) and encryption_tag (006).

CREATE TABLE IF NOT EXISTS api_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exchange VARCHAR(50) NOT NULL DEFAULT 'poloniex',
    api_key_encrypted TEXT NOT NULL,
    api_secret_encrypted TEXT NOT NULL,
    encryption_iv TEXT NOT NULL,
    encryption_tag TEXT,
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    permissions JSONB DEFAULT '{"read": true, "trade": true, "withdraw": false}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, exchange)
);

CREATE INDEX IF NOT EXISTS idx_api_credentials_user_id ON api_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_api_credentials_active ON api_credentials(is_active);
CREATE INDEX IF NOT EXISTS idx_api_credentials_permissions ON api_credentials USING gin(permissions);

DROP TRIGGER IF EXISTS update_api_credentials_updated_at ON api_credentials;
CREATE TRIGGER update_api_credentials_updated_at
    BEFORE UPDATE ON api_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== TRADING SESSIONS ===================

CREATE TABLE IF NOT EXISTS trading_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    strategy_config JSONB NOT NULL,
    risk_config JSONB,
    position_state JSONB,
    performance_metrics JSONB,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stopped_at TIMESTAMP,
    last_heartbeat_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id ON trading_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_active ON trading_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_heartbeat ON trading_sessions(last_heartbeat_at);

DROP TRIGGER IF EXISTS update_trading_sessions_updated_at ON trading_sessions;
CREATE TRIGGER update_trading_sessions_updated_at
    BEFORE UPDATE ON trading_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== USER SETTINGS ===================

CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    date_locale VARCHAR(10) DEFAULT 'AU',
    theme VARCHAR(20) DEFAULT 'dark',
    notifications_enabled BOOLEAN DEFAULT true,
    auto_trading_enabled BOOLEAN DEFAULT false,
    preferences JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== AGENT SESSIONS ===================
-- Final schema: VARCHAR(100) id (not UUID) from migration 007/013.

CREATE TABLE IF NOT EXISTS agent_sessions (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stopped_at TIMESTAMP WITH TIME ZONE,
    strategies_generated INTEGER DEFAULT 0,
    backtests_completed INTEGER DEFAULT 0,
    paper_trades_executed INTEGER DEFAULT 0,
    live_trades_executed INTEGER DEFAULT 0,
    total_pnl DECIMAL(20, 8) DEFAULT 0,
    config JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);

CREATE OR REPLACE FUNCTION update_agent_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_sessions_updated_at ON agent_sessions;
CREATE TRIGGER update_agent_sessions_updated_at
    BEFORE UPDATE ON agent_sessions
    FOR EACH ROW EXECUTE FUNCTION update_agent_sessions_updated_at();

-- =================== AGENT STRATEGIES ===================
-- Final schema: migration 007 (VARCHAR id) + columns from 004/012/014/015.

CREATE TABLE IF NOT EXISTS agent_strategies (
    id VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(100) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    name VARCHAR(200),
    strategy_name VARCHAR(255) DEFAULT '',
    strategy_code TEXT DEFAULT '',
    type VARCHAR(20),
    symbol VARCHAR(50),
    timeframe VARCHAR(10),
    indicators JSONB,
    code TEXT,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'generated',
    performance JSONB DEFAULT '{"winRate": 0, "profitFactor": 0, "totalTrades": 0, "totalReturn": 0}',
    sub_strategies JSONB,
    backtest_score DECIMAL(10, 4),
    paper_trading_score DECIMAL(10, 4),
    live_trading_score DECIMAL(10, 4),
    generation_prompt TEXT DEFAULT '',
    claude_response TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    promoted_at TIMESTAMP WITH TIME ZONE,
    retired_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_strategies_session_id ON agent_strategies(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_strategies_status ON agent_strategies(status);
CREATE INDEX IF NOT EXISTS idx_agent_strategies_symbol ON agent_strategies(symbol);
CREATE INDEX IF NOT EXISTS idx_agent_strategies_backtest_score ON agent_strategies(backtest_score DESC);

CREATE OR REPLACE FUNCTION update_agent_strategies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_strategies_updated_at ON agent_strategies;
CREATE TRIGGER update_agent_strategies_updated_at
    BEFORE UPDATE ON agent_strategies
    FOR EACH ROW EXECUTE FUNCTION update_agent_strategies_updated_at();

-- =================== AGENT SETTINGS ===================

CREATE TABLE IF NOT EXISTS agent_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
    auto_start_on_login BOOLEAN DEFAULT false,
    continue_when_logged_out BOOLEAN DEFAULT false,
    config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT false,
    last_started_at TIMESTAMP WITH TIME ZONE,
    last_stopped_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_settings_user_id ON agent_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_settings_run_mode ON agent_settings(run_mode);
CREATE INDEX IF NOT EXISTS idx_agent_settings_active ON agent_settings(is_active);

CREATE OR REPLACE FUNCTION update_agent_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_settings_updated_at ON agent_settings;
CREATE TRIGGER update_agent_settings_updated_at
    BEFORE UPDATE ON agent_settings
    FOR EACH ROW EXECUTE FUNCTION update_agent_settings_updated_at();

-- =================== AGENT LEARNINGS ===================

CREATE TABLE IF NOT EXISTS agent_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    learning_type VARCHAR(50) NOT NULL,
    context JSONB,
    insight TEXT NOT NULL,
    confidence DECIMAL(5, 4) CHECK (confidence >= 0 AND confidence <= 1),
    applied_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_learnings_session_id ON agent_learnings(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_learnings_type ON agent_learnings(learning_type);
CREATE INDEX IF NOT EXISTS idx_agent_learnings_confidence ON agent_learnings(confidence DESC);

-- =================== AGENT ACTIVITY LOG ===================

CREATE TABLE IF NOT EXISTS agent_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_log_session_id ON agent_activity_log(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_type ON agent_activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_created_at ON agent_activity_log(created_at DESC);

-- =================== BACKTEST PIPELINE RESULTS ===================

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

-- =================== TRADES ===================
-- Final schema: migration 008/012 base + execution_mode columns from 010.

CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id VARCHAR(255),
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL', 'LONG', 'SHORT')),
    entry_price DECIMAL(30, 18) NOT NULL,
    entry_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    quantity DECIMAL(30, 18) NOT NULL,
    exit_price DECIMAL(30, 18),
    exit_time TIMESTAMP WITH TIME ZONE,
    pnl DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    leverage DECIMAL(10, 2) DEFAULT 1,
    stop_loss DECIMAL(30, 18),
    take_profit DECIMAL(30, 18),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled', 'pending')),
    entry_order_id VARCHAR(255),
    exit_order_id VARCHAR(255),
    notes TEXT,
    trade_type VARCHAR(50) DEFAULT 'market',
    execution_mode VARCHAR(20) DEFAULT 'paper' CHECK (execution_mode IN ('backtest', 'paper', 'live')),
    rationale TEXT,
    strategy_version VARCHAR(50),
    agent_session_id VARCHAR(100),
    confidence_score DECIMAL(5, 2),
    risk_score DECIMAL(5, 2),
    fees DECIMAL(30, 18) DEFAULT 0,
    pnl_percent DECIMAL(10, 4),
    simulated BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode ON trades(execution_mode);
CREATE INDEX IF NOT EXISTS idx_trades_agent_session ON trades(agent_session_id);
CREATE INDEX IF NOT EXISTS idx_trades_execution_mode_status ON trades(execution_mode, status);

DROP TRIGGER IF EXISTS update_trades_updated_at ON trades;
CREATE TRIGGER update_trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================== AGENT EVENTS ===================
-- Used by audit trail — session_id VARCHAR(255) without FK for flexibility.

CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    execution_mode VARCHAR(20),
    description TEXT NOT NULL,
    explanation TEXT,
    data_inputs JSONB,
    confidence_score DECIMAL(5, 2),
    risk_score DECIMAL(5, 2),
    resulting_order_id VARCHAR(255),
    pnl_impact DECIMAL(30, 18),
    strategy_version VARCHAR(50),
    market VARCHAR(50),
    timeframe VARCHAR(10),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_user ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_mode ON agent_events(execution_mode);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_user_id ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_id ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC);

-- =================== PAPER PROMOTION QUEUE ===================

CREATE TABLE IF NOT EXISTS paper_promotion_queue (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppq_due ON paper_promotion_queue(due_at) WHERE NOT processed;

-- =================== VIEWS ===================

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

CREATE OR REPLACE VIEW autonomous_strategy_performance_summary AS
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

-- =================== COMMENTS ===================

COMMENT ON TABLE users IS 'Core user accounts';
COMMENT ON TABLE futures_accounts IS 'Poloniex futures account management';
COMMENT ON TABLE futures_positions IS 'Open futures positions';
COMMENT ON TABLE futures_orders IS 'Futures order management';
COMMENT ON TABLE futures_trades IS 'Futures trade execution records';
COMMENT ON TABLE historical_market_data IS 'Stores historical OHLCV data for backtesting';
COMMENT ON TABLE backtest_results IS 'Stores backtest run results and performance metrics';
COMMENT ON TABLE strategy_performance IS 'ML self-learning engine strategy performance tracking (QIG-informed)';
COMMENT ON TABLE paper_trading_sessions IS 'Paper trading session data';
COMMENT ON TABLE paper_trading_positions IS 'Paper trading positions';
COMMENT ON TABLE paper_trading_trades IS 'Paper trading trade executions';
COMMENT ON TABLE autonomous_trading_configs IS 'Configuration for fully autonomous trading per user';
COMMENT ON TABLE user_api_credentials IS 'AES-256-GCM encrypted API credentials per user per exchange';
COMMENT ON TABLE autonomous_trades IS 'History of all autonomous trades executed';
COMMENT ON TABLE autonomous_performance IS 'Performance metrics tracked over time';
COMMENT ON TABLE agent_sessions IS 'Autonomous agent trading sessions';
COMMENT ON TABLE agent_strategies IS 'AI-generated trading strategies';
COMMENT ON TABLE agent_settings IS 'Persistent agent configuration per user';
COMMENT ON TABLE agent_events IS 'Immutable audit trail of all agent actions and decisions';
COMMENT ON TABLE trades IS 'Main trades table for autonomous trading system';
COMMENT ON TABLE paper_promotion_queue IS 'Persistent paper→live promotion scheduling (replaces in-memory setTimeout)';
COMMENT ON COLUMN paper_trading_sessions.is_censored IS 'TRUE when session outcome is censored: hit max drawdown kill, position size limit, or had open positions force-closed at session end. Censored sessions are excluded from live promotion fitness calculations.';
COMMENT ON COLUMN paper_trading_sessions.censor_reason IS 'One of: max_drawdown_kill, position_size_limit, session_end_forced_close. NULL when not censored.';
COMMENT ON COLUMN strategy_performance.is_censored IS 'TRUE when session ended abnormally (QIG censoring pattern)';
COMMENT ON COLUMN agent_strategies.type IS 'single = single indicator strategy, combo = multi-strategy combination';
COMMENT ON COLUMN agent_settings.run_mode IS 'never = disabled, manual = user controlled, always = run 24/7';
COMMENT ON COLUMN trades.execution_mode IS 'Whether this trade is from backtest, paper trading, or live trading';
COMMENT ON COLUMN trades.simulated IS 'True for paper/backtest trades, false for live trades';
