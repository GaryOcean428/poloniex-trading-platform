/**
 * WebSocket Server Event Types
 * Aligned with @types/ws and Poloniex V3 API specifications
 */

// Core WebSocket Events (matching @types/ws)
export enum WebSocketEvents {
  // Connection lifecycle events
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

// Poloniex V3 API Events
export enum PoloniexEvents {
  // Market data events
  TICKER = 'ticker',
  ORDER_BOOK = 'orderbook',
  TRADE = 'trade',
  KLINE = 'kline',
  FUNDING = 'funding',
  
  // Account events (private channels)
  ACCOUNT = 'account',
  POSITION = 'position',
  ORDER = 'order',
  TRADE_EXECUTION = 'tradeExecution',
  
  // System events
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  SUBSCRIPTION_SUCCESS = 'subscriptionSuccess',
  SUBSCRIPTION_ERROR = 'subscriptionError'
}

// Combined event enum for frontend use
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

// Message types for WebSocket communication
export enum MessageTypes {
  WELCOME = 'welcome',
  PING = 'ping',
  PONG = 'pong',
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  MESSAGE = 'message',
  ACK = 'ack',
  ERROR = 'error'
}

// WebSocket event handler function signatures (aligned with @types/ws)
export interface WebSocketEventHandlers {
  onOpen: () => void | Promise<void>;
  onClose: (code: number, reason: Buffer) => void | Promise<void>;
  onError: (error: Error) => void | Promise<void>;
  onMessage: (data: Buffer, isBinary: boolean) => void | Promise<void>;
  onPing: (data: Buffer) => void | Promise<void>;
  onPong: (data: Buffer) => void | Promise<void>;
}

// Client-side event handler signatures
export interface ClientWebSocketEventHandlers {
  onConnectionChange: (state: string) => void;
  onMarketData: (data: any) => void;
  onTickerUpdate: (data: any) => void;
  onOrderBookUpdate: (data: any) => void;
  onTradeExecuted: (data: any) => void;
  onAccountUpdate: (data: any) => void;
  onPositionUpdate: (data: any) => void;
  onOrderUpdate: (data: any) => void;
  onError: (error: Error) => void;
}

// Event payload interfaces
export interface WebSocketEventPayload {
  type: string;
  timestamp: number;
  data?: any;
}

export interface PoloniexEventPayload extends WebSocketEventPayload {
  topic?: string;
  subject?: string;
  id?: number;
}

export interface ConnectionEventPayload extends WebSocketEventPayload {
  connectionType: 'public' | 'private';
  reconnectAttempts?: number;
}

export interface ErrorEventPayload extends WebSocketEventPayload {
  error: Error;
  context?: string;
  recoverable?: boolean;
}

export interface SubscriptionEventPayload extends WebSocketEventPayload {
  topic: string;
  symbols?: string[];
  success: boolean;
  message?: string;
}
