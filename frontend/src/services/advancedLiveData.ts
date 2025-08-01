import axios from "axios";

// Type definitions for live data processing
export interface LiveDataConfig {
  primarySource: "poloniex" | "websocket" | "aggregated";
  fallbackSources: ("poloniex" | "websocket" | "rest")[];
  updateInterval: number;
  aggregationMethod: "weighted" | "median" | "mean";
  enableAnomalyDetection: boolean;
  anomalyThreshold: number;
  enableDataNormalization: boolean;
  cacheDuration: number;
  maxRetries: number;
  retryDelay: number;
  enableCompression: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
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
  side: "buy" | "sell";
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

// Event types
interface LiveDataEvents {
  data_received: { source: string; data: unknown };
  data_processed: MarketDataPoint;
  websocket_connected: string;
  connection_error: { source: string; error: unknown };
  max_retries_reached: string;
  service_started: void;
  service_stopped: void;
  initialization_error: { error: unknown };
}

type EventCallback<T> = (data: T) => void;

class BrowserEventEmitter {
  private events: Record<string, EventCallback<any>[]> = {};

  on<K extends keyof LiveDataEvents>(
    event: K,
    callback: EventCallback<LiveDataEvents[K]>
  ): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  emit<K extends keyof LiveDataEvents>(
    event: K,
    data: LiveDataEvents[K]
  ): void {
    if (!this.events[event]) return;
    this.events[event].forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        // console.error("Error in event handler:", error);
      }
    });
  }

  off<K extends keyof LiveDataEvents>(
    event: K,
    callback: EventCallback<LiveDataEvents[K]>
  ): void {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter((cb) => cb !== callback);
  }
}

// Default configuration
const defaultLiveDataConfig: LiveDataConfig = {
  primarySource: "aggregated",
  fallbackSources: ["poloniex", "websocket", "rest"],
  updateInterval: 1000,
  aggregationMethod: "weighted",
  enableAnomalyDetection: true,
  anomalyThreshold: 3.0,
  enableDataNormalization: true,
  cacheDuration: 60000,
  maxRetries: 3,
  retryDelay: 1000,
  enableCompression: true,
  logLevel: "info",
};

// Cache for market data
const dataCache = new Map<string, { data: unknown; timestamp: number }>();

// Event emitter for live data updates
export const liveDataEvents = new BrowserEventEmitter();

/**
 * Advanced Live Data Service class
 */
export class LiveDataService {
  private config: LiveDataConfig;
  private websockets: Map<string, WebSocket> = new Map();
  private poloniexRestClient: unknown;
  private isRunning = false;
  private retryCount = new Map<string, number>();
  private dataBuffer = new Map<string, MarketDataPoint[]>();
  private lastAnomalyCheck = new Map<string, number>();
  private statisticalBaseline = new Map<
    string,
    { mean: number; stdDev: number; updateTime: number }
  >();

  constructor(config: Partial<LiveDataConfig> = {}) {
    this.config = { ...defaultLiveDataConfig, ...config };
    this.initializePoloniexClient();
  }

  private initializePoloniexClient(): void {
    this.poloniexRestClient = axios.create({
      baseURL: "https://api.poloniex.com/markets",
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PoloniexTradingPlatform/1.0",
      },
    });
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log("info", "Starting live data service");
    this.initializeWebSockets();
    liveDataEvents.emit("service_started", undefined);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.log("info", "Stopping live data service");

    this.websockets.forEach((ws, key) => {
      ws.close();
      this.websockets.delete(key);
    });

