import { io, Socket } from 'socket.io-client';
import { MarketData, Trade } from '@/types';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { getBackendUrl } from '@/utils/environment';

// Socket.io events
const EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  RECONNECT: 'reconnect',
  RECONNECT_ATTEMPT: 'reconnect_attempt',
  RECONNECT_ERROR: 'reconnect_error',
  RECONNECT_FAILED: 'reconnect_failed',
  CONNECT_ERROR: 'connect_error',
  CONNECT_TIMEOUT: 'connect_timeout',
  MARKET_DATA: 'marketData',
  TRADE_EXECUTED: 'tradeExecuted',
  CHAT_MESSAGE: 'chatMessage',
  ERROR: 'error',
  SUBSCRIBE_MARKET: 'subscribeMarket',
  UNSUBSCRIBE_MARKET: 'unsubscribeMarket',
  PING: 'ping',
  PONG: 'pong'
};

// Connection states
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed'
}

// Reconnection strategies
enum ReconnectionStrategy {
  EXPONENTIAL_BACKOFF = 'exponential_backoff',
  LINEAR_BACKOFF = 'linear_backoff',
  IMMEDIATE = 'immediate',
  NONE = 'none'
}

interface ChatMessage {
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

interface ConnectionConfig {
  url: string;
  options?: {
    reconnectionStrategy?: ReconnectionStrategy;
    initialReconnectDelay?: number;
    maxReconnectDelay?: number;
    maxReconnectAttempts?: number;
    reconnectionJitter?: number;
    timeout?: number;
    pingInterval?: number;
    pingTimeout?: number;
    autoConnect?: boolean;
    forceNew?: boolean;
    transports?: string[];
  };
  auth?: {
    token?: string;
    [key: string]: any;
  };
}

interface ConnectionStats {
  connectTime: number | null;
  disconnectTime: number | null;
  lastPingTime: number | null;
  lastPongTime: number | null;
  pingLatency: number | null;
  reconnectAttempts: number;
  successfulReconnects: number;
  failedReconnects: number;
  totalDisconnects: number;
  connectionUptime: number;
  connectionDowntime: number;
}

class WebSocketService {
  private static instance: WebSocketService;
  private socket: Socket | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private eventListeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private initialReconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private reconnectionJitter: number = 0.5; // Random factor to avoid thundering herd
  private currentReconnectDelay: number = this.initialReconnectDelay;
  private reconnectionStrategy: ReconnectionStrategy = ReconnectionStrategy.EXPONENTIAL_BACKOFF;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pingInterval: number = 30000; // 30 seconds
  private pingTimeout: number = 5000; // 5 seconds
  private lastPingTime: number = 0;
  private lastPongTime: number = 0;
  private offlineData: Map<string, any> = new Map();
  private connectionAttempted: boolean = false;
  private useMockData: boolean = true; // Default to mock data
  private healthCheckEndpoint: string = '/api/health';
  private subscriptions: Set<string> = new Set();
  private pendingMessages: Array<{event: string, data: any}> = [];
  private connectionStats: ConnectionStats = {
    connectTime: null,
    disconnectTime: null,
    lastPingTime: null,
    lastPongTime: null,
    pingLatency: null,
    reconnectAttempts: 0,
    successfulReconnects: 0,
    failedReconnects: 0,
    totalDisconnects: 0,
    connectionUptime: 0,
    connectionDowntime: 0
  };
  
  // Default connection config
  private config: ConnectionConfig = {
    url: getBackendUrl(),
    options: {
      reconnectionStrategy: ReconnectionStrategy.EXPONENTIAL_BACKOFF,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      maxReconnectAttempts: 10,
      reconnectionJitter: 0.5,
      timeout: 10000,
      pingInterval: 30000,
      pingTimeout: 5000,
      autoConnect: false,
      forceNew: true,
      transports: ['websocket']
    }
  };
  
