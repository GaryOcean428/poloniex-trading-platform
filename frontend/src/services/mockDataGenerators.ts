import { MarketData, OrderBook, Ticker, Trade } from "@/types";

/**
 * Generate random market data for testing purposes
 */
export const generateRandomMarketData = (
  symbol: string,
  timeframe: string,
  limit: number,
  volatility: number = 0.02,
  trendBias: number = 0,
  seed?: number
): MarketData[] => {
  const data: MarketData[] = [];
  let currentPrice = 50000 + Math.random() * 10000; // Start with random BTC price
  const now = Date.now();
  const interval =
    timeframe === "1m" ? 60000 : timeframe === "5m" ? 300000 : 3600000;

  // Use seeded random generator if seed provided
  const getRandom =
    seed !== undefined
      ? (() => {
          let s = seed;
          return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
          };
        })()
      : Math.random;

  for (let i = 0; i < limit; i++) {
    const timestamp = now - (limit - i - 1) * interval;
    const priceChange =
      (getRandom() - 0.5) * volatility * currentPrice +
      trendBias * currentPrice * 0.001;
    const open = currentPrice;
    const close = open + priceChange;
    const high = Math.max(open, close) * (1 + getRandom() * volatility * 0.5);
    const low = Math.min(open, close) * (1 - getRandom() * volatility * 0.5);
    const volume = getRandom() * 1000;

    data.push({
      pair: symbol,
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  return data;
};

/**
 * Generate random order book data
 */
export const generateRandomOrderBook = (
  symbol: string,
  _volatility: number = 0.02,
  seed?: number
): OrderBook => {
  // Use seeded random generator if seed provided
  const getRandom =
    seed !== undefined
      ? (() => {
          let s = seed;
          return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
          };
        })()
      : Math.random;

  const basePrice = 50000 + getRandom() * 10000;
  const spread = basePrice * 0.001; // 0.1% spread

  const bids: [number, number][] = [];
  const asks: [number, number][] = [];

  // Generate bids (buy orders)
  for (let i = 0; i < 10; i++) {
    const price = basePrice - spread - i * basePrice * 0.0001;
    const quantity = getRandom() * 10 + 0.1;
    bids.push([price, quantity]);
  }

  // Generate asks (sell orders)
  for (let i = 0; i < 10; i++) {
    const price = basePrice + spread + i * basePrice * 0.0001;
    const quantity = getRandom() * 10 + 0.1;
    asks.push([price, quantity]);
  }

  return {
    symbol,
    bids,
    asks,
    timestamp: Date.now(),
  };
};

/**
 * Generate random trade data
 */
export const generateRandomTrades = (
  symbol: string,
  limit: number,
  volatility: number = 0.02,
  seed?: number
): Trade[] => {
  const trades: Trade[] = [];
  const now = Date.now();
  let basePrice = 50000 + Math.random() * 10000;

  // Use seeded random generator if seed provided
  const getRandom =
    seed !== undefined
      ? (() => {
          let s = seed;
          return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
          };
        })()
      : Math.random;

  for (let i = 0; i < limit; i++) {
    const timestamp = now - (limit - i - 1) * 60000; // 1 minute intervals
    const price = basePrice + (getRandom() - 0.5) * volatility * basePrice;
    const amount = getRandom() * 5 + 0.01; // 0.01 to 5 BTC
    const type = getRandom() > 0.5 ? "BUY" : "SELL";

    trades.push({
      id: `trade_${timestamp}_${i}`,
      pair: symbol,
      timestamp,
      type,
      price,
      amount,
      total: price * amount,
      strategyId: "mock_strategy",
      status: "COMPLETED",
    });

    basePrice = price;
  }

  return trades;
};

/**
 * Generate random ticker data
 */
export const generateRandomTicker = (
  symbol: string,
  volatility: number = 0.02,
  trendBias: number = 0,
  seed?: number
): Ticker => {
  // Use seeded random generator if seed provided
  const getRandom =
    seed !== undefined
      ? (() => {
          let s = seed;
          return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
          };
        })()
      : Math.random;

  const basePrice = 50000 + getRandom() * 10000;
  const priceChange =
    (getRandom() - 0.5) * volatility * basePrice +
    trendBias * basePrice * 0.001;

  return {
    symbol,
    lastPrice: basePrice + priceChange,
    bidPrice: basePrice - basePrice * 0.001,
    askPrice: basePrice + basePrice * 0.001,
    volume24h: getRandom() * 10000,
    high24h: basePrice * (1 + getRandom() * volatility),
    low24h: basePrice * (1 - getRandom() * volatility),
    timestamp: Date.now(),
  };
};
