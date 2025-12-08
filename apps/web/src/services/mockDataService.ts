import { MarketData, OrderBook, Ticker, Trade } from "@/types";
import {
  generateRandomMarketData,
  generateRandomOrderBook,
  generateRandomTicker,
  generateRandomTrades,
} from "./mockDataGenerators";

// Cache for historical data
const historicalDataCache: Record<string, MarketData[]> = {};
const orderBookCache: Record<string, OrderBook> = {};
const tradesCache: Record<string, Trade[]> = {};
const tickerCache: Record<string, Ticker> = {};

// Mock mode configuration
interface MockDataConfig {
  isMockMode: boolean;
  mockDataSource: "random" | "historical" | "simulation";
  mockDataDelay: number;
  mockVolatility: number;
  mockTrendBias: number;
  mockHistoricalPeriod: string;
  mockDataOptions: {
    simulateLatency: boolean;
    simulateErrors: boolean;
    errorRate: number;
    useRandomSeed: boolean;
    randomSeed?: number;
  };
}

// Default mock configuration
let mockConfig: MockDataConfig = {
  isMockMode: false,
  mockDataSource: "random",
  mockDataDelay: 1000,
  mockVolatility: 0.02,
  mockTrendBias: 0,
  mockHistoricalPeriod: "30d",
  mockDataOptions: {
    simulateLatency: true,
    simulateErrors: true,
    errorRate: 0.05,
    useRandomSeed: false,
  },
};

/**
 * Configure mock data service
 */
export const configureMockData = (config: Partial<MockDataConfig>) => {
  mockConfig = { ...mockConfig, ...config };
};

/**
 * Mock data service for generating and managing mock market data
 */