  private constructor() {
    // Initialize offline data from localStorage if available
    try {
      const savedData = localStorage.getItem('websocket_offline_data');
      if (savedData) {
        this.offlineData = new Map(JSON.parse(savedData));
      }
    } catch (error) {
      console.error('Error loading offline data:', error);
    }
    
    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline.bind(this));
      window.addEventListener('offline', this.handleOffline.bind(this));
      window.addEventListener('beforeunload', this.cleanup.bind(this));
    }
  }
  
  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }
  
  /**
   * Configure the WebSocket service
   */
  public configure(config: Partial<ConnectionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      options: {
        ...this.config.options,
        ...config.options
      },
      auth: {
        ...this.config.auth,
        ...config.auth
      }
    };
    
    // Update internal settings from config
    if (this.config.options) {
      const { 
        reconnectionStrategy, 
        initialReconnectDelay, 
        maxReconnectDelay, 
        maxReconnectAttempts,
        reconnectionJitter,
        pingInterval,
        pingTimeout
      } = this.config.options;
      
      if (reconnectionStrategy) this.reconnectionStrategy = reconnectionStrategy;
      if (initialReconnectDelay) this.initialReconnectDelay = initialReconnectDelay;
      if (maxReconnectDelay) this.maxReconnectDelay = maxReconnectDelay;
      if (maxReconnectAttempts) this.maxReconnectAttempts = maxReconnectAttempts;
      if (reconnectionJitter) this.reconnectionJitter = reconnectionJitter;
      if (pingInterval) this.pingInterval = pingInterval;
      if (pingTimeout) this.pingTimeout = pingTimeout;
    }
  }
  
  /**
   * Get current connection state
   */
  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }
  
  /**
   * Get connection statistics
   */
  public getConnectionStats(): ConnectionStats {
    // Update uptime/downtime calculations
    if (this.connectionState === ConnectionState.CONNECTED && this.connectionStats.connectTime) {
      this.connectionStats.connectionUptime = Date.now() - this.connectionStats.connectTime;
    } else if (this.connectionStats.disconnectTime) {
      this.connectionStats.connectionDowntime = Date.now() - this.connectionStats.disconnectTime;
    }
    
    return { ...this.connectionStats };
  }
  
  /**
   * Handle device coming online
   */
  private handleOnline(): void {
    console.log('Device is online, attempting to reconnect WebSocket');
    if (this.connectionState === ConnectionState.DISCONNECTED || 
        this.connectionState === ConnectionState.FAILED) {
      this.reconnect();
    }
  }
  
  /**
   * Handle device going offline
   */
  private handleOffline(): void {
    console.log('Device is offline, WebSocket connection will be affected');
    // We don't disconnect here as the socket will handle this automatically
    // but we update our state to reflect the network status
    if (this.connectionState === ConnectionState.CONNECTED) {
      this.connectionState = ConnectionState.DISCONNECTED;
      this.connectionStats.disconnectTime = Date.now();
      this.connectionStats.totalDisconnects++;
    }
  }
  
  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.stopPingTimer();
    this.stopReconnectTimer();
    this.disconnect();
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline.bind(this));
      window.removeEventListener('offline', this.handleOffline.bind(this));
      window.removeEventListener('beforeunload', this.cleanup.bind(this));
    }
  }
  
  /**
   * Calculate next reconnect delay based on strategy
   */
  private calculateReconnectDelay(): number {
    let delay: number;
    
    switch (this.reconnectionStrategy) {
      case ReconnectionStrategy.EXPONENTIAL_BACKOFF:
        // Exponential backoff with jitter: delay = min(initialDelay * 2^attempts, maxDelay) * (1 ± jitter)
        delay = Math.min(
          this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
          this.maxReconnectDelay
        );
        break;
        
      case ReconnectionStrategy.LINEAR_BACKOFF:
        // Linear backoff with jitter: delay = min(initialDelay * attempts, maxDelay) * (1 ± jitter)
        delay = Math.min(
          this.initialReconnectDelay * (this.reconnectAttempts + 1),
          this.maxReconnectDelay
        );
        break;
        
      case ReconnectionStrategy.IMMEDIATE:
        // Immediate reconnection with minimal delay
        delay = 100;
        break;
        
      case ReconnectionStrategy.NONE:
      default:
        // No automatic reconnection
        return -1;
    }
    
    // Apply jitter to avoid thundering herd problem
    // Random value between (1 - jitter) and (1 + jitter)
    const jitterFactor = 1 + (Math.random() * 2 - 1) * this.reconnectionJitter;
    
    return Math.floor(delay * jitterFactor);
  }
  
  /**
   * Start ping timer to detect connection issues
   */
  private startPingTimer(): void {
    this.stopPingTimer();
    
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.connectionState !== ConnectionState.CONNECTED) {
        return;
      }
      
      this.lastPingTime = Date.now();
      this.connectionStats.lastPingTime = this.lastPingTime;
      
      this.socket.emit(EVENTS.PING, { timestamp: this.lastPingTime });
      
      // Set timeout for pong response
      setTimeout(() => {
        const pongElapsed = this.lastPongTime - this.lastPingTime;
        
        // If we haven't received a pong or it's too old
        if (pongElapsed <= 0 || pongElapsed > this.pingTimeout) {
          console.warn(`WebSocket ping timeout after ${this.pingTimeout}ms`);
          
          // Force disconnect and reconnect
          if (this.socket) {
            this.socket.disconnect();
            this.handleDisconnect(new Error('Ping timeout'));
          }
        }
      }, this.pingTimeout);
    }, this.pingInterval);
  }
  
  /**
   * Stop ping timer
   */
  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
  
  /**
   * Stop reconnect timer
   */
  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  
  /**
   * Connect to the WebSocket server
   */
  public connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Update auth token if provided
        if (token) {
          this.config.auth = { ...this.config.auth, token };
        }
        
        // If already connected or connecting, return immediately
        if (this.connectionState === ConnectionState.CONNECTED) {
          resolve();
          return;
        }
        
        if (this.connectionState === ConnectionState.CONNECTING) {
          // Wait for connection to complete
          const checkConnection = setInterval(() => {
            if (this.connectionState === ConnectionState.CONNECTED) {
              clearInterval(checkConnection);
              resolve();
            } else if (this.connectionState === ConnectionState.FAILED || 
                      this.connectionState === ConnectionState.DISCONNECTED) {
              clearInterval(checkConnection);
              reject(new Error('Connection failed'));
            }
          }, 100);
          return;
        }
        
        // Reset reconnect attempts on new connection
        this.reconnectAttempts = 0;
        this.currentReconnectDelay = this.initialReconnectDelay;
        this.connectionState = ConnectionState.CONNECTING;
        
        // If we already attempted to connect and failed, don't retry
        if (this.connectionAttempted && this.useMockData) {
          console.log('Using mock data (previous connection attempt failed)');
          this.connectionState = ConnectionState.FAILED;
          resolve();
          return;
        }
        
        this.connectionAttempted = true;
        console.log('Attempting WebSocket connection...');
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
          console.log(`WebSocket connection timed out after ${this.config.options?.timeout || 10000}ms`);
          this.connectionState = ConnectionState.FAILED;
          this.useMockData = true;
          resolve();
        }, this.config.options?.timeout || 10000);
        
        // In WebContainer environment, always use mock data
        // WebSocket connections outside the container domain aren't possible
        if (typeof window !== 'undefined' && window.location && window.location.hostname.includes('webcontainer-api.io')) {
          this.useMockData = true;
          this.connectionState = ConnectionState.FAILED;
          clearTimeout(connectionTimeout);
          console.log('Running in WebContainer environment, defaulting to mock data');
          resolve();
          return;
        }
        
        // Check if server is available before attempting socket connection
        fetch(this.config.url + this.healthCheckEndpoint, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000) // 5s timeout for the health check
        })
        .then(response => {
          if (!response.ok) throw new Error('Server health check failed');
          return response.json();
        })
        .then(() => {
          // Server is available, attempt WebSocket connection
          clearTimeout(connectionTimeout);
          
          // Configure socket.io options
          const socketOptions = {
            auth: this.config.auth,
            transports: this.config.options?.transports || ['websocket'],
            reconnection: false, // We handle reconnection ourselves
            timeout: this.config.options?.timeout || 10000,
            forceNew: this.config.options?.forceNew || true,
            autoConnect: this.config.options?.autoConnect !== undefined ? 
                        this.config.options.autoConnect : false
          };
          
          this.socket = io(this.config.url, socketOptions);
          
          // Set up event handlers
          this.setupSocketEventHandlers();
          
          // Connect if autoConnect is false
          if (!socketOptions.autoConnect) {
            this.socket.connect();
          }
        })
        .catch(error => {
          // Server is not available, use mock data
          clearTimeout(connectionTimeout);
          console.log('Server not available, using mock data:', error.message);
          this.useMockData = true;
          this.connectionState = ConnectionState.FAILED;
          resolve();
        });
      } catch (error) {
        console.error('WebSocket connection error:', error instanceof Error ? error.message : String(error));
        this.useMockData = true;
        this.connectionState = ConnectionState.FAILED;
        resolve();
      }
    });
  }
  
  /**
   * Set up socket event handlers
   */
  private setupSocketEventHandlers(): void {
    if (!this.socket) return;
    
    // Connection events
    this.socket.on(EVENTS.CONNECT, () => {
      console.log('WebSocket connected successfully');
      this.connectionState = ConnectionState.CONNECTED;
      this.useMockData = false;
      this.reconnectAttempts = 0;
      this.currentReconnectDelay = this.initialReconnectDelay;
      
      // Update connection stats
      this.connectionStats.connectTime = Date.now();
      
      // Start ping timer
      this.startPingTimer();
      
      // Resubscribe to previous subscriptions
      this.resubscribe();
      
      // Send any pending messages
      this.sendPendingMessages();
      
      // Notify listeners
      this.notifyListeners('connectionStateChanged', this.connectionState);
    });
    
    this.socket.on(EVENTS.DISCONNECT, (reason) => {
      console.log(`WebSocket disconnected: ${reason}`);
      this.handleDisconnect(new Error(reason));
    });
    
    this.socket.on(EVENTS.CONNECT_ERROR, (error) => {
      console.error('WebSocket connection error:', error);
      this.handleDisconnect(error);
    });
    
    this.socket.on(EVENTS.CONNECT_TIMEOUT, () => {
      console.error('WebSocket connection timeout');
      this.handleDisconnect(new Error('Connection timeout'));
    });
    
    // Ping/pong for connection health monitoring
    this.socket.on(EVENTS.PONG, (data: { timestamp: number }) => {
      this.lastPongTime = Date.now();
      this.connectionStats.lastPongTime = this.lastPongTime;
      
      // Calculate ping latency
      if (data && data.timestamp) {
        this.connectionStats.pingLatency = this.lastPongTime - data.timestamp;
      }
    });
    
    // Data events
    this.socket.on(EVENTS.MARKET_DATA, (data: MarketData) => {
      this.notifyListeners(EVENTS.MARKET_DATA, data);
    });
    
    this.socket.on(EVENTS.TRADE_EXECUTED, (data: Trade) => {
      this.notifyListeners(EVENTS.TRADE_EXECUTED, data);
    });
    
    this.socket.on(EVENTS.CHAT_MESSAGE, (data: ChatMessage) => {
      this.notifyListeners(EVENTS.CHAT_MESSAGE, data);
    });
    
    this.socket.on(EVENTS.ERROR, (error) => {
      console.error('WebSocket error:', typeof error === 'object' ? JSON.stringify(error) : error);
      this.notifyListeners(EVENTS.ERROR, error);
    });
  }
  
  /**
   * Resubscribe to previous subscriptions after reconnect
   */
  private resubscribe(): void {
    if (!this.socket || this.connectionState !== ConnectionState.CONNECTED) return;
    
    console.log(`Resubscribing to ${this.subscriptions.size} channels`);
    
    this.subscriptions.forEach(subscription => {
      this.socket?.emit(EVENTS.SUBSCRIBE_MARKET, { pair: subscription });
    });
  }
  
  /**
   * Send any pending messages after reconnect
   */
  private sendPendingMessages(): void {
    if (!this.socket || this.connectionState !== ConnectionState.CONNECTED) return;
    
    console.log(`Sending ${this.pendingMessages.length} pending messages`);
    
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        this.socket.emit(message.event, message.data);
      }
    }
  }
  
  /**
   * Handle WebSocket disconnection with reconnect logic
   */
  private handleDisconnect(error: Error): void {
    // Update connection state and stats
    this.connectionState = ConnectionState.DISCONNECTED;
    this.connectionStats.disconnectTime = Date.now();
    this.connectionStats.totalDisconnects++;
    
    // Stop ping timer
    this.stopPingTimer();
    
    // Notify listeners
    this.notifyListeners('connectionStateChanged', this.connectionState);
    this.notifyListeners(EVENTS.ERROR, error);
    
    // If reconnection strategy is NONE, don't attempt to reconnect
    if (this.reconnectionStrategy === ReconnectionStrategy.NONE) {
      this.useMockData = true;
      return;
    }
    
    // Attempt to reconnect
    this.reconnect();
  }
  
  /**
   * Attempt to reconnect to the WebSocket server
   */
  private reconnect(): void {
    // Stop any existing reconnect timer
    this.stopReconnectTimer();
    
    // Check if we've reached the maximum number of reconnect attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`Max reconnection attempts (${this.maxReconnectAttempts}) reached, staying in mock mode`);
      this.connectionState = ConnectionState.FAILED;
      this.useMockData = true;
      this.connectionStats.failedReconnects++;
      
      // Notify listeners
      this.notifyListeners('connectionStateChanged', this.connectionState);
      return;
    }
    
    // Calculate delay for next reconnect attempt
    const delay = this.calculateReconnectDelay();
    
    // If delay is negative, don't reconnect
    if (delay < 0) {
      console.log('Reconnection strategy is NONE, not attempting to reconnect');
      this.connectionState = ConnectionState.FAILED;
      this.useMockData = true;
      return;
    }
    
    // Update state and stats
    this.reconnectAttempts++;
    this.connectionState = ConnectionState.RECONNECTING;
    this.connectionStats.reconnectAttempts++;
    
    // Notify listeners
    this.notifyListeners('connectionStateChanged', this.connectionState);
    
    console.log(`Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    // Schedule reconnect attempt
    this.reconnectTimer = setTimeout(() => {
      // Create a new socket connection
      this.connect()
        .then(() => {
          if (this.connectionState === ConnectionState.CONNECTED) {
            console.log('Reconnected successfully');
            this.connectionStats.successfulReconnects++;
          } else {
            console.log('Reconnect attempt failed');
            this.connectionStats.failedReconnects++;
            // Continue with reconnection attempts
            this.reconnect();
          }
        })
        .catch(() => {
          console.log('Reconnect attempt failed with error');
          this.connectionStats.failedReconnects++;
          // Continue with reconnection attempts
          this.reconnect();
        });
    }, delay);
  }
  
  /**
   * Check if WebSocket is connected
   */
  public isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED && this.socket !== null;
  }
  
  /**
   * Check if we're using mock data
   */
  public isMockMode(): boolean {
    return this.useMockData;
  }
  
  /**
   * Save data for offline access
   */
  private saveOfflineData(key: string, data: any): void {
    try {
      this.offlineData.set(key, data);
      localStorage.setItem('websocket_offline_data', JSON.stringify(Array.from(this.offlineData.entries())));
    } catch (error) {
      console.error('Error saving offline data:', error);
    }
  }
  
  /**
   * Subscribe to market data for a specific pair
   */
  public subscribeToMarket(pair: string): void {
    // Add to subscriptions set
    this.subscriptions.add(pair);
    
    if (!this.isConnected()) {
      console.log('WebSocket not connected, skipping market subscription');
      // Try to load offline data
      const offlineData = this.offlineData.get(`market_${pair}`);
      if (offlineData) {
        this.notifyListeners(EVENTS.MARKET_DATA, offlineData);
      }
      return;
    }
    
    this.socket?.emit(EVENTS.SUBSCRIBE_MARKET, { pair });
  }
  
  /**
   * Unsubscribe from market data for a specific pair
   */
  public unsubscribeFromMarket(pair: string): void {
    // Remove from subscriptions set
    this.subscriptions.delete(pair);
    
    if (!this.isConnected()) {
      return;
    }
    
    this.socket?.emit(EVENTS.UNSUBSCRIBE_MARKET, { pair });
  }
  
  /**
   * Send a message to the server
   */
  public send(event: string, data: any): void {
    if (!this.isConnected()) {
      console.log(`WebSocket not connected, queueing message: ${event}`);
      // Queue message to be sent when connection is established
      this.pendingMessages.push({ event, data });
      return;
    }
    
    this.socket?.emit(event, data);
  }
  
  /**
   * Send a chat message
   */
  public sendChatMessage(message: string, username: string): void {
    this.send(EVENTS.CHAT_MESSAGE, {
      message,
      username,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Register an event listener
   */
  public on(event: string, callback: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    
    this.eventListeners.get(event)?.add(callback);
  }
  
  /**
   * Remove an event listener
   */
  public off(event: string, callback: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) return;
    
    this.eventListeners.get(event)?.delete(callback);
  }
  
  /**
   * Notify all listeners for a specific event
   */
  private notifyListeners(event: string, data: any): void {
    if (!this.eventListeners.has(event)) return;
    
    // Save data for offline access if it's a data event
    if (event === EVENTS.MARKET_DATA || event === EVENTS.TRADE_EXECUTED) {
      this.saveOfflineData(event, data);
    }
    
    this.eventListeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} event listener:`, error instanceof Error ? error.message : String(error));
      }
    });
  }
  
  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    // Stop timers
    this.stopPingTimer();
    this.stopReconnectTimer();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.connectionState = ConnectionState.DISCONNECTED;
    this.notifyListeners('connectionStateChanged', this.connectionState);
  }

  /**
   * Send market data to other connected clients
   * This is primarily for testing without a backend
   */
  public broadcastMarketData(data: MarketData): void {
    if (this.useMockData) {
      // When in mock mode, simulate receiving the data from server
      setTimeout(() => {
        this.notifyListeners(EVENTS.MARKET_DATA, data);
      }, 100);
    } else if (this.isConnected()) {
      // When connected to real server, emit the data
      this.send(EVENTS.MARKET_DATA, data);
    }
  }

  /**
   * Send trade data to other connected clients
   * This is primarily for testing without a backend
   */
  public broadcastTradeExecuted(data: Trade): void {
    if (this.useMockData) {
      // When in mock mode, simulate receiving the data from server
      setTimeout(() => {
        this.notifyListeners(EVENTS.TRADE_EXECUTED, data);
      }, 100);
    } else if (this.isConnected()) {
      // When connected to real server, emit the data
      this.send(EVENTS.TRADE_EXECUTED, data);
    }
  }
  
  /**
   * Get a hook for monitoring connection state
   */
  public useConnectionState() {
    const [state, setState] = React.useState(this.connectionState);
    
    React.useEffect(() => {
      const handleStateChange = (newState: ConnectionState) => {
        setState(newState);
      };
      
      this.on('connectionStateChanged', handleStateChange);
      
      return () => {
        this.off('connectionStateChanged', handleStateChange);
      };
    }, []);
    
    return state;
  }
}

