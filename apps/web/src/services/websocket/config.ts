// WebSocket configuration for enhanced connection stability
export const WEBSOCKET_CONFIG = {
  // Increase timeouts to prevent premature disconnections
  pingInterval: 30000,      // 30 seconds (was 5 seconds)
  pingTimeout: 60000,       // 60 seconds timeout  
  pongTimeout: 10000,       // 10 seconds for pong response
  
  // Connection settings
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  
  // Transport configuration
  transports: ['websocket', 'polling'],
  upgrade: true,
  rememberUpgrade: true,
  
  // Additional stability settings
  closeOnBeforeunload: false,
  withCredentials: true,
  autoConnect: true,
  
  // Query parameters
  query: {
    version: '1.0',
    transport: 'websocket'
  }
};

// Connection health monitoring
export const HEALTH_CHECK_CONFIG = {
  interval: 5000,           // Health check every 5 seconds
  timeout: 10000,           // Health check timeout
  maxFailures: 3,           // Max consecutive failures before marking unhealthy
  retryDelay: 2000          // Delay between health check retries
};