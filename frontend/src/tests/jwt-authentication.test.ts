import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from '@/services/authService';
import { 
  storeAuthData, 
  clearAuthData, 
  isAuthenticated, 
  getAccessToken, 
  getRefreshToken,
  getUserData,
  shouldRefreshToken
} from '@/utils/auth';

// Mock axios
vi.mock('axios', () => ({
  default: vi.fn(),
  post: vi.fn(),
  get: vi.fn()
}));

describe('JWT Authentication System', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    clearAuthData();
    vi.clearAllMocks();
  });

  describe('Auth Utilities', () => {
    it('should store and retrieve auth data correctly', () => {
      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };

      storeAuthData(mockAuthData);

      expect(getAccessToken()).toBe('mock-access-token');
      expect(getRefreshToken()).toBe('mock-refresh-token');
      expect(getUserData()).toEqual(mockAuthData.user);
      expect(isAuthenticated()).toBe(true);
    });

    it('should detect expired tokens', () => {
      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: -1, // Expired 1 second ago
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };

      storeAuthData(mockAuthData);

      // Should clear expired token and return false
      expect(isAuthenticated()).toBe(false);
      expect(getAccessToken()).toBe(null);
    });

    it('should detect when token needs refresh', () => {
      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 240, // 4 minutes (less than 5 minute threshold)
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };

      storeAuthData(mockAuthData);

      expect(shouldRefreshToken()).toBe(true);
    });

    it('should clear auth data completely', () => {
      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };

      storeAuthData(mockAuthData);
      expect(isAuthenticated()).toBe(true);

      clearAuthData();
      expect(isAuthenticated()).toBe(false);
      expect(getAccessToken()).toBe(null);
      expect(getRefreshToken()).toBe(null);
      expect(getUserData()).toBe(null);
    });
  });

  describe('AuthService', () => {
    it('should handle successful login', async () => {
      const mockResponse = {
        data: {
          success: true,
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 3600,
          user: {
            id: '1',
            username: 'demo',
            email: 'demo@poloniex.com',
            role: 'trader'
          }
        }
      };

      const axios = await import('axios');
      (axios.default.post as any) = vi.fn().mockResolvedValue(mockResponse);

      const result = await authService.login({
        username: 'demo',
        password: 'password'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(isAuthenticated()).toBe(true);
    });

    it('should handle login failure', async () => {
      const mockError = {
        response: {
          data: {
            error: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS'
          }
        }
      };

      const axios = await import('axios');
      (axios.default.post as any) = vi.fn().mockRejectedValue(mockError);

      const result = await authService.login({
        username: 'wrong',
        password: 'wrong'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
      expect(result.code).toBe('INVALID_CREDENTIALS');
      expect(isAuthenticated()).toBe(false);
    });

    it('should handle token verification', async () => {
      // Set up a mock token
      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };
      storeAuthData(mockAuthData);

      const mockResponse = {
        data: {
          success: true
        }
      };

      const axios = await import('axios');
      (axios.default.get as any) = vi.fn().mockResolvedValue(mockResponse);

      const isValid = await authService.verifyToken();

      expect(isValid).toBe(true);
      expect(axios.default.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/verify'),
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer mock-access-token'
          }
        })
      );
    });

    it('should handle token refresh', async () => {
      // Set up existing auth data
      const mockAuthData = {
        accessToken: 'old-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };
      storeAuthData(mockAuthData);

      const mockResponse = {
        data: {
          success: true,
          accessToken: 'new-access-token',
          expiresIn: 3600
        }
      };

      const axios = await import('axios');
      (axios.default.post as any) = vi.fn().mockResolvedValue(mockResponse);

      const newToken = await authService.refreshToken();

      expect(newToken).toBe('new-access-token');
      expect(getAccessToken()).toBe('new-access-token');
    });

    it('should get current user data', () => {
      const mockUser = {
        id: '1',
        username: 'demo',
        email: 'demo@poloniex.com',
        role: 'trader'
      };

      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: mockUser
      };
      storeAuthData(mockAuthData);

      const currentUser = authService.getCurrentUser();
      expect(currentUser).toEqual(mockUser);
    });
  });

  describe('Token Security', () => {
    it('should store tokens securely in localStorage', () => {
      const mockAuthData = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          id: '1',
          username: 'demo',
          email: 'demo@poloniex.com',
          role: 'trader'
        }
      };

      storeAuthData(mockAuthData);

      // Verify tokens are stored
      expect(localStorage.getItem('access_token')).toBe('mock-access-token');
      expect(localStorage.getItem('refresh_token')).toBe('mock-refresh-token');
      expect(localStorage.getItem('user_data')).toBe(JSON.stringify(mockAuthData.user));
      expect(localStorage.getItem('auth_expiry')).toBeTruthy();
    });

    it('should handle malformed token data gracefully', () => {
      // Set malformed user data
      localStorage.setItem('user_data', 'invalid-json');

      expect(getUserData()).toBe(null);
    });
  });
});