    liveDataEvents.emit("service_stopped", undefined);
  }

  private initializeWebSockets(): void {
    try {
      // Get bullet token for V3 WebSocket connection
      this.getBulletToken().then(({ token, endpoint }) => {
        const poloniexWs = new WebSocket(`${endpoint}?token=${token}`);

        poloniexWs.onopen = () => {
          this.log("info", "Poloniex V3 WebSocket connected");
          
          // Subscribe to ticker using V3 format
          poloniexWs.send(
            JSON.stringify({
              id: Date.now(),
              type: 'subscribe',
              topic: '/contractMarket/ticker:BTCUSDTPERP',
              response: true
            })
          );
          
          this.websockets.set("poloniex", poloniexWs);
          liveDataEvents.emit("websocket_connected", "poloniex");
        };

      poloniexWs.onmessage = (event: MessageEvent) => {
        try {
          const parsedData = JSON.parse(event.data);
          this.handleWebSocketMessage("poloniex", parsedData);
        } catch (error) {
          this.log("error", `Error parsing WebSocket message: ${error}`);
        }
      };

      poloniexWs.onerror = (event: Event) => {
        const error =
          event instanceof ErrorEvent ? event.error : "WebSocket error";
        this.log("error", `WebSocket error: ${error}`);
        liveDataEvents.emit("connection_error", { source: "poloniex", error });
      };

        poloniexWs.onclose = () => {
          this.log("info", "Poloniex V3 WebSocket disconnected");
          this.websockets.delete("poloniex");

          if (this.isRunning) {
            const retryCount = (this.retryCount.get("poloniex") || 0) + 1;
            this.retryCount.set("poloniex", retryCount);

            if (retryCount <= this.config.maxRetries) {
              setTimeout(
                () => this.initializeWebSockets(),
                this.config.retryDelay * retryCount
              );
            } else {
              liveDataEvents.emit("max_retries_reached", "poloniex");
            }
          }
        };
      }).catch(error => {
        this.log("error", `Error getting bullet token: ${error}`);
        liveDataEvents.emit("initialization_error", { error });
      });
    } catch (error) {
      this.log("error", `Error initializing WebSockets: ${error}`);
      liveDataEvents.emit("initialization_error", { error });
    }
  }

  // Add bullet token getter method
  private async getBulletToken(): Promise<{ token: string; endpoint: string }> {
    try {
      const response = await fetch('https://futures-api.poloniex.com/api/v1/bullet-public', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get bullet token: ${response.status}`);
      }
      
      const data = await response.json();
      if (data && data.data && data.data.token) {
        return {
          token: data.data.token,
          endpoint: data.data.instanceServers[0].endpoint
        };
      } else {
        throw new Error('Invalid bullet token response format');
      }
    } catch (error) {
      this.log("error", `Failed to get bullet token: ${error}`);
      throw error;
    }
  }

  private handleWebSocketMessage(source: string, message: unknown): void {
    try {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        "data" in message
      ) {
        const msg = message as { type: string; topic?: string; data: unknown };
        if (msg.type === "message" && msg.topic && msg.topic.includes('/contractMarket/ticker') && msg.data) {
          const tickerData = msg.data;
          const marketData: MarketDataPoint = {
            symbol: tickerData.symbol || 'UNKNOWN',
            timestamp: Date.now(),
            open: parseFloat(tickerData.open24h || "0"),
            high: parseFloat(tickerData.high24h || "0"),
            low: parseFloat(tickerData.low24h || "0"),
            close: parseFloat(tickerData.price || tickerData.lastPrice || "0"),
            volume: parseFloat(tickerData.volume24h || "0"),
            quoteVolume: parseFloat(tickerData.turnover24h || "0"),
            source: "poloniex_ws_v3",
          };
          this.processData(marketData);
          this.addToDataBuffer(marketData);
        }
      }
      liveDataEvents.emit("data_received", { source, data: message });
    } catch (error) {
      this.log("error", `Error handling WebSocket message: ${error}`);
    }
  }

  private addToDataBuffer(dataPoint: MarketDataPoint): void {
    const key = dataPoint.symbol;
    if (!this.dataBuffer.has(key)) {
      this.dataBuffer.set(key, []);
    }

    const buffer = this.dataBuffer.get(key)!;
    buffer.push(dataPoint);

    if (buffer.length > 100) {
      buffer.shift();
    }

    const lastUpdate = this.lastAnomalyCheck.get(key) || 0;
    if (Date.now() - lastUpdate > 300000) {
      this.lastAnomalyCheck.set(key, Date.now());
      this.updateStatisticalBaseline(key);
    }
  }

  private updateStatisticalBaseline(symbol: string): void {
    const buffer = this.dataBuffer.get(symbol);
    if (!buffer || buffer.length < 30) return;

    const prices = buffer.map((d) => d.close);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    const squaredDiffs = prices.map((price) => Math.pow(price - mean, 2));
    const variance =
      squaredDiffs.reduce((sum, diff) => sum + diff, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(variance);

    this.statisticalBaseline.set(symbol, {
      mean,
      stdDev,
      updateTime: Date.now(),
    });
  }

  private processData(dataPoint: MarketDataPoint): void {
    try {
      if (this.config.enableDataNormalization) {
        dataPoint = this.normalizeData(dataPoint);
      }

      if (this.config.enableAnomalyDetection) {
        dataPoint = this.detectAnomaly(dataPoint);
      }

      const cacheKey = `${dataPoint.symbol}_${dataPoint.timestamp}`;
      dataCache.set(cacheKey, { data: dataPoint, timestamp: Date.now() });
      liveDataEvents.emit("data_processed", dataPoint);
    } catch (error) {
      this.log("error", `Error processing data: ${error}`);
    }
  }

  private normalizeData(dataPoint: MarketDataPoint): MarketDataPoint {
    const normalized = { ...dataPoint };

    // Ensure high/low bounds are correct
    const prices = [
      normalized.open,
      normalized.high,
      normalized.low,
      normalized.close,
    ].filter((p) => typeof p === "number" && isFinite(p));

    if (prices.length > 0) {
      normalized.high = Math.max(...prices);
      normalized.low = Math.min(...prices);
    }

    normalized.normalized = true;
    return normalized;
  }

  private detectAnomaly(dataPoint: MarketDataPoint): MarketDataPoint {
    const baseline = this.statisticalBaseline.get(dataPoint.symbol);
    if (!baseline) {
      return { ...dataPoint, isAnomaly: false, confidence: 0 };
    }

    const zScore = Math.abs(
      (dataPoint.close - baseline.mean) / baseline.stdDev
    );
    const isAnomaly = zScore > this.config.anomalyThreshold;
    const confidence = Math.min(zScore / (this.config.anomalyThreshold * 2), 1);

    return { ...dataPoint, isAnomaly, confidence };
  }

  public async fetchMarketData(
    symbol: string,
    interval = "1h",
    limit = 100
  ): Promise<MarketDataPoint[]> {
    try {
      const cacheKey = `${symbol}_${interval}_${limit}`;
      const cached = dataCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
        return cached.data;
      }

      const response = await this.poloniexRestClient.get(`/${symbol}/candles`, {
        params: { interval, limit },
      });

      if (!response.data) {
        throw new Error("No data received from API");
      }

      const marketData: MarketDataPoint[] = response.data.map(
        (candle: Record<string, string | number>) => ({
          symbol,
          timestamp: Number(candle.timestamp),
          open: parseFloat(String(candle.open || "0")),
          high: parseFloat(String(candle.high || "0")),
          low: parseFloat(String(candle.low || "0")),
          close: parseFloat(String(candle.close || "0")),
          volume: parseFloat(String(candle.volume || "0")),
          quoteVolume: parseFloat(String(candle.quoteVolume || "0")),
          source: "poloniex_rest",
        })
      );

      const processedData = marketData.map((point) => {
        const processed = point;
        if (this.config.enableDataNormalization) {
          processed = this.normalizeData(processed);
        }
        if (this.config.enableAnomalyDetection) {
          processed = this.detectAnomaly(processed);
        }
        return processed;
      });

      dataCache.set(cacheKey, { data: processedData, timestamp: Date.now() });
      return processedData;
    } catch (error) {
      const cached = dataCache.get(`${symbol}_${interval}_${limit}`);
      if (cached) return cached.data;
      throw error;
    }
  }

  public async fetchOrderBook(symbol: string, limit = 100): Promise<OrderBook> {
    try {
      const cacheKey = `orderbook_${symbol}_${limit}`;
      const cached = dataCache.get(cacheKey);

      if (
        cached &&
        Date.now() - cached.timestamp < this.config.cacheDuration / 10
      ) {
        return cached.data;
      }

      const response = await this.poloniexRestClient.get(
        `/${symbol}/orderBook`,
        {
          params: { limit },
        }
      );

      const orderBook: OrderBook = {
        symbol,
        timestamp: Date.now(),
        bids: (response.data.bids || []).map((bid: [string, string]) => ({
          price: parseFloat(bid[0]),
          amount: parseFloat(bid[1]),
          timestamp: Date.now(),
        })),
        asks: (response.data.asks || []).map((ask: [string, string]) => ({
          price: parseFloat(ask[0]),
          amount: parseFloat(ask[1]),
          timestamp: Date.now(),
        })),
        source: "poloniex_rest",
        lastUpdateId: response.data.sequence,
      };

      dataCache.set(cacheKey, { data: orderBook, timestamp: Date.now() });
      return orderBook;
    } catch (error) {
      const cached = dataCache.get(`orderbook_${symbol}_${limit}`);
      if (cached) return cached.data;
      throw error;
    }
  }

  public async fetchTrades(symbol: string, limit = 100): Promise<TradeEntry[]> {
    try {
      const cacheKey = `trades_${symbol}_${limit}`;
      const cached = dataCache.get(cacheKey);

      if (
        cached &&
        Date.now() - cached.timestamp < this.config.cacheDuration / 10
      ) {
        return cached.data;
      }

      const response = await this.poloniexRestClient.get(`/${symbol}/trades`, {
        params: { limit },
      });

      const trades: TradeEntry[] = (response.data || []).map(
        (trade: Record<string, string | number>) => ({
          id: String(trade.id || ""),
          symbol,
          timestamp: Number(trade.ts || Date.now()),
          price: parseFloat(String(trade.price || "0")),
          amount: parseFloat(String(trade.amount || "0")),
          side:
            String(trade.takerSide || "").toLowerCase() === "sell"
              ? "buy"
              : "sell",
          source: "poloniex_rest",
        })
      );

      dataCache.set(cacheKey, { data: trades, timestamp: Date.now() });
      return trades;
    } catch (error) {
      const cached = dataCache.get(`trades_${symbol}_${limit}`);
      if (cached) return cached.data;
      throw error;
    }
  }

  public async fetchMarketSummary(symbol: string): Promise<MarketSummary> {
    try {
      const cacheKey = `summary_${symbol}`;
      const cached = dataCache.get(cacheKey);

      if (
        cached &&
        Date.now() - cached.timestamp < this.config.cacheDuration / 2
      ) {
        return cached.data;
      }

      const response = await this.poloniexRestClient.get(
        `/${symbol}/ticker24h`
      );

      const summary: MarketSummary = {
        symbol,
        timestamp: Date.now(),
        lastPrice: parseFloat(String(response.data.close || "0")),
        bidPrice: parseFloat(String(response.data.markPrice || "0")),
        askPrice: parseFloat(String(response.data.markPrice || "0")),
        high24h: parseFloat(String(response.data.high || "0")),
        low24h: parseFloat(String(response.data.low || "0")),
        volume24h: parseFloat(String(response.data.volume || "0")),
        quoteVolume24h: parseFloat(String(response.data.quoteVolume || "0")),
        percentChange24h: parseFloat(String(response.data.change || "0")) * 100,
        source: "poloniex_rest",
      };

      dataCache.set(cacheKey, { data: summary, timestamp: Date.now() });
      return summary;
    } catch (error) {
      const cached = dataCache.get(`summary_${symbol}`);
      if (cached) return cached.data;
      throw error;
    }
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string
  ): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= levels[this.config.logLevel]) {
      console[level](`[LiveData] ${message}`);
    }
  }
}

// Export singleton instance
export const liveDataService = new LiveDataService();

export default {
  LiveDataService,
  liveDataService,
  liveDataEvents,
};
