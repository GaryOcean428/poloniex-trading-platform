import CryptoJS from 'crypto-js';

interface SignatureParams {
  method: string;
  path: string;
  body?: Record<string, unknown> | string;
  queryString?: string;
  timestamp: number;
  secret: string;
}

interface AuthData {
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

/**
 * Generate HMAC-SHA256 signature for API authentication
 */
export function generateSignature({
  method,
  path,
  body,
  queryString,
  timestamp,
  secret
}: SignatureParams): string {
  // Create the string to sign
  let signString = `${method}\n${path}`;
  
  if (queryString) {
    signString += `?${queryString}`;
  }
  
  signString += `\nsignTimestamp=${timestamp}`;
  
  if (body) {
    signString += `\n${JSON.stringify(body)}`;
  }
  
  // Create HMAC SHA256 signature
  const signature = CryptoJS.HmacSHA256(signString, secret).toString(CryptoJS.enc.Hex);
  
  return signature;
}

/**
 * Generate authentication headers for API requests
 */
export function generateAuthHeaders(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  body?: Record<string, unknown> | string,
  queryString?: string
): Record<string, string> {
  const timestamp = Date.now();
  
  const signature = generateSignature({
    method,
    path,
    body,
    queryString,
    timestamp,
    secret: apiSecret
  });
  
  return {
    'API-Key': apiKey,
    'API-Sign': signature,
    'API-Timestamp': timestamp.toString(),
    'Content-Type': 'application/json'
  };
}

/**
 * Verify if a user is authenticated with JWT
 */
export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (!token) {
    return false;
  }
  
  // Check if token is expired
  const expiry = localStorage.getItem('auth_expiry');
  if (expiry) {
    const expiryTime = parseInt(expiry, 10);
    if (Date.now() > expiryTime) {
      // Clear expired token
      clearAuthData();
      return false;
    }
  }
  
  return true;
}

/**
 * Store authentication data from JWT login response
 */
export function storeAuthData(authData: AuthData): void {
  const expiryTime = Date.now() + authData.expiresIn * 1000;
  
  localStorage.setItem('access_token', authData.accessToken);
  localStorage.setItem('refresh_token', authData.refreshToken);
  localStorage.setItem('auth_expiry', expiryTime.toString());
  localStorage.setItem('user_data', JSON.stringify(authData.user));
}

/**
 * Store authentication data (legacy method for backward compatibility)
 */
export function storeAuthDataLegacy(token: string, expiresIn: number): void {
  const expiryTime = Date.now() + expiresIn * 1000;
  localStorage.setItem('auth_token', token);
  localStorage.setItem('access_token', token);
  localStorage.setItem('auth_expiry', expiryTime.toString());
}

/**
 * Clear authentication data
 */
export function clearAuthData(): void {
  localStorage.removeItem('auth_token'); // Legacy
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('auth_expiry');
  localStorage.removeItem('user_data');
}

/**
 * Get access token with sessionStorage fallback
 * Used by all services for consistent token retrieval
 */
export function getAccessToken(): string | null {
  return localStorage.getItem('access_token') ||
         localStorage.getItem('auth_token') ||
         sessionStorage.getItem('token');
}

/**
 * Get refresh token
 */
export function getRefreshToken(): string | null {
  return localStorage.getItem('refresh_token');
}

/**
 * Get access token (alias for service compatibility)
 * @deprecated Use getAccessToken() instead
 */
export const getAuthToken = getAccessToken;

/**
 * Get stored user data
 */
export function getUserData(): unknown | null {
  const userData = localStorage.getItem('user_data');
  if (!userData) return null;
  
  try {
    return JSON.parse(userData);
  } catch (_error) {
    // console.error('Error parsing user data:', error);
    return null;
  }
}



/**
 * Get authorization header value
 */
export function getAuthHeader(): string | null {
  const token = getAccessToken();
  return token ? `Bearer ${token}` : null;
}

/**
 * Check if token needs refresh (expires in less than 5 minutes)
 */
export function shouldRefreshToken(): boolean {
  const expiry = localStorage.getItem('auth_expiry');
  if (!expiry) return false;
  
  const expiryTime = parseInt(expiry, 10);
  const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  return Date.now() > (expiryTime - fiveMinutes);
}

/**
 * Decode JWT payload (without verification - for display purposes only)
 */
export function decodeJWTPayload(token: string): unknown | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch (_error) {
    // console.error('Error decoding JWT:', error);
    return null;
  }
}

/**
 * Refresh access token using refresh token
 * Returns new access token or null if refresh fails
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    // console.warn('No refresh token available');
    return null;
  }

  try {
    // Get backend URL from environment or use default
    const backendUrl = import.meta.env.VITE_API_BASE_URL || 
      (window.location.hostname.includes('railway.app') 
        ? 'https://polytrade-be.up.railway.app'
        : 'http://localhost:3000');

    const response = await fetch(`${backendUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // console.warn('Token refresh failed:', response.status);
      // Clear auth data if refresh fails
      clearAuthData();
      return null;
    }

    const data = await response.json();
    
    if (data.success && data.accessToken) {
      // Store new tokens
      localStorage.setItem('access_token', data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem('refresh_token', data.refreshToken);
      }
      if (data.expiresIn) {
        const expiryTime = Date.now() + data.expiresIn * 1000;
        localStorage.setItem('auth_expiry', expiryTime.toString());
      }
      
      // console.log('Token refreshed successfully');
      return data.accessToken;
    }

    return null;
  } catch (_error) {
    // console.error('Error refreshing token:', error);
    return null;
  }
}

/**
 * Get access token with automatic refresh if needed
 * This should be used by all API calls
 */
export async function getAccessTokenWithRefresh(): Promise<string | null> {
  const currentToken = getAccessToken();
  
  if (!currentToken) {
    return null;
  }

  // Check if token needs refresh
  if (shouldRefreshToken()) {
    // console.log('Token expiring soon, refreshing...');
    const newToken = await refreshAccessToken();
    return newToken || currentToken; // Return new token or fallback to current
  }

  return currentToken;
}
