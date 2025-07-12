import bcrypt from 'bcryptjs';
import { query, transaction, geoQuery } from '../db/connection.js';

/**
 * User Service - PostGIS-based user management with location-aware features
 */
export class UserService {

  /**
   * Create a new user with location data
   */
  static async createUser({
    username,
    email,
    password,
    latitude,
    longitude,
    countryCode,
    timezone,
    role = 'trader'
  }) {
    try {
      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Create location point if coordinates provided
      const locationPoint = (latitude && longitude)
        ? geoQuery.createPoint(latitude, longitude)
        : null;

      const queryText = `
        INSERT INTO users (
          username, email, password_hash, role,
          registered_location, country_code, timezone
        ) VALUES ($1, $2, $3, $4, ${locationPoint || 'NULL'}, $5, $6)
        RETURNING id, username, email, role, country_code, timezone, created_at
      `;

      const params = [username, email, passwordHash, role, countryCode, timezone];
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
    } catch (error) {
      console.error('Error creating user:', error);
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
          ${geoQuery.getLatLon('u.registered_location')},
          gr.trading_allowed as jurisdiction_trading_allowed,
          gr.kyc_required as jurisdiction_kyc_required,
          gr.futures_allowed as jurisdiction_futures_allowed
        FROM users u
        LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
        WHERE (u.username = $1 OR u.email = $1) AND u.is_active = true
      `;

      const result = await query(queryText, [identifier]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding user:', error);
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
          ${geoQuery.getLatLon('u.registered_location')},
          gr.trading_allowed as jurisdiction_trading_allowed,
          gr.kyc_required as jurisdiction_kyc_required,
          gr.futures_allowed as jurisdiction_futures_allowed
        FROM users u
        LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
        WHERE u.id = $1 AND u.is_active = true
      `;

      const result = await query(queryText, [userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw error;
    }
  }

  /**
   * Verify user password
   */
  static async verifyPassword(user, password) {
    try {
      return await bcrypt.compare(password, user.password_hash);
    } catch (error) {
      console.error('Error verifying password:', error);
      return false;
    }
  }

  /**
   * Update user's last login time and location
   */
  static async updateLastLogin(userId, latitude, longitude) {
    try {
      const locationPoint = (latitude && longitude)
        ? geoQuery.createPoint(latitude, longitude)
        : null;

      const queryText = `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;

      await query(queryText, [userId]);

      // If location provided, we could update registered location or track it separately
      // For now, we'll just update the login time

    } catch (error) {
      console.error('Error updating last login:', error);
      throw error;
    }
  }

  /**
   * Create user session with location tracking
   */
  static async createSession({
    userId,
    refreshTokenHash,
    sessionToken,
    expiresAt,
    ipAddress,
    userAgent,
    latitude,
    longitude,
    deviceFingerprint,
    mfaVerified = false
  }) {
    try {
      const locationPoint = (latitude && longitude)
        ? geoQuery.createPoint(latitude, longitude)
        : null;

      // Check if location is suspicious
      let isSuspiciousLocation = false;
      if (locationPoint) {
        const suspiciousResult = await query(
          'SELECT is_suspicious_location($1, $2) as is_suspicious',
          [userId, locationPoint]
        );
        isSuspiciousLocation = suspiciousResult.rows[0]?.is_suspicious || false;
      }

      const queryText = `
        INSERT INTO login_sessions (
          user_id, refresh_token_hash, session_token, expires_at,
          login_location, ip_address, user_agent, device_fingerprint,
          is_suspicious_location, mfa_verified
        ) VALUES ($1, $2, $3, $4, ${locationPoint || 'NULL'}, $5, $6, $7, $8, $9)
        RETURNING id, is_suspicious_location
      `;

      const params = [
        userId, refreshTokenHash, sessionToken, expiresAt,
        ipAddress, userAgent, deviceFingerprint,
        isSuspiciousLocation, mfaVerified
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
    } catch (error) {
      console.error('Error creating session:', error);
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
          ${geoQuery.getLatLon('ls.login_location')},
          u.username, u.email, u.role, u.is_active as user_active
        FROM login_sessions ls
        JOIN users u ON ls.user_id = u.id
        WHERE ls.session_token = $1 AND ls.is_active = true
      `;

      const result = await query(queryText, [sessionToken]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding session:', error);
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
    } catch (error) {
      console.error('Error updating session access:', error);
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
    } catch (error) {
      console.error('Error invalidating session:', error);
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
      console.log(`Cleaned up ${result.rowCount} expired sessions`);
      return result.rowCount;
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
      throw error;
    }
  }

  /**
   * Log security event
   */
  static async logSecurityEvent({
    userId,
    sessionId,
    eventType,
    eventDescription,
    severity = 'info',
    ipAddress,
    userAgent,
    latitude,
    longitude,
    metadata = {}
  }) {
    try {
      const locationPoint = (latitude && longitude)
        ? geoQuery.createPoint(latitude, longitude)
        : null;

      const queryText = `
        INSERT INTO security_audit_log (
          user_id, session_id, event_type, event_description, severity,
          ip_address, user_agent, event_location, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, ${locationPoint || 'NULL'}, $8)
      `;

      const params = [
        userId, sessionId, eventType, eventDescription, severity,
        ipAddress, userAgent, JSON.stringify(metadata)
      ];

      await query(queryText, params);
    } catch (error) {
      console.error('Error logging security event:', error);
      // Don't throw here as security logging shouldn't break the main flow
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
    } catch (error) {
      console.error('Error creating user preferences:', error);
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
    } catch (error) {
      console.error('Error getting user preferences:', error);
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
          gr.trading_allowed, gr.futures_allowed, gr.kyc_required,
          gr.enhanced_kyc_required, gr.regulatory_framework
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
        jurisdiction: user.country_code,
        regulatory_framework: user.regulatory_framework
      };
    } catch (error) {
      console.error('Error checking jurisdiction compliance:', error);
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
    } catch (error) {
      console.error('Error getting login activity:', error);
      throw error;
    }
  }
}

export default UserService;
