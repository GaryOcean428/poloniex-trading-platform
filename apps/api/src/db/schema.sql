-- PostGIS Database Schema for Cryptocurrency Trading Platform
-- Location-aware authentication and compliance system

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table with location data
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'trader' CHECK (role IN ('trader', 'admin', 'viewer')),

    -- Location data
    registered_location GEOGRAPHY(POINT, 4326),
    country_code VARCHAR(2),
    timezone VARCHAR(50),

    -- Account status
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    kyc_status VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'approved', 'rejected')),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,

    -- Compliance flags
    risk_level VARCHAR(10) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
    trading_enabled BOOLEAN DEFAULT true,

    -- Create indexes
    CONSTRAINT users_username_length CHECK (LENGTH(username) >= 3),
    CONSTRAINT users_email_format CHECK (email ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Create indexes for users table
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_country_code ON users(country_code);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_registered_location ON users USING GIST(registered_location);

-- Login sessions with geospatial tracking
CREATE TABLE login_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Session data
    refresh_token_hash VARCHAR(255) NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Location tracking
    login_location GEOGRAPHY(POINT, 4326),
    ip_address INET,
    user_agent TEXT,

    -- Security flags
    is_suspicious_location BOOLEAN DEFAULT false,
    is_vpn_detected BOOLEAN DEFAULT false,
    mfa_verified BOOLEAN DEFAULT false,

    -- Device fingerprinting
    device_fingerprint VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Status
    is_active BOOLEAN DEFAULT true,
    logout_reason VARCHAR(50),

    CONSTRAINT login_sessions_expires_at_future CHECK (expires_at > created_at)
);

-- Create indexes for login_sessions
CREATE INDEX idx_login_sessions_user_id ON login_sessions(user_id);
CREATE INDEX idx_login_sessions_token ON login_sessions(session_token);
CREATE INDEX idx_login_sessions_expires_at ON login_sessions(expires_at);
CREATE INDEX idx_login_sessions_created_at ON login_sessions(created_at);
CREATE INDEX idx_login_sessions_location ON login_sessions USING GIST(login_location);
CREATE INDEX idx_login_sessions_ip_address ON login_sessions(ip_address);

-- API credentials (encrypted storage)
CREATE TABLE user_api_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Exchange information
    exchange VARCHAR(50) NOT NULL DEFAULT 'poloniex',
    credential_name VARCHAR(100) NOT NULL,

    -- Encrypted credentials
    api_key_encrypted TEXT NOT NULL,
    api_secret_encrypted TEXT NOT NULL,
    passphrase_encrypted TEXT, -- For some exchanges

    -- Permissions
    permissions JSONB DEFAULT '{"read": true, "trade": false, "withdraw": false}',

    -- Status
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(user_id, exchange, credential_name)
);

-- Create indexes for api_credentials
CREATE INDEX idx_api_credentials_user_id ON user_api_credentials(user_id);
CREATE INDEX idx_api_credentials_exchange ON user_api_credentials(exchange);
CREATE INDEX idx_api_credentials_active ON user_api_credentials(is_active);

-- Trading accounts/profiles
CREATE TABLE trading_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_credential_id UUID REFERENCES user_api_credentials(id) ON DELETE SET NULL,

    -- Account details
    account_name VARCHAR(100) NOT NULL,
    exchange VARCHAR(50) NOT NULL DEFAULT 'poloniex',
    account_type VARCHAR(20) DEFAULT 'spot' CHECK (account_type IN ('spot', 'futures', 'margin')),

    -- Configuration
    max_position_size DECIMAL(20, 8) DEFAULT 0,
    risk_limit DECIMAL(20, 8) DEFAULT 0,
    trading_enabled BOOLEAN DEFAULT true,

    -- Performance tracking
    total_pnl DECIMAL(20, 8) DEFAULT 0,
    win_rate DECIMAL(5, 2) DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(user_id, account_name),
    CONSTRAINT trading_accounts_name_length CHECK (LENGTH(account_name) >= 3)
);

