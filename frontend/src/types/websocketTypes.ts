// WebSocket Service Type Definitions

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed",
}

export enum ReconnectionStrategy {
  EXPONENTIAL_BACKOFF = "exponential_backoff",
  LINEAR_BACKOFF = "linear_backoff",
  IMMEDIATE = "immediate",
  NONE = "none",
}

export interface PoloniexBulletToken {
  code: string;
  data: {
    instanceServers: Array<{
      endpoint: string;
      protocol: string;
      encrypt: boolean;
      pingInterval: number;
      pingTimeout: number;
    }>;
    token: string;
  };
}

export interface ConnectionConfig {
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
    [key: string]: unknown;
  };
}

export interface ConnectionStats {
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

export interface WebSocketMessage {
  type: string;
  topic?: string;
  data?: unknown;
  timestamp?: number;
}

export interface MarketData {
  pair: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  pair: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface KlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WebSocketHealth {
  state: ConnectionState;
  isHealthy: boolean;
  uptime: number;
  lastPing: number;
  latency: number | null;
  reconnectAttempts: number;
}

export interface PoloniexV3Config {
  BULLET_ENDPOINT: string;
  PUBLIC_WS_URL: string;
  PRIVATE_WS_URL: string;
  RECONNECT_INTERVAL: number;
  MAX_RECONNECT_ATTEMPTS: number;
  PING_INTERVAL: number;
  TOKEN_EXPIRY: number;
}

// WebSocket Events aligned with backend enums
export enum WebSocketEvents {
  // Connection lifecycle events (matching @types/ws)
  OPEN = 'open',
  CLOSE = 'close',
  ERROR = 'error',
  MESSAGE = 'message',
  PING = 'ping',
  PONG = 'pong',
  
  // Custom application events
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  RECONNECTED = 'reconnected',
  WELCOME = 'welcome',
  ACK = 'ack'
}

// Client-side WebSocket Events
export enum ClientWebSocketEvents {
  // Connection state
  CONNECTION_STATE_CHANGED = 'connectionStateChanged',
  CONNECTION_ESTABLISHED = 'connectionEstablished',
  CONNECTION_LOST = 'connectionLost',
  
  // Market data
  MARKET_DATA = 'marketData',
  TICKER_UPDATE = 'tickerUpdate',
  ORDER_BOOK_UPDATE = 'orderBookUpdate',
  TRADE_EXECUTED = 'tradeExecuted',
  KLINE_UPDATE = 'klineUpdate',
  
  // Account updates
  ACCOUNT_UPDATE = 'accountUpdate',
  POSITION_UPDATE = 'positionUpdate',
  ORDER_UPDATE = 'orderUpdate',
  BALANCE_UPDATE = 'balanceUpdate',
  
  // Subscription management
  MARKET_SUBSCRIBED = 'marketSubscribed',
  MARKET_UNSUBSCRIBED = 'marketUnsubscribed',
  SUBSCRIBE_MARKET = 'subscribeMarket',
  UNSUBSCRIBE_MARKET = 'unsubscribeMarket',
  
  // Error handling
  WEBSOCKET_ERROR = 'websocketError',
  SUBSCRIPTION_ERROR = 'subscriptionError',
  RECONNECTION_ERROR = 'reconnectionError'
}

// Poloniex V3 Topics (exact API paths)
export enum PoloniexTopics {
  // Public market data
  TICKER = '/contractMarket/ticker',
  TICKER_V2 = '/contractMarket/tickerV2',
  LEVEL2 = '/contractMarket/level2',
  LEVEL3 = '/contractMarket/level3',
  EXECUTION = '/contractMarket/execution',
  KLINE = '/contractMarket/candles',
  
  // Private account data
  WALLET = '/contractAccount/wallet',
  POSITION = '/contractAccount/position',
  ORDERS = '/contractAccount/orders',
  TRADES = '/contractAccount/trades',
  
  // System topics
  FUNDING = '/contract/funding',
  SYSTEM = '/contract/system'
}

export interface SocketIOEvents {
  CONNECT: string;
  DISCONNECT: string;
  RECONNECT: string;
  RECONNECT_ATTEMPT: string;
  RECONNECT_ERROR: string;
  RECONNECT_FAILED: string;
  CONNECT_ERROR: string;
  CONNECT_TIMEOUT: string;
  MARKET_DATA: string;
  TRADE_EXECUTED: string;
  ERROR: string;
  SUBSCRIBE_MARKET: string;
  UNSUBSCRIBE_MARKET: string;
  PING: string;
  PONG: string;
}

export interface SubscriptionMessage {
  id: number;
  type: string;
  topic?: string;
  symbols?: string[];
  privateChannel?: boolean;
  response?: boolean;
}

export interface ConnectionHealth {
  state: ConnectionState;
  isHealthy: boolean;
  uptime: number;
  lastPing: number;
  latency: number | null;
  reconnectAttempts: number;
}

export interface WebSocketServiceInterface {
  connect(token?: string): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  isMockMode(): boolean;
  getConnectionState(): ConnectionState;
  getConnectionStats(): ConnectionStats;
  subscribeToMarket(pair: string): void;
  unsubscribeFromMarket(pair: string): void;
  send(event: string, data: unknown): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
  subscribeToPoloniexV3(topic: string, symbols?: string[]): void;
  unsubscribeFromPoloniexV3(topic: string): void;
}

export interface TestResult {
  success: boolean;
  error?: string;
  recommendation?: string;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface PoloniexApiResponse<T> {
  code: string;
  data: T;
  msg?: string;
}

export interface PoloniexTicker {
  symbol: string;
  price: string;
  open: string;
  high: string;
  low: string;
  volume: string;
  timestamp: number;
}

export interface PoloniexContract {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  volume24h: string;
  turnover24h: string;
  openInterest: string;
  maxLeverage: number;
}

export interface PoloniexKline {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}
