import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, geoQuery } from '../db/connection.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
/**
 * User Service - PostGIS-based user management with location-aware features
 */
export class UserService {
    /**
     * Create a new user with location data
     */
    static async createUser({ username, email, password, latitude, longitude, countryCode, timezone, role = 'trader' }) {
        try {
            // Hash password
            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            const queryText = `
        INSERT INTO users (
          username, email, password_hash, role,
          latitude, longitude, country_code, timezone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, username, email, role, country_code, timezone, created_at
      `;
            const params = [username, email, passwordHash, role, latitude, longitude, countryCode, timezone];
            const result = await query(queryText, params);
            if (result.rows.length === 0) {
                throw new Error('Failed to create user');
            }
            const user = result.rows[0];
            // Create user preferences
            await this.createUserPreferences(user.id);
            // Log security event
            await this.logSecurityEvent({
                userId: user.id,
                eventType: 'user_created',
                eventDescription: `User account created: ${username}`,
                severity: 'info'
            });
            return user;
        }
        catch (error) {
            logger.error('Error creating user', { error: error.message, stack: error.stack });
            throw error;
        }
    }
    /**
     * Find user by username or email
     */
    static async findUser(identifier) {
        try {
            const queryText = `
        SELECT
          u.id, u.username, u.email, u.password_hash, u.role,
          u.country_code, u.timezone, u.is_active, u.is_verified,
          u.kyc_status, u.trading_enabled, u.risk_level,
          u.created_at, u.updated_at, u.last_login_at,
          u.latitude, u.longitude,
          gr.trading_allowed as jurisdiction_trading_allowed,
          gr.kyc_required as jurisdiction_kyc_required,
          gr.futures_allowed as jurisdiction_futures_allowed
        FROM users u
        LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
        WHERE (u.username = $1 OR u.email = $1) AND u.is_active = true
      `;
            const result = await query(queryText, [identifier]);
            return result.rows[0] || null;
        }
        catch (error) {
            logger.error('Error finding user', { error: error.message, identifier });
            throw error;
        }
    }
    /**
     * Find user by ID
     */
    static async findUserById(userId) {
        try {
            const queryText = `
        SELECT
          u.id, u.username, u.email, u.role,
          u.country_code, u.timezone, u.is_active, u.is_verified,
          u.kyc_status, u.trading_enabled, u.risk_level,
          u.created_at, u.updated_at, u.last_login_at,
          u.latitude, u.longitude,
          gr.trading_allowed as jurisdiction_trading_allowed,
          gr.kyc_required as jurisdiction_kyc_required,
          gr.futures_allowed as jurisdiction_futures_allowed
        FROM users u
        LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
        WHERE u.id = $1 AND u.is_active = true
      `;
            const result = await query(queryText, [userId]);
            return result.rows[0] || null;
        }
        catch (error) {
            logger.error('Error finding user by ID', { error: error.message, userId });
            throw error;
        }
    }
    /**
     * Verify user password
     */
    static async verifyPassword(user, password) {
        try {
            return await bcrypt.compare(password, user.password_hash);
        }
        catch (error) {
            logger.error('Error verifying password', { error: error.message });
            return false;
        }
    }
    /**
     * Update user's last login time and location
     */
    static async updateLastLogin(userId, latitude, longitude) {
        try {
            if (latitude && longitude) {
                // Location point can be created for future use
                // For now, we are just updating the last login time.
            }
            const queryText = `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
            await query(queryText, [userId]);
            // If location provided, we could update registered location or track it separately
            // For now, we'll just update the login time
        }
        catch (error) {
            logger.error('Error updating last login', { error: error.message });
            throw error;
        }
    }
    /**
     * Create user session with location tracking
     */
    static async createSession({ userId, refreshTokenHash, sessionToken, expiresAt, ipAddress, userAgent, latitude, longitude, deviceFingerprint, mfaVerified = false }) {
        try {
            // Check if location is suspicious - disabled without PostGIS
            let isSuspiciousLocation = false;
            const queryText = `
        INSERT INTO login_sessions (
          user_id, refresh_token_hash, session_token, expires_at,
          latitude, longitude, ip_address, user_agent,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `;
            const params = [
                userId, refreshTokenHash, sessionToken, expiresAt,
                latitude, longitude, ipAddress, userAgent,
                true
            ];
            const result = await query(queryText, params);
            if (result.rows.length === 0) {
                throw new Error('Failed to create session');
            }
            const session = result.rows[0];
            // Log security event
            await this.logSecurityEvent({
                userId,
                sessionId: session.id,
                eventType: 'login_successful',
                eventDescription: `User logged in successfully${isSuspiciousLocation ? ' (suspicious location)' : ''}`,
                severity: isSuspiciousLocation ? 'warning' : 'info',
                ipAddress,
                userAgent,
                latitude,
                longitude
            });
            return session;
        }
        catch (error) {
            logger.error('Error creating session', { error: error.message });
            throw error;
        }
    }
    /**
     * Find session by token
     */
    static async findSessionByToken(sessionToken) {
        try {
            const queryText = `
        SELECT
          ls.id, ls.user_id, ls.refresh_token_hash, ls.expires_at,
          ls.is_active, ls.is_suspicious_location, ls.mfa_verified,
          ls.created_at, ls.last_accessed_at,
          ls.latitude, ls.longitude,
          u.username, u.email, u.role, u.is_active as user_active
        FROM login_sessions ls
        JOIN users u ON ls.user_id = u.id
        WHERE ls.refresh_token_hash = $1 AND ls.is_active = true
      `;
            const result = await query(queryText, [sessionToken]);
            return result.rows[0] || null;
        }
        catch (error) {
            logger.error('Error finding session', { error: error.message });
            throw error;
        }
    }
    /**
     * Update session access time
     */
    static async updateSessionAccess(sessionId) {
        try {
            const queryText = `
        UPDATE login_sessions
        SET last_accessed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
            await query(queryText, [sessionId]);
        }
        catch (error) {
            logger.error('Error updating session access', { error: error.message, sessionId });
            throw error;
        }
    }
    /**
     * Invalidate session
     */
    static async invalidateSession(sessionId, reason = 'logout') {
        try {
            const queryText = `
        UPDATE login_sessions
        SET is_active = false, logout_reason = $2
        WHERE id = $1
      `;
            await query(queryText, [sessionId, reason]);
        }
        catch (error) {
            logger.error('Error invalidating session', { error: error.message, sessionId, reason });
            throw error;
        }
    }
    /**
     * Clean up expired sessions
     */
    static async cleanupExpiredSessions() {
        try {
            const queryText = `
        UPDATE login_sessions
        SET is_active = false, logout_reason = 'expired'
        WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true
      `;
            const result = await query(queryText);
            logger.info('Cleaned up expired sessions', { count: result.rowCount });
            return result.rowCount;
        }
        catch (error) {
            logger.error('Error cleaning up sessions', { error: error.message });
            throw error;
        }
    }
    /**
     * Log security event
     */
    static async logSecurityEvent({ userId, sessionId, // Used for session-specific events
    eventType, eventDescription, severity = 'info', ipAddress, userAgent, latitude, longitude, metadata = {} }) {
        try {
            const queryText = `
        INSERT INTO security_audit_log (
          user_id, event_type, details,
          ip_address, user_agent, latitude, longitude, country_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
            const params = [
                userId, eventType, JSON.stringify({ description: eventDescription, severity }),
                ipAddress, userAgent, latitude, longitude, null
            ];
            await query(queryText, params);
        }
        catch (error) {
            logger.error('Error logging security event', { error: error.message });
        }
    }
    /**
     * Create default user preferences
     */
    static async createUserPreferences(userId) {
        try {
            const queryText = `
        INSERT INTO user_preferences (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
      `;
            await query(queryText, [userId]);
        }
        catch (error) {
            logger.error('Error creating user preferences', { error: error.message, userId });
            throw error;
        }
    }
    /**
     * Get user preferences
     */
    static async getUserPreferences(userId) {
        try {
            const queryText = `
        SELECT * FROM user_preferences WHERE user_id = $1
      `;
            const result = await query(queryText, [userId]);
            return result.rows[0] || null;
        }
        catch (error) {
            logger.error('Error getting user preferences', { error: error.message, userId });
            throw error;
        }
    }
    /**
     * Check jurisdiction compliance
     */
    static async checkJurisdictionCompliance(userId) {
        try {
            const queryText = `
        SELECT
          u.country_code, u.kyc_status, u.trading_enabled,
          gr.trading_allowed, gr.futures_allowed, gr.kyc_required
        FROM users u
        LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
        WHERE u.id = $1
      `;
            const result = await query(queryText, [userId]);
            const user = result.rows[0];
            if (!user) {
                return { compliant: false, reason: 'User not found' };
            }
            // Check if trading is allowed in jurisdiction
            if (!user.trading_allowed) {
                return {
                    compliant: false,
                    reason: 'Trading not allowed in jurisdiction',
                    jurisdiction: user.country_code
                };
            }
            // Check KYC requirements
            if (user.kyc_required && user.kyc_status !== 'approved') {
                return {
                    compliant: false,
                    reason: 'KYC verification required',
                    kyc_status: user.kyc_status
                };
            }
            return {
                compliant: true,
                jurisdiction: user.country_code
            };
        }
        catch (error) {
            logger.error('Error checking jurisdiction compliance', { error: error.message });
            throw error;
        }
    }
    /**
     * Get recent login activity for user
     */
    static async getRecentLoginActivity(userId, limit = 10) {
        try {
            const queryText = `
        SELECT
          id, ip_address, user_agent, is_suspicious_location,
          is_vpn_detected, created_at,
          ${geoQuery.getLatLon('login_location')}
        FROM login_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
            const result = await query(queryText, [userId, limit]);
            return result.rows;
        }
        catch (error) {
            logger.error('Error getting login activity', { error: error.message, userId });
            throw error;
        }
    }
    // =================== API KEY MANAGEMENT ===================
    /**
     * Get encryption key from environment
     */
    static getEncryptionKey() {
        const key = env.API_ENCRYPTION_KEY || env.JWT_SECRET;
        if (!key) {
            throw new Error('API_ENCRYPTION_KEY or JWT_SECRET environment variable is required for API key encryption');
        }
        // Create a 32-byte key from the provided key
        return crypto.createHash('sha256').update(key).digest();
    }
    /**
     * Encrypt sensitive data
     */
    static encrypt(text) {
        try {
            const algorithm = 'aes-256-gcm';
            const key = this.getEncryptionKey();
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(algorithm, key, iv);
            cipher.setAAD(Buffer.from('polytrade-api-key', 'utf8'));
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag();
            // Return iv + authTag + encrypted data
            return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
        }
        catch (error) {
            logger.error('Error encrypting data', { error: error.message });
            throw new Error('Failed to encrypt data');
        }
    }
    /**
     * Decrypt sensitive data
     */
    static decrypt(encryptedData) {
        try {
            const algorithm = 'aes-256-gcm';
            const key = this.getEncryptionKey();
            const parts = encryptedData.split(':');
            if (parts.length !== 3) {
                throw new Error('Invalid encrypted data format');
            }
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encrypted = parts[2];
            const decipher = crypto.createDecipheriv(algorithm, key, iv);
            decipher.setAAD(Buffer.from('polytrade-api-key', 'utf8'));
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        catch (error) {
            logger.error('Error decrypting data', { error: error.message });
            throw new Error('Failed to decrypt data');
        }
    }
    /**
     * Store encrypted API credentials for a user
     */
    static async storeApiCredentials({ userId, exchange = 'poloniex', credentialName, apiKey, apiSecret, passphrase = null, permissions = { read: true, trade: false, withdraw: false } }) {
        try {
            // Encrypt sensitive data
            const apiKeyEncrypted = this.encrypt(apiKey);
            const apiSecretEncrypted = this.encrypt(apiSecret);
            const passphraseEncrypted = passphrase ? this.encrypt(passphrase) : null;
            const queryText = `
        INSERT INTO api_credentials (
          user_id, exchange, credential_name,
          api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, exchange, credential_name)
        DO UPDATE SET
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          api_secret_encrypted = EXCLUDED.api_secret_encrypted,
          passphrase_encrypted = EXCLUDED.passphrase_encrypted,
          updated_at = CURRENT_TIMESTAMP,
          is_active = EXCLUDED.is_active
        RETURNING id, credential_name, exchange, created_at, updated_at
      `;
            const params = [
                userId, exchange, credentialName,
                apiKeyEncrypted, apiSecretEncrypted, passphraseEncrypted,
                true
            ];
            const result = await query(queryText, params);
            if (result.rows.length === 0) {
                throw new Error('Failed to store API credentials');
            }
            // Log security event
            await this.logSecurityEvent({
                userId,
                eventType: 'api_credentials_stored',
                eventDescription: `API credentials stored for ${exchange}`,
                severity: 'info',
                metadata: { exchange, credentialName }
            });
            return result.rows[0];
        }
        catch (error) {
            logger.error('Error storing API credentials', { error: error.message });
            throw error;
        }
    }
    /**
     * Get API credentials for a user (with decryption)
     */
    static async getApiCredentials(userId, exchange = 'poloniex', credentialName = null) {
        try {
            let queryText = `
        SELECT
          id, user_id, exchange, credential_name,
          api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
          is_active, last_used_at, created_at, updated_at
        FROM api_credentials
        WHERE user_id = $1 AND exchange = $2 AND is_active = true
      `;
            const params = [userId, exchange];
            if (credentialName) {
                queryText += ' AND credential_name = $3';
                params.push(credentialName);
            }
            queryText += ' ORDER BY created_at DESC';
            const result = await query(queryText, params);
            if (result.rows.length === 0) {
                return null;
            }
            // Return only the first credential for security
            const credential = result.rows[0];
            // Decrypt sensitive data
            try {
                const decryptedCredential = {
                    id: credential.id,
                    userId: credential.user_id,
                    exchange: credential.exchange,
                    credentialName: credential.credential_name,
                    apiKey: this.decrypt(credential.api_key_encrypted),
                    apiSecret: this.decrypt(credential.api_secret_encrypted),
                    passphrase: credential.passphrase_encrypted ? this.decrypt(credential.passphrase_encrypted) : null,
                    isActive: credential.is_active,
                    lastUsedAt: credential.last_used_at,
                    createdAt: credential.created_at,
                    updatedAt: credential.updated_at
                };
                // Update last used timestamp
                await this.updateApiCredentialsLastUsed(credential.id);
                return decryptedCredential;
            }
            catch (decryptError) {
                logger.error('Failed to decrypt API credentials', {
                    userId,
                    exchange,
                    credentialName,
                    error: decryptError.message
                });
                // Log security event for failed decryption
                await this.logSecurityEvent({
                    userId,
                    eventType: 'api_credentials_decrypt_failed',
                    eventDescription: `Failed to decrypt API credentials for ${exchange}`,
                    severity: 'error',
                    metadata: { exchange, credentialName, error: decryptError.message }
                });
                throw new Error('Failed to decrypt API credentials. They may be corrupted.');
            }
        }
        catch (error) {
            logger.error('Error getting API credentials', { userId, error: error.message });
            throw error;
        }
    }
    /**
     * List API credentials for a user (without decryption - for UI display)
     */
    static async listApiCredentials(userId) {
        try {
            const queryText = `
        SELECT
          id, exchange, credential_name,
          is_active, last_used_at, created_at, updated_at
        FROM api_credentials
        WHERE user_id = $1
        ORDER BY exchange, credential_name
      `;
            const result = await query(queryText, [userId]);
            return result.rows;
        }
        catch (error) {
            logger.error('Error listing API credentials', { userId, error: error.message });
            throw error;
        }
    }
    /**
     * Update API credentials last used timestamp
     */
    static async updateApiCredentialsLastUsed(credentialId) {
        try {
            const queryText = `
        UPDATE api_credentials
        SET last_used_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
            await query(queryText, [credentialId]);
        }
        catch (error) {
            logger.error('Error updating API credentials last used', { credentialId, error: error.message });
            // Don't throw as this is non-critical
        }
    }
    /**
     * Delete API credentials
     */
    static async deleteApiCredentials(userId, credentialId) {
        try {
            const queryText = `
        DELETE FROM api_credentials
        WHERE id = $1 AND user_id = $2
        RETURNING exchange, credential_name
      `;
            const result = await query(queryText, [credentialId, userId]);
            if (result.rows.length === 0) {
                throw new Error('API credentials not found or access denied');
            }
            const deleted = result.rows[0];
            // Log security event
            await this.logSecurityEvent({
                userId,
                eventType: 'api_credentials_deleted',
                eventDescription: `API credentials deleted for ${deleted.exchange}`,
                severity: 'warning',
                metadata: { exchange: deleted.exchange, credentialName: deleted.credential_name }
            });
            return deleted;
        }
        catch (error) {
            logger.error('Error deleting API credentials', { userId, credentialId, error: error.message });
            throw error;
        }
    }
    /**
     * Test API credentials by making a simple API call
     */
    static async testApiCredentials(userId, credentialId) {
        try {
            // This is a placeholder - actual implementation would depend on the exchange API
            // For now, just verify the credentials exist and are decryptable
            const queryText = `
        SELECT id, exchange, credential_name
        FROM api_credentials
        WHERE id = $1 AND user_id = $2 AND is_active = true
      `;
            const result = await query(queryText, [credentialId, userId]);
            if (result.rows.length === 0) {
                throw new Error('API credentials not found');
            }
            // Try to decrypt the credentials to ensure they're valid
            const credentials = await this.getApiCredentials(userId, result.rows[0].exchange, result.rows[0].credential_name);
            if (!credentials) {
                throw new Error('Failed to decrypt API credentials');
            }
            // Log test event
            await this.logSecurityEvent({
                userId,
                eventType: 'api_credentials_tested',
                eventDescription: `API credentials tested for ${credentials.exchange}`,
                severity: 'info',
                metadata: { exchange: credentials.exchange, credentialName: credentials.credentialName }
            });
            return {
                success: true,
                exchange: credentials.exchange,
                credentialName: credentials.credentialName
            };
        }
        catch (error) {
            logger.error('Error testing API credentials', { userId, credentialId, error: error.message });
            // Log failed test
            await this.logSecurityEvent({
                userId,
                eventType: 'api_credentials_test_failed',
                eventDescription: `API credentials test failed`,
                severity: 'warning',
                metadata: { credentialId, error: error.message }
            });
            throw error;
        }
    }
}
export default UserService;
