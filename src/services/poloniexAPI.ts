import axios from 'axios';
import CryptoJS from 'crypto-js';
import { getStorageItem, STORAGE_KEYS } from '@/utils/storage';
import { MarketData } from '@/types';

// Base URLs for Poloniex APIs
const FUTURES_BASE_URL = 'https://futures-api.poloniex.com/v3';
const SPOT_BASE_URL = 'https://api.poloniex.com/v3';

// Add WebSocket endpoints
// WebSocket endpoints - commented out as they're not currently used
// const FUTURES_WS_URL = 'wss://futures-ws.poloniex.com/ws/public';
// const FUTURES_PRIVATE_WS_URL = 'wss://futures-ws.poloniex.com/ws/private';

import { IS_WEBCONTAINER, IS_LOCAL_DEV } from '@/utils/environment';

// Add rate limiting configuration
const RATE_LIMITS = {
  PUBLIC_REQUESTS_PER_SECOND: 10,
  PRIVATE_REQUESTS_PER_SECOND: 5,
  ORDERS_PER_SECOND: 2
};

// Create a logger for API calls
const logApiCall = (method: string, endpoint: string, data?: any) => {
  console.log(`API ${method} ${endpoint}`, data ? JSON.stringify(data) : '');
};

// Safe error handler - prevents Symbol() objects from being passed around
const safeErrorHandler = (error: any): Error => {
  if (error instanceof Error) {
    // Create a new error object with just the message to avoid Symbol properties
    return new Error(error.message);
  }
  return new Error(String(error));
};

// Create a singleton API client
class PoloniexApiClient {
  private static instance: PoloniexApiClient;
  private apiKey: string = '';
  private apiSecret: string = '';
  private mockMode: boolean = true;
  private lastBalanceUpdate: number = 0;
  private cachedBalance: any = null;
  private historicalData: Map<string, MarketData[]> = new Map();
  private balanceUpdateInterval: number = 10000; // 10 seconds
  private requestCounter: number = 0;
  private requestTimeoutMs: number = 5000; // 5 second timeout for requests
  private rateLimitQueue: Map<string, number[]> = new Map();
  private positionUpdateCallbacks: Set<Function> = new Set();
  private orderUpdateCallbacks: Set<Function> = new Set();
  private liquidationCallbacks: Set<Function> = new Set();
  private marginCallbacks: Set<Function> = new Set();

  private constructor() {
    this.loadCredentials();
  }

  /**
   * Subscribe to position updates
   */
  public onPositionUpdate(callback: Function): void {
    this.positionUpdateCallbacks.add(callback);
  }

  /**
   * Subscribe to order updates
   */
  public onOrderUpdate(callback: Function): void {
    this.orderUpdateCallbacks.add(callback);
  }

  /**
   * Subscribe to liquidation warnings
   */
  public onLiquidationWarning(callback: Function): void {
    this.liquidationCallbacks.add(callback);
  }

  /**
   * Subscribe to margin updates
   */
  public onMarginUpdate(callback: Function): void {
    this.marginCallbacks.add(callback);
  }

