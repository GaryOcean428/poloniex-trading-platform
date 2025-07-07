import axios from 'axios';
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { throttle, debounce } from 'lodash';

/**
 * Advanced Live Data Processing Module
 * 
 * This module provides enhanced real-time market data processing capabilities
 * with features like data normalization, anomaly detection, and multi-source
 * data aggregation for the Poloniex trading platform.
 */

// Types for live data processing
export interface LiveDataConfig {
  primarySource: 'poloniex' | 'websocket' | 'aggregated';
  fallbackSources: ('poloniex' | 'websocket' | 'rest')[];
  updateInterval: number; // milliseconds
  aggregationMethod: 'weighted' | 'median' | 'mean';
  enableAnomalyDetection: boolean;
  anomalyThreshold: number;
  enableDataNormalization: boolean;
  cacheDuration: number; // milliseconds
  maxRetries: number;
  retryDelay: number; // milliseconds
  enableCompression: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface MarketDataPoint {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume?: number;
  weightedAverage?: number;
  source?: string;
  isAnomaly?: boolean;
  confidence?: number;
  normalized?: boolean;
}

export interface OrderBookEntry {
  price: number;
  amount: number;
  timestamp: number;
}

export interface OrderBook {
  symbol: string;
  timestamp: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  source?: string;
  lastUpdateId?: number;
}

export interface TradeEntry {
  id: string;
  symbol: string;
  timestamp: number;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  source?: string;
}

export interface MarketSummary {
  symbol: string;
  timestamp: number;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  percentChange24h: number;
  source?: string;
}

// Default configuration
const defaultLiveDataConfig: LiveDataConfig = {
  primarySource: 'aggregated',
  fallbackSources: ['poloniex', 'websocket', 'rest'],
  updateInterval: 1000, // 1 second
  aggregationMethod: 'weighted',
  enableAnomalyDetection: true,
  anomalyThreshold: 3.0, // 3 standard deviations
  enableDataNormalization: true,
  cacheDuration: 60000, // 1 minute
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  enableCompression: true,
  logLevel: 'info'
};

// Cache for market data
const dataCache = new Map<string, {
  data: any;
  timestamp: number;
}>();

// Event emitter for live data updates
export const liveDataEvents = new EventEmitter();

/**
 * Advanced Live Data Service class
 */
export class LiveDataService {
  private config: LiveDataConfig;
  private websockets: Map<string, WebSocket> = new Map();
  private poloniexRestClient: any;
  private isRunning: boolean = false;
  private retryCount: Map<string, number> = new Map();
  private dataBuffer: Map<string, MarketDataPoint[]> = new Map();
  private lastAnomalyCheck: Map<string, number> = new Map();
  private statisticalBaseline: Map<string, {
    mean: number;
    stdDev: number;
    updateTime: number;
  }> = new Map();
  
  constructor(config: Partial<LiveDataConfig> = {}) {
    this.config = { ...defaultLiveDataConfig, ...config };
    this.initializePoloniexClient();
    
    // Set up throttled and debounced methods
    this.processDataThrottled = throttle(this.processData.bind(this), 200);
    this.updateBaselineDebounced = debounce(this.updateStatisticalBaseline.bind(this), 60000);
    
    // Set up event listeners
    liveDataEvents.on('data_received', this.handleDataReceived.bind(this));
    liveDataEvents.on('connection_error', this.handleConnectionError.bind(this));
  }
  
  /**
   * Initialize the Poloniex REST API client
   */
  private initializePoloniexClient(): void {
    this.poloniexRestClient = axios.create({
      baseURL: 'https://api.poloniex.com/markets',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PoloniexTradingPlatform/1.0'
      }
    });
    
    this.log('info', 'Poloniex REST client initialized');
  }
  
  /**
   * Start the live data service
   */
  public start(): void {
    if (this.isRunning) {
      this.log('warn', 'Live data service is already running');
      return;
    }
    
    this.isRunning = true;
    this.log('info', 'Starting live data service');
    
    // Initialize connections based on configuration
    if (this.config.primarySource === 'websocket' || 
        this.config.fallbackSources.includes('websocket')) {
      this.initializeWebSockets();
    }
    
    liveDataEvents.emit('service_started');
  }
  
