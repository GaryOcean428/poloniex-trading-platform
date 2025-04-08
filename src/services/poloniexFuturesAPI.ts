import { getEnvVariable } from '@/utils/environment';

// Poloniex Futures API endpoints
const BASE_URL = 'https://futures-api.poloniex.com';
const V3_PREFIX = '/v3';

// API endpoints
const ENDPOINTS = {
  // Account endpoints
  ACCOUNT_BALANCE: `${V3_PREFIX}/account/balance`,
  ACCOUNT_BILLS: `${V3_PREFIX}/account/bills`,
  
  // Position endpoints
  CURRENT_POSITIONS: `${V3_PREFIX}/trade/position/opens`,
  POSITION_HISTORY: `${V3_PREFIX}/trade/position/history`,
  ADJUST_MARGIN: `${V3_PREFIX}/position/margin`,
  GET_LEVERAGES: `${V3_PREFIX}/account/leverage-info`,
  SET_LEVERAGE: `${V3_PREFIX}/trade/set-leverage`,
  SWITCH_POSITION_MODE: `${V3_PREFIX}/position/mode`,
  VIEW_POSITION_MODE: `${V3_PREFIX}/position/mode-info`,
  POSITION_RISK_LIMIT: `${V3_PREFIX}/position/risk-limit`,
  
  // Trading endpoints
  PLACE_ORDER: `${V3_PREFIX}/trade/order`,
  CANCEL_ORDER: `${V3_PREFIX}/trade/cancel-order`,
  CANCEL_ALL_ORDERS: `${V3_PREFIX}/trade/cancel-all-orders`,
  ORDER_HISTORY: `${V3_PREFIX}/trade/history-orders`,
  OPEN_ORDERS: `${V3_PREFIX}/trade/open-orders`,
  
  // Market data endpoints
  MARKET_TICKER: `${V3_PREFIX}/market/ticker`,
  MARKET_KLINES: `${V3_PREFIX}/market/candles`,
  MARKET_DEPTH: `${V3_PREFIX}/market/orderbook`,
  MARKET_TRADES: `${V3_PREFIX}/market/trades`,
  MARKET_FUNDING_RATE: `${V3_PREFIX}/market/funding-rate`,
};

// Position modes
export enum PositionMode {
  HEDGE = 'HEDGE',
  ONE_WAY = 'ONE_WAY'
}

// Position sides
export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
  BOTH = 'BOTH'
}

// Margin modes
export enum MarginMode {
  ISOLATED = 'ISOLATED',
  CROSS = 'CROSS'
}

// Order types
export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
  POST_ONLY = 'POST_ONLY',
  FOK = 'FOK',
  IOC = 'IOC'
}

// Order sides
export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

// Position status
export enum PositionStatus {
  NORMAL = 'NORMAL',
  LIQ = 'LIQ',
  ADL = 'ADL'
}

// Interface for futures position
export interface FuturesPosition {
  symbol: string;
  side: OrderSide;
  mgnMode: MarginMode;
  posSide: PositionSide;
  openAvgPx: string;
  qty: string;
  availQty: string;
  lever: string;
  adl: string;
  liqPx: string;
  im: string;
  mm: string;
  mgn: string;
  maxWAmt: string;
  upl: string;
  uplRatio: string;
  pnl: string;
  markPx: string;
  mgnRatio: string;
  state: PositionStatus;
}

// Interface for futures account balance
export interface FuturesAccountBalance {
  state: string;
  eq: string;
  isoEq: string;
  im: string;
  mm: string;
}

// Interface for futures order
export interface FuturesOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: string;
  size: string;
  value: string;
  leverage: string;
  marginMode: MarginMode;
  positionSide: PositionSide;
  state: string;
  createTime: number;
  updateTime: number;
  filledSize: string;
  filledValue: string;
  avgPrice: string;
  fee: string;
  clientOrderId?: string;
}