  /**
   * Check rate limit before making request
   */
  private async checkRateLimit(type: 'public' | 'private' | 'order'): Promise<void> {
    const now = Date.now();
    const key = `${type}_requests`;
    const limit = type === 'public' ? RATE_LIMITS.PUBLIC_REQUESTS_PER_SECOND :
                 type === 'private' ? RATE_LIMITS.PRIVATE_REQUESTS_PER_SECOND :
                 RATE_LIMITS.ORDERS_PER_SECOND;

    if (!this.rateLimitQueue.has(key)) {
      this.rateLimitQueue.set(key, []);
    }

    const queue = this.rateLimitQueue.get(key)!;
    const oneSecondAgo = now - 1000;
    
    // Remove timestamps older than 1 second
    while (queue.length > 0 && queue[0] < oneSecondAgo) {
      queue.shift();
    }

    if (queue.length >= limit) {
      const oldestRequest = queue[0];
      const waitTime = 1000 - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    queue.push(now);
  }

  public static getInstance(): PoloniexApiClient {
    if (!PoloniexApiClient.instance) {
      PoloniexApiClient.instance = new PoloniexApiClient();
    }
    return PoloniexApiClient.instance;
  }

  /**
   * Load credentials from localStorage or environment variables
   */
  public loadCredentials(): void {
    try {
      // Try to get credentials from localStorage first
      const storedApiKey = getStorageItem(STORAGE_KEYS.API_KEY, '');
      const storedApiSecret = getStorageItem(STORAGE_KEYS.API_SECRET, '');
      const isLiveTrading = getStorageItem(STORAGE_KEYS.IS_LIVE_TRADING, false);
      
      // Check for environment variable API key
      const envApiKey = import.meta.env.VITE_POLONIEX_API_KEY || '';
      
      // If stored credentials exist, use them
      if ((storedApiKey && storedApiSecret) || envApiKey) {
        // Prioritize stored credentials, fall back to env variables
        this.apiKey = storedApiKey || envApiKey;
        this.apiSecret = storedApiSecret || ''; // Secret should come from storage for security
        this.mockMode = !isLiveTrading || IS_WEBCONTAINER || IS_LOCAL_DEV;
        
        console.log(
          this.mockMode 
            ? 'Using API credentials but running in mock mode' 
            : 'Using API credentials with live trading enabled'
        );
      } else {
        // No credentials, use mock mode
        this.mockMode = true;
        console.log('No API credentials found, using mock mode');
      }
      
      // Log connection status
      if (this.mockMode) {
        console.log('Mock mode active - live trading disabled');
      } else {
        console.log('Live trading mode active with API credentials');
      }
      
      // Clear cached data when credentials change
      this.cachedBalance = null;
      this.lastBalanceUpdate = 0;
    } catch (error) {
      console.error('Error loading credentials:', error instanceof Error ? error.message : String(error));
      // Default to mock mode if there's any error
      this.mockMode = true;
      console.log('Error loading credentials, defaulting to mock mode');
    }
  }

  /**
   * Generate signature for Poloniex API requests
   */
  private generateSignature(endpoint: string, queryString: string = '', body: any = null): string {
    // Current timestamp in milliseconds
    const timestamp = Date.now();
    const signVersion = '2';
    
    // Create the string to sign
    let signString = timestamp + signVersion + endpoint;
    
    if (queryString) {
      signString += '?' + queryString;
    }
    
    if (body) {
      signString += JSON.stringify(body);
    }
    
    // Create HMAC SHA256 signature
    const signature = CryptoJS.HmacSHA256(signString, this.apiSecret).toString(CryptoJS.enc.Hex);
    
    return signature;
  }

  /**
   * Get account balance - returns mock data if in mock mode
   */
  public async getAccountBalance() {
    // Track request number for debugging
    const requestId = ++this.requestCounter;
    
    // Check if we have a recent cached balance
    if (this.cachedBalance && Date.now() - this.lastBalanceUpdate < this.balanceUpdateInterval) {
      console.log(`[Request ${requestId}] Using cached balance data`);
      return this.cachedBalance;
    }
    
    console.log(`[Request ${requestId}] Getting account balance`);
    
    try {
      // If in mock mode, return mock data immediately
      if (this.mockMode) {
        console.log(`[Request ${requestId}] Using mock account balance data`);
        return {
          totalAmount: "15478.23",
          availableAmount: "12345.67",
          accountEquity: "15820.45",
          unrealizedPnL: "342.22",
          todayPnL: "156.78",
          todayPnLPercentage: "1.02"
        };
      }
      
      const endpoint = '/accounts/balance';
      const timestamp = Date.now().toString();
      const signVersion = '2';
      const signature = this.generateSignature(endpoint, '', null);
      const url = `${FUTURES_BASE_URL}${endpoint}`;
      
      logApiCall('GET', url);
      
      // Use axios with timeout
      const response = await axios.get(url, {
        headers: {
          'PF-API-KEY': this.apiKey,
          'PF-API-SIGN': signature,
          'PF-API-TIMESTAMP': timestamp,
          'PF-API-SIGN-VERSION': signVersion,
          'Content-Type': 'application/json'
        },
        timeout: this.requestTimeoutMs
      });
      
      // Cache the response
      this.cachedBalance = response.data;
      this.lastBalanceUpdate = Date.now();
      
      console.log(`[Request ${requestId}] Account balance fetched successfully`);
      return this.cachedBalance;
    } catch (error) {
      if (!IS_WEBCONTAINER) {
        // Only log as error if not in WebContainer, since errors are expected there
        console.error(`[Request ${requestId}] Error fetching account balance:`, safeErrorHandler(error).message);
      } else {
        console.log(`[Request ${requestId}] Expected network error in WebContainer, using mock data`);
      }
      
      // If timeout or network error, return mock data
      console.log(`[Request ${requestId}] Falling back to mock account balance data`);
      return {
        totalAmount: "15478.23",
        availableAmount: "12345.67",
        accountEquity: "15820.45",
        unrealizedPnL: "342.22",
        todayPnL: "156.78",
        todayPnLPercentage: "1.02"
      };
    }
  }

  /**
   * Get market data for a specific pair - returns mock data if in mock mode
   */
  public async getMarketData(pair: string) {
    // Track request number for debugging
    const requestId = ++this.requestCounter;
    console.log(`[Request ${requestId}] Getting market data for ${pair}`);
    
    try {
      // If in mock mode, return mock data immediately
      if (this.mockMode) {
        console.log(`[Request ${requestId}] Using mock market data for ${pair}`);
        return this.generateMockMarketData(100);
      }
      
      // Poloniex expects pairs in format like BTC_USDT (not BTC-USDT)
      const formattedPair = pair.replace('-', '_') + '_PERP';
      const endpoint = `/markets/${formattedPair}/candles`;
      const queryParams = `interval=5m&limit=100`;
      
      logApiCall('GET', `${endpoint}?${queryParams}`);
      
      // Use axios with timeout
      const response = await axios.get(`${SPOT_BASE_URL}${endpoint}?${queryParams}`, {
        timeout: this.requestTimeoutMs
      });
      
      console.log(`[Request ${requestId}] Market data fetched successfully for ${pair}`);
      return response.data;
    } catch (error) {
      if (!IS_WEBCONTAINER) {
        // Only log as error if not in WebContainer, since errors are expected there
        console.error(`[Request ${requestId}] Error fetching market data for ${pair}:`, safeErrorHandler(error).message);
      } else {
        console.log(`[Request ${requestId}] Expected network error in WebContainer, using mock data`);
      }
      
      // If timeout or network error, return mock data
      console.log(`[Request ${requestId}] Falling back to mock market data for ${pair}`);
      return this.generateMockMarketData(100);
    }
  }

  /**
   * Generate mock market data (candles)
   */
  private generateMockMarketData(count: number) {
    return Array.from({ length: count }, (_, i) => {
      const basePrice = 50000 + Math.random() * 5000;
      const volatility = basePrice * 0.01;
      const timestamp = Date.now() - (count - 1 - i) * 60 * 1000; // Last n minutes
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
        (100 + Math.random() * 900).toString()
      ];
    });
  }

