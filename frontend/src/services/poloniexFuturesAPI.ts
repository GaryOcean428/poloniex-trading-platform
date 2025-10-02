import {
  getApiBaseUrl,
  getPoloniexApiKey,
  getPoloniexApiSecret,
} from "@/utils/environment";
import crypto from "crypto";

/**
 * Resolve Poloniex Futures REST base and API prefix
 * We avoid brittle string replaces and instead derive a canonical host + prefix.
 * Docs reference paths like: /v3/futures/api/market/get-*
 * - For hosts under api.poloniex.com we use baseHost=https://api.poloniex.com and apiPrefix=/v3/futures/api
 * - If a custom base explicitly targets a futures host, we fall back to /v3 by default
 */
const RAW_BASE = getApiBaseUrl("futures");
function resolveFuturesBase(raw: string): { baseHost: string; apiPrefix: string } {
  try {
    const u = new URL(raw);
    const host = u.origin; // protocol + host

    // Primary: standard API host
    if (host.includes("api.poloniex.com")) {
      return { baseHost: "https://api.poloniex.com", apiPrefix: "/v3/futures/api" };
    }

    // Secondary: futures-dedicated host
    if (host.includes("futures-api.poloniex.com")) {
      // Some deployments use /v3 on this host
      return { baseHost: host, apiPrefix: "/v3" };
    }

    // Fallback: default to api.poloniex.com
    return { baseHost: "https://api.poloniex.com", apiPrefix: "/v3/futures/api" };
  } catch {
    // If RAW_BASE isn't a valid URL, use canonical default
    return { baseHost: "https://api.poloniex.com", apiPrefix: "/v3/futures/api" };
  }
}

// Always use backend proxy to avoid CORS issues
const BASE_HOST = "";
const API_PREFIX = "/api/futures";

// Normalize symbol (UI uses BTC-USDT; API commonly expects BTCUSDT)
const normalizeFuturesSymbol = (sym?: string): string | undefined => {
  if (!sym) return sym;
  return sym.replace(/-/g, "").toUpperCase();
};