-- Create indexes for trading_accounts
CREATE INDEX idx_trading_accounts_user_id ON trading_accounts(user_id);
CREATE INDEX idx_trading_accounts_exchange ON trading_accounts(exchange);
CREATE INDEX idx_trading_accounts_active ON trading_accounts(trading_enabled);

-- Geographic restrictions and compliance
CREATE TABLE geo_restrictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Geographic scope
    country_code VARCHAR(2) NOT NULL,
    region VARCHAR(100),
    jurisdiction VARCHAR(100),

    -- Restriction details
    trading_allowed BOOLEAN DEFAULT true,
    futures_allowed BOOLEAN DEFAULT true,
    margin_allowed BOOLEAN DEFAULT true,

    -- Requirements
    kyc_required BOOLEAN DEFAULT false,
    enhanced_kyc_required BOOLEAN DEFAULT false,
    minimum_age INTEGER DEFAULT 18,

    -- Restricted features
    restricted_features JSONB DEFAULT '[]',
    max_position_size DECIMAL(20, 8),
    max_daily_volume DECIMAL(20, 8),

    -- Compliance
    regulatory_framework VARCHAR(100),
    license_required BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Make country_code unique
    UNIQUE(country_code)
);

-- Create indexes for geo_restrictions
CREATE INDEX idx_geo_restrictions_country ON geo_restrictions(country_code);
CREATE INDEX idx_geo_restrictions_trading ON geo_restrictions(trading_allowed);

-- Audit log for security events
CREATE TABLE security_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID REFERENCES login_sessions(id) ON DELETE SET NULL,

    -- Event details
    event_type VARCHAR(50) NOT NULL,
    event_description TEXT NOT NULL,
    severity VARCHAR(10) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),

    -- Location and context
    ip_address INET,
    user_agent TEXT,
    event_location GEOGRAPHY(POINT, 4326),

    -- Additional data
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Status
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Create indexes for security_audit_log
CREATE INDEX idx_security_audit_user_id ON security_audit_log(user_id);
CREATE INDEX idx_security_audit_event_type ON security_audit_log(event_type);
CREATE INDEX idx_security_audit_severity ON security_audit_log(severity);
CREATE INDEX idx_security_audit_created_at ON security_audit_log(created_at);
CREATE INDEX idx_security_audit_location ON security_audit_log USING GIST(event_location);

-- User preferences and settings
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Interface preferences
    theme VARCHAR(20) DEFAULT 'dark' CHECK (theme IN ('light', 'dark', 'system')),
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50),

    -- Trading preferences
    default_trading_pair VARCHAR(20) DEFAULT 'BTC-USDT',
    preferred_chart_timeframe VARCHAR(10) DEFAULT '1h',

    -- Security preferences
    mfa_enabled BOOLEAN DEFAULT false,
    login_notifications BOOLEAN DEFAULT true,
    trade_notifications BOOLEAN DEFAULT true,

    -- Privacy settings
    profile_visibility VARCHAR(20) DEFAULT 'private' CHECK (profile_visibility IN ('public', 'private', 'friends')),
    location_sharing BOOLEAN DEFAULT false,

    -- Notification preferences
    notification_preferences JSONB DEFAULT '{"email": true, "sms": false, "push": true}',

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one preference record per user
    UNIQUE(user_id)
);

-- Create indexes for user_preferences
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

-- Create update triggers for timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_api_credentials_updated_at BEFORE UPDATE ON user_api_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trading_accounts_updated_at BEFORE UPDATE ON trading_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_geo_restrictions_updated_at BEFORE UPDATE ON geo_restrictions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default geo restrictions for major jurisdictions
INSERT INTO geo_restrictions (country_code, jurisdiction, trading_allowed, futures_allowed, kyc_required, regulatory_framework) VALUES
('US', 'United States', true, true, true, 'CFTC/SEC'),
('EU', 'European Union', true, true, true, 'MiCA'),
('UK', 'United Kingdom', true, true, true, 'FCA'),
('CA', 'Canada', true, true, true, 'CSA'),
('AU', 'Australia', true, true, true, 'ASIC'),
('JP', 'Japan', true, true, true, 'JFSA'),
('SG', 'Singapore', true, true, true, 'MAS'),
('KR', 'South Korea', true, false, true, 'FSC'),
('CN', 'China', false, false, false, 'PBOC'),
('IN', 'India', true, false, true, 'RBI/SEBI');

