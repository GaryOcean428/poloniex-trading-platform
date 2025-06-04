// Environment detection and configuration

export const IS_WEBCONTAINER = typeof window !== 'undefined' && 
  window.location && 
  window.location.hostname.includes('webcontainer-api.io');

export const IS_LOCAL_DEV = !IS_WEBCONTAINER && 
  window.location.hostname === 'localhost';

// Get environment variables with fallbacks
export const getEnvVariable = (key: string, fallback: string = ''): string => {
  const value = import.meta.env[key];
  return value !== undefined ? String(value) : fallback;
};

// Get Poloniex API key from environment
export const getPoloniexApiKey = (): string => {
  return getEnvVariable('VITE_POLONIEX_API_KEY', '');
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