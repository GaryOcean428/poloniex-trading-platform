import { getApiBaseUrl, getBackendUrl, } from "@/utils/environment";
import { getAccessToken } from "@/utils/auth";

/**
 * Poloniex Futures API Configuration
 * Using backend proxy to avoid CORS issues
 * Backend proxy endpoints: /api/futures/*
 */

// Always use backend proxy to avoid CORS issues
const BASE_HOST = typeof window !== 'undefined' ? window.location.origin : '';
const API_PREFIX = "/api/futures";

// Normalize symbol (UI uses BTC-USDT; backend expects BTC_USDT or BTC_USDT_PERP)
const normalizeFuturesSymbol = (sym?: string): string | undefined => {
    if (!sym) return sym;
    // Convert BTC-USDT -> BTC_USDT (backend normalizes to _PERP itself)
    return sym.replace(/-/g, "_").toUpperCase();
};

// API endpoints — mapped to actual backend routes in apps/api/src/routes/futures.ts
const ENDPOINTS = {
    // Authenticated account endpoints
    ACCOUNT_BALANCE: `${API_PREFIX}/balance`,
    ACCOUNT_BILLS: `${API_PREFIX}/account/bills`,
    CURRENT_POSITIONS: `${API_PREFIX}/positions`,
    POSITION_HISTORY: `${API_PREFIX}/position-history`,
    ADJUST_MARGIN: `${API_PREFIX}/position/margin`,
    GET_LEVERAGES: `${API_PREFIX}/leverage`,        // GET /leverage/:symbol (handled via param)
    SET_LEVERAGE: `${API_PREFIX}/leverage`,           // POST /leverage
    SWITCH_POSITION_MODE: `${API_PREFIX}/position-mode`,
    VIEW_POSITION_MODE: `${API_PREFIX}/position-mode`,
    PLACE_ORDER: `${API_PREFIX}/order`,
    CANCEL_ORDER: `${API_PREFIX}/order`,              // DELETE /order/:orderId
    CANCEL_ALL_ORDERS: `${API_PREFIX}/orders`,        // DELETE /orders?symbol=...
    ORDER_HISTORY: `${API_PREFIX}/order-history`,
    EXECUTION_DETAILS: `${API_PREFIX}/trades`,       // GET /trades (authenticated user trades)
    OPEN_ORDERS: `${API_PREFIX}/orders`,
    // Public market data endpoints
    MARKET_TICKER: `${API_PREFIX}/ticker`,
    MARKET_KLINES: `${API_PREFIX}/klines`,
    MARKET_DEPTH: `${API_PREFIX}/orderbook`,
    MARKET_TRADES: `${API_PREFIX}/trades`,            // GET /trades/:symbol (public)
    MARKET_FUNDING_RATE: `${API_PREFIX}/funding-rate`,
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
    eq: string;         // Total equity (the real balance field from Poloniex)
  availMgn: string;   // Available margin
  isoEq: string;
    im: string;
    mm: string;
    totalBalance?: number;       // Parsed convenience field
  availableBalance?: number;   // Parsed convenience field
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

// Create auth headers for backend proxy
// Backend handles Poloniex API authentication, frontend just needs JWT
const createAuthHeaders = (): Record<string, string> => {
    const token = getAccessToken();
    return {
          "Content-Type": "application/json",
          ...(token && { "Authorization": `Bearer ${token}` }),
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

      const headers = authenticated ? createAuthHeaders() : { "Content-Type": "application/json" };

      const response = await fetch(url.toString(), {
              method,
              headers,
              body: method !== "GET" ? body : undefined,
      });

      // Determine response content type up-front
      const contentType = response.headers.get("content-type") || "";

      // Handle non-OK responses with robust parsing
      if (!response.ok) {
              let errorPayload: unknown = {};
              if (contentType.includes("application/json")) {
                        errorPayload = await response.json().catch(() => ({}));
              } else {
                        const text = await response.text().catch(() => "");
                        errorPayload = { status: response.status, url: url.toString(), preview: text?.slice(0, 200) };
              }
              throw new Error(`API error (${response.status}) from ${url.toString()}: ${JSON.stringify(errorPayload)}`);
      }

      // Guard: successful but non-JSON response
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
                              availMgn: "10000.00",
                              isoEq: "5000.00",
                              im: "1000.00",
                              mm: "500.00",
                              totalBalance: 10000,
                              availableBalance: 10000,
                  } as T;
                  break;
        case ENDPOINTS.CURRENT_POSITIONS:
                  mockData = [
                    {
                                  symbol: "BTC_USDT_PERP",
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
                              symbol: String(params.symbol || "BTC_USDT_PERP"),
                              leverage: "10",
                              maxLeverage: "75",
                  } as T;
                  break;
        case ENDPOINTS.OPEN_ORDERS:
                  mockData = [] as T;
                  break;
        case ENDPOINTS.MARKET_TICKER:
                  mockData = {
                              symbol: String(params.symbol || "BTC_USDT_PERP"),
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
                              symbol: String(params.symbol || "BTC_USDT_PERP"),
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
        const raw = await this.request<FuturesAccountBalance>(
                "GET",
                ENDPOINTS.ACCOUNT_BALANCE
              );
        // Parse numeric fields for display convenience
      // Poloniex returns eq/availMgn as string decimals
      return {
              ...raw,
              totalBalance: parseFloat(raw.eq || "0"),
              availableBalance: parseFloat(raw.availMgn || raw.eq || "0"),
      };
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
        const result = await this.request<FuturesPosition[] | { data?: FuturesPosition[] }>(
                "GET",
                ENDPOINTS.CURRENT_POSITIONS,
                symbol ? { symbol } : {}
              );
        // Handle both array and wrapped response
      if (Array.isArray(result)) return result;
        if (result && (result as any).data) return (result as any).data;
        return [];
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
        // Backend: GET /api/futures/leverage/:symbol
      return this.request<LeverageInfo>("GET", `${ENDPOINTS.GET_LEVERAGES}/${normalizeFuturesSymbol(symbol)}`);
  }

  async setLeverage(params: {
        symbol: string;
        lever: string;
        mgnMode: MarginMode;
  }): Promise<GenericApiResponse> {
        return this.request<GenericApiResponse>(
                "POST",
                ENDPOINTS.SET_LEVERAGE,
          { symbol: normalizeFuturesSymbol(params.symbol), leverage: params.lever }
              );
  }

  async switchPositionMode(posMode: PositionMode): Promise<GenericApiResponse> {
        return this.request<GenericApiResponse>(
                "POST",
                ENDPOINTS.SWITCH_POSITION_MODE,
          { symbol: "BTC_USDT_PERP", mode: posMode === PositionMode.HEDGE ? "ISOLATED" : "CROSS" }
              );
  }

  async getPositionMode(): Promise<{ posMode: PositionMode }> {
        // This endpoint may not exist on backend - return safe default
      try {
              return await this.request<{ posMode: PositionMode }>(
                        "GET",
                        `${ENDPOINTS.VIEW_POSITION_MODE}/BTC_USDT_PERP`
                      );
      } catch {
              return { posMode: PositionMode.ONE_WAY };
      }
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
        return this.request<OrderResponse>("POST", ENDPOINTS.PLACE_ORDER, {
                ...params,
                symbol: normalizeFuturesSymbol(params.symbol),
        });
  }

  async cancelOrder(params: {
        symbol: string;
        orderId: string;
  }): Promise<OrderResponse> {
        // Backend: DELETE /api/futures/order/:orderId?symbol=...
      return this.request<OrderResponse>(
              "DELETE",
              `${ENDPOINTS.CANCEL_ORDER}/${params.orderId}`,
        { symbol: normalizeFuturesSymbol(params.symbol) }
            );
  }

  async cancelAllOrders(symbol?: string): Promise<GenericApiResponse> {
        // Backend: DELETE /api/futures/orders?symbol=...
      return this.request<GenericApiResponse>(
              "DELETE",
              ENDPOINTS.CANCEL_ALL_ORDERS,
              symbol ? { symbol: normalizeFuturesSymbol(symbol) } : {}
            );
  }

  async getOrderHistory(params: {
        symbol?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
  }): Promise<FuturesOrder[]> {
        const result = await this.request<FuturesOrder[] | any>("GET", ENDPOINTS.ORDER_HISTORY, params);
        if (Array.isArray(result)) return result;
        if (result && result.data) return result.data;
        return [];
  }

  async getOpenOrders(symbol?: string): Promise<FuturesOrder[]> {
        // Backend: GET /api/futures/orders?symbol=...
      const result = await this.request<FuturesOrder[] | any>("GET", ENDPOINTS.OPEN_ORDERS, symbol ? { symbol } : {});
        if (Array.isArray(result)) return result;
        if (result && result.data) return result.data;
        return [];
  }

  // Market data endpoints (public)
  async getMarketTicker(symbol: string): Promise<MarketTicker> {
        // Backend: GET /api/futures/ticker?symbol=BTC_USDT
      const data = await this.request<any>(
              "GET",
              ENDPOINTS.MARKET_TICKER,
        { symbol: normalizeFuturesSymbol(symbol) },
              false
            );
        // Normalize ticker response — Poloniex v3 returns array or single object
      const ticker = Array.isArray(data) ? data[0] : data;
        if (!ticker) throw new Error("No ticker data returned");
        return {
                symbol: ticker.symbol || symbol,
                last: ticker.close || ticker.last || ticker.lp || "0",
                bestAsk: ticker.ask || ticker.bestAsk || "0",
                bestBid: ticker.bid || ticker.bestBid || "0",
                high24h: ticker.high24h || ticker.high || "0",
                low24h: ticker.low24h || ticker.low || "0",
                volume24h: ticker.amount || ticker.volume24h || "0",
                fundingRate: ticker.fundingRate || "0",
                nextFundingTime: ticker.nextFundingTime || 0,
        };
  }

  async getMarketKlines(params: {
        symbol: string;
        interval: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
  }): Promise<MarketKline[]> {
        // Backend: GET /api/futures/klines/:symbol?interval=1h&limit=100
      const sym = normalizeFuturesSymbol(params.symbol) || params.symbol;
        const data = await this.request<any>(
                "GET",
                `${ENDPOINTS.MARKET_KLINES}/${sym}`,
          { interval: params.interval, limit: params.limit || 100 },
                false
              );
        if (!Array.isArray(data)) return [];
        // Poloniex V3 candles: [low, high, open, close, amt, qty, tC, sT, cT]
      return data.map((c: any) => ({
              ts: parseInt(c[7] || c.ts || Date.now()),
              open: String(c[2] || c.open || "0"),
              high: String(c[1] || c.high || "0"),
              low: String(c[0] || c.low || "0"),
              close: String(c[3] || c.close || "0"),
              volume: String(c[5] || c.volume || "0"),
      }));
  }

  async getMarketDepth(params: {
        symbol: string;
        limit?: number;
  }): Promise<MarketDepth> {
        // Backend: GET /api/futures/orderbook/:symbol?depth=20
      const sym = normalizeFuturesSymbol(params.symbol) || params.symbol;
        return this.request<MarketDepth>(
                "GET",
                `${ENDPOINTS.MARKET_DEPTH}/${sym}`,
          { depth: params.limit || 20 },
                false
              );
  }

  async getMarketTrades(params: {
        symbol: string;
        limit?: number;
  }): Promise<MarketTrade[]> {
        // Backend: GET /api/futures/trades/:symbol
      const sym = normalizeFuturesSymbol(params.symbol) || params.symbol;
        const data = await this.request<any>(
                "GET",
                `${ENDPOINTS.MARKET_TRADES}/${sym}`,
          {},
                false
              );
        if (!Array.isArray(data)) return [];
        return data.map((t: any) => ({
                ts: t.cT || t.ts || Date.now(),
                price: String(t.px || t.price || "0"),
                size: String(t.qty || t.size || "0"),
                side: (t.side === "sell" ? OrderSide.SELL : OrderSide.BUY),
        }));
  }

  async getMarketFundingRate(symbol: string): Promise<FundingRate> {
        // Backend: GET /api/futures/funding-rate/:symbol
      const sym = normalizeFuturesSymbol(symbol) || symbol;
        return this.request<FundingRate>(
                "GET",
                `${ENDPOINTS.MARKET_FUNDING_RATE}/${sym}`,
          {},
                false
              );
  }
}

export default PoloniexFuturesAPI;
