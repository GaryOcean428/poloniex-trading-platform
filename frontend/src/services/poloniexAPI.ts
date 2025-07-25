import { useAppStore } from "@/store";
import { MarketData } from "@/types";
import { getApiBaseUrl, shouldUseMockMode } from "@/utils/environment";
import axios from "axios";

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

// Custom error classes
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

const safeErrorHandler = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(String(error));
};

// Singleton API client
class PoloniexApiClient {
  private static instance: PoloniexApiClient;
  private mockMode: boolean = true;
  private lastBalanceUpdate: number = 0;
  private cachedBalance = null;
  private historicalData: Map<string, MarketData[]> = new Map();
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
      this.mockMode =
        shouldUseMockMode(true) || !storeState.apiCredentials.isLiveTrading;
    } catch {
      this.mockMode = shouldUseMockMode(false);
    }
  }

  private async checkRateLimit(type: string): Promise<void> {
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

  public async getAccountBalance(): Promise<{
    totalAmount: string;
    availableAmount: string;
    accountEquity: string;
    unrealizedPnL: string;
    todayPnL: string;
    todayPnLPercentage: string;
  } | null> {
    if (this.cachedBalance && Date.now() - this.lastBalanceUpdate < 10000) {
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
        const mockData = this.generateMockHistoricalData(startDate, endDate);
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
    } catch {
      const mockData = this.generateMockHistoricalData(startDate, endDate);
      this.historicalData.set(cacheKey, mockData);
      return mockData;
    }
  }

  private generateMockHistoricalData(
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
        pair: "BTC-USDT",
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

  public async placeOrder(
    pair: string,
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    quantity: number,
    price?: number
  ): Promise<{ orderId: string; status: string; id?: string }> {
    // TODO: Implement actual order placement
    // For now, return a mock response to satisfy the interface
    console.warn('placeOrder called - this is a stub implementation');
    
    if (this.mockMode) {
      const orderId = `mock_${Date.now()}`;
      return {
        orderId,
        id: orderId, // Add id field for compatibility
        status: 'filled'
      };
    }
    
    throw new Error('Order placement not implemented for live trading');
  }

  public async placeConditionalOrder(
    pair: string,
    side: 'buy' | 'sell',
    type: 'stop' | 'takeProfit',
    quantity: number,
    triggerPrice: number
  ): Promise<{ orderId: string; status: string }> {
    // TODO: Implement actual conditional order placement
    // For now, return a mock response to satisfy the interface
    console.warn('placeConditionalOrder called - this is a stub implementation');
    
    if (this.mockMode) {
      return {
        orderId: `mock_conditional_${Date.now()}`,
        status: 'pending'
      };
    }
    
    throw new Error('Conditional order placement not implemented for live trading');
  }

  // Event listener methods for automated trading
  public onPositionUpdate(callback: (data: any) => void): void {
    // TODO: Implement position update listener
    console.warn('onPositionUpdate called - this is a stub implementation');
  }

  public onLiquidationWarning(callback: (data: any) => void): void {
    // TODO: Implement liquidation warning listener
    console.warn('onLiquidationWarning called - this is a stub implementation');
  }

  public onMarginUpdate(callback: (data: any) => void): void {
    // TODO: Implement margin update listener
    console.warn('onMarginUpdate called - this is a stub implementation');
  }
}

export const poloniexApi = PoloniexApiClient.getInstance();
