import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, refreshAccessToken, clearAuthData } from './auth';

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: string | null) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

/**
 * Start background token refresh
 * Checks every 5 minutes if token needs refresh
 */
function startBackgroundTokenRefresh() {
  // Check immediately on startup
  const checkAndRefresh = async () => {
    const token = getAccessToken();
    if (!token) return;

    // Decode token to check expiry
    try {
      const parts = token.split('.');
      if (parts.length === 3 && parts[1]) {
        const payload = JSON.parse(atob(parts[1]));
        const expiresAt = payload.exp * 1000; // Convert to milliseconds
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        // Refresh if token expires in less than 10 minutes
        if (expiresAt - now < 10 * 60 * 1000) {
          // console.log('Background token refresh triggered');
          await refreshAccessToken();
        }
      }
    } catch (_error) {
      // console.error('Error checking token expiry:', error);
    }
  };

  // Check immediately
  checkAndRefresh();

  // Then check every 5 minutes
  setInterval(checkAndRefresh, 5 * 60 * 1000);
}

/**
 * Setup axios interceptors for automatic token refresh
 */
export function setupAxiosInterceptors() {
  // Start background refresh
  startBackgroundTokenRefresh();
  // Request interceptor - add auth token to requests
  axios.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = getAccessToken();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor - handle 401/403 and refresh token
  axios.interceptors.response.use(
    (response) => {
      return response;
    },
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      // If error is 401 or 403 and we haven't retried yet
      if ((error.response?.status === 401 || error.response?.status === 403) && !originalRequest._retry) {
        if (isRefreshing) {
          // If already refreshing, queue this request
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then(token => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              return axios(originalRequest);
            })
            .catch(err => {
              return Promise.reject(err);
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const newToken = await refreshAccessToken();
          
          if (newToken) {
            // Update the failed request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
            }
            
            // Process queued requests
            processQueue(null, newToken);
            
            // Retry original request
            return axios(originalRequest);
          } else {
            // Refresh failed, clear auth and redirect to login
            processQueue(new Error('Token refresh failed'), null);
            clearAuthData();
            
            // Redirect to login if not already there
            if (!window.location.pathname.includes('/login')) {
              window.location.href = '/login';
            }
            
            return Promise.reject(error);
          }
        } catch (refreshError) {
          processQueue(refreshError, null);
          clearAuthData();
          
          // Redirect to login
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
          
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    }
  );
}