export const mockDataService = {
  /**
   * Get mock market data for a specific symbol and timeframe
   */
  getMarketData: (
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<MarketData[]> => {
    // If not in mock mode, reject with error
    if (!mockConfig.isMockMode) {
      return Promise.reject(new Error("Mock mode is disabled"));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockConfig.mockDataOptions.simulateLatency
        ? Math.random() * mockConfig.mockDataDelay
        : 0;

      // Simulate random errors if enabled
      if (
        mockConfig.mockDataOptions.simulateErrors &&
        Math.random() < mockConfig.mockDataOptions.errorRate
      ) {
        setTimeout(() => {
          reject(new Error("Simulated network error"));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          let data: MarketData[];

          switch (mockConfig.mockDataSource) {
            case "random":
              // Generate random data with specified parameters
              data = generateRandomMarketData(
                symbol,
                timeframe,
                limit,
                mockConfig.mockVolatility,
                mockConfig.mockTrendBias,
                mockConfig.mockDataOptions.useRandomSeed
                  ? mockConfig.mockDataOptions.randomSeed
                  : undefined
              );
              break;

            case "historical":
              // Use cached historical data or generate new data
              const cacheKey = `${symbol}_${timeframe}_${mockConfig.mockHistoricalPeriod}`;
              if (!historicalDataCache[cacheKey]) {
                // In a real implementation, this would fetch from a historical data API
                // For now, we'll generate random data as a placeholder
                historicalDataCache[cacheKey] = generateRandomMarketData(
                  symbol,
                  timeframe,
                  limit * 5, // Generate more data for historical cache
                  mockConfig.mockVolatility,
                  mockConfig.mockTrendBias,
                  mockConfig.mockDataOptions.useRandomSeed
                    ? mockConfig.mockDataOptions.randomSeed
                    : undefined
                );
              }

              // Return a slice of the cached data
              data = historicalDataCache[cacheKey].slice(0, limit);
              break;

            case "simulation":
              // Generate simulated market data based on realistic market behavior
              // This would be more sophisticated in a real implementation
              data = generateRandomMarketData(
                symbol,
                timeframe,
                limit,
                mockConfig.mockVolatility,
                mockConfig.mockTrendBias,
                mockConfig.mockDataOptions.useRandomSeed
                  ? mockConfig.mockDataOptions.randomSeed
                  : undefined
              );
              break;

            default:
              data = [];
          }

          resolve(data);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  },

  /**
   * Get mock order book data for a specific symbol
   */
  getOrderBook: (symbol: string): Promise<OrderBook> => {
    // If not in mock mode, reject with error
    if (!mockConfig.isMockMode) {
      return Promise.reject(new Error("Mock mode is disabled"));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockConfig.mockDataOptions.simulateLatency
        ? Math.random() * mockConfig.mockDataDelay
        : 0;

      // Simulate random errors if enabled
      if (
        mockConfig.mockDataOptions.simulateErrors &&
        Math.random() < mockConfig.mockDataOptions.errorRate
      ) {
        setTimeout(() => {
          reject(new Error("Simulated network error"));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          // Use cached order book or generate new one
          if (!orderBookCache[symbol]) {
            orderBookCache[symbol] = generateRandomOrderBook(
              symbol,
              mockConfig.mockVolatility,
              mockConfig.mockDataOptions.useRandomSeed
                ? mockConfig.mockDataOptions.randomSeed
                : undefined
            );
          } else {
            // Update the existing order book with some changes to simulate market activity
            const book = orderBookCache[symbol];
            const updatedBook = generateRandomOrderBook(
              symbol,
              mockConfig.mockVolatility,
              mockConfig.mockDataOptions.useRandomSeed
                ? mockConfig.mockDataOptions.randomSeed
                : undefined
            );

            // Merge some of the new orders with existing ones
            orderBookCache[symbol] = {
              ...book,
              bids: [...book.bids.slice(3), ...updatedBook.bids.slice(0, 3)],
              asks: [...book.asks.slice(3), ...updatedBook.asks.slice(0, 3)],
              timestamp: Date.now(),
            };
          }

          resolve(orderBookCache[symbol]);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  },

  /**
   * Get mock trades for a specific symbol
   */
  getTrades: (symbol: string, limit: number = 50): Promise<Trade[]> => {
    // If not in mock mode, reject with error
    if (!mockConfig.isMockMode) {
      return Promise.reject(new Error("Mock mode is disabled"));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockConfig.mockDataOptions.simulateLatency
        ? Math.random() * mockConfig.mockDataDelay
        : 0;

      // Simulate random errors if enabled
      if (
        mockConfig.mockDataOptions.simulateErrors &&
        Math.random() < mockConfig.mockDataOptions.errorRate
      ) {
        setTimeout(() => {
          reject(new Error("Simulated network error"));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          // Generate new trades
          const newTrades = generateRandomTrades(
            symbol,
            limit,
            mockConfig.mockVolatility,
            mockConfig.mockDataOptions.useRandomSeed
              ? mockConfig.mockDataOptions.randomSeed
              : undefined
          );

          // Update cache
          tradesCache[symbol] = newTrades;

          resolve(newTrades);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  },

  /**
   * Get mock ticker data for a specific symbol
   */
  getTicker: (symbol: string): Promise<Ticker> => {
    // If not in mock mode, reject with error
    if (!mockConfig.isMockMode) {
      return Promise.reject(new Error("Mock mode is disabled"));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockConfig.mockDataOptions.simulateLatency
        ? Math.random() * mockConfig.mockDataDelay
        : 0;

      // Simulate random errors if enabled
      if (
        mockConfig.mockDataOptions.simulateErrors &&
        Math.random() < mockConfig.mockDataOptions.errorRate
      ) {
        setTimeout(() => {
          reject(new Error("Simulated network error"));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          // Use cached ticker as base or generate new one
          if (!tickerCache[symbol]) {
            tickerCache[symbol] = generateRandomTicker(
              symbol,
              mockConfig.mockVolatility,
              mockConfig.mockTrendBias,
              mockConfig.mockDataOptions.useRandomSeed
                ? mockConfig.mockDataOptions.randomSeed
                : undefined
            );
          } else {
            // Update the existing ticker with some changes to simulate market activity
            const prevTicker = tickerCache[symbol];
            const priceFactor =
              1 +
              (Math.random() * mockConfig.mockVolatility * 0.02 -
                0.01 +
                mockConfig.mockTrendBias * 0.005);
            const volumeFactor =
              1 + (Math.random() * mockConfig.mockVolatility * 0.1 - 0.05);

            tickerCache[symbol] = {
              ...prevTicker,
              lastPrice: prevTicker.lastPrice * priceFactor,
              bidPrice: prevTicker.bidPrice * priceFactor,
              askPrice: prevTicker.askPrice * priceFactor,
              volume24h: prevTicker.volume24h * volumeFactor,
              high24h: Math.max(
                prevTicker.high24h,
                prevTicker.lastPrice * priceFactor
              ),
              low24h: Math.min(
                prevTicker.low24h,
                prevTicker.lastPrice * priceFactor
              ),
              timestamp: Date.now(),
            };
          }

          resolve(tickerCache[symbol]);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  },

  /**
   * Clear all cached mock data
   */
  clearCache: () => {
    Object.keys(historicalDataCache).forEach(
      (key) => delete historicalDataCache[key]
    );
    Object.keys(orderBookCache).forEach((key) => delete orderBookCache[key]);
    Object.keys(tradesCache).forEach((key) => delete tradesCache[key]);
    Object.keys(tickerCache).forEach((key) => delete tickerCache[key]);
  },
};

export default mockDataService;
