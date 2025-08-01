import { AccountBalance, MarketData, AdvancedMetrics, StrategyTypeUnion, EnhancedStrategy } from '../types/unified-interfaces';

export function isValidAccountBalance(obj: unknown): obj is AccountBalance {
  return obj !== null && 
    typeof obj === 'object' &&
    typeof (obj as AccountBalance).available === 'number' &&
    typeof (obj as AccountBalance).total === 'number' &&
    typeof (obj as AccountBalance).currency === 'string';
}

export function isValidMarketData(obj: unknown): obj is MarketData {
  return obj !== null && 
    typeof obj === 'object' &&
    typeof (obj as MarketData).close === 'number' &&
    typeof (obj as MarketData).pair === 'string' &&
    typeof (obj as MarketData).timestamp === 'number';
}

// Enhanced market data with price fallback
export function enhanceMarketData(data: unknown): MarketData {
  if (!data) {
    throw new Error('Invalid market data provided');
  }
  
  return {
    ...data,
    price: data.price ?? data.close ?? data.last ?? 0
  };
}

// Safe account balance access with string properties
export function safeAccountBalance(balance: unknown): AccountBalance {
  if (!balance || typeof balance !== 'object') {
    return {
      available: 0,
      total: 0,
      currency: 'USDT',
      totalAmount: '0',
      availableAmount: '0',
      accountEquity: '0',
      unrealizedPnL: '0',
      todayPnL: '0'
    };
  }

  const balanceObj = balance as Partial<AccountBalance>;
  return {
    available: balanceObj.available ?? 0,
    total: balanceObj.total ?? 0,
    currency: balanceObj.currency ?? 'USDT',
    totalAmount: balanceObj.totalAmount ?? balanceObj.total?.toString() ?? '0',
    availableAmount: balanceObj.availableAmount ?? balanceObj.available?.toString() ?? '0',
    accountEquity: balanceObj.accountEquity ?? balanceObj.total?.toString() ?? '0',
    unrealizedPnL: balanceObj.unrealizedPnL ?? '0',
    todayPnL: balanceObj.todayPnL ?? '0',
    todayPnLPercentage: balanceObj.todayPnLPercentage ?? '0'
  };
}

export function safeMetricsAccess(metrics: unknown): Partial<AdvancedMetrics> {
  if (!metrics || typeof metrics !== 'object') {
    return {};
  }

  const metricsObj = metrics as Partial<AdvancedMetrics>;
  return {
    totalTrades: metricsObj.totalTrades ?? 0,
    winRate: metricsObj.winRate ?? 0,
    profitFactor: metricsObj.profitFactor ?? 0,
    sharpeRatio: metricsObj.sharpeRatio ?? 0,
    maxDrawdown: metricsObj.maxDrawdown ?? 0,
    calmarRatio: metricsObj.calmarRatio ?? 0,
    gainToLossRatio: metrics.gainToLossRatio ?? 0,
    payoffRatio: metrics.payoffRatio ?? 0,
    expectancy: metrics.expectancy ?? 0,
    systemQualityNumber: metrics.systemQualityNumber ?? 0,
    painIndex: metrics.painIndex ?? 0,
    martinRatio: metrics.martinRatio ?? 0,
    burkeRatio: metrics.burkeRatio ?? 0,
    skewness: metricsObj.skewness ?? 0,
    kurtosis: metricsObj.kurtosis ?? 0,
    upnessIndex: metricsObj.upnessIndex ?? 0,
    upsidePotentialRatio: metricsObj.upsidePotentialRatio ?? 0,
    gainToPainRatio: metricsObj.gainToPainRatio ?? 0
  };
}

// Add type conversion utility for strategies
export function ensureStrategyType(strategy: unknown): EnhancedStrategy {
  if (!strategy || typeof strategy !== 'object') {
    throw new Error('Strategy object is required');
  }

  const strategyObj = strategy as Partial<EnhancedStrategy>;

  // Validate and convert strategy type
  const validTypes: StrategyTypeUnion[] = [
    'scalping', 'swing', 'arbitrage', 'momentum', 
    'mean_reversion', 'trend_following', 'ml_based', 'grid', 'dca'
  ];
  
  let strategyType: StrategyTypeUnion = 'momentum'; // default
  if (typeof strategyObj.type === 'string') {
    const lowerType = strategyObj.type.toLowerCase();
    const foundType = validTypes.find(t => t === lowerType || t.includes(lowerType));
    if (foundType) {
      strategyType = foundType;
    }
  }

  return {
    id: strategyObj.id ?? `strategy_${Date.now()}`,
    name: strategyObj.name ?? 'Unnamed Strategy',
    type: strategyType,
    symbol: strategyObj.symbol ?? 'BTC-USDT',
    timeframe: strategyObj.timeframe ?? '1h',
    parameters: strategyObj.parameters ?? {},
    confidence: strategyObj.confidence ?? 0,
    profitPotential: strategyObj.profitPotential ?? 0,
    riskScore: strategyObj.riskScore ?? 0,
    description: strategyObj.description ?? 'No description available',
    learningMetrics: {
      adaptationRate: strategyObj.learningMetrics?.adaptationRate ?? 0,
      consistencyScore: strategyObj.learningMetrics?.consistencyScore ?? 0,
      marketConditionPerformance: strategyObj.learningMetrics?.marketConditionPerformance ?? {},
      timestamp: strategyObj.learningMetrics?.timestamp ?? Date.now()
    },
    adaptationRate: strategyObj.adaptationRate ?? 0,
    consistencyScore: strategyObj.consistencyScore ?? 0,
    marketConditionPerformance: strategyObj.marketConditionPerformance ?? {},
    active: strategyObj.active ?? true
  };
}

// Safe numeric parsing utilities
export function safeParseFloat(value: unknown, defaultValue: number = 0): number {
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

export function safeParseInt(value: unknown, defaultValue: number = 0): number {
  if (typeof value === 'number' && !isNaN(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}
