-- Standard PostgreSQL Database Schema for Cryptocurrency Trading Platform
-- Location-aware authentication and compliance system (without PostGIS)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table with location data (using separate lat/lon columns)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'trader' CHECK (role IN ('trader', 'admin', 'viewer')),

    -- Location data (using separate columns instead of PostGIS)
    registered_latitude DECIMAL(10, 8),
    registered_longitude DECIMAL(11, 8),
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
CREATE INDEX idx_users_location ON users(registered_latitude, registered_longitude);

-- Login sessions with location tracking
CREATE TABLE login_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Location data (using separate columns instead of PostGIS)
    login_latitude DECIMAL(10, 8),
    login_longitude DECIMAL(11, 8),
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    
    -- Security flags
    is_suspicious_location BOOLEAN DEFAULT false,
    mfa_verified BOOLEAN DEFAULT false,
    
    -- Session management
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Create indexes for login_sessions
CREATE INDEX idx_login_sessions_user_id ON login_sessions(user_id);
CREATE INDEX idx_login_sessions_token ON login_sessions(session_token);
CREATE INDEX idx_login_sessions_expires_at ON login_sessions(expires_at);
CREATE INDEX idx_login_sessions_location ON login_sessions(login_latitude, login_longitude);

-- User preferences table
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Trading preferences
    default_pair VARCHAR(20) DEFAULT 'BTC_USDT',
    risk_tolerance VARCHAR(10) DEFAULT 'medium' CHECK (risk_tolerance IN ('low', 'medium', 'high')),
    max_position_size DECIMAL(18, 8) DEFAULT 1000.00,
    auto_trading_enabled BOOLEAN DEFAULT false,
    
    -- Notification preferences
    email_notifications BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    sms_notifications BOOLEAN DEFAULT false,
    
    -- UI preferences
    theme VARCHAR(10) DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    language VARCHAR(5) DEFAULT 'en',
    timezone_override VARCHAR(50),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure one preference record per user
    CONSTRAINT unique_user_preferences UNIQUE (user_id)
);

-- Create indexes for user_preferences
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

-- API keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- API key data (encrypted)
    key_name VARCHAR(100) NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    encrypted_api_secret TEXT NOT NULL,
    
    -- Permissions
    read_permission BOOLEAN DEFAULT true,
    trade_permission BOOLEAN DEFAULT false,
    withdraw_permission BOOLEAN DEFAULT false,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique key name per user
    CONSTRAINT unique_user_key_name UNIQUE (user_id, key_name)
);

-- Create indexes for api_keys
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_active ON api_keys(is_active);

-- Geo-restrictions table (for compliance)
CREATE TABLE geo_restrictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_code VARCHAR(2) NOT NULL UNIQUE,
    country_name VARCHAR(100) NOT NULL,
    
    -- Trading restrictions
    trading_allowed BOOLEAN DEFAULT true,
    futures_allowed BOOLEAN DEFAULT true,
    kyc_required BOOLEAN DEFAULT false,
    
    -- Compliance notes
    restriction_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for geo_restrictions
CREATE INDEX idx_geo_restrictions_country_code ON geo_restrictions(country_code);

-- Security audit log
CREATE TABLE security_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL,
    event_description TEXT,
    severity VARCHAR(10) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    
    -- Context data
    ip_address INET,
    user_agent TEXT,
    event_latitude DECIMAL(10, 8),
    event_longitude DECIMAL(11, 8),
    
    -- Additional metadata
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for security_audit_log
CREATE INDEX idx_security_audit_user_id ON security_audit_log(user_id);
CREATE INDEX idx_security_audit_event_type ON security_audit_log(event_type);
CREATE INDEX idx_security_audit_severity ON security_audit_log(severity);
CREATE INDEX idx_security_audit_created_at ON security_audit_log(created_at);
CREATE INDEX idx_security_audit_location ON security_audit_log(event_latitude, event_longitude);

-- Insert default geo-restrictions
INSERT INTO geo_restrictions (country_code, country_name, trading_allowed, futures_allowed, kyc_required) VALUES
('US', 'United States', true, false, true),
('CN', 'China', false, false, false),
('KP', 'North Korea', false, false, false),
('IR', 'Iran', false, false, false),
('RU', 'Russia', true, true, true),
('CA', 'Canada', true, true, true),
('GB', 'United Kingdom', true, true, true),
('DE', 'Germany', true, true, true),
('FR', 'France', true, true, true),
('JP', 'Japan', true, true, true),
('KR', 'South Korea', true, true, true),
('SG', 'Singapore', true, true, true),
('AU', 'Australia', true, true, true),
('NZ', 'New Zealand', true, true, true),
('CH', 'Switzerland', true, true, true),
('NL', 'Netherlands', true, true, true),
('SE', 'Sweden', true, true, true),
('NO', 'Norway', true, true, true),
('DK', 'Denmark', true, true, true),
('FI', 'Finland', true, true, true);

