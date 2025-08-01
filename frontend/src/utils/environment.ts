// Environment detection and configuration

export const IS_WEBCONTAINER = typeof window !== 'undefined' && 
  window.location && 
  window.location.hostname.includes('webcontainer-api.io');

export const IS_LOCAL_DEV = typeof window !== 'undefined' && 
  window.location && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Get environment variables with fallbacks
export const getEnvVariable = (key: string, fallback: string = ''): string => {
  const value = import.meta.env[key];
  return value !== undefined ? String(value) : fallback;
};

// Get Poloniex API credentials from environment
export const getPoloniexApiKey = (): string => {
  return getEnvVariable('VITE_POLONIEX_API_KEY', '');
};

export const getPoloniexApiSecret = (): string => {
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

  // Default to official Poloniex V3 futures API endpoints
  return service === 'futures' 
    ? 'https://api.poloniex.com/v3/futures'
    : 'https://api.poloniex.com/v3';
};

// Get WebSocket URLs for V3 futures
export const getPoloniexWebSocketUrl = (type: 'public' | 'private' = 'public'): string => {
  const customWsUrl = getEnvVariable('VITE_POLONIEX_WS_URL', '');
  if (customWsUrl) {
    return customWsUrl;
  }

  // Default Poloniex V3 futures WebSocket endpoints
  return type === 'public' 
    ? 'wss://futures-apiws.poloniex.com'
    : 'wss://futures-apiws.poloniex.com';
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
  
  // In production, require credentials - don't fall back to mock mode
  return !hasCredentials;
};

// Get base URL for the application
export const getBaseUrl = () => {
  if (IS_WEBCONTAINER) {
    return window.location.origin;
  }
  if (IS_LOCAL_DEV) {
    return 'http://localhost:5675'; // .clinerules compliant frontend port
  }
  return 'https://poloniex-trading-platform.vercel.app'; // Production URL
};

// Get backend API URL with proper protocol and Railway support
export const getBackendUrl = (): string => {
  const envUrl = getEnvVariable('VITE_BACKEND_URL');
  if (envUrl) return envUrl;
  
  // Check for local development first (localhost or 127.0.0.1)
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // Use .clinerules compliant backend port range (8765-8799)
      return `${protocol}//localhost:8765`;
    }
    
    // For Railway deployment, use Railway reference variables
    const railwayPublicDomain = getEnvVariable('VITE_RAILWAY_PUBLIC_DOMAIN');
    const railwayPrivateDomain = getEnvVariable('VITE_RAILWAY_PRIVATE_DOMAIN');
    
    if (railwayPublicDomain) {
      return `https://${railwayPublicDomain}`;
    }
    
    if (railwayPrivateDomain) {
      return `https://${railwayPrivateDomain}`;
    }
    
    // Legacy Railway support
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      return 'https://polytrade-be.up.railway.app';
    }
    
    // Fall back to same origin for other cases
    return window.location.origin;
  }
  
  // Server-side fallback - use .clinerules compliant port
  return 'http://localhost:8765';
};

// Get WebSocket URL with proper protocol handling for Railway deployment
export const getWebSocketUrl = (): string => {
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