  /**
   * Stop the live data service
   */
  public stop(): void {
    if (!this.isRunning) {
      this.log('warn', 'Live data service is not running');
      return;
    }
    
    this.isRunning = false;
    this.log('info', 'Stopping live data service');
    
    // Close all websocket connections
    for (const [key, ws] of this.websockets.entries()) {
      ws.close();
      this.websockets.delete(key);
    }
    
    liveDataEvents.emit('service_stopped');
  }
  
  /**
   * Initialize WebSocket connections
   */
  private initializeWebSockets(): void {
    try {
      // Poloniex WebSocket
      const poloniexWs = new WebSocket('wss://ws.poloniex.com/markets');
      
      poloniexWs.on('open', () => {
        this.log('info', 'Poloniex WebSocket connected');
        
        // Subscribe to market data
        poloniexWs.send(JSON.stringify({
          event: 'subscribe',
          channel: ['ticker']
        }));
        
        this.websockets.set('poloniex', poloniexWs);
        liveDataEvents.emit('websocket_connected', 'poloniex');
      });
      
      poloniexWs.on('message', (data: any) => {
        try {
          const parsedData = JSON.parse(data.toString());
          this.handleWebSocketMessage('poloniex', parsedData);
        } catch (error) {
          this.log('error', `Error parsing Poloniex WebSocket message: ${error}`);
        }
      });
      
      poloniexWs.on('error', (error) => {
        this.log('error', `Poloniex WebSocket error: ${error}`);
        liveDataEvents.emit('connection_error', { source: 'poloniex', error });
      });
      
      poloniexWs.on('close', () => {
        this.log('info', 'Poloniex WebSocket disconnected');
        this.websockets.delete('poloniex');
        
        // Attempt to reconnect if service is still running
        if (this.isRunning) {
          const retryCount = (this.retryCount.get('poloniex') || 0) + 1;
          this.retryCount.set('poloniex', retryCount);
          
          if (retryCount <= this.config.maxRetries) {
            this.log('info', `Attempting to reconnect to Poloniex WebSocket (attempt ${retryCount})`);
            setTimeout(() => this.initializeWebSockets(), this.config.retryDelay * retryCount);
          } else {
            this.log('error', 'Max retry attempts reached for Poloniex WebSocket');
            liveDataEvents.emit('max_retries_reached', 'poloniex');
          }
        }
      });
    } catch (error) {
      this.log('error', `Error initializing WebSockets: ${error}`);
      liveDataEvents.emit('initialization_error', { error });
    }
  }
  
  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(source: string, message: any): void {
    try {
      if (source === 'poloniex') {
        // Process Poloniex-specific message format
        if (message.channel === 'ticker' && message.data) {
          const tickerData = message.data;
          
          const marketData: MarketDataPoint = {
            symbol: tickerData.symbol,
            timestamp: Date.now(),
            open: parseFloat(tickerData.open),
            high: parseFloat(tickerData.high),
            low: parseFloat(tickerData.low),
            close: parseFloat(tickerData.close),
            volume: parseFloat(tickerData.volume),
            quoteVolume: parseFloat(tickerData.quoteVolume),
            source: 'poloniex_ws'
          };
          
          // Process the data (throttled)
          this.processDataThrottled(marketData);
          
          // Add to buffer for statistical analysis
          this.addToDataBuffer(marketData);
        }
      }
      
      liveDataEvents.emit('data_received', { source, data: message });
    } catch (error) {
      this.log('error', `Error handling WebSocket message: ${error}`);
    }
  }
  
  /**
   * Add data point to buffer for statistical analysis
   */
  private addToDataBuffer(dataPoint: MarketDataPoint): void {
    const key = dataPoint.symbol;
    
    if (!this.dataBuffer.has(key)) {
      this.dataBuffer.set(key, []);
    }
    
    const buffer = this.dataBuffer.get(key)!;
    buffer.push(dataPoint);
    
    // Keep buffer at a reasonable size (last 100 points)
    if (buffer.length > 100) {
      buffer.shift();
    }
    
    // Update statistical baseline periodically
    const lastUpdate = this.statisticalBaseline.get(key)?.updateTime || 0;
    if (Date.now() - lastUpdate > 300000) { // 5 minutes
      this.updateBaselineDebounced(key);
    }
  }
  
