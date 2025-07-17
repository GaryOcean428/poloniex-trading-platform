import crypto from 'crypto';
import express from 'express';
import { generateRefreshToken, generateToken, verifyToken } from '../middleware/auth.js';
import { UserService } from '../services/userService.js';

const router = express.Router();

// Helper function to get client IP
const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null);
};

// Helper function to generate session token
const generateSessionToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Helper function to hash refresh token
const hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Helper function to extract geolocation from request
const extractLocation = (req) => {
  // In production, you would use a proper geolocation service
  // For now, return null - location can be added by frontend
  const lat = req.headers['x-latitude'];
  const lon = req.headers['x-longitude'];

  if (lat && lon) {
    return {
      latitude: parseFloat(lat),
      longitude: parseFloat(lon)
    };
  }

  return { latitude: null, longitude: null };
};

/**
 * POST /api/auth/login
 * Authenticate user and return JWT tokens with location tracking
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    // Find user in database
    const user = await UserService.findUser(username);
    if (!user) {
      await UserService.logSecurityEvent({
        eventType: 'login_failed',
        eventDescription: `Failed login attempt for username: ${username}`,
        severity: 'warning',
        ipAddress: getClientIP(req),
        userAgent: req.headers['user-agent']
      });

      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      await UserService.logSecurityEvent({
        userId: user.id,
        eventType: 'login_blocked',
        eventDescription: `Login attempt for disabled account: ${username}`,
        severity: 'warning',
        ipAddress: getClientIP(req),
        userAgent: req.headers['user-agent']
      });

      return res.status(401).json({
        error: 'Account is disabled',
        code: 'ACCOUNT_DISABLED'
      });
    }

    // Verify password
    const passwordValid = await UserService.verifyPassword(user, password);
    if (!passwordValid) {
      await UserService.logSecurityEvent({
        userId: user.id,
        eventType: 'login_failed',
        eventDescription: `Invalid password for user: ${username}`,
        severity: 'warning',
        ipAddress: getClientIP(req),
        userAgent: req.headers['user-agent']
      });

      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check jurisdiction compliance
    const compliance = await UserService.checkJurisdictionCompliance(user.id);
    if (!compliance.compliant) {
      await UserService.logSecurityEvent({
        userId: user.id,
        eventType: 'compliance_violation',
        eventDescription: `Login blocked due to compliance: ${compliance.reason}`,
        severity: 'error',
        ipAddress: getClientIP(req),
        userAgent: req.headers['user-agent']
      });

      return res.status(403).json({
        error: compliance.reason,
        code: 'COMPLIANCE_VIOLATION',
        jurisdiction: compliance.jurisdiction
      });
    }

    // Generate tokens
    const tokenPayload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };

    const accessToken = generateToken(tokenPayload, '1h');
    const refreshToken = generateRefreshToken(tokenPayload);
    const sessionToken = generateSessionToken();

    // Get location data
    const { latitude, longitude } = extractLocation(req);

    // Create session in database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const session = await UserService.createSession({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      sessionToken,
      expiresAt,
      ipAddress: getClientIP(req),
      userAgent: req.headers['user-agent'],
      latitude,
      longitude,
      deviceFingerprint: req.headers['x-device-fingerprint'] || null,
      mfaVerified: false // TODO: Implement MFA
    });

    // Update user's last login
    await UserService.updateLastLogin(user.id, latitude, longitude);

    // Return tokens and user info
    res.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: 3600, // 1 hour in seconds
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        country_code: user.country_code,
        timezone: user.timezone,
        kyc_status: user.kyc_status,
        trading_enabled: user.trading_enabled && user.jurisdiction_trading_allowed,
        suspicious_location: session.is_suspicious_location
      }
    });

    console.log(`✅ User ${username} logged in successfully${session.is_suspicious_location ? ' (suspicious location detected)' : ''}`);
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        error: 'Refresh token required',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken);
    if (!decoded) {
      return res.status(403).json({
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Find session by hashed refresh token
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const sessions = await UserService.findSessionByToken(refreshTokenHash);

    if (!sessions || !sessions.user_active) {
      return res.status(403).json({
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Check if session is expired
    if (new Date() > new Date(sessions.expires_at)) {
      await UserService.invalidateSession(sessions.id, 'expired');
      return res.status(403).json({
        error: 'Refresh token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Update session access time
    await UserService.updateSessionAccess(sessions.id);

    // Generate new access token
    const tokenPayload = {
      id: decoded.id,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role
    };

    const accessToken = generateToken(tokenPayload, '1h');

    res.json({
      success: true,
      accessToken,
      expiresIn: 3600
    });

    console.log(`✅ Token refreshed for user ${decoded.username}`);
  } catch (error) {
    console.error('❌ Token refresh error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/auth/logout
 * Invalidate refresh token and session
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const authHeader = req.headers['authorization'];
    const accessToken = authHeader && authHeader.split(' ')[1];

    if (refreshToken) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const session = await UserService.findSessionByToken(refreshTokenHash);

      if (session) {
        await UserService.invalidateSession(session.id, 'logout');

        await UserService.logSecurityEvent({
          userId: session.user_id,
          sessionId: session.id,
          eventType: 'logout',
          eventDescription: 'User logged out successfully',
          severity: 'info',
          ipAddress: getClientIP(req),
          userAgent: req.headers['user-agent']
        });
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

    console.log('✅ User logged out');
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/auth/verify
 * Verify current token and return user info
 */
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'No token provided',
        code: 'NO_TOKEN'
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(403).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // Get fresh user data from database
    const user = await UserService.findUserById(decoded.id);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        country_code: user.country_code,
        timezone: user.timezone,
        kyc_status: user.kyc_status,
        trading_enabled: user.trading_enabled && user.jurisdiction_trading_allowed
      },
      tokenValid: true
    });
  } catch (error) {
    console.error('❌ Token verification error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/auth/user
 * Get current user profile with preferences (requires authentication)
 */
router.get('/user', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'No token provided',
        code: 'NO_TOKEN'
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(403).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // Get fresh user data
    const user = await UserService.findUserById(decoded.id);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Get user preferences
    const preferences = await UserService.getUserPreferences(user.id);

    // Get recent login activity
    const loginActivity = await UserService.getRecentLoginActivity(user.id, 5);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        country_code: user.country_code,
        timezone: user.timezone,
        is_verified: user.is_verified,
        kyc_status: user.kyc_status,
        trading_enabled: user.trading_enabled && user.jurisdiction_trading_allowed,
        risk_level: user.risk_level,
        last_login_at: user.last_login_at,
        created_at: user.created_at,
        latitude: user.latitude,
        longitude: user.longitude,
        jurisdiction: {
          trading_allowed: user.jurisdiction_trading_allowed,
          kyc_required: user.jurisdiction_kyc_required,
          futures_allowed: user.jurisdiction_futures_allowed
        }
      },
      preferences,
      recent_activity: loginActivity
    });
  } catch (error) {
    console.error('❌ Get user error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/auth/register
 * Register a new user (for future use)
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, countryCode, timezone } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        error: 'Username, email, and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Check if user already exists
    const existingUser = await UserService.findUser(username);
    if (existingUser) {
      return res.status(409).json({
        error: 'Username already exists',
        code: 'USER_EXISTS'
      });
    }

    // Get location data
    const { latitude, longitude } = extractLocation(req);

    // Create user
    const user = await UserService.createUser({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      latitude,
      longitude,
      countryCode: countryCode || 'US',
      timezone: timezone || 'UTC',
      role: 'trader'
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });

    console.log(`✅ New user registered: ${username}`);
  } catch (error) {
    console.error('❌ Registration error:', error);

    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({
        error: 'Username or email already exists',
        code: 'USER_EXISTS'
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

export default router;
