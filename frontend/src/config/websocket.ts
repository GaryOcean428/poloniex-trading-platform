/**
 * WebSocket Configuration
 *
 * Provides environment-aware WebSocket URL resolution with proper fallbacks
 * for Railway deployment and local development.
 */

import { getEnvVariable } from '@/utils/environment';
import { getBackendUrl } from '@/utils/environment';

export interface WebSocketConfig {
  url: string;
  options: {
    transports: string[];
    timeout: number;
    reconnection: boolean;
    reconnectionAttempts: number;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    randomizationFactor: number;
    forceNew: boolean;
    upgrade: boolean;
    rememberUpgrade: boolean;
  };
}

/**
 * Get WebSocket URL with proper environment variable resolution
 */
export const getWebSocketUrl = (): string => {
  // Priority 1: Explicit WebSocket URL
  const explicitWsUrl = getEnvVariable('VITE_WS_URL');
  if (explicitWsUrl) return explicitWsUrl;

  // Priority 2: Derive from backend URL (handles Railway domains correctly)
  const backendUrl = getBackendUrl();
  if (backendUrl) {
    if (backendUrl.startsWith('https://')) return backendUrl.replace('https://', 'wss://');
    if (backendUrl.startsWith('http://')) return backendUrl.replace('http://', 'ws://');
    return backendUrl;
  }

  // Priority 3: Railway/public domain hints
  const railwayPublicDomain = getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN');
  if (railwayPublicDomain) return `wss://${railwayPublicDomain}`;
  const railwayPrivateDomain = getEnvVariable('VITE_RAILWAY_PRIVATE_DOMAIN');
  if (railwayPrivateDomain) return `wss://${railwayPrivateDomain}`;

  // Priority 4: Environment detection
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:8765`;
    }

    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      // As a last resort, same-origin; backend proxy must exist for /socket.io
      return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}`;
    }

    if (hostname.includes('webcontainer-api.io')) {
      return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:8765`;
    }
  }

  // Final fallback
  return 'ws://localhost:8765';
};

/**
 * Get WebSocket connection configuration
 */
export const getWebSocketConfig = (): WebSocketConfig => {
  const url = getWebSocketUrl();

  return {
    url,
    options: {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      // Ensure proper protocol handling for Railway deployment
      forceNew: true,
      upgrade: true,
      rememberUpgrade: false,
    },
  };
};

/**
 * Validate WebSocket URL format
 */
export const validateWebSocketUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
};

/**
 * Get environment-specific connection strategy
 */
export const getConnectionStrategy = (): {
  usePolling: boolean;
  preferWebSocket: boolean;
  maxRetries: number;
} => {
  const isProduction = import.meta.env.PROD;
  const isRailway = getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN') !== '';

  if (isProduction && isRailway) {
    return {
      usePolling: true, // Railway works better with polling fallback
      preferWebSocket: true,
      maxRetries: 3,
    };
  }

  return {
    usePolling: false,
    preferWebSocket: true,
    maxRetries: 5,
  };
};

/**
 * Debug information for WebSocket configuration
 */
export const getWebSocketDebugInfo = () => {
  const config = getWebSocketConfig();
  const strategy = getConnectionStrategy();

  return {
    url: config.url,
    isValidUrl: validateWebSocketUrl(config.url),
    environment: {
      isDev: import.meta.env.DEV,
      isProd: import.meta.env.PROD,
      isRailway: getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN') !== '',
      backendUrl: getEnvVariable('VITE_BACKEND_URL'),
      wsUrl: getEnvVariable('VITE_WS_URL'),
    },
    strategy,
    options: config.options,
  };
};
