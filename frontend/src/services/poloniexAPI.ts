import { useAppStore } from "@/store";
import { FuturesOrder, MarketData, Position } from "@/types";
import axios from "axios";

import {
  getApiBaseUrl,
  IS_WEBCONTAINER,
  shouldUseMockMode,
} from "@/utils/environment";

// Use our secure backend API instead of direct Poloniex calls
const API_BASE_URL = getApiBaseUrl();

// Authentication token for backend API
const getAuthToken = (): string | null => {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
};

// Create axios instance with authentication
const createAuthenticatedAxios = () => {
  const token = getAuthToken();
  return axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
};

// Custom error classes for better error handling
export class PoloniexAPIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "PoloniexAPIError";
  }
}

export class PoloniexConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoloniexConnectionError";
  }
}

export class PoloniexAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoloniexAuthenticationError";
  }
}

// Rate limiting configuration
const RATE_LIMITS = {
  PUBLIC_REQUESTS_PER_SECOND: 10,
  PRIVATE_REQUESTS_PER_SECOND: 5,
  ORDERS_PER_SECOND: 2,
};

// Create a logger for API calls
const logApiCall = (_method: string, _endpoint: string, _data?: unknown) => {
  // Production logging should be handled by a dedicated service
};

// Safe error handler
const safeErrorHandler = (error: unknown): Error => {
  if (error instanceof Error) {
    return new Error(error.message);
  }
  return new Error(String(error));
};

// Create a singleton API client
class PoloniexApiClient {
  private static instance: PoloniexApiClient;
  private mockMode: boolean = true;
  private lastBalanceUpdate: number = 0;
  private cachedBalance: unknown = null;
  private historicalData: Map<string, MarketData[]> = new Map();
  private balanceUpdateInterval: number = 10000; // 10 seconds
  private requestCounter: number = 0;
  private rateLimitQueue: Map<string, number[]> = new Map();
  private positionUpdateCallbacks: Set<(positions: Position[]) => void> =
    new Set();
  private orderUpdateCallbacks: Set<(orders: FuturesOrder[]) => void> =
    new Set();
  private liquidationCallbacks: Set<
    (warning: { pair: string; message: string }) => void
  > = new Set();
  private marginCallbacks: Set<
    (margin: { pair: string; ratio: number }) => void
  > = new Set();

  private constructor() {
    this.loadCredentials();
  }

  public static getInstance(): PoloniexApiClient {
    if (!PoloniexApiClient.instance) {
      PoloniexApiClient.instance = new PoloniexApiClient();
    }
    return PoloniexApiClient.instance;
  }

  public onPositionUpdate(callback: (positions: Position[]) => void): void {
    this.positionUpdateCallbacks.add(callback);
  }

  public onOrderUpdate(callback: (orders: FuturesOrder[]) => void): void {
    this.orderUpdateCallbacks.add(callback);
  }

  public onLiquidationWarning(
    callback: (warning: { pair: string; message: string }) => void
  ): void {
    this.liquidationCallbacks.add(callback);
  }

  public onMarginUpdate(
    callback: (margin: { pair: string; ratio: number }) => void
  ): void {
    this.marginCallbacks.add(callback);
  }

