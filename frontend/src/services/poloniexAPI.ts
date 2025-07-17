import { useAppStore } from "@/store";
import { MarketData } from "@/types";
import axios from "axios";

import {
  getApiBaseUrl,
  shouldUseMockMode
} from "@/utils/environment";

// Poloniex V3 Futures API Configuration
const POLONIEX_V3_BASE_URL = "https://futures-api.poloniex.com/api/v1";

// Authentication token for backend API
const getAuthToken = (): string | null => {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
};

// Create axios instance with authentication
const createAuthenticatedAxios = () => {
  const token = getAuthToken();
  return axios.create({
    baseURL: getApiBaseUrl(),
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
  private cachedBalance: {
    totalAmount: string;
    availableAmount: string;
    accountEquity: string;
    unrealizedPnL: string;
    todayPnL: string;
    todayPnLPercentage: string;
  } | null = null;
  private historicalData: Map<string, MarketData[]> = new Map();
  private balanceUpdateInterval: number = 10000;
  private rateLimitQueue: Map<string, number[]> = new Map();

  private constructor() {
    this.loadCredentials();
  }

  public static getInstance(): PoloniexApiClient {
    if (!PoloniexApiClient.instance) {
      PoloniexApiClient.instance = new PoloniexApiClient();
    }
    return PoloniexApiClient.instance;
  }

  public loadCredentials(): void {
    try {
      const storeState = useAppStore.getState();
      const { isLiveTrading } = storeState.apiCredentials;
      this.mockMode = shouldUseMockMode(true) || !isLiveTrading;
    } catch {
      this.mockMode = shouldUseMockMode(false);
    }
  }

  private async checkRateLimit(type: string): Promise<void> {
    const now = Date.now();
    const key = `${type}_requests`;
    const limit = type === "public" ? RATE_LIMITS.PUBLIC_REQUESTS_PER_SECOND :
                  type === "private" ? RATE_LIMITS.PRIVATE_REQUESTS_PER_SECOND :
                  RATE_LIMITS.ORDERS_PER_SECOND;

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

  public async getAccountBalance(): Promise<{
    totalAmount: string;
    availableAmount: string;
    accountEquity: string;
    unrealizedPnL: string;
    todayPnL: string;
    todayPnLPercentage: string;
  } | null> {
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

  public async getMarketData(pair: string) {
    try {
      if (this.mockMode) {
        return this.generateMockMarketData(100);
      }

      await this.checkRateLimit("public");
      const api = createAuthenticatedAxios();
      const response = await api.get(`/klines/${pair}`, {
        params: {
          interval: "5m",
          limit: 100,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new PoloniexAPIError(
          `Market data not found for ${pair}`,
          "NOT_FOUND",
          404
        );
      }
      throw new PoloniexConnectionError(
        `Failed to fetch market data for ${pair}: ${safeErrorHandler(error).message}`
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
      const response = await api.get("/account/balances");

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new PoloniexAuthenticationError(
          "Authentication failed for positions"
        );
      }
      throw new PoloniexConnectionError(
        `Failed to fetch open positions: ${safeErrorHandler(error).message}`
      );
    }
  }

  public async placeOrder(
    pair: string,
    side: "buy" | "sell",
    type: "limit" | "market",
    quantity: number,
    price?: number
  ) {
    await this.checkRate
