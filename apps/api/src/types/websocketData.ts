/**
 * WebSocket Data Type Definitions
 * Type-safe interfaces for Poloniex V3 WebSocket message data
 */

// Account data interfaces
export interface AccountData {
  accountId?: string;
  equity?: number;
  availableBalance?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  marginRatio?: number;
  totalMargin?: number;
  unrealisedPnl?: number;
  timestamp?: number;
}

// Position data interfaces
export interface PositionData {
  symbol?: string;
  side?: string;
  currentQty?: number;
  availableQty?: number;
  markPrice?: number;
  unrealisedPnl?: number;
  liquidationPrice?: number;
  avgEntryPrice?: number;
  marginType?: string;
  positionSide?: string;
  timestamp?: number;
}

// Order data interfaces
export interface OrderData {
  orderId?: string;
  symbol?: string;
  side?: string;
  type?: string;
  status?: string;
  filledSize?: number;
  filledValue?: number;
  avgPrice?: number;
  fee?: number;
  size?: number;
  price?: number;
  timeInForce?: string;
  timestamp?: number;
}

// Trade execution data interfaces
export interface TradeExecutionData {
  tradeId?: string;
  orderId?: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  value?: number;
  fee?: number;
  liquidity?: string;
  ts?: number;
  timestamp?: number;
}

// Ticker data interfaces
export interface TickerData {
  symbol?: string;
  price?: number;
  lastPrice?: number;
  markPrice?: number;
  indexPrice?: number;
  bestBid?: number;
  bestAsk?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  turnover24h?: number;
  change24h?: number;
  fundingRate?: number;
  nextFundingTime?: number;
  openInterest?: number;
  ts?: number;
  timestamp?: number;
}

// Order book data interfaces
export interface OrderBookData {
  symbol?: string;
  asks?: Array<[string, string]>;
  bids?: Array<[string, string]>;
  timestamp?: number;
  sequence?: number;
}

// Trade data interfaces
export interface TradeData {
  symbol?: string;
  price?: number;
  size?: number;
  side?: string;
  timestamp?: number;
  sequence?: number;
}

// Funding data interfaces
export interface FundingData {
  symbol?: string;
  fundingRate?: number;
  timestamp?: number;
}

// Generic WebSocket data type union
export type WebSocketData = 
  | AccountData 
  | PositionData 
  | OrderData 
  | TradeExecutionData 
  | TickerData 
  | OrderBookData 
  | TradeData 
  | FundingData 
  | unknown;

// Type guards for runtime type checking
export function isAccountData(data: unknown): data is AccountData {
  return typeof data === 'object' && data !== null && 
    ('accountId' in data || 'equity' in data || 'availableBalance' in data);
}

export function isPositionData(data: unknown): data is PositionData {
  return typeof data === 'object' && data !== null && 
    ('symbol' in data && 'currentQty' in data);
}

export function isOrderData(data: unknown): data is OrderData {
  return typeof data === 'object' && data !== null && 
    ('orderId' in data || 'status' in data);
}

export function isTradeExecutionData(data: unknown): data is TradeExecutionData {
  return typeof data === 'object' && data !== null && 
    ('tradeId' in data && 'orderId' in data);
}

export function isTickerData(data: unknown): data is TickerData {
  return typeof data === 'object' && data !== null && 
    ('symbol' in data && ('price' in data || 'lastPrice' in data));
}

export function isOrderBookData(data: unknown): data is OrderBookData {
  return typeof data === 'object' && data !== null && 
    ('asks' in data || 'bids' in data);
}

export function isTradeData(data: unknown): data is TradeData {
  return typeof data === 'object' && data !== null && 
    ('symbol' in data && 'price' in data && 'size' in data);
}

export function isFundingData(data: unknown): data is FundingData {
  return typeof data === 'object' && data !== null && 
    ('fundingRate' in data);
}