  /**
   * Get open positions - returns mock data if in mock mode
   */
  public async getOpenPositions() {
    // Track request number for debugging
    const requestId = ++this.requestCounter;
    console.log(`[Request ${requestId}] Getting open positions`);
    
    try {
      // If in mock mode, return mock data immediately
      if (this.mockMode) {
        console.log(`[Request ${requestId}] Using mock positions data`);
        return {
          positions: [
            {
              symbol: "BTC_USDT",
              posId: "12345",
              pos: "long",
              marginMode: "cross",
              posCost: "25000",
              posSide: "long",
              posSize: "0.5",
              markPrice: "51000",
              unrealizedPnL: "500",
              liquidationPrice: "45000"
            }
          ]
        };
      }
      
      const endpoint = '/positions';
      const timestamp = Date.now().toString();
      const signVersion = '2';
      const signature = this.generateSignature(endpoint, '', null);
      
      logApiCall('GET', endpoint);
      
      // Use axios with timeout
      const response = await axios.get(`${FUTURES_BASE_URL}${endpoint}`, {
        headers: {
          'PF-API-KEY': this.apiKey,
          'PF-API-SIGN': signature,
          'PF-API-TIMESTAMP': timestamp,
          'PF-API-SIGN-VERSION': signVersion,
          'Content-Type': 'application/json'
        },
        timeout: this.requestTimeoutMs
      });
      
      console.log(`[Request ${requestId}] Open positions fetched successfully`);
      return response.data;
    } catch (error) {
      if (!IS_WEBCONTAINER) {
        // Only log as error if not in WebContainer, since errors are expected there
        console.error(`[Request ${requestId}] Error fetching open positions:`, safeErrorHandler(error).message);
      } else {
        console.log(`[Request ${requestId}] Expected network error in WebContainer, using mock data`);
      }
      
      // If timeout or network error, return mock data
      console.log(`[Request ${requestId}] Falling back to mock positions data`);
      return {
        positions: [
          {
            symbol: "BTC_USDT",
            posId: "12345",
            pos: "long",
            marginMode: "cross",
            posCost: "25000",
            posSide: "long",
            posSize: "0.5",
            markPrice: "51000",
            unrealizedPnL: "500",
            liquidationPrice: "45000"
          }
        ]
      };
    }
  }

