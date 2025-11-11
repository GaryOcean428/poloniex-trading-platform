import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://polytrade-be.up.railway.app';

export interface ApiCredentials {
  id: string;
  exchange: string;
  apiKey: string;
  apiSecret: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * Fetch the user's active API credentials (decrypted)
 * Requires authentication token
 */
export const getActiveCredentials = async (): Promise<ApiCredentials | null> => {
  try {
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');

    if (!token) {
      console.warn('No authentication token found');
      return null;
    }

    const response = await axios.get(`${API_URL}/api/keys/active`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.apiKey && response.data.apiSecret) {
      return response.data;
    }

    return null;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.warn('No active API credentials found');
      return null;
    }
    
    console.error('Error fetching API credentials:', error.message);
    throw error;
  }
};

/**
 * Check if user has active API credentials
 */
export const hasActiveCredentials = async (): Promise<boolean> => {
  try {
    const credentials = await getActiveCredentials();
    return credentials !== null;
  } catch (error) {
    return false;
  }
};

/**
 * Get API credentials with caching (5 minute cache)
 */
let cachedCredentials: ApiCredentials | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const getCachedCredentials = async (): Promise<ApiCredentials | null> => {
  const now = Date.now();
  
  if (cachedCredentials && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedCredentials;
  }

  cachedCredentials = await getActiveCredentials();
  cacheTimestamp = now;
  
  return cachedCredentials;
};

/**
 * Clear credentials cache (call after logout or credential changes)
 */
export const clearCredentialsCache = (): void => {
  cachedCredentials = null;
  cacheTimestamp = 0;
};

export default {
  getActiveCredentials,
  hasActiveCredentials,
  getCachedCredentials,
  clearCredentialsCache
};