// Export a singleton instance
export const webSocketService = WebSocketService.getInstance();

// Hook for using WebSocket in React components
export const useWebSocket = () => {
  const [connectionState, setConnectionState] = React.useState<ConnectionState>(
    webSocketService.getConnectionState()
  );
  const [isMockMode, setIsMockMode] = React.useState<boolean>(
    webSocketService.isMockMode()
  );
  const errorHandler = useErrorHandler();
  
  React.useEffect(() => {
    const handleStateChange = (state: ConnectionState) => {
      setConnectionState(state);
      setIsMockMode(webSocketService.isMockMode());
      
      // Handle connection errors
      if (state === ConnectionState.FAILED) {
        errorHandler.handleError(new Error('WebSocket connection failed after multiple attempts'));
      }
    };
    
    webSocketService.on('connectionStateChanged', handleStateChange);
    
    return () => {
      webSocketService.off('connectionStateChanged', handleStateChange);
    };
  }, [errorHandler]);
  
  return {
    connectionState,
    isMockMode,
    isConnected: webSocketService.isConnected(),
    connect: webSocketService.connect.bind(webSocketService),
    disconnect: webSocketService.disconnect.bind(webSocketService),
    subscribe: webSocketService.subscribeToMarket.bind(webSocketService),
    unsubscribe: webSocketService.unsubscribeFromMarket.bind(webSocketService),
    send: webSocketService.send.bind(webSocketService),
    on: webSocketService.on.bind(webSocketService),
    off: webSocketService.off.bind(webSocketService),
    getStats: webSocketService.getConnectionStats.bind(webSocketService)
  };
};
