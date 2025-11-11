/**
 * Centralized Token Helper Utility
 * 
 * This module provides a single source of truth for authentication token management,
 * preventing localStorage key mismatches that cause auth persistence failures.
 * 
 * Standard Keys (matching auth.ts):
 * - 'access_token' - JWT access token (primary)
 * - 'refresh_token' - JWT refresh token
 * - 'auth_token' - Legacy key (backward compatibility)
 * - 'auth_expiry' - Token expiration timestamp
 * - 'user_data' - Serialized user profile
 * 
 * @module tokenHelper
 */

/**
 * Get access token using correct storage keys
 * Checks both 'access_token' (JWT) and 'auth_token' (legacy) for backward compatibility
 * 
 * @returns {string | null} Access token or null if not found
 */
export function getToken(): string | null {
  return localStorage.getItem('access_token') || localStorage.getItem('auth_token');
}

/**
 * Get refresh token
 * 
 * @returns {string | null} Refresh token or null if not found
 */
export function getRefreshToken(): string | null {
  return localStorage.getItem('refresh_token');
}

/**
 * Get authorization header value
 * 
 * @returns {string | null} Bearer token header or null if no token available
 */
export function getAuthHeader(): string | null {
  const token = getToken();
  return token ? `Bearer ${token}` : null;
}

/**
 * Check if user has valid token (doesn't validate expiry)
 * 
 * @returns {boolean} True if token exists in storage
 */
export function hasToken(): boolean {
  return !!getToken();
}

/**
 * Check if token is expired
 * 
 * @returns {boolean} True if token is expired or expiry not found
 */
export function isTokenExpired(): boolean {
  const expiry = localStorage.getItem('auth_expiry');
  if (!expiry) return true;
  
  const expiryTime = parseInt(expiry, 10);
  return Date.now() > expiryTime;
}

/**
 * Check if token needs refresh (expires in less than 5 minutes)
 * 
 * @returns {boolean} True if token expires within 5 minutes
 */
export function shouldRefreshToken(): boolean {
  const expiry = localStorage.getItem('auth_expiry');
  if (!expiry) return false;
  
  const expiryTime = parseInt(expiry, 10);
  const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  return Date.now() > (expiryTime - fiveMinutes);
}

/**
 * Store token with correct key
 * Internal use only - prefer using storeAuthData from auth.ts
 * 
 * @param {string} token - Access token to store
 */
export function storeToken(token: string): void {
  localStorage.setItem('access_token', token);
}

/**
 * Clear all authentication data
 * Internal use only - prefer using clearAuthData from auth.ts
 */
export function clearTokens(): void {
  localStorage.removeItem('auth_token'); // Legacy
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('auth_expiry');
  localStorage.removeItem('user_data');
}