  /**
   * Update statistical baseline for anomaly detection
   */
  private updateStatisticalBaseline(symbol: string): void {
    const buffer = this.dataBuffer.get(symbol);
    
    if (!buffer || buffer.length < 30) {
      return; // Not enough data points
    }
    
    // Calculate mean and standard deviation of closing prices
    const prices = buffer.map(d => d.close);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    const squaredDiffs = prices.map(price => Math.pow(price - mean, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(variance);
    
    this.statisticalBaseline.set(symbol, {
      mean,
      stdDev,
      updateTime: Date.now()
    });
    
    this.log('debug', `Updated statistical baseline for ${symbol}: mean=${mean.toFixed(4)}, stdDev=${stdDev.toFixed(4)}`);
  }
  
  /**
   * Process incoming market data
   */
  private processData(dataPoint: MarketDataPoint): void {
    try {
      // Apply data normalization if enabled
      if (this.config.enableDataNormalization) {
        dataPoint = this.normalizeData(dataPoint);
      }
      
      // Detect anomalies if enabled
      if (this.config.enableAnomalyDetection) {
        dataPoint = this.detectAnomaly(dataPoint);
      }
      
      // Cache the processed data
      const cacheKey = `${dataPoint.symbol}_${dataPoint.timestamp}`;
      dataCache.set(cacheKey, {
        data: dataPoint,
        timestamp: Date.now()
      });
      
      // Emit processed data event
      liveDataEvents.emit('data_processed', dataPoint);
    } catch (error) {
      this.log('error', `Error processing data: ${error}`);
    }
  }
  
  /**
   * Normalize market data
   */
  private normalizeData(dataPoint: MarketDataPoint): MarketDataPoint {
    // Simple normalization: ensure all numeric values are valid
    const normalized = { ...dataPoint };
    
    // Ensure numeric values are valid numbers
    for (const key of ['open', 'high', 'low', 'close', 'volume', 'quoteVolume', 'weightedAverage']) {
      if (key in normalized && (isNaN(normalized[key]) || !isFinite(normalized[key]))) {
        normalized[key] = 0;
      }
    }
    
    // Ensure high is the highest value
    normalized.high = Math.max(normalized.open, normalized.high, normalized.low, normalized.close);
    
    // Ensure low is the lowest value
    normalized.low = Math.min(normalized.open, normalized.low, normalized.close);
    
    // Mark as normalized
    normalized.normalized = true;
    
    return normalized;
  }
  
  /**
   * Detect anomalies in market data
   */
  private detectAnomaly(dataPoint: MarketDataPoint): MarketDataPoint {
    const baseline = this.statisticalBaseline.get(dataPoint.symbol);
    
    if (!baseline) {
      return { ...dataPoint, isAnomaly: false, confidence: 0 };
    }
    
    // Calculate z-score (number of standard deviations from mean)
    const zScore = Math.abs((dataPoint.close - baseline.mean) / baseline.stdDev);
    
    // Mark as anomaly if z-score exceeds threshold
    const isAnomaly = zScore > this.config.anomalyThreshold;
    
    // Calculate confidence (0-1 scale)
    const confidence = Math.min(zScore / (this.config.anomalyThreshold * 2), 1);
    
    return {
      ...dataPoint,
      isAnomaly,
      confidence
    };
  }
  
  /**
   * Fetch market data from Poloniex REST API
   */
  public async fetchMarketData(symbol: string, interval: string = '1h', limit: number = 100): Promise<MarketDataPoint[]> {
    try {
      // Check cache first
      const cacheKey = `${symbol}_${interval}_${limit}`;
      const cached = dataCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.config.cacheDuration)) {
        this.log('debug', `Using cached data for ${cacheKey}`);
        return cached.data;
      }
      
      this.log('info', `Fetching market data for ${symbol} (${interval})`);
      
      const response = await this.poloniexRestClient.get(`/${symbol}/candles`, {
        params: {
          interval,
          limit
        }
      });
      
      if (!response.data) {
        throw new Error('No data received from Poloniex API');
      }
      
      // Transform API response to MarketDataPoint[]
      const marketData: MarketDataPoint[] = response.data.map((candle: any) => ({
        symbol,
        timestamp: candle.timestamp,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
        quoteVolume: parseFloat(candle.quoteVolume),
        source: 'poloniex_rest'
      }));
      
      // Process each data point
      const processedData = marketData.map(dataPoint => {
        // Apply normalization if enabled
        if (this.config.enableDataNormalization) {
          dataPoint = this.normalizeData(dataPoint);
        }
        
        // Detect anomalies if enabled
        if (this.config.enableAnomalyDetection) {
          dataPoint = this.detectAnomaly(dataPoint);
        }
        
        return dataPoint;
      });
      
      // Cache the processed data
      dataCache.set(cacheKey, {
        data: processedData,
        timestamp: Date.now()
      });
      
      return processedData;
    } catch (error) {
      this.log('error', `Error fetching market data: ${error}`);
      
      // Try to use cached data even if expired
      const cached = dataCache.get(`${symbol}_${interval}_${limit}`);
      if (cached) {
        this.log('warn', `Using expired cached data for ${symbol}`);
        return cached.data;
      }
      
      throw error;
    }
  }
  
