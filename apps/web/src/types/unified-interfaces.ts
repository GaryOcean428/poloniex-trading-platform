// Unified trading platform interfaces
export interface AccountBalance {
  available: number;
  total: number;
  currency: string;
  // Extended properties for UI requirements
  totalAmount?: string;
  availableAmount?: string;
  accountEquity?: string;
  unrealizedPnL?: string;
  todayPnL?: string;
  todayPnLPercentage?: string;
}

export interface MarketData {
  // Core properties
  pair: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // CRITICAL: Missing property causing Dashboard.tsx failure
  price?: number; // Added as optional, defaults to close price
}

export interface AdvancedMetrics {
  // Base metrics
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  calmarRatio: number;
  
  // Missing properties causing Backtesting.tsx failures
  gainToLossRatio: number;
  payoffRatio: number;
  expectancy: number;
  systemQualityNumber: number;
  
  // Advanced properties
  painIndex: number;
  martinRatio: number;
  burkeRatio: number;
  skewness: number;
  kurtosis: number;
  upnessIndex: number;
  upsidePotentialRatio: number;
  gainToPainRatio: number;
}

export interface AdvancedBacktestMetrics extends AdvancedMetrics {
  // Existing properties from current interface
  dailyReturns: number[];
  monthlyReturns: number[];
  volatility: number;
  recoveryFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageHoldingPeriod: number;
  bestMonth: number;
  worstMonth: number;
  valueAtRisk95: number;
  valueAtRisk99: number;
  conditionalVaR95: number;
  conditionalVaR99: number;
  sortinoRatio: number;
  omegaRatio: number;
  kappa3: number;
  ulcerIndex: number;
  modifiedSharpe: number;
  treynorRatio: number;
  informationRatio: number;
  modigliani: number;
  excessReturnOnVaR: number;
  conditionalSharpe: number;
  tailRatio: number;
}

export type StrategyTypeUnion = 
  | 'scalping'
  | 'swing' 
  | 'arbitrage'
  | 'momentum'
  | 'mean_reversion'
  | 'trend_following'
  | 'ml_based'
  | 'grid'
  | 'dca';

export interface EnhancedStrategy {
  id: string;
  name: string;
  type: StrategyTypeUnion; // FIXED: Was string, now proper union
  symbol: string;
  timeframe: string;
  parameters: Record<string, any>;
  confidence: number;
  profitPotential: number;
  riskScore: number;
  description: string;
  learningMetrics: {
    adaptationRate: number;
    consistencyScore: number;
    marketConditionPerformance: Record<string, any>;
    timestamp: number;
  };
  adaptationRate: number;
  consistencyScore: number;
  marketConditionPerformance: Record<string, any>;
  active: boolean;
}
