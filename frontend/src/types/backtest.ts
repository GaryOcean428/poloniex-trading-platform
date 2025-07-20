export interface BacktestResult {
  strategyId: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  finalBalance: number;
  totalPnL: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
}

export interface BacktestTrade {
  id: string;
  entryPrice: number;
  exitPrice: number | null;
  entryTime: string;
  exitTime: string | null;
  side: 'long' | 'short';
  status: 'open' | 'closed' | 'stopped';
  pnl: number;
  pnlPercent: number;
  balance: number;
  size: number;
  fee: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  highestProfit?: number;
  // Legacy properties for backward compatibility
  timestamp?: number;
  type?: 'BUY' | 'SELL';
  price?: number;
  amount?: number;
  total?: number;
}

export interface BacktestMetrics {
  dailyReturns: number[];
  monthlyReturns: number[];
  volatility: number;
  profitFactor: number;
  recoveryFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageHoldingPeriod: number;
  bestMonth: number;
  worstMonth: number;
}

export interface OptimizationResult {
  parameters: Record<string, number>;
  performance: BacktestResult;
}

export interface BacktestOptions {
  startDate: string;
  endDate: string;
  initialBalance: number;
  feeRate: number;
  slippage: number;
  useHistoricalData: boolean;
}