-- Create database views for common queries
CREATE VIEW user_summary AS
SELECT 
    u.id,
    u.username,
    u.email,
    u.role,
    u.country_code,
    u.timezone,
    u.is_active,
    u.is_verified,
    u.kyc_status,
    u.trading_enabled,
    u.registered_latitude as latitude,
    u.registered_longitude as longitude,
    u.created_at,
    u.last_login_at,
    gr.trading_allowed as jurisdiction_trading_allowed,
    gr.futures_allowed as jurisdiction_futures_allowed,
    gr.kyc_required as jurisdiction_kyc_required
FROM users u
LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code;

CREATE VIEW active_sessions AS
SELECT 
    ls.id,
    ls.user_id,
    ls.session_token,
    ls.expires_at,
    ls.created_at,
    ls.login_latitude as longitude,
    ls.login_longitude as latitude,
    ls.ip_address,
    ls.is_suspicious_location,
    ls.last_activity_at,
    u.username,
    u.email
FROM login_sessions ls
JOIN users u ON ls.user_id = u.id
WHERE ls.is_active = true AND ls.expires_at > CURRENT_TIMESTAMP;

-- Function to calculate distance between two points (simplified Haversine formula)
CREATE OR REPLACE FUNCTION calculate_distance_km(lat1 DECIMAL, lon1 DECIMAL, lat2 DECIMAL, lon2 DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
    R CONSTANT DECIMAL := 6371; -- Earth's radius in km
    dLat DECIMAL;
    dLon DECIMAL;
    a DECIMAL;
    c DECIMAL;
BEGIN
    -- Convert latitude and longitude from degrees to radians
    dLat := radians(lat2 - lat1);
    dLon := radians(lon2 - lon1);
    
    -- Haversine formula
    a := sin(dLat/2) * sin(dLat/2) + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon/2) * sin(dLon/2);
    c := 2 * atan2(sqrt(a), sqrt(1-a));
    
    RETURN R * c;
END;
$$ LANGUAGE plpgsql;

-- Function to detect suspicious location changes
CREATE OR REPLACE FUNCTION detect_suspicious_location(
    user_id UUID,
    new_latitude DECIMAL,
    new_longitude DECIMAL
) RETURNS BOOLEAN AS $$
DECLARE
    last_latitude DECIMAL;
    last_longitude DECIMAL;
    distance_km DECIMAL;
    time_diff INTERVAL;
    max_speed_kmh CONSTANT DECIMAL := 1000; -- Maximum reasonable travel speed
BEGIN
    -- Get the last known location
    SELECT login_latitude, login_longitude INTO last_latitude, last_longitude
    FROM login_sessions
    WHERE user_id = user_id AND login_latitude IS NOT NULL AND login_longitude IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- If no previous location, not suspicious
    IF last_latitude IS NULL OR last_longitude IS NULL THEN
        RETURN false;
    END IF;
    
    -- Calculate distance
    distance_km := calculate_distance_km(last_latitude, last_longitude, new_latitude, new_longitude);
    
    -- If distance is less than 100km, not suspicious
    IF distance_km < 100 THEN
        RETURN false;
    END IF;
    
    -- Get time difference from last login
    SELECT CURRENT_TIMESTAMP - MAX(created_at) INTO time_diff
    FROM login_sessions
    WHERE user_id = user_id;
    
    -- If time difference is more than 1 day, not suspicious
    IF time_diff > interval '1 day' THEN
        RETURN false;
    END IF;
    
    -- Check if travel speed is unreasonable
    IF distance_km / (EXTRACT(EPOCH FROM time_diff) / 3600) > max_speed_kmh THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$ LANGUAGE plpgsql;

-- Create default admin user
INSERT INTO users (username, email, password_hash, role, country_code, timezone, is_active, is_verified, kyc_status, trading_enabled) VALUES
('admin', 'admin@polytrade.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewrKmY6fkxrZyXOK', 'admin', 'US', 'America/New_York', true, true, 'approved', true),
('demo', 'demo@polytrade.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewrKmY6fkxrZyXOK', 'trader', 'US', 'America/New_York', true, true, 'approved', true),
('trader', 'trader@polytrade.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewrKmY6fkxrZyXOK', 'trader', 'US', 'America/New_York', true, true, 'approved', true);

-- Create default user preferences for each user
INSERT INTO user_preferences (user_id, default_pair, risk_tolerance, max_position_size, auto_trading_enabled)
SELECT id, 'BTC_USDT', 'medium', 10000.00, false
FROM users;

-- Create database triggers for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_geo_restrictions_updated_at BEFORE UPDATE ON geo_restrictions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- All default users have password: 'password'
-- Hash generated with: bcrypt.hash('password', 12)