  /**
   * Fetch order book from Poloniex REST API
   */
  public async fetchOrderBook(symbol: string, limit: number = 100): Promise<OrderBook> {
    try {
      // Check cache first
      const cacheKey = `orderbook_${symbol}_${limit}`;
      const cached = dataCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.config.cacheDuration / 10)) { // Shorter cache for order book
        this.log('debug', `Using cached order book for ${symbol}`);
        return cached.data;
      }
      
      this.log('info', `Fetching order book for ${symbol}`);
      
      const response = await this.poloniexRestClient.get(`/${symbol}/orderBook`, {
        params: { limit }
      });
      
      if (!response.data) {
        throw new Error('No data received from Poloniex API');
      }
      
      // Transform API response to OrderBook
      const orderBook: OrderBook = {
        symbol,
        timestamp: Date.now(),
        bids: response.data.bids.map((bid: any) => ({
          price: parseFloat(bid[0]),
          amount: parseFloat(bid[1]),
          timestamp: Date.now()
        })),
        asks: response.data.asks.map((ask: any) => ({
          price: parseFloat(ask[0]),
          amount: parseFloat(ask[1]),
          timestamp: Date.now()
        })),
        source: 'poloniex_rest',
        lastUpdateId: response.data.sequence
      };
      
      // Cache the order book
      dataCache.set(cacheKey, {
        data: orderBook,
        timestamp: Date.now()
      });
      