// Generate HMAC-SHA256 signature for API authentication
const generateSignature = (timestamp: string, method: string, requestPath: string, body: string = '') => {
  const crypto = require('crypto');
  const apiSecret = getEnvVariable('VITE_POLONIEX_API_SECRET');
  
  if (!apiSecret) {
    throw new Error('VITE_POLONIEX_API_SECRET is not defined in environment variables');
  }
  
  const message = timestamp + method + requestPath + body;
  return crypto.createHmac('sha256', apiSecret).update(message).digest('base64');
};

// Create headers for authenticated requests
const createAuthHeaders = (method: string, endpoint: string, body: string = '') => {
  const apiKey = getEnvVariable('VITE_POLONIEX_API_KEY');
  const passphrase = getEnvVariable('VITE_POLONIEX_PASSPHRASE');
  
  if (!apiKey || !passphrase) {
    throw new Error('VITE_POLONIEX_API_KEY or VITE_POLONIEX_PASSPHRASE is not defined in environment variables');
  }
  
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, endpoint, body);
  
  return {
    'Content-Type': 'application/json',
    'PF-API-KEY': apiKey,
    'PF-API-SIGN': signature,
    'PF-API-TIMESTAMP': timestamp,
    'PF-API-PASSPHRASE': passphrase
  };
};

// Poloniex Futures API client
class PoloniexFuturesAPI {
  private baseUrl: string;
  private mockMode: boolean;
  
  constructor(mockMode: boolean = false) {
    this.baseUrl = BASE_URL;
    this.mockMode = mockMode;
  }
  
