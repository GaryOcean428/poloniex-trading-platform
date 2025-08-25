<<<<<<< HEAD
// Re-export strategy types from shared module
export * from '@shared/types/strategy';
=======
// Re-export strategy types from ambient module declarations
// This ensures compatibility during Railway builds
export * from '@shared/types';

// Explicit re-exports for key types and values to ensure they're always available
export type {
  Strategy,
  StrategyParameters,
  TradingStrategy,
  MovingAverageCrossoverParameters,
  RSIParameters,
  MACDParameters,
  BollingerBandsParameters,
  BreakoutParameters,
  StrategyTypeUnion,
  StrategyPerformance,
  BaseStrategyParameters
} from '@shared/types';

// Export StrategyType as a value (enum)
export { StrategyType } from '@shared/types';
>>>>>>> origin/main

export interface MarketData {
  pair: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  pair: string;
  timestamp: number;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  total: number;
  strategyId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

export interface Position {
  id: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number;
  leverage: number;
  marginMode: 'ISOLATED' | 'CROSS';
  liquidationPrice: number;
  unrealizedPnL: number;
  marginRatio: number;
  timestamp: number;
}

export interface FuturesOrder {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET' | 'POST_ONLY' | 'FOK' | 'IOC';
  price?: number;
  size: number;
  value: number;
  leverage: number;
  marginMode: 'ISOLATED' | 'CROSS';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED';
  timestamp: number;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export interface ExchangeService {
  placeOrder: (pair: string, side: 'BUY' | 'SELL', type: 'LIMIT' | 'MARKET', quantity: number, price?: number) => Promise<unknown>;
  errors: string[];
  addError: (error: string) => void;
  clearErrors: () => void;
  refreshApiConnection: () => Promise<void>;
}
