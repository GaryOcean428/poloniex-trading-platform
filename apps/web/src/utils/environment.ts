// Environment detection and configuration

export const IS_WEBCONTAINER =
  typeof window !== 'undefined' &&
  window.location &&
  window.location.hostname.includes('webcontainer-api.io');

export const IS_LOCAL_DEV =
  typeof window !== 'undefined' &&
  window.location &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Get environment variables with fallbacks
export const getEnvVariable = (key: string, fallback: string = ''): string => {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const value = env ? env[key] : undefined;
  return value !== undefined ? String(value) : fallback;
};

// Get Poloniex API credentials from environment
// WARNING: API keys should NOT be set via VITE_ env vars in production
// as they will be bundled into the frontend JavaScript.
// Use the backend /api/api-keys endpoint to manage credentials securely.
export const getPoloniexApiKey = (): string => {
  if (!IS_LOCAL_DEV && !IS_WEBCONTAINER) {
    // Never expose API keys in production builds
    return '';
  }
  return getEnvVariable('VITE_POLONIEX_API_KEY', '');
};

export const getPoloniexApiSecret = (): string => {
  if (!IS_LOCAL_DEV && !IS_WEBCONTAINER) {
    // Never expose API secrets in production builds
    return '';
  }
  return getEnvVariable('VITE_POLONIEX_API_SECRET', '');
};

export const getPoloniexPassphrase = (): string => {
  // Passphrase is not required for Poloniex API v3
  // This function is kept for compatibility but returns empty string
  return '';
};

// Get API base URLs with environment variable support
export const getApiBaseUrl = (service: 'futures' | 'spot' = 'futures'): string => {
  // Check for custom API URL first - V3 futures specific
  const customApiUrl = getEnvVariable('VITE_POLONIEX_API_BASE_URL', '');
  if (customApiUrl) {
    return customApiUrl;
  }

  // Support legacy NEXT_PUBLIC_API_URL for compatibility
  const nextPublicApiUrl = getEnvVariable('NEXT_PUBLIC_API_URL', '');
  if (nextPublicApiUrl) {
    return nextPublicApiUrl;
  }

  // Use backend proxy endpoints to avoid CORS issues
  return service === 'futures'
    ? '/api/futures'
    : '/api/spot';
};

// Get WebSocket URLs for V3 futures
export const getPoloniexWebSocketUrl = (type: 'public' | 'private' = 'public'): string => {
  const customWsUrl = getEnvVariable('VITE_POLONIEX_WS_URL', '');
  if (customWsUrl) {
    return customWsUrl;
  }

  // Default Poloniex V3 futures WebSocket endpoints (per official docs)
  return type === 'public'
    ? 'wss://ws.poloniex.com/ws/v3/public'
    : 'wss://ws.poloniex.com/ws/v3/private';
};

// Mock mode configuration
export const isMockModeForced = (): boolean => {
  // Check for explicit mock mode environment variable
  const forceMock = getEnvVariable('VITE_FORCE_MOCK_MODE', '').toLowerCase();
  return forceMock === 'true' || forceMock === '1';
};

export const isMockModeDisabled = (): boolean => {
  // Check for explicit disable mock mode environment variable
  const disableMock = getEnvVariable('VITE_DISABLE_MOCK_MODE', '').toLowerCase();
  return disableMock === 'true' || disableMock === '1';
};

// Determine if mock mode should be enabled
export const shouldUseMockMode = (hasCredentials: boolean = false): boolean => {
  // If explicitly forced, use mock mode
  if (isMockModeForced()) {
    return true;
  }

  // If explicitly disabled, don't use mock mode (requires credentials)
  if (isMockModeDisabled()) {
    return !hasCredentials;
  }

  // Default behavior: only use mock mode in development environments when no credentials
  // Production should never default to mock mode
  if (IS_WEBCONTAINER || IS_LOCAL_DEV) {
    return !hasCredentials;
  }

  // In production, never auto-enable mock mode — missing credentials should fail explicitly
  return false;
};

// Get base URL for the application
export const getBaseUrl = () => {
  if (IS_WEBCONTAINER) {
    return window.location.origin;
  }
  if (IS_LOCAL_DEV) {
    return 'http://localhost:5675'; // .clinerules compliant frontend port
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
};

// Get backend API URL with proper protocol and Railway support
export const getBackendUrl = (): string => {
  // Priority 1: Explicit backend URL
  const envUrl = getEnvVariable('VITE_BACKEND_URL');
  if (envUrl) return envUrl;

  // Priority 2: Environment detection from browser context
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol || 'http:';

    // Local development - backend runs on .clinerules compliant port 8765
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8765';
    }

    // WebContainer detection
    if (hostname.includes('webcontainer-api.io')) {
      return `${protocol}//${hostname}:8765`;
    }

    // Fall back to same origin for other cases
    return window.location.origin;
  }

  // Priority 3: Railway environment variables (server-side scenarios)
  const railwayPublicDomain = getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN');
  if (railwayPublicDomain) {
    return `https://${railwayPublicDomain}`;
  }

  const railwayPrivateDomain = getEnvVariable('VITE_RAILWAY_PRIVATE_DOMAIN');
  if (railwayPrivateDomain) {
    return `https://${railwayPrivateDomain}`;
  }

  return '';
};

// Get WebSocket URL with proper protocol handling for Railway deployment
export const getWebSocketUrl = (): string => {
  // Priority 1: Explicit WebSocket URL
  const explicitWsUrl = getEnvVariable('VITE_WS_URL');
  if (explicitWsUrl) return explicitWsUrl;

  // Priority 2: Convert backend URL to WebSocket URL
  const backendUrl = getBackendUrl();

  // Convert HTTP/HTTPS to WS/WSS appropriately
  if (backendUrl.startsWith('https://')) {
    return backendUrl.replace('https://', 'wss://');
  } else if (backendUrl.startsWith('http://')) {
    return backendUrl.replace('http://', 'ws://');
  }

  return backendUrl;
};

// Get development frontend URL with .clinerules compliant ports
export const getFrontendUrl = (): string => {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }

  // Default to .clinerules compliant frontend port range (5675-5699)
  return 'http://localhost:5675';
};
