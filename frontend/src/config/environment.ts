// Enhanced environment management for proper mock mode detection
interface EnvironmentConfig {
  apiKey: string | null;
  apiSecret: string | null;
  forceMockMode: boolean;
  isProduction: boolean;
  wsUrl: string;
  apiUrl: string;
  liveTradingEnabled: boolean;
}

export class EnvironmentManager {
  private static instance: EnvironmentManager;
  private config: EnvironmentConfig;
  
  private constructor() {
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
      wsUrl: import.meta.env.VITE_WS_URL || 'wss://ws.poloniex.com/ws/public',
      apiUrl: import.meta.env.VITE_API_URL || 'https://api.poloniex.com',
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
    
    // Log configuration status
    console.log('Environment Configuration:', {
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret,
      forceMockMode: isExplicitlyMocked,
      liveTradingEnabled: this.config.liveTradingEnabled,
      mode: this.config.liveTradingEnabled ? 'LIVE' : 'MOCK'
    });
    
    // Warn about configuration issues
    if (!hasValidCredentials && !isExplicitlyMocked) {
      console.warn(
        'API credentials missing or invalid. Running in MOCK mode.',
        '\nTo enable live trading:',
        '\n1. Set VITE_POLONIEX_API_KEY and VITE_POLONIEX_API_SECRET in .env',
        '\n2. Ensure VITE_FORCE_MOCK_MODE is not set to "true"'
      );
    }
    
    if (hasValidCredentials && isExplicitlyMocked) {
      console.warn(
        'Valid API credentials found but VITE_FORCE_MOCK_MODE is enabled.',
        '\nTo enable live trading, set VITE_FORCE_MOCK_MODE=false'
      );
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