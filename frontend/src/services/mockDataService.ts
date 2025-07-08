import { MarketData, OrderBook, Trade, Ticker } from '@/types';
import { useMockMode } from '../hooks/useMockMode';
import { generateRandomMarketData, generateRandomOrderBook, generateRandomTrades, generateRandomTicker } from './mockDataGenerators';

// Cache for historical data
const historicalDataCache: Record<string, MarketData[]> = {};
const orderBookCache: Record<string, OrderBook> = {};
const tradesCache: Record<string, Trade[]> = {};
const tickerCache: Record<string, Ticker> = {};

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
    const { 
      isMockMode, 
      mockDataSource, 
      mockDataDelay, 
      mockVolatility, 
      mockTrendBias,
      mockHistoricalPeriod,
      mockDataOptions 
    } = useMockMode();

    // If not in mock mode, reject with error
    if (!isMockMode) {
      return Promise.reject(new Error('Mock mode is disabled'));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockDataOptions.simulateLatency ? 
        Math.random() * mockDataDelay : 
        0;

      // Simulate random errors if enabled
      if (mockDataOptions.simulateErrors && Math.random() < mockDataOptions.errorRate) {
        setTimeout(() => {
          reject(new Error('Simulated network error'));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          let data: MarketData[];

          switch (mockDataSource) {
            case 'random':
              // Generate random data with specified parameters
              data = generateRandomMarketData(
                symbol,
                timeframe,
                limit,
                mockVolatility,
                mockTrendBias,
                mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined
              );
              break;

            case 'historical':
              // Use cached historical data or generate new data
              const cacheKey = `${symbol}_${timeframe}_${mockHistoricalPeriod}`;
              if (!historicalDataCache[cacheKey]) {
                // In a real implementation, this would fetch from a historical data API
                // For now, we'll generate random data as a placeholder
                historicalDataCache[cacheKey] = generateRandomMarketData(
                  symbol,
                  timeframe,
                  limit * 5, // Generate more data for historical cache
                  mockVolatility,
                  mockTrendBias,
                  mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined
                );
              }
              
              // Return a slice of the cached data
              data = historicalDataCache[cacheKey].slice(0, limit);
              break;

            case 'simulation':
              // Generate simulated market data based on realistic market behavior
              // This would be more sophisticated in a real implementation
              data = generateRandomMarketData(
                symbol,
                timeframe,
                limit,
                mockVolatility,
                mockTrendBias,
                mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined,
                true // Use more realistic simulation
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
    const { 
      isMockMode, 
      mockDataDelay, 
      mockVolatility,
      mockDataOptions 
    } = useMockMode();

    // If not in mock mode, reject with error
    if (!isMockMode) {
      return Promise.reject(new Error('Mock mode is disabled'));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockDataOptions.simulateLatency ? 
        Math.random() * mockDataDelay : 
        0;

      // Simulate random errors if enabled
      if (mockDataOptions.simulateErrors && Math.random() < mockDataOptions.errorRate) {
        setTimeout(() => {
          reject(new Error('Simulated network error'));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          // Use cached order book or generate new one
          if (!orderBookCache[symbol]) {
            orderBookCache[symbol] = generateRandomOrderBook(
              symbol,
              mockVolatility,
              mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined
            );
          } else {
            // Update the existing order book with some changes to simulate market activity
            const book = orderBookCache[symbol];
            const updatedBook = generateRandomOrderBook(
              symbol,
              mockVolatility,
              mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined
            );
            
            // Merge some of the new orders with existing ones
            orderBookCache[symbol] = {
              ...book,
              bids: [...book.bids.slice(3), ...updatedBook.bids.slice(0, 3)],
              asks: [...book.asks.slice(3), ...updatedBook.asks.slice(0, 3)],
              timestamp: Date.now()
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
    const { 
      isMockMode, 
      mockDataDelay, 
      mockVolatility,
      mockDataOptions 
    } = useMockMode();

    // If not in mock mode, reject with error
    if (!isMockMode) {
      return Promise.reject(new Error('Mock mode is disabled'));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockDataOptions.simulateLatency ? 
        Math.random() * mockDataDelay : 
        0;

      // Simulate random errors if enabled
      if (mockDataOptions.simulateErrors && Math.random() < mockDataOptions.errorRate) {
        setTimeout(() => {
          reject(new Error('Simulated network error'));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          // Generate new trades
          const newTrades = generateRandomTrades(
            symbol,
            limit,
            mockVolatility,
            mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined
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
    const { 
      isMockMode, 
      mockDataDelay, 
      mockVolatility,
      mockTrendBias,
      mockDataOptions 
    } = useMockMode();

    // If not in mock mode, reject with error
    if (!isMockMode) {
      return Promise.reject(new Error('Mock mode is disabled'));
    }

    return new Promise((resolve, reject) => {
      // Simulate network delay if enabled
      const delay = mockDataOptions.simulateLatency ? 
        Math.random() * mockDataDelay : 
        0;

      // Simulate random errors if enabled
      if (mockDataOptions.simulateErrors && Math.random() < mockDataOptions.errorRate) {
        setTimeout(() => {
          reject(new Error('Simulated network error'));
        }, delay);
        return;
      }

      setTimeout(() => {
        try {
          // Use cached ticker as base or generate new one
          if (!tickerCache[symbol]) {
            tickerCache[symbol] = generateRandomTicker(
              symbol,
              mockVolatility,
              mockTrendBias,
              mockDataOptions.useRandomSeed ? mockDataOptions.randomSeed : undefined
            );
          } else {
            // Update the existing ticker with some changes to simulate market activity
            const prevTicker = tickerCache[symbol];
            const priceFactor = 1 + (Math.random() * mockVolatility * 0.02 - 0.01 + mockTrendBias * 0.005);
            const volumeFactor = 1 + (Math.random() * mockVolatility * 0.1 - 0.05);
            
            tickerCache[symbol] = {
              ...prevTicker,
              lastPrice: prevTicker.lastPrice * priceFactor,
              bidPrice: prevTicker.bidPrice * priceFactor,
              askPrice: prevTicker.askPrice * priceFactor,
              volume24h: prevTicker.volume24h * volumeFactor,
              high24h: Math.max(prevTicker.high24h, prevTicker.lastPrice * priceFactor),
              low24h: Math.min(prevTicker.low24h, prevTicker.lastPrice * priceFactor),
              timestamp: Date.now()
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
    Object.keys(historicalDataCache).forEach(key => delete historicalDataCache[key]);
    Object.keys(orderBookCache).forEach(key => delete orderBookCache[key]);
    Object.keys(tradesCache).forEach(key => delete tradesCache[key]);
    Object.keys(tickerCache).forEach(key => delete tickerCache[key]);
  }
};

export default mockDataService;
