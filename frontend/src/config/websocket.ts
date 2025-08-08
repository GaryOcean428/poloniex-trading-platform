/**
 * WebSocket Configuration
 * 
 * Provides environment-aware WebSocket URL resolution with proper fallbacks
 * for Railway deployment and local development.
 */

import { getEnvVariable } from '@/utils/environment';

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
  // Check for explicit WebSocket URL first
  const explicitWsUrl = getEnvVariable('VITE_WS_URL');
  if (explicitWsUrl) {
    return explicitWsUrl;
  }

  // Check for backend URL and convert to WebSocket URL
  const backendUrl = getEnvVariable('VITE_BACKEND_URL');
  if (backendUrl) {
    // Convert HTTP/HTTPS to WS/WSS
    if (backendUrl.startsWith('https://')) {
      return backendUrl.replace('https://', 'wss://');
    } else if (backendUrl.startsWith('http://')) {
      return backendUrl.replace('http://', 'ws://');
    }
    return backendUrl;
  }

  // Check Railway-specific environment variables
  const railwayPublicDomain = getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN');
  if (railwayPublicDomain) {
    return `wss://${railwayPublicDomain}`;
  }

  const railwayPrivateDomain = getEnvVariable('VITE_RAILWAY_PRIVATE_DOMAIN');
  if (railwayPrivateDomain) {
    return `wss://${railwayPrivateDomain}`;
  }

  // Environment detection for fallbacks
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    // Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // Use .clinerules compliant backend port (8765-8799)
      return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:8765`;
    }

    // Railway detection (derive from env or same-origin)
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      const railwayPublicDomain = getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN');
      if (railwayPublicDomain) {
        return `wss://${railwayPublicDomain}`;
      }
      // Fallback to same-origin protocol/host
      return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}`;
    }

    // WebContainer detection
    if (hostname.includes('webcontainer-api.io')) {
      return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:8765`;
    }
  }

  // Final fallback for development
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