  // Helper method for making API requests
  private async request<T>(
    method: string,
    endpoint: string,
    params: Record<string, any> = {},
    authenticated: boolean = true
  ): Promise<T> {
    if (this.mockMode) {
      return this.mockResponse<T>(endpoint, params);
    }
    
    const url = new URL(this.baseUrl + endpoint);
    let body = '';
    
    if (method === 'GET' && Object.keys(params).length > 0) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined) {
          url.searchParams.append(key, params[key]);
        }
      });
    } else if (method !== 'GET' && Object.keys(params).length > 0) {
      body = JSON.stringify(params);
    }
    
    const headers: Record<string, string> = authenticated 
      ? createAuthHeaders(method, endpoint, body)
      : { 'Content-Type': 'application/json' };
    
    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: method !== 'GET' ? body : undefined
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Poloniex Futures API error: ${JSON.stringify(errorData)}`);
      }
      
      return await response.json() as T;
    } catch (error) {
      console.error('Poloniex Futures API request failed:', error);
      throw error;
    }
  }
  
  // Mock responses for development and testing
  private mockResponse<T>(endpoint: string, params: Record<string, any>): Promise<T> {
    let mockData: any;
    
    switch (endpoint) {
      case ENDPOINTS.ACCOUNT_BALANCE:
        mockData = {
          state: 'NORMAL',
          eq: '10000.00',
          isoEq: '5000.00',
          im: '1000.00',
          mm: '500.00'
        };
        break;
        
      case ENDPOINTS.CURRENT_POSITIONS:
        mockData = [
          {
            symbol: 'BTC-USDT',
            side: 'BUY',
            mgnMode: 'ISOLATED',
            posSide: 'LONG',
            openAvgPx: '50000.00',
            qty: '0.1',
            availQty: '0.1',
            lever: '10',
            adl: '1',
            liqPx: '45000.00',
            im: '500.00',
            mm: '250.00',
            mgn: '500.00',
            maxWAmt: '4500.00',
            upl: '100.00',
            uplRatio: '0.02',
            pnl: '100.00',
            markPx: '51000.00',
            mgnRatio: '0.05',
            state: 'NORMAL'
          }
        ];
        
        if (params.symbol) {
          mockData = mockData.filter((pos: any) => pos.symbol === params.symbol);
        }
        break;
        
      case ENDPOINTS.VIEW_POSITION_MODE:
        mockData = {
          posMode: 'ONE_WAY'
        };
        break;
        
      case ENDPOINTS.GET_LEVERAGES:
        mockData = {
          symbol: params.symbol || 'BTC-USDT',
          leverage: '10',
          maxLeverage: '75'
        };
        break;
        
      case ENDPOINTS.OPEN_ORDERS:
        mockData = [];
        break;
        
      case ENDPOINTS.MARKET_TICKER:
        mockData = {
          symbol: params.symbol || 'BTC-USDT',
          last: '50000.00',
          bestAsk: '50010.00',
          bestBid: '49990.00',
          high24h: '51000.00',
          low24h: '49000.00',
          volume24h: '1000.00',
          fundingRate: '0.0001',
          nextFundingTime: Date.now() + 8 * 60 * 60 * 1000
        };
        break;
        
      default:
        mockData = {};
    }
    
    return Promise.resolve(mockData as T);
  }
  
  // Account endpoints
  async getAccountBalance(): Promise<FuturesAccountBalance> {
    return this.request<FuturesAccountBalance>('GET', ENDPOINTS.ACCOUNT_BALANCE);
  }
  
  async getAccountBills(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.ACCOUNT_BILLS, params);
  }
  
  // Position endpoints
  async getCurrentPositions(symbol?: string): Promise<FuturesPosition[]> {
    return this.request<FuturesPosition[]>('GET', ENDPOINTS.CURRENT_POSITIONS, { symbol });
  }
  
  async getPositionHistory(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.POSITION_HISTORY, params);
  }
  
  async adjustMargin(params: { symbol: string; posSide: PositionSide; amount: string }): Promise<any> {
    return this.request<any>('POST', ENDPOINTS.ADJUST_MARGIN, params);
  }
  
  async getLeverages(symbol: string): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.GET_LEVERAGES, { symbol });
  }
  
  async setLeverage(params: { symbol: string; lever: string; mgnMode: MarginMode }): Promise<any> {
    return this.request<any>('POST', ENDPOINTS.SET_LEVERAGE, params);
  }
  
  async switchPositionMode(posMode: PositionMode): Promise<any> {
    return this.request<any>('POST', ENDPOINTS.SWITCH_POSITION_MODE, { posMode });
  }
  
  async getPositionMode(): Promise<{ posMode: PositionMode }> {
    return this.request<{ posMode: PositionMode }>('GET', ENDPOINTS.VIEW_POSITION_MODE);
  }
  
  // Trading endpoints
  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    price?: string;
    size: string;
    posSide: PositionSide;
    clientOrderId?: string;
  }): Promise<any> {
    return this.request<any>('POST', ENDPOINTS.PLACE_ORDER, params);
  }
  
  async cancelOrder(params: { symbol: string; orderId: string }): Promise<any> {
    return this.request<any>('POST', ENDPOINTS.CANCEL_ORDER, params);
  }
  
  async cancelAllOrders(symbol?: string): Promise<any> {
    return this.request<any>('POST', ENDPOINTS.CANCEL_ALL_ORDERS, { symbol });
  }
  
  async getOrderHistory(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.ORDER_HISTORY, params);
  }
  
  async getOpenOrders(symbol?: string): Promise<FuturesOrder[]> {
    return this.request<FuturesOrder[]>('GET', ENDPOINTS.OPEN_ORDERS, { symbol });
  }
  
  // Market data endpoints
  async getMarketTicker(symbol: string): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.MARKET_TICKER, { symbol }, false);
  }
  
  async getMarketKlines(params: { symbol: string; interval: string; startTime?: number; endTime?: number; limit?: number }): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.MARKET_KLINES, params, false);
  }
  
  async getMarketDepth(params: { symbol: string; limit?: number }): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.MARKET_DEPTH, params, false);
  }
  
  async getMarketTrades(params: { symbol: string; limit?: number }): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.MARKET_TRADES, params, false);
  }
  
  async getMarketFundingRate(symbol: string): Promise<any> {
    return this.request<any>('GET', ENDPOINTS.MARKET_FUNDING_RATE, { symbol }, false);
  }
}

export default PoloniexFuturesAPI;