  /**
   * Place an order - returns mock data if in mock mode
   */
  public async placeOrder(pair: string, side: 'buy' | 'sell', type: 'limit' | 'market', quantity: number, price?: number) {
    await this.checkRateLimit('order');

    // Track request number for debugging
    const requestId = ++this.requestCounter;
    console.log(`[Request ${requestId}] Placing ${side} ${type} order for ${quantity} ${pair} ${price ? 'at ' + price : ''}`);
    
    try {
      // If in mock mode, return mock data immediately
      if (this.mockMode) {
        console.log(`[Request ${requestId}] Using mock order placement`);
        return { 
          success: true, 
          orderId: 'mock-order-' + Date.now(),
          pair,
          side,
          type,
          quantity,
          price: price || 'market'
        };
      }
      
      // Poloniex expects pairs in format like BTC_USDT (not BTC-USDT)
      const formattedPair = pair.replace('-', '_');
      const endpoint = '/orders';
      const timestamp = Date.now();
      
      const orderData = {
        symbol: formattedPair,
        side: side.toUpperCase(),
        type: type.toUpperCase(),
        quantity: quantity.toString(),
        leverage: '1', // Default leverage
        ...(type === 'limit' && price ? { price: price.toString() } : {})
      };
      
      const signature = this.generateSignature(endpoint, '', orderData);
      
      logApiCall('POST', endpoint, orderData);
      
      // Use axios with timeout
      const response = await axios.post(`${FUTURES_BASE_URL}${endpoint}`, orderData, {
        headers: {
          'PF-API-KEY': this.apiKey,
          'PF-API-SIGN': signature,
          'PF-API-TIMESTAMP': timestamp,
          'Content-Type': 'application/json'
        },
        timeout: this.requestTimeoutMs
      });
      
      console.log(`[Request ${requestId}] Order placed successfully`);
      return response.data;
    } catch (error) {
      const safeError = safeErrorHandler(error);
      
      if (!IS_WEBCONTAINER) {
        console.error(`[Request ${requestId}] Error placing order:`, safeError.message);
      } else {
        console.log(`[Request ${requestId}] Expected network error in WebContainer, using mock order response`);
        // In WebContainer, return mock success instead of propagating error
        return { 
          success: true, 
          orderId: 'mock-order-' + Date.now(),
          pair,
          side,
          type,
          quantity,
          price: price || 'market'
        };
      }
      
      // For order placement in real env, propagate the error
      throw safeError;
    }
  }

  /**
   * Place a conditional order (stop loss, take profit)
   */
  public async placeConditionalOrder(
    pair: string,
    side: 'buy' | 'sell',
    type: 'stop' | 'takeProfit',
    quantity: number,
    triggerPrice: number,
    price?: number
  ) {
    await this.checkRateLimit('order');

    if (this.mockMode) {
      return {
        success: true,
        orderId: 'mock-conditional-' + Date.now(),
        type: 'conditional'
      };
    }

    const endpoint = '/orders/conditional';
    const orderData = {
      symbol: pair.replace('-', '_'),
      side: side.toUpperCase(),
      type: type.toUpperCase(),
      quantity: quantity.toString(),
      triggerPrice: triggerPrice.toString(),
      ...(price && { price: price.toString() })
    };

    const signature = this.generateSignature(endpoint, '', orderData);
    const timestamp = Date.now();

    try {
      const response = await axios.post(
        `${FUTURES_BASE_URL}${endpoint}`,
        orderData,
        {
          headers: {
            'PF-API-KEY': this.apiKey,
            'PF-API-SIGN': signature,
            'PF-API-TIMESTAMP': timestamp,
            'Content-Type': 'application/json'
          },
          timeout: this.requestTimeoutMs
        }
      );

      return response.data;
    } catch (error) {
      throw safeErrorHandler(error);
    }
  }

  /**
   * Update leverage for a position
   */
  public async updateLeverage(pair: string, leverage: number) {
    await this.checkRateLimit('private');

    if (this.mockMode) {
      return { success: true };
    }

    const endpoint = '/positions/leverage';
    const data = {
      symbol: pair.replace('-', '_'),
      leverage: leverage.toString()
    };

    const signature = this.generateSignature(endpoint, '', data);
    const timestamp = Date.now();

    try {
      const response = await axios.post(
        `${FUTURES_BASE_URL}${endpoint}`,
        data,
        {
          headers: {
            'PF-API-KEY': this.apiKey,
            'PF-API-SIGN': signature,
            'PF-API-TIMESTAMP': timestamp,
            'Content-Type': 'application/json'
          },
          timeout: this.requestTimeoutMs
        }
      );

      return response.data;
    } catch (error) {
      throw safeErrorHandler(error);
    }
  }

