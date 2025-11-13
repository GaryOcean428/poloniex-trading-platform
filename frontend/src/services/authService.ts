import axios, { AxiosError, AxiosResponse } from 'axios';
import { getAccessToken, getRefreshToken, storeAuthData, clearAuthData, shouldRefreshToken } from '@/utils/auth';
import { auditLogger, AuditEventType } from '@/utils/auditLogger';

// Get the backend URL from environment
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ||
                     import.meta.env.VITE_API_URL ||
                     'http://localhost:3000';

interface LoginCredentials {
  username: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}

interface RefreshResponse {
  success: boolean;
  accessToken: string;
  expiresIn: number;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

type User = LoginResponse['user'];

function isUser(value: unknown): value is User {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    'username' in value &&
    'email' in value &&
    'role' in value
  );
}

// Local, safe Axios error type guard for tests and runtime
function isAxiosError(error: unknown): error is AxiosError {
  return typeof error === 'object' && error !== null && (error as any).isAxiosError === true;
}

// Handle mocked errors that look like Axios errors but lack isAxiosError flag
function hasAxiosLikeResponse(error: unknown): error is { response: { data?: any; status?: number } } {
  return typeof error === 'object' && error !== null && 'response' in (error as any);
}

/**
 * Auth Service for JWT authentication
 */
export class AuthService {
  private static instance: AuthService;
  private refreshPromise: Promise<string | null> | null = null;

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Login with username and password
   */
  async login(credentials: LoginCredentials): Promise<ApiResponse<LoginResponse>> {
    try {
      const response: AxiosResponse<any> = await axios.post(
        `${API_BASE_URL}/api/auth/login`,
        credentials,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // Backend may return { success, accessToken, refreshToken, expiresIn, user }
      if (response.data?.success) {
        storeAuthData(response.data as LoginResponse);
        // Audit log successful login
        await auditLogger.logAuth(AuditEventType.LOGIN_SUCCESS, {
          username: credentials.username,
          userId: response.data.user?.id
        });
        return { success: true, data: response.data as LoginResponse };
      }

      // Fallback to backend shape { token, user }
      if (response.data?.token && response.data?.user) {
        const mapped: LoginResponse = {
          success: true,
          accessToken: response.data.token,
          // Backend does not currently issue refresh tokens; store empty and rely on access token
          refreshToken: '',
          // Align with backend default of 30 minutes if configured; otherwise a safe default (30 min)
          expiresIn: 30 * 60,
          user: {
            id: String(response.data.user.id ?? ''),
            username: String(response.data.user.username ?? response.data.user.name ?? ''),
            email: String(response.data.user.email ?? ''),
            role: String(response.data.user.role ?? 'trader')
          }
        };
        storeAuthData(mapped);
        // Audit log successful login
        await auditLogger.logAuth(AuditEventType.LOGIN_SUCCESS, {
          username: credentials.username,
          userId: mapped.user.id
        });
        return { success: true, data: mapped };
      }

      // Audit log failed login
      await auditLogger.logAuth(AuditEventType.LOGIN_FAILURE, {
        username: credentials.username,
        reason: 'Invalid response format'
      });
      return { success: false, error: 'Login failed' };
    } catch (error: unknown) {
      if ((isAxiosError(error) || hasAxiosLikeResponse(error)) && (error as any).response?.data) {
        return {
          success: false,
          error: ((error as any).response.data as any).error || 'Login failed',
          code: ((error as any).response.data as any).code
        };
      }

      return { success: false, error: 'Network error occurred' };
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<string | null> {
    // Prevent multiple simultaneous refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._refreshToken();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  private async _refreshToken(): Promise<string | null> {
    try {
      const refreshToken = getRefreshToken();

      if (!refreshToken) {
        // console.warn('No refresh token available');
        return null;
      }

      const response: AxiosResponse<RefreshResponse> = await axios.post(
        `${API_BASE_URL}/api/auth/refresh`,
        { refreshToken },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        // Update access token
        const currentUser = this.getCurrentUser();
        if (currentUser) {
          storeAuthData({
            accessToken: response.data.accessToken,
            refreshToken: refreshToken,
            expiresIn: response.data.expiresIn,
            user: currentUser
          });
        }

        return response.data.accessToken;
      }

      return null;
    } catch (error: unknown) {
      // If refresh fails, clear auth data and redirect to login
      if (isAxiosError(error) && (error.response?.status === 403 || error.response?.status === 401)) {
        this.logout();
      }

      return null;
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      // Audit log logout before clearing data
      await auditLogger.logAuth(AuditEventType.LOGOUT, {});
      
      const refreshToken = getRefreshToken();

      if (refreshToken) {
        // Notify server to invalidate refresh token
        await axios.post(
          `${API_BASE_URL}/api/auth/logout`,
          { refreshToken },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }
    } catch (error) {
      // console.error('Logout error:', error);
    } finally {
      // Always clear local auth data
      clearAuthData();
    }
  }

  /**
   * Verify current token
   */
  async verifyToken(): Promise<boolean> {
    try {
      const token = getAccessToken();

      if (!token) {
        return false;
      }

      const response = await axios.get(
        `${API_BASE_URL}/api/auth/verify`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      return !!response.data?.success;
    } catch (error) {
      // If verify endpoint is not implemented on the backend, treat as valid to avoid false logouts
      if (isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404 || status === 405 || status === 501) {
          return true;
        }
      }
      return false;
    }
  }

  /**
   * Get current user data
   */
  getCurrentUser(): User | null {
    const userData = localStorage.getItem('user_data');
    if (!userData) return null;

    try {
      const parsed = JSON.parse(userData) as unknown;
      return isUser(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Make authenticated request with automatic token refresh
   */
  async authenticatedRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: unknown
  ): Promise<ApiResponse<T>> {
    try {
      let token = getAccessToken();

      // Check if we need to refresh the token
      if (shouldRefreshToken()) {
        // console.log('Token needs refresh, refreshing...');
        const newToken = await this.refreshToken();
        if (newToken) {
          token = newToken;
        } else {
          return { success: false, error: 'Authentication failed' };
        }
      }

      if (!token) {
        return { success: false, error: 'No authentication token' };
      }

      const config = {
        method,
        url: `${API_BASE_URL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        ...(data !== undefined ? { data } : {})
      };

      const response = await axios(config);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      // console.error('Authenticated request error:', error);

      // If token is invalid, try to refresh once
      if (isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
        const newToken = await this.refreshToken();
        if (newToken) {
          // Retry the request with new token
          try {
            const config = {
              method,
              url: `${API_BASE_URL}${endpoint}`,
              headers: {
                'Authorization': `Bearer ${newToken}`,
                'Content-Type': 'application/json'
              },
              ...(data !== undefined ? { data } : {})
            };

            const response = await axios(config);
            return { success: true, data: response.data };
          } catch (retryError: unknown) {
            // console.error('Retry request error:', retryError);
            return {
              success: false,
              error: (isAxiosError(retryError) ? ((retryError.response?.data as any)?.error) : undefined) || 'Request failed'
            };
          }
        } else {
          return { success: false, error: 'Authentication failed' };
        }
      }

      return {
        success: false,
        error: (isAxiosError(error) ? ((error.response?.data as any)?.error) : undefined) || 'Request failed'
      };
    }
  }
}

// Export singleton instance
export const authService = AuthService.getInstance();
