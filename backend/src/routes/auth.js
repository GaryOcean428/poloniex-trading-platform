import express from 'express';
import bcrypt from 'bcryptjs';
import { generateToken, generateRefreshToken, verifyToken } from '../middleware/auth.js';

const router = express.Router();

// In-memory user store for demo purposes
// In production, this would be a database
const users = new Map([
  ['demo', {
    id: '1',
    username: 'demo',
    email: 'demo@poloniex.com',
    password: '$2b$10$RCUYLGMFvkS6jmki5Q3duOqATZEOAS5je/FQu9vATYBfb3MMGEyUG', // 'password' hashed
    role: 'trader',
    apiKey: '',
    isActive: true,
    createdAt: new Date().toISOString()
  }],
  ['trader', {
    id: '2', 
    username: 'trader',
    email: 'trader@poloniex.com',
    password: '$2b$10$RCUYLGMFvkS6jmki5Q3duOqATZEOAS5je/FQu9vATYBfb3MMGEyUG', // 'password' hashed
    role: 'trader',
    apiKey: '',
    isActive: true,
    createdAt: new Date().toISOString()
  }]
]);

// Store for refresh tokens (in production, use Redis or database)
const refreshTokens = new Set();

/**
 * POST /api/auth/login
 * Authenticate user and return JWT tokens
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

    // Find user
    const user = users.get(username.toLowerCase());
    if (!user) {
      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        error: 'Account is disabled',
        code: 'ACCOUNT_DISABLED'
      });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
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

    // Store refresh token
    refreshTokens.add(refreshToken);

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
        role: user.role
      }
    });

    console.log(`User ${username} logged in successfully`);
  } catch (error) {
    console.error('Login error:', error);
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
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        error: 'Refresh token required',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // Check if refresh token exists in store
    if (!refreshTokens.has(refreshToken)) {
      return res.status(403).json({
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken);
    if (!decoded) {
      refreshTokens.delete(refreshToken);
      return res.status(403).json({
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

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

    console.log(`Token refreshed for user ${decoded.username}`);
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/auth/logout
 * Invalidate refresh token
 */
router.post('/logout', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      refreshTokens.delete(refreshToken);
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

    console.log('User logged out');
  } catch (error) {
    console.error('Logout error:', error);
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
router.get('/verify', (req, res) => {
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

    res.json({
      success: true,
      user: {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email,
        role: decoded.role
      },
      tokenValid: true
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/auth/user
 * Get current user profile (requires authentication)
 */
router.get('/user', (req, res) => {
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
    const user = users.get(decoded.username.toLowerCase());
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
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

export default router;