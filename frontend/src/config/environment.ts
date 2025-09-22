// Enhanced environment management for proper mock mode detection and security
interface EnvironmentConfig {
  apiKey: string | null;
  apiSecret: string | null;
  forceMockMode: boolean;
  isProduction: boolean;
  wsUrl: string;
  apiUrl: string;
  liveTradingEnabled: boolean;
  backendUrl: string;
}

/**
 * Validates frontend environment variables for security
 */
function validateFrontendEnvironment(): void {
  const errors: string[] = [];
  
  // Check for potentially exposed backend secrets
  const envVars = import.meta.env;
  
  // These should NEVER be exposed to the frontend
  const forbiddenBackendSecrets = [
    'JWT_SECRET',
    'DATABASE_URL', 
    'API_ENCRYPTION_KEY',
    'POLONIEX_API_SECRET', // Should use VITE_POLONIEX_API_SECRET for frontend
    'POLONIEX_API_KEY'     // Should use VITE_POLONIEX_API_KEY for frontend
  ];
  
  forbiddenBackendSecrets.forEach(secret => {
    if (envVars[secret]) {
      errors.push(`❌ Backend secret '${secret}' is exposed to frontend. Remove it or prefix with VITE_ if needed for frontend.`);
    }
  });
  
  // Validate required frontend environment variables
  const requiredVars = ['VITE_API_URL'];
  
  requiredVars.forEach(varName => {
    if (!envVars[varName]) {
      errors.push(`❌ Required environment variable '${varName}' is missing`);
    }
  });
  
  // Validate URLs
  if (envVars.VITE_API_URL && !isValidUrl(envVars.VITE_API_URL)) {
    errors.push(`❌ VITE_API_URL must be a valid URL`);
  }
  
  if (envVars.VITE_WS_URL && !isValidUrl(envVars.VITE_WS_URL)) {
    errors.push(`❌ VITE_WS_URL must be a valid URL`);
  }
  
  // Production-specific validations
  if (envVars.PROD) {
    if (envVars.VITE_API_URL?.includes('localhost')) {
      console.warn('⚠️  Using localhost API URL in production build');
    }
    
    if (envVars.VITE_FORCE_MOCK_MODE !== 'true' && (!envVars.VITE_POLONIEX_API_KEY || !envVars.VITE_POLONIEX_API_SECRET)) {
      console.warn('⚠️  Poloniex API credentials not set - trading features will be limited');
    }
  }
  
  if (errors.length > 0) {
    console.error('❌ Frontend environment validation failed:');
    errors.forEach(error => console.error(`   ${error}`));
    throw new Error(`Frontend environment validation failed: ${errors.join(', ')}`);
  }
  
  console.log('✅ Frontend environment validation passed');
}

/**
 * Validates if a string is a valid URL
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export class EnvironmentManager {
  private static instance: EnvironmentManager;
  private config: EnvironmentConfig;
  
  private constructor() {
    // Validate environment before loading configuration
    validateFrontendEnvironment();
    
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }
  
  static getInstance(): EnvironmentManager {
    if (!EnvironmentManager.instance) {
      EnvironmentManager.instance = new EnvironmentManager();
    }
    return EnvironmentManager.instance;
  }
  
  private loadConfiguration(): EnvironmentConfig {
    // Check for environment variables
    const apiKey = import.meta.env.VITE_POLONIEX_API_KEY || null;
    const apiSecret = import.meta.env.VITE_POLONIEX_API_SECRET || null;
    const forceMockMode = import.meta.env.VITE_FORCE_MOCK_MODE === 'true';
    
    // Check for localStorage override (for testing)
    const storedConfig = this.getStoredConfig();
    
    return {
      apiKey: storedConfig?.apiKey || apiKey,
      apiSecret: storedConfig?.apiSecret || apiSecret,
      forceMockMode: storedConfig?.forceMockMode ?? forceMockMode,
      isProduction: import.meta.env.PROD,
      wsUrl: import.meta.env.VITE_WS_URL || 'wss://futures-apiws.poloniex.com',
      apiUrl: import.meta.env.VITE_API_URL || 'https://api.poloniex.com',
      backendUrl: import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'https://api.poloniex.com',
      liveTradingEnabled: false // Will be set after validation
    };
  }
  
  private getStoredConfig(): Partial<EnvironmentConfig> | null {
    try {
      const stored = localStorage.getItem('poloniex_config');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }
  
  private validateConfiguration(): void {
    const { apiKey, apiSecret, forceMockMode } = this.config;
    
    // Determine if live trading should be enabled
    const hasValidCredentials = !!(apiKey && apiSecret && apiKey.length > 10 && apiSecret.length > 10);
    const isExplicitlyMocked = forceMockMode === true;
    
    this.config.liveTradingEnabled = hasValidCredentials && !isExplicitlyMocked;
    
    // Log configuration status (only in development)
    if (import.meta.env.DEV) {
      console.info('Environment Configuration:', {
        hasApiKey: !!apiKey,
        hasApiSecret: !!apiSecret,
        forceMockMode: isExplicitlyMocked,
        liveTradingEnabled: this.config.liveTradingEnabled,
        mode: this.config.liveTradingEnabled ? 'LIVE' : 'MOCK'
      });
    }
    
    // Warn about configuration issues
    if (!hasValidCredentials && !isExplicitlyMocked) {
      // console.warn(
      //   'API credentials missing or invalid. Running in MOCK mode.',
      //   '\nTo enable live trading:',
      //   '\n1. Set VITE_POLONIEX_API_KEY and VITE_POLONIEX_API_SECRET in .env',
      //   '\n2. Ensure VITE_FORCE_MOCK_MODE is not set to "true"'
      // );
    }
    
    if (hasValidCredentials && isExplicitlyMocked) {
      // console.warn(
      //   'Valid API credentials found but VITE_FORCE_MOCK_MODE is enabled.',
      //   '\nTo enable live trading, set VITE_FORCE_MOCK_MODE=false'
      // );
    }
  }
  
  getConfig(): EnvironmentConfig {
    return { ...this.config };
  }
  
  isLiveTradingEnabled(): boolean {
    return this.config.liveTradingEnabled;
  }
  
  isMockMode(): boolean {
    return !this.config.liveTradingEnabled;
  }
  
  // Allow runtime configuration updates (for testing)
  updateConfig(updates: Partial<EnvironmentConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfiguration();
    
    // Persist to localStorage
    localStorage.setItem('poloniex_config', JSON.stringify({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      forceMockMode: this.config.forceMockMode
    }));
    
    // Trigger configuration change event
    window.dispatchEvent(new CustomEvent('config-updated', { 
      detail: this.config 
    }));
  }
  
  // Clear stored configuration
  clearStoredConfig(): void {
    localStorage.removeItem('poloniex_config');
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }
}