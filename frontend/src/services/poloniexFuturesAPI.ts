import {
  getApiBaseUrl,
  getPoloniexApiKey,
  getPoloniexApiSecret,
} from "@/utils/environment";
import crypto from "crypto";

// Get configured API base URL
const BASE_URL = getApiBaseUrl("futures").replace("/v3", "");
const V3_PREFIX = "/v3";

// API endpoints
const ENDPOINTS = {
  ACCOUNT_BALANCE: `${V3_PREFIX}/account/balance`,
  ACCOUNT_BILLS: `${V3_PREFIX}/account/bills`,
  CURRENT_POSITIONS: `${V3_PREFIX}/trade/position/opens`,
  POSITION_HISTORY: `${V3_PREFIX}/trade/position/history`,
  ADJUST_MARGIN: `${V3_PREFIX}/position/margin`,
  GET_LEVERAGES: `${V3_PREFIX}/account/leverage-info`,
  SET_LEVERAGE: `${V3_PREFIX}/trade/set-leverage`,
  SWITCH_POSITION_MODE: `${V3_PREFIX}/position/mode`,
  VIEW_POSITION_MODE: `${V3_PREFIX}/position/mode-info`,
  PLACE_ORDER: `${V3_PREFIX}/trade/order`,
  CANCEL_ORDER: `${V3_PREFIX}/trade/cancel-order`,
  CANCEL_ALL_ORDERS: `${V3_PREFIX}/trade/cancel-all-orders`,
  ORDER_HISTORY: `${V3_PREFIX}/trade/history-orders`,
  OPEN_ORDERS: `${V3_PREFIX}/trade/open-orders`,
  MARKET_TICKER: `${V3_PREFIX}/market/ticker`,
  MARKET_KLINES: `${V3_PREFIX}/market/candles`,
  MARKET_DEPTH: `${V3_PREFIX}/market/orderbook`,
  MARKET_TRADES: `${V3_PREFIX}/market/trades`,
  MARKET_FUNDING_RATE: `${V3_PREFIX}/market/funding-rate`,
};

// Enums
export enum PositionMode {
  HEDGE = "HEDGE",
  ONE_WAY = "ONE_WAY",
}

export enum PositionSide {
  LONG = "LONG",
  SHORT = "SHORT",
  BOTH = "BOTH",
}

export enum MarginMode {
  ISOLATED = "ISOLATED",
  CROSS = "CROSS",
}

export enum OrderType {
  LIMIT = "LIMIT",
  MARKET = "MARKET",
  POST_ONLY = "POST_ONLY",
  FOK = "FOK",
  IOC = "IOC",
}

export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

export enum PositionStatus {
  NORMAL = "NORMAL",
  LIQ = "LIQ",
  ADL = "ADL",
}

// Interfaces
export interface AccountBill {
  billId: string;
  symbol: string;
  currency: string;
  amount: string;
  balance: string;
  type: string;
  ts: number;
}

export interface PositionHistory {
  symbol: string;
  side: OrderSide;
  posSide: PositionSide;
  mgnMode: MarginMode;
  openAvgPx: string;
  closeAvgPx: string;
  qty: string;
  lever: string;
  openTime: number;
  closeTime: number;
  pnl: string;
  state: string;
}

export interface LeverageInfo {
  symbol: string;
  leverage: string;
  maxLeverage: string;
}

export interface OrderResponse {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: string;
  size: string;
  filledSize: string;
  filledValue: string;
  state: string;
  createTime: number;
  updateTime: number;
}

export interface GenericApiResponse {
  code: string;
  msg: string;
  data: Record<string, unknown>;
}

export interface MarketTicker {
  symbol: string;
  last: string;
  bestAsk: string;
  bestBid: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  fundingRate: string;
  nextFundingTime: number;
}