-- Create views for common queries
CREATE VIEW active_users_with_location AS
SELECT
    u.id,
    u.username,
    u.email,
    u.country_code,
    u.timezone,
    u.kyc_status,
    u.trading_enabled,
    u.last_login_at,
    ST_X(u.registered_location::geometry) as longitude,
    ST_Y(u.registered_location::geometry) as latitude,
    gr.trading_allowed as jurisdiction_trading_allowed,
    gr.kyc_required as jurisdiction_kyc_required
FROM users u
LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
WHERE u.is_active = true;

CREATE VIEW recent_login_activity AS
SELECT
    ls.id,
    ls.user_id,
    u.username,
    ls.ip_address,
    ls.is_suspicious_location,
    ls.is_vpn_detected,
    ls.created_at,
    ST_X(ls.login_location::geometry) as longitude,
    ST_Y(ls.login_location::geometry) as latitude,
    ls.user_agent
FROM login_sessions ls
JOIN users u ON ls.user_id = u.id
WHERE ls.created_at >= NOW() - INTERVAL '7 days'
ORDER BY ls.created_at DESC;

-- Functions for geospatial analysis
CREATE OR REPLACE FUNCTION calculate_distance_km(point1 GEOGRAPHY, point2 GEOGRAPHY)
RETURNS DECIMAL AS $$
BEGIN
    RETURN ST_Distance(point1, point2) / 1000.0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_suspicious_location(
    user_id UUID,
    new_location GEOGRAPHY,
    threshold_km DECIMAL DEFAULT 1000
)
RETURNS BOOLEAN AS $$
DECLARE
    last_location GEOGRAPHY;
    distance_km DECIMAL;
BEGIN
    -- Get the most recent login location for this user
    SELECT login_location INTO last_location
    FROM login_sessions
    WHERE login_sessions.user_id = is_suspicious_location.user_id
      AND login_location IS NOT NULL
      AND created_at >= NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
    LIMIT 1;

    -- If no previous location, not suspicious
    IF last_location IS NULL THEN
        RETURN false;
    END IF;

    -- Calculate distance
    distance_km := calculate_distance_km(last_location, new_location);

    -- Return true if distance exceeds threshold
    RETURN distance_km > threshold_km;
END;
$$ LANGUAGE plpgsql;

-- Create admin user for initial setup
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
        INSERT INTO users (username, email, password_hash, role, country_code, timezone, kyc_status, trading_enabled)
        VALUES (
            'admin',
            'admin@polytrade.com',
            '$2b$10$RCUYLGMFvkS6jmki5Q3duOqATZEOAS5je/FQu9vATYBfb3MMGEyUG', -- 'password' hashed
            'admin',
            'US',
            'America/New_York',
            'approved',
            true
        );
    END IF;
END $$;

-- Create demo trading user
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'demo') THEN
        INSERT INTO users (username, email, password_hash, role, country_code, timezone, kyc_status, trading_enabled)
        VALUES (
            'demo',
            'demo@polytrade.com',
            '$2b$10$RCUYLGMFvkS6jmki5Q3duOqATZEOAS5je/FQu9vATYBfb3MMGEyUG', -- 'password' hashed
            'trader',
            'US',
            'America/New_York',
            'approved',
            true
        );
    END IF;
END $$;

-- Create trader user
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'trader') THEN
        INSERT INTO users (username, email, password_hash, role, country_code, timezone, kyc_status, trading_enabled)
        VALUES (
            'trader',
            'trader@polytrade.com',
            '$2b$10$RCUYLGMFvkS6jmki5Q3duOqATZEOAS5je/FQu9vATYBfb3MMGEyUG', -- 'password' hashed
            'trader',
            'US',
            'America/New_York',
            'approved',
            true
        );
    END IF;
END $$;

-- Grant appropriate permissions
-- Note: In production, create specific roles with limited permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;
