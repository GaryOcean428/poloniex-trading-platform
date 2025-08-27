import seedrandom from 'seedrandom';
import { OrderBookEntry, TradeData, TickerData } from '../../../shared/types';

// Mock data generators for various market data types
// These functions generate realistic-looking mock data for testing

export interface MarketDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookData {
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

/**
 * Generate random market data (candles/OHLCV)
 * @param symbol Trading pair symbol
 * @param timeframe Timeframe for the candles
 * @param limit Number of candles to generate
 * @param volatility Volatility factor (0-1)
 * @param trendBias Trend bias factor (-1 to 1, negative for bearish, positive for bullish)
 * @param seed Random seed for reproducible results
 * @param realistic Whether to use more realistic market simulation
 * @returns Array of market data points
 */
export const generateRandomMarketData = (
  symbol: string,
  timeframe: string,
  limit: number = 100,
  volatility: number = 0.5,
  trendBias: number = 0,
  seed?: number,
  realistic: boolean = false
): MarketDataPoint[] => {
  // Set random seed if provided
  if (seed !== undefined) {
    seedrandom(seed.toString(), { global: true });
  }

  // Parse timeframe to get interval in minutes
  const timeframeMap: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '4h': 240,
    '1d': 1440
  };

  const intervalMinutes = timeframeMap[timeframe] || 5;

  // Generate base price based on symbol
  const symbolPriceMap: Record<string, number> = {
    'BTC-USDT': 50000,
    'ETH-USDT': 3000,
    'SOL-USDT': 100,
    'XRP-USDT': 0.5,
    'ADA-USDT': 0.4,
    'DOT-USDT': 10,
    'DOGE-USDT': 0.1,
    'AVAX-USDT': 30,
    'MATIC-USDT': 1.2,
    'LINK-USDT': 15
  };

  const basePrice = symbolPriceMap[symbol] || 100;

  // Calculate time interval
  const now = new Date();
  const endTime = now.getTime();
  const startTime = endTime - (limit * intervalMinutes * 60 * 1000);

  // Generate data
  const data: MarketDataPoint[] = [];
  let lastClose = basePrice;

  for (let i = 0; i < limit; i++) {
    // Calculate timestamp
    const timestamp = startTime + (i * intervalMinutes * 60 * 1000);

    // Calculate price movement
    const scaledVolatility = volatility * (basePrice * 0.02); // Scale volatility to price
    const trend = trendBias * (basePrice * 0.001) * i; // Cumulative trend effect

    let priceChange: number;

    if (realistic) {
      // More realistic price movement with some mean reversion and momentum
      const meanReversionFactor = 0.3;
      const momentumFactor = 0.2;
      const randomFactor = 0.5;

      // Mean reversion component (pull toward base price)
      const reversion = (basePrice - lastClose) * meanReversionFactor;

      // Momentum component (continue in same direction)
      const prevClose = i > 0 ? (data[i-1]?.close ?? lastClose) : lastClose;
      const momentum = (i > 0 ? (lastClose - prevClose) : 0) * momentumFactor;

      // Random component
      const random = (Math.random() * 2 - 1) * scaledVolatility * randomFactor;

      priceChange = reversion + momentum + random + trend;
    } else {
      // Simple random walk
      priceChange = (Math.random() * 2 - 1) * scaledVolatility + trend;
    }

    // Calculate OHLC
    const open = lastClose;
    const close = Math.max(0.001, open + priceChange); // Ensure price doesn't go negative
    const high = Math.max(open, close) + (Math.random() * scaledVolatility * 0.5);
    const low = Math.min(open, close) - (Math.random() * scaledVolatility * 0.5);

    // Calculate volume
    const baseVolume = basePrice * 1000; // Base volume scaled to price
    const volumeVariation = Math.random() * 0.5 + 0.75; // 0.75 to 1.25
    const volume = baseVolume * volumeVariation * (1 + volatility);

    // Add candle to data
    data.push({
      time: timestamp,
      open,
      high,
      low,
      close,
      volume
    });

    // Update last values for next iteration
    lastClose = close;
  }

  return data;
};

/**
 * Generate random order book
 * @param symbol Trading pair symbol
 * @param volatility Volatility factor (0-1)
 * @param seed Random seed for reproducible results
 * @returns Order book object
 */
export const generateRandomOrderBook = (
  symbol: string,
  volatility: number = 0.5,
  seed?: number
): OrderBookData => {
  // Set random seed if provided
  if (seed !== undefined) {
    seedrandom(seed.toString(), { global: true });
  }

  // Generate base price based on symbol
  const symbolPriceMap: Record<string, number> = {
    'BTC-USDT': 50000,
    'ETH-USDT': 3000,
    'SOL-USDT': 100,
    'XRP-USDT': 0.5,
    'ADA-USDT': 0.4,
    'DOT-USDT': 10,
    'DOGE-USDT': 0.1,
    'AVAX-USDT': 30,
    'MATIC-USDT': 1.2,
    'LINK-USDT': 15
  };

  const basePrice = symbolPriceMap[symbol] || 100;

  // Calculate price step based on price magnitude
  const getPriceStep = (price: number) => {
    if (price >= 10000) return 1;
    if (price >= 1000) return 0.1;
    if (price >= 100) return 0.01;
    if (price >= 10) return 0.001;
    if (price >= 1) return 0.0001;
    return 0.00001;
  };

  const priceStep = getPriceStep(basePrice);

  // Generate bids (buy orders)
  const bids = [];
  let bidPrice = basePrice * (1 - 0.001 * (1 + volatility));

  for (let i = 0; i < 50; i++) {
    const priceDecrease = priceStep * (1 + Math.random() * volatility);
    bidPrice -= priceDecrease;

    // Volume increases as price decreases (more buyers at lower prices)
    const volumeFactor = 1 + (i / 10) * volatility;
    const volume = (Math.random() * basePrice * 0.1 + basePrice * 0.01) * volumeFactor;

    bids.push({ price: bidPrice, quantity: volume });
  }

  // Generate asks (sell orders)
  const asks = [];
  let askPrice = basePrice * (1 + 0.001 * (1 + volatility));

  for (let i = 0; i < 50; i++) {
    const priceIncrease = priceStep * (1 + Math.random() * volatility);
    askPrice += priceIncrease;

    // Volume increases as price increases (more sellers at higher prices)
    const volumeFactor = 1 + (i / 10) * volatility;
    const volume = (Math.random() * basePrice * 0.1 + basePrice * 0.01) * volumeFactor;

    asks.push({ price: askPrice, quantity: volume });
  }

  return {
    symbol,
    bids,
    asks,
    timestamp: Date.now()
  };
};