export interface MarketKline {
  ts: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface MarketDepth {
  asks: [string, string][];
  bids: [string, string][];
  ts: number;
}

export interface MarketTrade {
  ts: number;
  price: string;
  size: string;
  side: OrderSide;
}

export interface FundingRate {
  symbol: string;
  fundingRate: string;
  nextFundingTime: number;
}

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

export interface FuturesAccountBalance {
  state: string;
  eq: string;
  isoEq: string;
  im: string;
  mm: string;
}

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

// Generate HMAC-SHA256 signature
const generateSignature = (
  timestamp: string,
  method: string,
  requestPath: string,
  body: string = ""
): string => {
  const apiSecret = getPoloniexApiSecret();
  if (!apiSecret) {
    throw new Error("VITE_POLONIEX_API_SECRET is not defined");
  }
  const message = timestamp + method + requestPath + body;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("base64");
};

// Create auth headers
const createAuthHeaders = (
  method: string,
  endpoint: string,
  body: string = ""
): Record<string, string> => {
  const apiKey = getPoloniexApiKey();
  if (!apiKey) {
    throw new Error("VITE_POLONIEX_API_KEY is not defined");
  }
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, endpoint, body);
  return {
    "Content-Type": "application/json",
    "PF-API-KEY": apiKey,
    "PF-API-SIGN": signature,
    "PF-API-TIMESTAMP": timestamp,
  };
};

// Main API class
class PoloniexFuturesAPI {
  private baseUrl: string;
  private mockMode: boolean;