  /**
   * Get recent trades for a pair - returns mock data if in mock mode
   */
  public async getRecentTrades(pair: string, limit: number = 50) {
    // Track request number for debugging
    const requestId = ++this.requestCounter;
    console.log(`[Request ${requestId}] Getting recent trades for ${pair} (limit: ${limit})`);
    
    try {
      // If in mock mode, return mock data immediately
      if (this.mockMode) {
        console.log(`[Request ${requestId}] Using mock trades data for ${pair}`);
        return this.generateMockTrades(pair, limit);
      }
      
      // Poloniex expects pairs in format like BTC_USDT (not BTC-USDT)
      const formattedPair = pair.replace('-', '_') + '_PERP';
      const endpoint = `/markets/${formattedPair}/trades`;
      const queryParams = `limit=${limit}`;
      
      logApiCall('GET', `${endpoint}?${queryParams}`);
      
      // Use axios with timeout
      const response = await axios.get(`${SPOT_BASE_URL}${endpoint}?${queryParams}`, {
        timeout: this.requestTimeoutMs
      });
      
      console.log(`[Request ${requestId}] Recent trades fetched successfully for ${pair}`);
      return response.data;
    } catch (error) {
      if (!IS_WEBCONTAINER) {
        // Only log as error if not in WebContainer, since errors are expected there
        console.error(`[Request ${requestId}] Error fetching recent trades for ${pair}:`, safeErrorHandler(error).message);
      } else {
        console.log(`[Request ${requestId}] Expected network error in WebContainer, using mock data`);
      }
      
      // If timeout or network error, return mock data
      console.log(`[Request ${requestId}] Falling back to mock trades data for ${pair}`);
      return this.generateMockTrades(pair, limit);
    }
  }

  /**
   * Generate mock trades data
   */
  private generateMockTrades(_pair: string, limit: number) {
    // Create an array of trades with guaranteed unique IDs
    return Array.from({ length: limit }, (_, i) => {
      const basePrice = 51000 + (Math.random() - 0.5) * 1000;
      const amount = 0.01 + Math.random() * 0.5;
      // Use index in timestamp to ensure uniqueness
      const timestamp = Date.now() - (i * 60 * 1000); // Last few minutes, each 1 minute apart
      
      return {
        id: `mock-trade-${i}-${Date.now()}`, // Ensure unique IDs by combining index and timestamp
        price: basePrice.toString(),
        quantity: amount.toString(),
        amount: (basePrice * amount).toString(),
        takerSide: Math.random() > 0.5 ? 'buy' : 'sell',
        ts: timestamp,
        createdAt: new Date(timestamp).toISOString()
      };
    });
  }

  /**
   * Get historical market data for backtesting
   */
  public async getHistoricalData(pair: string, startDate: string, endDate: string): Promise<MarketData[]> {
    const cacheKey = `${pair}-${startDate}-${endDate}`;
    
    if (this.historicalData.has(cacheKey)) {
      return this.historicalData.get(cacheKey)!;
    }
    
    try {
      const response = await axios.get(`${SPOT_BASE_URL}/markets/${pair.replace('-', '_')}/candles`, {
        params: {
          startTime: new Date(startDate).getTime(),
          endTime: new Date(endDate).getTime(),
          interval: '1h'
        },
        timeout: this.requestTimeoutMs
      });
      
      const data = response.data.map((candle: any) => ({
        pair,
        timestamp: new Date(candle[0]).getTime(),
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
      }));
      
      this.historicalData.set(cacheKey, data);
      return data;
    } catch (error) {
      // Return mock data for testing
      const mockData = this.generateMockHistoricalData(pair, startDate, endDate);
      this.historicalData.set(cacheKey, mockData);
      return mockData;
    }
  }

  /**
   * Generate mock historical data
   */
  private generateMockHistoricalData(pair: string, startDate: string, endDate: string): MarketData[] {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const hourMs = 60 * 60 * 1000;
    const data: MarketData[] = [];
    
    let basePrice = 50000; // Starting price
    
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
        volume: 100 + Math.random() * 900
      });
      
      // Update base price for next candle
      basePrice = close;
    }
    
    return data;
  }
}

// Export a singleton instance
export const poloniexApi = PoloniexApiClient.getInstance();