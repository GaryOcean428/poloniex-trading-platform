export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface TradeData {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface TickerData {
  symbol: string;
  price: number;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  timestamp: number;
}