  constructor(mockMode = false) {
    this.baseUrl = BASE_URL;
    this.mockMode = mockMode;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    params: Record<string, unknown> = {},
    authenticated = true
  ): Promise<T> {
    if (this.mockMode) {
      return this.mockResponse<T>(endpoint, params);
    }

    const url = new URL(this.baseUrl + endpoint);
    let body = "";

    if (method === "GET" && Object.keys(params).length > 0) {
      Object.keys(params).forEach((key) => {
        if (params[key] !== undefined) {
          url.searchParams.append(key, String(params[key]));
        }
      });
    } else if (method !== "GET" && Object.keys(params).length > 0) {
      body = JSON.stringify(params);
    }

    const headers = authenticated
      ? createAuthHeaders(method, endpoint, body)
      : { "Content-Type": "application/json" };

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: method !== "GET" ? body : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API error: ${JSON.stringify(errorData)}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      console.error("Poloniex Futures API request failed:", error);
      throw error;
    }
  }

  private mockResponse<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
    let mockData: T;

    switch (endpoint) {
      case ENDPOINTS.ACCOUNT_BALANCE:
        mockData = {
          state: "NORMAL",
          eq: "10000.00",
          isoEq: "5000.00",
          im: "1000.00",
          mm: "500.00",
        } as T;
        break;

      case ENDPOINTS.CURRENT_POSITIONS:
        mockData = [{
          symbol: "BTC-USDT",
          side: OrderSide.BUY,
          mgnMode: MarginMode.ISOLATED,
          posSide: PositionSide.LONG,
          openAvgPx: "50000.00",
          qty: "0.1",
          availQty: "0.1",
          lever: "10",
          adl: "1",
          liqPx: "45000.00",
          im: "500.00",
          mm: "250.00",
          mgn: "500.00",
          maxWAmt: "4500.00",
          upl: "100.00",
          uplRatio: "0.02",
          pnl: "100.00",
          markPx: "51000.00",
          mgnRatio: "0.05",
          state: PositionStatus.NORMAL,
        }] as T;
        break;

      case ENDPOINTS.VIEW_POSITION_MODE:
        mockData = { posMode: PositionMode.ONE_WAY } as T;
        break;

      case ENDPOINTS.GET_LEVERAGES:
        mockData = {
          symbol: String(params.symbol || "BTC-USDT"),
          leverage: "10",
          maxLeverage: "75",
        } as T;
        break;

      case ENDPOINTS.OPEN_ORDERS:
        mockData = [] as T;
        break;

      case ENDPOINTS.MARKET_TICKER:
        mockData = {
          symbol: String(params.symbol || "BTC-USDT"),
          last: "50000.00",
          bestAsk: "50010.00",
          bestBid: "49990.00",
          high24h: "51000.00",
          low24h: "49000.00",
          volume24h: "1000.00",
          fundingRate: "0.0001",
          nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
        } as T;
        break;

      case ENDPOINTS.MARKET_KLINES:
        mockData = [{
          ts: Date.now(),
          open: "50000.00",
          high: "50200.00",
          low: "49900.00",
          close: "50050.00",
          volume: "100.00",
        }] as T;
        break;

      case ENDPOINTS.MARKET_DEPTH:
        mockData = {
          asks: [["50010.00", "10.00"], ["50020.00", "20.00"]],
          bids: [["49990.00", "15.00"], ["49980.00", "25.00"]],
          ts: Date.now(),
        } as T;
        break;

      case ENDPOINTS.MARKET_TRADES:
        mockData = [{
          ts: Date.now(),
          price: "50000.00",
          size: "0.1",
          side: OrderSide.BUY,
        }] as T;
        break;

      case ENDPOINTS.MARKET_FUNDING_RATE:
        mockData = {
          symbol: String(params.symbol || "BTC-USDT"),
          fundingRate: "0.0001",
          nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
        } as T;
        break;

      default:
        mockData = {} as T;
    }

    return Promise.resolve(mockData);
  }

  // Account endpoints
  async getAccountBalance(): Promise<FuturesAccountBalance> {
    return this.request<FuturesAccountBalance>("GET", ENDPOINTS.ACCOUNT_BALANCE);
  }

  async getAccountBills(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<AccountBill[]> {
    return this.request<AccountBill[]>("GET", ENDPOINTS.ACCOUNT_BILLS, params);
  }

  // Position endpoints
  async getCurrentPositions(symbol?: string): Promise<FuturesPosition[]> {
    return this.request<FuturesPosition[]>("GET", ENDPOINTS.CURRENT_POSITIONS, { symbol });
  }

  async getPositionHistory(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<PositionHistory[]> {
    return this.request<PositionHistory[]>("GET", ENDPOINTS.POSITION_HISTORY, params);
  }

  async adjustMargin(params: {
    symbol: string;
    posSide: PositionSide;
    amount: string;
  }): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>("POST", ENDPOINTS.ADJUST_MARGIN, params);
  }

  async getLeverages(symbol: string): Promise<LeverageInfo> {
    return this.request<LeverageInfo>("GET", ENDPOINTS.GET_LEVERAGES, { symbol });
  }

  async setLeverage(params: {
    symbol: string;
    lever: string;
    mgnMode: MarginMode;
  }): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>("POST", ENDPOINTS.SET_LEVERAGE, params);
  }

  async switchPositionMode(posMode: PositionMode): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>("POST", ENDPOINTS.SWITCH_POSITION_MODE, { posMode });
  }

  async getPositionMode(): Promise<{ posMode: PositionMode }> {
    return this.request<{ posMode: PositionMode }>("GET", ENDPOINTS.VIEW_POSITION_MODE);
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
  }): Promise<OrderResponse> {
    return this.request<OrderResponse>("POST", ENDPOINTS.PLACE_ORDER, params);
  }

  async cancelOrder(params: { symbol: string; orderId: string }): Promise<OrderResponse> {
    return this.request<OrderResponse>("POST", ENDPOINTS.CANCEL_ORDER, params);
  }

  async cancelAllOrders(symbol?: string): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>("POST", ENDPOINTS.CANCEL_ALL_ORDERS, { symbol });
  }

  async getOrderHistory(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<FuturesOrder[]> {
    return this.request<FuturesOrder[]>("GET", ENDPOINTS.ORDER_HISTORY, params);
  }

  async getOpenOrders(symbol?: string): Promise<FuturesOrder[]> {
    return this.request<FuturesOrder[]>("GET", ENDPOINTS.OPEN_ORDERS, { symbol });
  }

  // Market data endpoints
  async getMarketTicker(symbol: string): Promise<MarketTicker> {
    return this.request<MarketTicker>("GET", ENDPOINTS.MARKET_TICKER, { symbol }, false);
  }

  async getMarketKlines(params: {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<MarketKline[]> {
    return this.request<MarketKline[]>("GET", ENDPOINTS.MARKET_KLINES, params, false);
  }

  async getMarketDepth(params: {
    symbol: string;
    limit?: number;
  }): Promise<MarketDepth> {
    return this.request<MarketDepth>("GET", ENDPOINTS.MARKET_DEPTH, params, false);
  }

  async getMarketTrades(params: {
    symbol: string;
    limit?: number;
  }): Promise<MarketTrade[]> {
    return this.request<MarketTrade[]>("GET", ENDPOINTS.MARKET_TRADES, params, false);
  }

  async getMarketFundingRate(symbol: string): Promise<FundingRate> {
    return this.request<FundingRate>("GET", ENDPOINTS.MARKET_FUNDING_RATE, { symbol }, false);
  }
}

export default PoloniexFuturesAPI;
