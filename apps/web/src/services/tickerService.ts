import { getBackendUrl } from '@/utils/environment';

const BASE_URL = getBackendUrl();

export interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  lastUpdateTime: Date;
}

export interface PoloniexTickerData {
  s: string;        // symbol (e.g., "BTC_USDT_PERP")
  o: string;        // open price
  l: string;        // low price
  h: string;        // high price
  c: string;        // close/current price
  qty: string;      // quantity
  amt: string;      // amount
  tC: number;       // trade count
  sT: number;       // start time
  cT: number;       // current time
  dN: string;       // display name
  dC: string;       // daily change
  bPx: string;      // bid price
  bSz: string;      // bid size
  aPx: string;      // ask price
  aSz: string;      // ask size
  mPx: string;      // mark price
  iPx: string;      // index price
}

// Backend returns unwrapped array after V3 API fix
export type PoloniexTickerResponse = PoloniexTickerData[];

/**
 * Convert Poloniex symbol format to display format
 * BTC_USDT_PERP -> BTC-USDT
 */
function convertSymbolFormat(poloniexSymbol: string): string {
  return poloniexSymbol.replace('_PERP', '').replace('_', '-');
}

/**
 * Convert display symbol to Poloniex format
 * BTC-USDT -> BTC_USDT_PERP
 */
function convertToPoloniexFormat(displaySymbol: string): string {
  return displaySymbol.replace('-', '_') + '_PERP';
}

/**
 * Parse Poloniex ticker response to TickerData format
 */
function parseTickerData(data: PoloniexTickerData): TickerData {
  const currentPrice = parseFloat(data.c);
  const openPrice = parseFloat(data.o);
  const change24h = currentPrice - openPrice;
  const changePercent24h = (change24h / openPrice) * 100;

  return {
    symbol: convertSymbolFormat(data.s),
    price: currentPrice,
    change24h,
    changePercent24h,
    volume24h: parseFloat(data.amt),
    high24h: parseFloat(data.h),
    low24h: parseFloat(data.l),
    lastUpdateTime: new Date(data.cT)
  };
}

/**
 * Ticker Service
 * Fetches real-time market ticker data from backend
 */
export const TickerService = {
  /**
   * Fetch ticker for a single symbol
   */
  async fetchTicker(symbol: string): Promise<TickerData | null> {
    try {
      const poloniexSymbol = convertToPoloniexFormat(symbol);
      const url = `${BASE_URL}/api/futures/ticker?symbol=${poloniexSymbol}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        // console.error(`Failed to fetch ticker for ${symbol}:`, response.statusText);
        return null;
      }

      const data: PoloniexTickerResponse = await response.json();
      
      // Backend returns unwrapped array after V3 API fix
      if (!Array.isArray(data) || data.length === 0) {
        // console.error(`Invalid ticker response for ${symbol}:`, data);
        return null;
      }

      const tickerData = data[0];
      if (!tickerData) {
        // console.error(`No ticker data found for ${symbol}`);
        return null;
      }

      return parseTickerData(tickerData);
    } catch (_error) {
      // console.error(`Error fetching ticker for ${symbol}:`, error);
      return null;
    }
  },

  /**
   * Fetch tickers for multiple symbols
   */
  async fetchTickers(symbols: string[]): Promise<TickerData[]> {
    try {
      const tickerPromises = symbols.map(symbol => this.fetchTicker(symbol));
      const tickers = await Promise.all(tickerPromises);
      
      // Filter out null values (failed fetches)
      return tickers.filter((ticker): ticker is TickerData => ticker !== null);
    } catch (_error) {
      // console.error('Error fetching multiple tickers:', error);
      return [];
    }
  },

  /**
   * Fetch all available tickers
   */
  async fetchAllTickers(): Promise<TickerData[]> {
    try {
      const url = `${BASE_URL}/api/futures/ticker`;
      
      const response = await fetch(url);
      if (!response.ok) {
        // console.error('Failed to fetch all tickers:', response.statusText);
        return [];
      }

      const data: PoloniexTickerResponse = await response.json();
      
      // Backend returns unwrapped array after V3 API fix
      if (!Array.isArray(data)) {
        // console.error('Invalid ticker response:', data);
        return [];
      }

      return data.map(parseTickerData);
    } catch (_error) {
      // console.error('Error fetching all tickers:', error);
      return [];
    }
  },

  /**
   * Subscribe to ticker updates (polling-based)
   * Returns a cleanup function to stop polling
   */
  subscribeTickers(
    symbols: string[],
    callback: (tickers: TickerData[]) => void,
    intervalMs: number = 2000
  ): () => void {
    let isActive = true;

    const fetchAndUpdate = async () => {
      if (!isActive) return;
      
      const tickers = await this.fetchTickers(symbols);
      if (isActive && tickers.length > 0) {
        callback(tickers);
      }
    };

    // Initial fetch
    fetchAndUpdate();

    // Set up polling
    const intervalId = setInterval(fetchAndUpdate, intervalMs);

    // Return cleanup function
    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }
};

export default TickerService;