      return orderBook;
    } catch (error) {
      this.log('error', `Error fetching order book: ${error}`);
      
      // Try to use cached data even if expired
      const cached = dataCache.get(`orderbook_${symbol}_${limit}`);
      if (cached) {
        this.log('warn', `Using expired cached order book for ${symbol}`);
        return cached.data;
      }
      
      throw error;
    }
  }
  
  /**
   * Fetch recent trades from Poloniex REST API
   */
  public async fetchTrades(symbol: string, limit: number = 100): Promise<TradeEntry[]> {
    try {
      // Check cache first
      const cacheKey = `trades_${symbol}_${limit}`;
      const cached = dataCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.config.cacheDuration / 10)) { // Shorter cache for trades
        this.log('debug', `Using cached trades for ${symbol}`);
        return cached.data;
      }
      
      this.log('info', `Fetching trades for ${symbol}`);
      
      const response = await this.poloniexRestClient.get(`/${symbol}/trades`, {
        params: { limit }
      });
      
      if (!response.data) {
        throw new Error('No data received from Poloniex API');
      }
      
      // Transform API response to TradeEntry[]
      const trades: TradeEntry[] = response.data.map((trade: any) => ({
        id: trade.id.toString(),
        symbol,
        timestamp: trade.ts,
        price: parseFloat(trade.price),
        amount: parseFloat(trade.amount),
        side: trade.takerSide === 'sell' ? 'buy' : 'sell', // Invert taker side to get maker side
        source: 'poloniex_rest'
      }));
      
      // Cache the trades
      dataCache.set(cacheKey, {
        data: trades,
        timestamp: Date.now()
      });
      
      return trades;
    } catch (error) {
      this.log('error', `Error fetching trades: ${error}`);
      
      // Try to use cached data even if expired
      const cached = dataCache.get(`trades_${symbol}_${limit}`);
      if (cached) {
        this.log('warn', `Using expired cached trades for ${symbol}`);
        return cached.data;
      }
      
      throw error;
    }
  }
  
  /**
   * Fetch market summary from Poloniex REST API
   */
  public async fetchMarketSummary(symbol: string): Promise<MarketSummary> {
    try {
      // Check cache first
      const cacheKey = `summary_${symbol}`;
      const cached = dataCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.config.cacheDuration / 2)) { // Medium cache for summary
        this.log('debug', `Using cached market summary for ${symbol}`);
        return cached.data;
      }
      
      this.log('info', `Fetching market summary for ${symbol}`);
      
      const response = await this.poloniexRestClient.get(`/${symbol}/ticker24h`);
      
      if (!response.data) {
        throw new Error('No data received from Poloniex API');
      }
      
      // Transform API response to MarketSummary
      const summary: MarketSummary = {
        symbol,
        timestamp: Date.now(),
        lastPrice: parseFloat(response.data.close),
        bidPrice: parseFloat(response.data.markPrice), // Using mark price as bid
        askPrice: parseFloat(response.data.markPrice), // Using mark price as ask
        high24h: parseFloat(response.data.high),
        low24h: parseFloat(response.data.low),
        volume24h: parseFloat(response.data.volume),
        quoteVolume24h: parseFloat(response.data.quoteVolume),
        percentChange24h: parseFloat(response.data.change) * 100,
        source: 'poloniex_rest'
      };
      
      // Cache the summary
      dataCache.set(cacheKey, {
        data: summary,
        timestamp: Date.now()
      });
      
      return summary;
    } catch (error) {
      this.log('error', `Error fetching market summary: ${error}`);
      
      // Try to use cached data even if expired
      const cached = dataCache.get(`summary_${symbol}`);
      if (cached) {
        this.log('warn', `Using expired cached market summary for ${symbol}`);
        return cached.data;
      }
      
      throw error;
    }
  }
  
  /**
   * Aggregate data from multiple sources
   */
  public async getAggregatedData(symbol: string, interval: string = '1h', limit: number = 100): Promise<MarketDataPoint[]> {
    try {
      // Fetch data from multiple sources
      const sources = [];
      
      // Primary source
      if (this.config.primarySource === 'poloniex' || this.config.fallbackSources.includes('poloniex')) {
        try {
          const poloniexData = await this.fetchMarketData(symbol, interval, limit);
          sources.push({ source: 'poloniex', data: poloniexData, weight: 1.0 });
        } catch (error) {
          this.log('warn', `Failed to fetch data from Poloniex: ${error}`);
        }
      }
      
      // WebSocket data (from buffer)
      if (this.config.primarySource === 'websocket' || this.config.fallbackSources.includes('websocket')) {
        const wsData = this.dataBuffer.get(symbol);
        if (wsData && wsData.length > 0) {
          sources.push({ source: 'websocket', data: wsData, weight: 1.2 }); // Higher weight for real-time data
        }
      }
      
      // If no data sources available, throw error
      if (sources.length === 0) {
        throw new Error('No data available from any source');
      }
      
      // If only one source, return its data
      if (sources.length === 1) {
        return sources[0].data;
      }
      
      // Aggregate data from multiple sources
      return this.aggregateDataSources(sources, this.config.aggregationMethod);
    } catch (error) {
      this.log('error', `Error getting aggregated data: ${error}`);
      throw error;
    }
  }
  
  /**
   * Aggregate data from multiple sources
   */
  private aggregateDataSources(
    sources: { source: string; data: MarketDataPoint[]; weight: number }[],
    method: 'weighted' | 'median' | 'mean'
  ): MarketDataPoint[] {
    // Group data points by timestamp (rounded to nearest minute)
    const groupedByTimestamp = new Map<number, { points: MarketDataPoint[], weights: number[] }>();
    
    for (const source of sources) {
      for (const point of source.data) {
        // Round timestamp to nearest minute
        const roundedTimestamp = Math.floor(point.timestamp / 60000) * 60000;
        
        if (!groupedByTimestamp.has(roundedTimestamp)) {
          groupedByTimestamp.set(roundedTimestamp, { points: [], weights: [] });
        }
        
        const group = groupedByTimestamp.get(roundedTimestamp)!;
        group.points.push(point);
        group.weights.push(source.weight);
      }
    }
    
    // Aggregate data points for each timestamp
    const aggregatedData: MarketDataPoint[] = [];
    
    for (const [timestamp, { points, weights }] of groupedByTimestamp.entries()) {
      if (points.length === 0) continue;
      
      let aggregatedPoint: MarketDataPoint;
      
      switch (method) {
        case 'weighted':
          aggregatedPoint = this.weightedAggregate(points, weights);
          break;
        case 'median':
          aggregatedPoint = this.medianAggregate(points);
          break;
        case 'mean':
        default:
          aggregatedPoint = this.meanAggregate(points);
          break;
      }
      
      // Set timestamp and symbol
      aggregatedPoint.timestamp = timestamp;
      aggregatedPoint.symbol = points[0].symbol;
      aggregatedPoint.source = 'aggregated';
      
      aggregatedData.push(aggregatedPoint);
    }
    
    // Sort by timestamp
    return aggregatedData.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  /**
   * Weighted aggregate of data points
   */
  private weightedAggregate(points: MarketDataPoint[], weights: number[]): MarketDataPoint {
    // Normalize weights
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weights.map(w => w / totalWeight);
    
    // Calculate weighted average for each numeric field
    const result: any = {};
    
    for (const field of ['open', 'high', 'low', 'close', 'volume', 'quoteVolume']) {
      let weightedSum = 0;
      
      for (let i = 0; i < points.length; i++) {
        weightedSum += points[i][field] * normalizedWeights[i];
      }
      
      result[field] = weightedSum;
    }
    
    return result as MarketDataPoint;
  }
  
  /**
   * Median aggregate of data points
   */
  private medianAggregate(points: MarketDataPoint[]): MarketDataPoint {
    const result: any = {};
    
    for (const field of ['open', 'high', 'low', 'close', 'volume', 'quoteVolume']) {
      const values = points.map(p => p[field]).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      
      if (values.length % 2 === 0) {
        result[field] = (values[middle - 1] + values[middle]) / 2;
      } else {
        result[field] = values[middle];
      }
    }
    
    return result as MarketDataPoint;
  }
  
  /**
   * Mean aggregate of data points
   */
  private meanAggregate(points: MarketDataPoint[]): MarketDataPoint {
    const result: any = {};
    
    for (const field of ['open', 'high', 'low', 'close', 'volume', 'quoteVolume']) {
      const sum = points.reduce((acc, p) => acc + p[field], 0);
      result[field] = sum / points.length;
    }
    
    return result as MarketDataPoint;
  }
  
  /**
   * Handle data received event
   */
  private handleDataReceived(event: any): void {
    this.log('debug', `Data received from ${event.source}`);
    // Additional handling can be added here
  }
  
  /**
   * Handle connection error event
   */
  private handleConnectionError(event: any): void {
    this.log('error', `Connection error from ${event.source}: ${event.error}`);
    
    // If primary source fails, switch to fallback
    if (event.source === this.config.primarySource) {
      const fallbacks = this.config.fallbackSources.filter(s => s !== event.source);
      
      if (fallbacks.length > 0) {
        this.log('info', `Switching to fallback source: ${fallbacks[0]}`);
        // Implementation of fallback logic
      }
    }
  }
  
  /**
   * Log messages based on configured log level
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    
    if (levels[level] >= levels[this.config.logLevel]) {
      const timestamp = new Date().toISOString();
      console[level](`[${timestamp}] [LiveData] [${level.toUpperCase()}] ${message}`);
    }
  }
  
  // Throttled and debounced methods (defined in constructor)
  private processDataThrottled: (dataPoint: MarketDataPoint) => void;
  private updateBaselineDebounced: (symbol: string) => void;
}

// Export singleton instance
export const liveDataService = new LiveDataService();

export default {
  LiveDataService,
  liveDataService,
  liveDataEvents
};
