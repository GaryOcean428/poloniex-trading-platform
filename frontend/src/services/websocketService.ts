import React from 'react';
import { io, Socket } from 'socket.io-client';
import { MarketData, Trade } from '@/types';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { getBackendUrl, getPoloniexApiKey, getPoloniexApiSecret, shouldUseMockMode, getPoloniexWebSocketUrl } from '@/utils/environment';
import { WEBSOCKET_CONFIG, HEALTH_CHECK_CONFIG } from './websocket/config';

// Socket.io events for internal backend
const SOCKET_IO_EVENTS = {
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

// Poloniex V3 futures WebSocket configuration
const POLONIEX_WS_CONFIG = {
  url: getPoloniexWebSocketUrl('private'), // V3 futures private stream
  publicUrl: getPoloniexWebSocketUrl('public'), // V3 futures public stream
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  pingInterval: 30000
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
  private poloniexWs: WebSocket | null = null; // Direct Poloniex WebSocket
  private usePoloniexDirect: boolean = false; // Flag to determine connection type
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
  private pingInterval: number = WEBSOCKET_CONFIG.pingInterval;
  private pingTimeout: number = WEBSOCKET_CONFIG.pingTimeout;
  private lastPingTime: number = 0;
  private lastPongTime: number = 0;
  private offlineData: Map<string, any> = new Map();
  private connectionAttempted: boolean = false;
  private useMockData: boolean = true; // Default to mock data
  private healthCheckEndpoint: string = '/api/health';
  private subscriptions: Set<string> = new Set();
  private pendingMessages: Array<{event: string, data: any}> = [];
  
  // Add error logging throttling
  private lastErrorLog: { [key: string]: number } = {};
  private ERROR_LOG_THROTTLE_MS = 30000; // 30 seconds
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
  
  private config: ConnectionConfig = {
    url: getBackendUrl(),
    options: {
      ...WEBSOCKET_CONFIG,
      reconnectionStrategy: ReconnectionStrategy.EXPONENTIAL_BACKOFF,
      initialReconnectDelay: WEBSOCKET_CONFIG.reconnectionDelay,
      maxReconnectDelay: WEBSOCKET_CONFIG.reconnectionDelayMax,
      maxReconnectAttempts: WEBSOCKET_CONFIG.reconnectionAttempts,
      reconnectionJitter: WEBSOCKET_CONFIG.randomizationFactor,
      timeout: 10000,
      pingInterval: WEBSOCKET_CONFIG.pingInterval,
      pingTimeout: WEBSOCKET_CONFIG.pingTimeout,
      autoConnect: WEBSOCKET_CONFIG.autoConnect,
      forceNew: true,
      transports: WEBSOCKET_CONFIG.transports
    }
  };
  
  private constructor() {
    // Determine connection strategy based on environment and credentials
    const hasCredentials = !!(getPoloniexApiKey() && getPoloniexApiSecret());
    const mockMode = shouldUseMockMode(hasCredentials);
    
    // Use direct Poloniex connection if we have credentials and not in mock mode
    this.usePoloniexDirect = hasCredentials && !mockMode;
    this.useMockData = mockMode;
    
    console.log('WebSocket Service initialized:', {
      usePoloniexDirect: this.usePoloniexDirect,
      useMockData: this.useMockData,
      hasCredentials
    });
    
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
   * Throttled logging to prevent console spam
   */
  private throttledLog(type: 'log' | 'warn' | 'error', key: string, message: string, ...args: any[]): void {
    const now = Date.now();
    const lastLog = this.lastErrorLog[key] || 0;
    
    if (now - lastLog > this.ERROR_LOG_THROTTLE_MS) {
      if (import.meta.env.DEV) {
        console[type](message, ...args);
      }
      this.lastErrorLog[key] = now;
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
    this.stopPoloniexPingTimer();
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
      if (this.connectionState !== ConnectionState.CONNECTED) {
        return;
      }
      
      this.lastPingTime = Date.now();
      this.connectionStats.lastPingTime = this.lastPingTime;
      
      if (this.usePoloniexDirect && this.poloniexWs) {
        // For Poloniex, the WebSocket handles ping/pong automatically
        // We just track timing
      } else if (this.socket) {
        // For backend Socket.IO connection, send ping
        this.socket.emit(SOCKET_IO_EVENTS.PING, { timestamp: this.lastPingTime });
        
        // Set timeout for pong response
        setTimeout(() => {
          const pongElapsed = this.lastPongTime - this.lastPingTime;
          
          // If we haven't received a pong or it's too old
          if (pongElapsed <= 0 || pongElapsed > this.pingTimeout) {
            this.throttledLog('warn', 'ping-timeout', `WebSocket ping timeout after ${this.pingTimeout}ms`);
            
            // Force disconnect and reconnect
            if (this.socket) {
              this.socket.disconnect();
              this.handleDisconnect(new Error('Ping timeout'));
            }
          }
        }, this.pingTimeout);
      }
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
   * Connect to Poloniex V3 futures WebSocket directly
   */
  private connectToPoloniex(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = POLONIEX_WS_CONFIG.publicUrl; // Start with public stream
        
        console.log('Connecting to Poloniex V3 futures WebSocket:', wsUrl);
        
        this.poloniexWs = new WebSocket(wsUrl);
        
        this.poloniexWs.onopen = () => {
          console.log('Connected to Poloniex V3 futures WebSocket');
          this.connectionState = ConnectionState.CONNECTED;
          this.useMockData = false;
          this.reconnectAttempts = 0;
          
          // Update connection stats
          this.connectionStats.connectTime = Date.now();
          
          // Start ping timer
          this.startPoloniexPingTimer();
          
          // Subscribe to default channels
          this.subscribeToPoloniexChannels();
          
          // Notify listeners
          this.notifyListeners('connectionStateChanged', this.connectionState);
          
          resolve();
        };
        
        this.poloniexWs.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handlePoloniexMessage(data);
          } catch (error) {
            console.error('Error parsing Poloniex WebSocket message:', error);
          }
        };
        
        this.poloniexWs.onerror = (error) => {
          console.error('Poloniex WebSocket error:', error);
          this.handlePoloniexDisconnect();
          reject(error);
        };
        
        this.poloniexWs.onclose = () => {
          console.log('Poloniex WebSocket connection closed');
          this.handlePoloniexDisconnect();
        };
        
      } catch (error) {
        console.error('Failed to create Poloniex WebSocket connection:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Handle Poloniex WebSocket messages
   */
  private handlePoloniexMessage(data: any): void {
    try {
      // Handle different message types from Poloniex
      if (data.channel === 'ticker' && data.data) {
        const tickerData = Array.isArray(data.data) ? data.data : [data.data];
        
        tickerData.forEach((ticker: any) => {
          const marketData: MarketData = {
            pair: ticker.symbol?.replace('_', '-') || 'BTC-USDT',
            timestamp: Date.now(),
            open: parseFloat(ticker.open) || 0,
            high: parseFloat(ticker.high) || 0,
            low: parseFloat(ticker.low) || 0,
            close: parseFloat(ticker.close) || 0,
            volume: parseFloat(ticker.quantity) || 0
          };
          
          this.notifyListeners(SOCKET_IO_EVENTS.MARKET_DATA, marketData);
        });
      } else if (data.channel === 'trades' && data.data) {
        // Handle trades data
        const tradesData = Array.isArray(data.data) ? data.data : [data.data];
        
        tradesData.forEach((trade: any) => {
          const tradeData: Trade = {
            id: trade.id,
            pair: trade.symbol?.replace('_', '-') || 'BTC-USDT',
            price: parseFloat(trade.price) || 0,
            amount: parseFloat(trade.quantity) || 0,
            side: trade.takerSide === 'buy' ? 'buy' : 'sell',
            timestamp: trade.ts || Date.now()
          };
          
          this.notifyListeners(SOCKET_IO_EVENTS.TRADE_EXECUTED, tradeData);
        });
      }
    } catch (error) {
      console.error('Error handling Poloniex message:', error);
    }
  }
  
  /**
   * Subscribe to Poloniex channels
   */
  private subscribeToPoloniexChannels(): void {
    if (!this.poloniexWs || this.poloniexWs.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Subscribe to ticker data for major pairs
    const subscribeMessage = {
      event: 'subscribe',
      channel: ['ticker'],
      symbols: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'ADA_USDT', 'DOT_USDT']
    };
    
    this.poloniexWs.send(JSON.stringify(subscribeMessage));
    console.log('Subscribed to Poloniex ticker channels');
  }
  
  /**
   * Handle Poloniex WebSocket disconnection
   */
  private handlePoloniexDisconnect(): void {
    this.connectionState = ConnectionState.DISCONNECTED;
    this.connectionStats.disconnectTime = Date.now();
    this.connectionStats.totalDisconnects++;
    
    this.stopPoloniexPingTimer();
    
    // Notify listeners
    this.notifyListeners('connectionStateChanged', this.connectionState);
    
    // Attempt to reconnect
    this.reconnectToPoloniex();
  }
  
  /**
   * Reconnect to Poloniex WebSocket
   */
  private reconnectToPoloniex(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max Poloniex reconnect attempts reached, switching to mock mode');
      this.useMockData = true;
      this.connectionState = ConnectionState.FAILED;
      this.notifyListeners('connectionStateChanged', this.connectionState);
      return;
    }
    
    const delay = this.calculateReconnectDelay();
    this.reconnectAttempts++;
    this.connectionState = ConnectionState.RECONNECTING;
    
    console.log(`Reconnecting to Poloniex in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connectToPoloniex()
        .then(() => {
          console.log('Poloniex reconnection successful');
          this.connectionStats.successfulReconnects++;
        })
        .catch(() => {
          console.log('Poloniex reconnection failed');
          this.connectionStats.failedReconnects++;
          this.reconnectToPoloniex();
        });
    }, delay);
  }
  
  /**
   * Start ping timer for Poloniex connection
   */
  private startPoloniexPingTimer(): void {
    this.stopPoloniexPingTimer();
    
    this.pingTimer = setInterval(() => {
      if (this.poloniexWs && this.poloniexWs.readyState === WebSocket.OPEN) {
        // Poloniex WebSocket handles ping/pong automatically
        // We just track the connection health
        this.lastPingTime = Date.now();
        this.connectionStats.lastPingTime = this.lastPingTime;
      }
    }, POLONIEX_WS_CONFIG.pingInterval);
  }
  
  /**
   * Stop ping timer for Poloniex connection
   */
  private stopPoloniexPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
  /**
   * Connect to the WebSocket server (either Poloniex direct or internal backend)
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
          this.throttledLog('log', 'using-mock-data', 'Using mock data (previous connection attempt failed)');
          this.connectionState = ConnectionState.FAILED;
          resolve();
          return;
        }
        
        this.connectionAttempted = true;
        
        // Choose connection method based on configuration
        if (this.usePoloniexDirect) {
          console.info('Attempting direct Poloniex V3 futures WebSocket connection...');
          this.connectToPoloniex()
            .then(() => {
              resolve();
            })
            .catch((error) => {
              console.warn('Failed to connect to Poloniex, falling back to mock mode:', error);
              this.useMockData = true;
              this.connectionState = ConnectionState.FAILED;
              resolve();
            });
        } else {
          console.info('Attempting internal backend WebSocket connection...');
          this.connectToBackend(token)
            .then(() => {
              resolve();
            })
            .catch((error) => {
              console.warn('Failed to connect to backend, using mock mode:', error);
              this.useMockData = true;
              this.connectionState = ConnectionState.FAILED;
              resolve();
            });
        }
      } catch (error) {
        this.throttledLog('error', 'websocket-connection-error', 'WebSocket connection error:', error instanceof Error ? error.message : String(error));
        this.useMockData = true;
        this.connectionState = ConnectionState.FAILED;
        resolve();
      }
    });
  }
  
  /**
   * Connect to internal backend (original Socket.IO logic)
   */
  private connectToBackend(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (import.meta.env.DEV) {
          console.info('Attempting internal backend WebSocket connection...');
        }
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
          this.throttledLog('warn', 'connection-timeout', `WebSocket connection timed out after ${this.config.options?.timeout || 10000}ms`);
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
          this.throttledLog('log', 'webcontainer-mock', 'Running in WebContainer environment, defaulting to mock data');
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
          
          // Configure socket.io options with enhanced stability settings
          const socketOptions = {
            auth: this.config.auth,
            transports: this.config.options?.transports || ['websocket', 'polling'],
            reconnection: false, // We handle reconnection ourselves
            timeout: this.config.options?.timeout || 10000,
            forceNew: this.config.options?.forceNew || true,
            autoConnect: this.config.options?.autoConnect !== undefined ? 
                        this.config.options.autoConnect : false,
            // Additional stability settings
            closeOnBeforeunload: false,
            withCredentials: true,
            upgrade: true
          };
          
          this.socket = io(this.config.url, socketOptions);
          
          // Set up event handlers
          this.setupSocketEventHandlers();
          
          // Connect if autoConnect is false
          if (!socketOptions.autoConnect) {
            this.socket.connect();
          }
          
          resolve();
        })
        .catch(error => {
          // Server is not available, use mock data
          clearTimeout(connectionTimeout);
          this.throttledLog('log', 'server-unavailable', 'Server not available, using mock data:', error.message);
          this.useMockData = true;
          this.connectionState = ConnectionState.FAILED;
          resolve();
        });
      } catch (error) {
        this.throttledLog('error', 'websocket-connection-error', 'WebSocket connection error:', error instanceof Error ? error.message : String(error));
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
    this.socket.on(SOCKET_IO_EVENTS.CONNECT, () => {
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
    
    this.socket.on(SOCKET_IO_EVENTS.DISCONNECT, (reason) => {
      this.throttledLog('log', 'websocket-disconnect', `WebSocket disconnected: ${reason}`);
      this.handleDisconnect(new Error(reason));
    });
    
    this.socket.on(SOCKET_IO_EVENTS.CONNECT_ERROR, (error) => {
      this.throttledLog('error', 'websocket-connect-error', 'WebSocket connection error:', error);
      this.handleDisconnect(error);
    });
    
    this.socket.on(SOCKET_IO_EVENTS.CONNECT_TIMEOUT, () => {
      this.throttledLog('error', 'websocket-timeout', 'WebSocket connection timeout');
      this.handleDisconnect(new Error('Connection timeout'));
    });
    
    // Ping/pong for connection health monitoring
    this.socket.on(SOCKET_IO_EVENTS.PONG, (data: { timestamp: number }) => {
      this.lastPongTime = Date.now();
      this.connectionStats.lastPongTime = this.lastPongTime;
      
      // Calculate ping latency
      if (data && data.timestamp) {
        this.connectionStats.pingLatency = this.lastPongTime - data.timestamp;
      }
    });
    
    // Data events
    this.socket.on(SOCKET_IO_EVENTS.MARKET_DATA, (data: MarketData) => {
      this.notifyListeners(SOCKET_IO_EVENTS.MARKET_DATA, data);
    });
    
    this.socket.on(SOCKET_IO_EVENTS.TRADE_EXECUTED, (data: Trade) => {
      this.notifyListeners(SOCKET_IO_EVENTS.TRADE_EXECUTED, data);
    });
    
    this.socket.on(SOCKET_IO_EVENTS.CHAT_MESSAGE, (data: ChatMessage) => {
      this.notifyListeners(SOCKET_IO_EVENTS.CHAT_MESSAGE, data);
    });
    
    this.socket.on(SOCKET_IO_EVENTS.ERROR, (error) => {
      console.error('WebSocket error:', typeof error === 'object' ? JSON.stringify(error) : error);
      this.notifyListeners(SOCKET_IO_EVENTS.ERROR, error);
    });
  }
  
  /**
   * Resubscribe to previous subscriptions after reconnect
   */
  private resubscribe(): void {
    if (!this.isConnected()) return;
    
    console.log(`Resubscribing to ${this.subscriptions.size} channels`);
    
    this.subscriptions.forEach(subscription => {
      if (this.usePoloniexDirect && this.poloniexWs) {
        // For Poloniex direct connection, send subscription message
        const subscribeMessage = {
          event: 'subscribe',
          channel: ['ticker'],
          symbols: [subscription.replace('-', '_')]
        };
        this.poloniexWs.send(JSON.stringify(subscribeMessage));
      } else if (this.socket) {
        // For backend connection, use Socket.IO events
        this.socket.emit(SOCKET_IO_EVENTS.SUBSCRIBE_MARKET, { pair: subscription });
      }
    });
  }
  
  /**
   * Send any pending messages after reconnect
   */
  private sendPendingMessages(): void {
    if (!this.isConnected()) return;
    
    console.log(`Sending ${this.pendingMessages.length} pending messages`);
    
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        if (this.usePoloniexDirect && this.poloniexWs) {
          // For Poloniex direct connection, send as JSON
          this.poloniexWs.send(JSON.stringify(message));
        } else if (this.socket) {
          // For backend connection, use Socket.IO events
          this.socket.emit(message.event, message.data);
        }
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
    if (this.usePoloniexDirect) {
      return this.connectionState === ConnectionState.CONNECTED && 
             this.poloniexWs !== null && 
             this.poloniexWs.readyState === WebSocket.OPEN;
    } else {
      return this.connectionState === ConnectionState.CONNECTED && this.socket !== null;
    }
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
        this.notifyListeners(SOCKET_IO_EVENTS.MARKET_DATA, offlineData);
      }
      return;
    }
    
    if (this.usePoloniexDirect && this.poloniexWs) {
      // For Poloniex direct connection
      const subscribeMessage = {
        event: 'subscribe',
        channel: ['ticker'],
        symbols: [pair.replace('-', '_')]
      };
      this.poloniexWs.send(JSON.stringify(subscribeMessage));
    } else if (this.socket) {
      // For backend Socket.IO connection
      this.socket.emit(SOCKET_IO_EVENTS.SUBSCRIBE_MARKET, { pair });
    }
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
    
    if (this.usePoloniexDirect && this.poloniexWs) {
      // For Poloniex direct connection
      const unsubscribeMessage = {
        event: 'unsubscribe',
        channel: ['ticker'],
        symbols: [pair.replace('-', '_')]
      };
      this.poloniexWs.send(JSON.stringify(unsubscribeMessage));
    } else if (this.socket) {
      // For backend Socket.IO connection
      this.socket.emit(SOCKET_IO_EVENTS.UNSUBSCRIBE_MARKET, { pair });
    }
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
    
    if (this.usePoloniexDirect && this.poloniexWs) {
      // For Poloniex direct connection, send as JSON
      const message = { event, ...data };
      this.poloniexWs.send(JSON.stringify(message));
    } else if (this.socket) {
      // For backend Socket.IO connection
      this.socket.emit(event, data);
    }
  }
  
  /**
   * Send a chat message
   */
  public sendChatMessage(message: string, username: string): void {
    this.send(SOCKET_IO_EVENTS.CHAT_MESSAGE, {
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
    if (event === SOCKET_IO_EVENTS.MARKET_DATA || event === SOCKET_IO_EVENTS.TRADE_EXECUTED) {
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
    this.stopPoloniexPingTimer();
    this.stopReconnectTimer();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    if (this.poloniexWs) {
      this.poloniexWs.close();
      this.poloniexWs = null;
    }
    
    this.connectionState = ConnectionState.DISCONNECTED;
    this.notifyListeners('connectionStateChanged', this.connectionState);
  }

  /**
   * Handle page visibility change
   * When page becomes hidden, we maintain connection but reduce activity
   * When page becomes visible, we ensure connection is active
   */
  public handlePageVisibilityChange(isVisible: boolean): void {
    if (isVisible) {
      // Page visible - ensure connection is active
      console.log('Page visible - ensuring WebSocket connection is active');
      if (this.connectionState === ConnectionState.DISCONNECTED || 
          this.connectionState === ConnectionState.FAILED) {
        this.connect();
      }
    } else {
      // Page hidden - maintain connection but log the state
      console.log('Page hidden - maintaining WebSocket connection in background');
      // We don't disconnect on tab blur to maintain real-time data flow
    }
  }

  /**
   * Get connection health information
   */
  public getConnectionHealth(): {
    state: ConnectionState;
    isHealthy: boolean;
    uptime: number;
    lastPing: number;
    latency: number | null;
    reconnectAttempts: number;
  } {
    const now = Date.now();
    const uptime = this.connectionStats.connectTime ? 
      now - this.connectionStats.connectTime : 0;
    
    return {
      state: this.connectionState,
      isHealthy: this.connectionState === ConnectionState.CONNECTED,
      uptime,
      lastPing: this.connectionStats.lastPingTime || 0,
      latency: this.connectionStats.pingLatency,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Send market data to other connected clients
   * This is primarily for testing without a backend
   */
  public broadcastMarketData(data: MarketData): void {
    if (this.useMockData) {
      // When in mock mode, simulate receiving the data from server
      setTimeout(() => {
        this.notifyListeners(SOCKET_IO_EVENTS.MARKET_DATA, data);
      }, 100);
    } else if (this.isConnected()) {
      // When connected to real server, emit the data
      this.send(SOCKET_IO_EVENTS.MARKET_DATA, data);
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
        this.notifyListeners(SOCKET_IO_EVENTS.TRADE_EXECUTED, data);
      }, 100);
    } else if (this.isConnected()) {
      // When connected to real server, emit the data
      this.send(SOCKET_IO_EVENTS.TRADE_EXECUTED, data);
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