// API endpoints (aligned to documented futures routes)
const ENDPOINTS = {
  // Account / positions / trading (authenticated)
  ACCOUNT_BALANCE: `${API_PREFIX}/account/balance`,
  ACCOUNT_BILLS: `${API_PREFIX}/account/bills`,
  CURRENT_POSITIONS: `${API_PREFIX}/trade/position/opens`,
  POSITION_HISTORY: `${API_PREFIX}/trade/position/history`,
  ADJUST_MARGIN: `${API_PREFIX}/position/margin`,
  GET_LEVERAGES: `${API_PREFIX}/account/leverage-info`,
  SET_LEVERAGE: `${API_PREFIX}/trade/set-leverage`,
  SWITCH_POSITION_MODE: `${API_PREFIX}/position/mode`,
  VIEW_POSITION_MODE: `${API_PREFIX}/position/mode-info`,
  PLACE_ORDER: `${API_PREFIX}/trade/order`,
  CANCEL_ORDER: `${API_PREFIX}/trade/cancel-order`,
  CANCEL_ALL_ORDERS: `${API_PREFIX}/trade/cancel-all-orders`,
  ORDER_HISTORY: `${API_PREFIX}/trade/history-orders`,
  OPEN_ORDERS: `${API_PREFIX}/trade/open-orders`,

  // Market data (public)
  // Use "get-trading-info" for 24h stats/last price
  MARKET_TICKER: `${API_PREFIX}/market/get-trading-info`,
  // Klines/candles
  MARKET_KLINES: `${API_PREFIX}/market/get-kline-data`,
  // Order book (Level 2)
  MARKET_DEPTH: `${API_PREFIX}/market/get-order-book`,
  // Recent executions/trades
  MARKET_TRADES: `${API_PREFIX}/market/get-execution-info`,
  // Funding rate
  MARKET_FUNDING_RATE: `${API_PREFIX}/market/get-funding-rate`,
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
  return crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("base64");
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
  private baseHost: string;
  private mockMode: boolean;

  constructor(mockMode = false) {
    this.baseHost = BASE_HOST;
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

    const url = new URL(this.baseHost + endpoint);
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

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
    });

    // Determine response content type up-front
    const contentType = response.headers.get("content-type") || "";

    // Handle non-OK responses with robust parsing
    if (!response.ok) {
      // Try to parse JSON error first, otherwise capture text snippet
      let errorPayload: unknown = {};
      if (contentType.includes("application/json")) {
        errorPayload = await response.json().catch(() => ({}));
      } else {
        const text = await response.text().catch(() => "");
        errorPayload = { status: response.status, url: url.toString(), preview: text?.slice(0, 200) };
      }
      throw new Error(`API error (${response.status}) from ${url.toString()}: ${JSON.stringify(errorPayload)}`);
    }

    // Guard: successful but non-JSON (e.g., HTML index.html) should not be parsed as JSON
    if (!contentType.includes("application/json")) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Non-JSON response (${response.status}) from ${url.toString()}: ${text?.slice(0, 200)}`
      );
    }

    return (await response.json()) as T;
  }

  private mockResponse<T>(
    endpoint: string,
    params: Record<string, unknown>
  ): Promise<T> {
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
        mockData = [
          {
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
          },
        ] as T;
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
        mockData = [
          {
            ts: Date.now(),
            open: "50000.00",
            high: "50200.00",
            low: "49900.00",
            close: "50050.00",
            volume: "100.00",
          },
        ] as T;
        break;

      case ENDPOINTS.MARKET_DEPTH:
        mockData = {
          asks: [
            ["50010.00", "10.00"],
            ["50020.00", "20.00"],
          ],
          bids: [
            ["49990.00", "15.00"],
            ["49980.00", "25.00"],
          ],
          ts: Date.now(),
        } as T;
        break;

      case ENDPOINTS.MARKET_TRADES:
        mockData = [
          {
            ts: Date.now(),
            price: "50000.00",
            size: "0.1",
            side: OrderSide.BUY,
          },
        ] as T;
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
    return this.request<FuturesAccountBalance>(
      "GET",
      ENDPOINTS.ACCOUNT_BALANCE
    );
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
    return this.request<FuturesPosition[]>("GET", ENDPOINTS.CURRENT_POSITIONS, {
      symbol,
    });
  }

  async getPositionHistory(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<PositionHistory[]> {
    return this.request<PositionHistory[]>(
      "GET",
      ENDPOINTS.POSITION_HISTORY,
      params
    );
  }

  async adjustMargin(params: {
    symbol: string;
    posSide: PositionSide;
    amount: string;
  }): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>(
      "POST",
      ENDPOINTS.ADJUST_MARGIN,
      params
    );
  }

  async getLeverages(symbol: string): Promise<LeverageInfo> {
    return this.request<LeverageInfo>("GET", ENDPOINTS.GET_LEVERAGES, {
      symbol,
    });
  }

  async setLeverage(params: {
    symbol: string;
    lever: string;
    mgnMode: MarginMode;
  }): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>(
      "POST",
      ENDPOINTS.SET_LEVERAGE,
      params
    );
  }

  async switchPositionMode(posMode: PositionMode): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>(
      "POST",
      ENDPOINTS.SWITCH_POSITION_MODE,
      { posMode }
    );
  }

  async getPositionMode(): Promise<{ posMode: PositionMode }> {
    return this.request<{ posMode: PositionMode }>(
      "GET",
      ENDPOINTS.VIEW_POSITION_MODE
    );
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

  async cancelOrder(params: {
    symbol: string;
    orderId: string;
  }): Promise<OrderResponse> {
    return this.request<OrderResponse>("POST", ENDPOINTS.CANCEL_ORDER, params);
  }

  async cancelAllOrders(symbol?: string): Promise<GenericApiResponse> {
    return this.request<GenericApiResponse>(
      "POST",
      ENDPOINTS.CANCEL_ALL_ORDERS,
      { symbol }
    );
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
    return this.request<FuturesOrder[]>("GET", ENDPOINTS.OPEN_ORDERS, {
      symbol,
    });
  }

  // Market data endpoints
  async getMarketTicker(symbol: string): Promise<MarketTicker> {
    return this.request<MarketTicker>(
      "GET",
      ENDPOINTS.MARKET_TICKER,
      { symbol: normalizeFuturesSymbol(symbol) },
      false
    );
  }

  async getMarketKlines(params: {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<MarketKline[]> {
    const payload = {
      ...params,
      symbol: normalizeFuturesSymbol(params.symbol),
    };
    return this.request<MarketKline[]>(
      "GET",
      ENDPOINTS.MARKET_KLINES,
      payload,
      false
    );
  }

  async getMarketDepth(params: {
    symbol: string;
    limit?: number;
  }): Promise<MarketDepth> {
    const payload = {
      ...params,
      symbol: normalizeFuturesSymbol(params.symbol),
    };
    return this.request<MarketDepth>(
      "GET",
      ENDPOINTS.MARKET_DEPTH,
      payload,
      false
    );
  }

  async getMarketTrades(params: {
    symbol: string;
    limit?: number;
  }): Promise<MarketTrade[]> {
    const payload = {
      ...params,
      symbol: normalizeFuturesSymbol(params.symbol),
    };
    return this.request<MarketTrade[]>(
      "GET",
      ENDPOINTS.MARKET_TRADES,
      payload,
      false
    );
  }

  async getMarketFundingRate(symbol: string): Promise<FundingRate> {
    return this.request<FundingRate>(
      "GET",
      ENDPOINTS.MARKET_FUNDING_RATE,
      { symbol: normalizeFuturesSymbol(symbol) },
      false
    );
  }
}

export default PoloniexFuturesAPI;