  private async checkRateLimit(
    type: "public" | "private" | "order"
  ): Promise<void> {
    const now = Date.now();
    const key = `${type}_requests`;
    const limit =
      type === "public"
        ? RATE_LIMITS.PUBLIC_REQUESTS_PER_SECOND
        : type === "private"
        ? RATE_LIMITS.PRIVATE_REQUESTS_PER_SECOND
        : RATE_LIMITS.ORDERS_PER_SECOND;

    if (!this.rateLimitQueue.has(key)) {
      this.rateLimitQueue.set(key, []);
    }

    const queue = this.rateLimitQueue.get(key)!;
    const oneSecondAgo = now - 1000;

    while (queue.length > 0 && queue[0] < oneSecondAgo) {
      queue.shift();
    }

    if (queue.length >= limit) {
      const oldestRequest = queue[0];
      const waitTime = 1000 - (now - oldestRequest);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    queue.push(now);
  }

  public loadCredentials(): void {
    try {
      const storeState = useAppStore.getState();
      const { isLiveTrading } = storeState.apiCredentials;

      this.mockMode = shouldUseMockMode(true) || !isLiveTrading;

      this.cachedBalance = null;
      this.lastBalanceUpdate = 0;
    } catch (error) {
      this.mockMode = shouldUseMockMode(false);
    }
  }

  /**
   * Get account balance via secure backend
   */
  public async getAccountBalance() {
    if (
      this.cachedBalance &&
      Date.now() - this.lastBalanceUpdate < this.balanceUpdateInterval
    ) {
      return this.cachedBalance;
    }

    try {
      if (this.mockMode) {
        return {
          totalAmount: "15478.23",
          availableAmount: "12345.67",
          accountEquity: "15820.45",
          unrealizedPnL: "342.22",
          todayPnL: "156.78",
          todayPnLPercentage: "1.02",
        };
      }

      const api = createAuthenticatedAxios();
      logApiCall("GET", "/account/balances");

      const response = await api.get("/account/balances");

      this.cachedBalance = response.data;
      this.lastBalanceUpdate = Date.now();

      return this.cachedBalance;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new PoloniexAuthenticationError(
            "Authentication failed - please check your API credentials"
          );
        }
        if (
          error.response?.status === 400 &&
          error.response.data?.requiresApiKeys
        ) {
          throw new PoloniexAuthenticationError(
            "API credentials required - please add your Poloniex API keys"
          );
        }
        if (error.response?.status) {
          throw new PoloniexAPIError(
            `Backend API error: ${error.response.statusText}`,
            error.response.data?.code || "API_ERROR",
            error.response.status
          );
        }
      }

      throw new PoloniexConnectionError(
        `Failed to fetch account balance: ${safeErrorHandler(error).message}`
      );
    }
  }

  /**
   * Get market data via secure backend
   */
  public async getMarketData(pair: string) {
    try {
      if (this.mockMode) {
        return this.generateMockMarketData(100);
      }

      await this.checkRateLimit("public");
      const api = createAuthenticatedAxios();

      logApiCall("GET", `/klines/${pair}`);
      const response = await api.get(`/klines/${pair}`, {
        params: {
          interval: "5m",
          limit: 100,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new PoloniexAPIError(
            `Market data not found for ${pair}`,
            "NOT_FOUND",
            404
          );
        }
      }

      throw new PoloniexConnectionError(
        `Failed to fetch market data for ${pair}: ${
          safeErrorHandler(error).message
        }`
      );
    }
  }

  private generateMockMarketData(count: number) {
    return Array.from({ length: count }, (_, i) => {
      const basePrice = 50000 + Math.random() * 5000;
      const volatility = basePrice * 0.01;
      const timestamp = Date.now() - (count - 1 - i) * 60 * 1000;
      const open = basePrice + (Math.random() - 0.5) * volatility;
      const high = open + Math.random() * volatility;
      const low = open - Math.random() * volatility;
      const close = low + Math.random() * (high - low);

      return [
        new Date(timestamp).toISOString(),
        open.toString(),
        high.toString(),
        low.toString(),
        close.toString(),
        (100 + Math.random() * 900).toString(),
      ];
    });
  }

  /**
   * Get open positions via secure backend
   */
  public async getOpenPositions() {
    try {
      if (this.mockMode) {
        return {
          positions: [
            {
              symbol: "BTC_USDT_PERP",
              posId: "12345",
              pos: "long",
              marginMode: "cross",
              posCost: "25000",
              posSide: "long",
              posSize: "0.5",
              markPrice: "51000",
              unrealizedPnL: "500",
              liquidationPrice: "45000",
            },
          ],
        };
      }

      await this.checkRateLimit("private");
      const api = createAuthenticatedAxios();

      logApiCall("GET", "/account/balances");
      const response = await api.get("/account/balances");

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new PoloniexAuthenticationError(
            "Authentication failed for positions"
          );
        }
      }

      throw new PoloniexConnectionError(
        `Failed to fetch open positions: ${safeErrorHandler(error).message}`
      );
    }
  }

  /**
   * Place an order via secure backend
   */
  public async placeOrder(
    pair: string,
    side: "buy" | "sell",
    type: "limit" | "market",
    quantity: number,
    price?: number
  ) {
    await this.checkRateLimit("order");

    try {
      if (this.mockMode) {
        return {
          success: true,
          orderId: "mock-order-" + Date.now(),
          pair,
          side,
          type,
          quantity,
          price: price || "market",
        };
      }

      const api = createAuthenticatedAxios();
      const orderData = {
        symbol: pair,
        side: side.toUpperCase(),
        type: type.toUpperCase(),
        amount: quantity.toString(),
        ...(type === "limit" && price ? { price: price.toString() } : {}),
      };

      logApiCall("POST", "/orders", orderData);
      const response = await api.post("/orders", orderData);

      return response.data;
    } catch (error) {
      const safeError = safeErrorHandler(error);

      if (IS_WEBCONTAINER) {
        return {
          success: true,
          orderId: "mock-order-" + Date.now(),
          pair,
          side,
          type,
          quantity,
          price: price || "market",
        };
      }

      throw safeError;
    }
  }

  /**
   * Get recent trades via secure backend
   */
  public async getRecentTrades(pair: string, limit: number = 50) {
    try {
      if (this.mockMode) {
        return this.generateMockTrades(pair, limit);
      }

      await this.checkRateLimit("public");
      const api = createAuthenticatedAxios();

      logApiCall("GET", "/trades");
      const response = await api.get("/trades", {
        params: { symbol: pair, limit },
      });

      return response.data;
    } catch (error) {
      throw new PoloniexConnectionError(
        `Failed to fetch recent trades for ${pair}: ${
          safeErrorHandler(error).message
        }`
      );
    }
  }

  private generateMockTrades(_pair: string, limit: number) {
    return Array.from({ length: limit }, (_, i) => {
      const basePrice = 51000 + (Math.random() - 0.5) * 1000;
      const amount = 0.01 + Math.random() * 0.5;
      const timestamp = Date.now() - i * 60 * 1000;

      return {
        id: `mock-trade-${i}-${Date.now()}`,
        price: basePrice.toString(),
        quantity: amount.toString(),
        amount: (basePrice * amount).toString(),
        takerSide: Math.random() > 0.5 ? "buy" : "sell",
        ts: timestamp,
        createdAt: new Date(timestamp).toISOString(),
      };
    });
  }

  /**
   * Get historical market data for backtesting via secure backend
   */
  public async getHistoricalData(
    pair: string,
    startDate: string,
    endDate: string
  ): Promise<MarketData[]> {
    const cacheKey = `${pair}-${startDate}-${endDate}`;

    if (this.historicalData.has(cacheKey)) {
      return this.historicalData.get(cacheKey)!;
    }

    try {
      if (this.mockMode) {
        const mockData = this.generateMockHistoricalData(
          pair,
          startDate,
          endDate
        );
        this.historicalData.set(cacheKey, mockData);
        return mockData;
      }

      const api = createAuthenticatedAxios();

      const response = await api.get(`/klines/${pair}`, {
        params: {
          interval: "1h",
          startTime: new Date(startDate).getTime(),
          endTime: new Date(endDate).getTime(),
          limit: 1000,
        },
      });

      const data = response.data.map((candle: unknown[]) => ({
        pair,
        timestamp: new Date(candle[0] as string).getTime(),
        open: parseFloat(candle[1] as string),
        high: parseFloat(candle[2] as string),
        low: parseFloat(candle[3] as string),
        close: parseFloat(candle[4] as string),
        volume: parseFloat(candle[5] as string),
      }));

      this.historicalData.set(cacheKey, data);
      return data;
    } catch (error) {
      const mockData = this.generateMockHistoricalData(
        pair,
        startDate,
        endDate
      );
      this.historicalData.set(cacheKey, mockData);
      return mockData;
    }
  }

  private generateMockHistoricalData(
    pair: string,
    startDate: string,
    endDate: string
  ): MarketData[] {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const hourMs = 60 * 60 * 1000;
    const data: MarketData[] = [];

    let basePrice = 50000;

    for (let time = start; time <= end; time += hourMs) {
      const volatility = basePrice * 0.01;
      const open = basePrice + (Math.random() - 0.5) * volatility;
      const high = open + Math.random() * volatility;
      const low = open - Math.random() * volatility;
      const close = low + Math.random() * (high - low);

      data.push({
        pair,
        timestamp: time,
        open,
        high,
        low,
        close,
        volume: 100 + Math.random() * 900,
      });

      basePrice = close;
    }

    return data;
  }
}

// Export a singleton instance
export const poloniexApi = PoloniexApiClient.getInstance();
