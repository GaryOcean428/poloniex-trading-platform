-- 000_base_schema.sql
-- Base schema: users + autonomous_trading_configs tables
-- Required by all subsequent migrations (001+ reference users(id))

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================== USERS ===================

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

-- Update trigger
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_users_updated_at();

-- =================== AUTONOMOUS TRADING CONFIGS ===================
-- Queried on startup by FullyAutonomousTrader.loadActiveConfigs()

CREATE TABLE IF NOT EXISTS autonomous_trading_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    strategy_type VARCHAR(100) DEFAULT 'default',
    config JSONB NOT NULL DEFAULT '{}',
    risk_params JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT false,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_autonomous_trading_configs_user
    ON autonomous_trading_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_trading_configs_active
    ON autonomous_trading_configs(is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_autonomous_trading_configs_updated_at ON autonomous_trading_configs;
CREATE TRIGGER trg_autonomous_trading_configs_updated_at
    BEFORE UPDATE ON autonomous_trading_configs
    FOR EACH ROW EXECUTE FUNCTION update_users_updated_at();
