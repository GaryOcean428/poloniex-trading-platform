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
  return getEnvVariable('VITE_POLONIEX_PASSPHRASE', '');
};

// Get API base URLs with environment variable support
export const getApiBaseUrl = (service: 'futures' | 'spot' = 'futures'): string => {
  // Check for custom API URL first
  const customApiUrl = getEnvVariable('VITE_API_URL', '');
  if (customApiUrl) {
    return customApiUrl;
  }

  // Support legacy NEXT_PUBLIC_API_URL for compatibility
  const nextPublicApiUrl = getEnvVariable('NEXT_PUBLIC_API_URL', '');
  if (nextPublicApiUrl) {
    return nextPublicApiUrl;
  }

  // Default to official Poloniex API endpoints
  return service === 'futures' 
    ? 'https://futures-api.poloniex.com/v3'
    : 'https://api.poloniex.com/v3';
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
    return 'http://localhost:5173';
  }
  return 'https://poloniex-trading-platform.vercel.app'; // Production URL
};

// Get backend API URL
export const getBackendUrl = (): string => {
  const envUrl = getEnvVariable('VITE_BACKEND_URL');
  if (envUrl) return envUrl;
  if (IS_LOCAL_DEV) return 'http://localhost:3000';
  return window.location.origin;
};