/**
 * Generate random trades
 * @param symbol Trading pair symbol
 * @param limit Number of trades to generate
 * @param volatility Volatility factor (0-1)
 * @param seed Random seed for reproducible results
 * @returns Array of trade objects
 */
export const generateRandomTrades = (
  symbol: string,
  limit: number = 50,
  volatility: number = 0.5,
  seed?: number
): TradeData[] => {
  // Set random seed if provided
  if (seed !== undefined) {
    seedrandom(seed.toString(), { global: true });
  }

  // Generate base price based on symbol
  const symbolPriceMap: Record<string, number> = {
    'BTC-USDT': 50000,
    'ETH-USDT': 3000,
    'SOL-USDT': 100,
    'XRP-USDT': 0.5,
    'ADA-USDT': 0.4,
    'DOT-USDT': 10,
    'DOGE-USDT': 0.1,
    'AVAX-USDT': 30,
    'MATIC-USDT': 1.2,
    'LINK-USDT': 15
  };

  const basePrice = symbolPriceMap[symbol] || 100;

  // Generate trades
  const trades: TradeData[] = [];
  const now = Date.now();
  let lastPrice = basePrice;

  for (let i = 0; i < limit; i++) {
    // Calculate price movement
    const scaledVolatility = volatility * (basePrice * 0.001);
    const priceChange = (Math.random() * 2 - 1) * scaledVolatility;
    const price = Math.max(0.001, lastPrice + priceChange);

    // Calculate volume
    const baseVolume = basePrice * 0.01;
    const volume = baseVolume * (Math.random() * 2 + 0.1);

    // Determine if buy or sell
    const isBuy = Math.random() > 0.5;

    // Calculate timestamp (recent trades, with some random time difference)
    const timeOffset = Math.floor(Math.random() * 1000 * (i + 1));
    const timestamp = now - timeOffset;

    // Add trade to data
    trades.push({
      id: `mock-trade-${symbol}-${timestamp}`,
      symbol,
      price,
      quantity: volume,
      side: isBuy ? 'buy' : 'sell',
      timestamp
    });

    lastPrice = price;
  }

  // Sort by timestamp (newest first)
  return trades.sort((a, b) => b.timestamp - a.timestamp);
};

/**
 * Generate random ticker data
 * @param symbol Trading pair symbol
 * @param volatility Volatility factor (0-1)
 * @param trendBias Trend bias factor (-1 to 1)
 * @param seed Random seed for reproducible results
 * @returns Ticker object
 */
export const generateRandomTicker = (
  symbol: string,
  volatility: number = 0.5,
  trendBias: number = 0,
  seed?: number
): TickerData => {
  // Set random seed if provided
  if (seed !== undefined) {
    seedrandom(seed.toString(), { global: true });
  }

  // Generate base price based on symbol
  const symbolPriceMap: Record<string, number> = {
    'BTC-USDT': 50000,
    'ETH-USDT': 3000,
    'SOL-USDT': 100,
    'XRP-USDT': 0.5,
    'ADA-USDT': 0.4,
    'DOT-USDT': 10,
    'DOGE-USDT': 0.1,
    'AVAX-USDT': 30,
    'MATIC-USDT': 1.2,
    'LINK-USDT': 15
  };

  const basePrice = symbolPriceMap[symbol] || 100;

  // Apply trend bias to base price
  const biasedBasePrice = basePrice * (1 + trendBias * 0.01);

  // Calculate price variations
  const priceVariation = biasedBasePrice * 0.01 * volatility;
  const lastPrice = biasedBasePrice + (Math.random() * 2 - 1) * priceVariation;

  // Calculate bid and ask prices
  const spreadFactor = 0.001 * (1 + volatility * 0.5);
  const bidPrice = lastPrice * (1 - spreadFactor);
  const askPrice = lastPrice * (1 + spreadFactor);

  // Calculate 24h high and low
  const highLowRange = biasedBasePrice * 0.05 * volatility;
  const high24h = biasedBasePrice + highLowRange;
  const low24h = biasedBasePrice - highLowRange;

  // Calculate 24h volume
  const baseVolume = biasedBasePrice * 1000;
  const volume24h = baseVolume * (1 + Math.random() * volatility);

  // Calculate 24h change
  const change24h = ((lastPrice / biasedBasePrice) - 1) * 100;

  return {
    symbol,
    price: lastPrice,
    lastPrice,
    bidPrice,
    askPrice,
    high24h,
    low24h,
    volume24h,
    change24h,
    changePercent24h: change24h,
    timestamp: Date.now()
  };
};
