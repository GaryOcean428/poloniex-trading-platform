import axios, { AxiosResponse } from 'axios';
import { getAccessToken, getRefreshToken, storeAuthData, clearAuthData, shouldRefreshToken } from '@/utils/auth';

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
      const response: AxiosResponse<LoginResponse> = await axios.post(
        `${API_BASE_URL}/api/auth/login`,
        credentials,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        // Store authentication data
        storeAuthData(response.data);
        return { success: true, data: response.data };
      }

      return { success: false, error: 'Login failed' };
    } catch (error: unknown) {
      // console.error('Login error:', error);
      
      if (error.response?.data) {
        return { 
          success: false, 
          error: error.response.data.error || 'Login failed',
          code: error.response.data.code
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
      // console.error('Token refresh error:', error);
      
      // If refresh fails, clear auth data and redirect to login
      if (error.response?.status === 403 || error.response?.status === 401) {
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

      return response.data.success;
    } catch (error) {
      // console.error('Token verification error:', error);
      return false;
    }
  }

  /**
   * Get current user data
   */
  getCurrentUser(): unknown | null {
    const userData = localStorage.getItem('user_data');
    if (!userData) return null;
    
    try {
      return JSON.parse(userData);
    } catch (error) {
      // console.error('Error parsing user data:', error);
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
        ...(data && { data })
      };

      const response = await axios(config);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      // console.error('Authenticated request error:', error);
      
      // If token is invalid, try to refresh once
      if (error.response?.status === 401 || error.response?.status === 403) {
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
              ...(data && { data })
            };

            const response = await axios(config);
            return { success: true, data: response.data };
          } catch (retryError: unknown) {
            // console.error('Retry request error:', retryError);
            return { 
              success: false, 
              error: retryError.response?.data?.error || 'Request failed'
            };
          }
        } else {
          return { success: false, error: 'Authentication failed' };
        }
      }
      
      return { 
        success: false, 
        error: error.response?.data?.error || 'Request failed'
      };
    }
  }
}

// Export singleton instance
export const authService = AuthService.getInstance();