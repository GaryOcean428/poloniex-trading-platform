import { AccountBalance, MarketData, AdvancedMetrics, StrategyTypeUnion, EnhancedStrategy } from '../types/unified-interfaces';

export function isValidAccountBalance(obj: any): obj is AccountBalance {
  return obj && 
    typeof obj.available === 'number' &&
    typeof obj.total === 'number' &&
    typeof obj.currency === 'string';
}

export function isValidMarketData(obj: any): obj is MarketData {
  return obj && 
    typeof obj.close === 'number' &&
    typeof obj.pair === 'string' &&
    typeof obj.timestamp === 'number';
}

// Enhanced market data with price fallback
export function enhanceMarketData(data: any): MarketData {
  if (!data) {
    throw new Error('Invalid market data provided');
  }
  
  return {
    ...data,
    price: data.price ?? data.close ?? data.last ?? 0
  };
}

// Safe account balance access with string properties
export function safeAccountBalance(balance: any): AccountBalance {
  if (!balance) {
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

  return {
    available: balance.available ?? 0,
    total: balance.total ?? 0,
    currency: balance.currency ?? 'USDT',
    totalAmount: balance.totalAmount ?? balance.total?.toString() ?? '0',
    availableAmount: balance.availableAmount ?? balance.available?.toString() ?? '0',
    accountEquity: balance.accountEquity ?? balance.total?.toString() ?? '0',
    unrealizedPnL: balance.unrealizedPnL ?? '0',
    todayPnL: balance.todayPnL ?? '0',
    todayPnLPercentage: balance.todayPnLPercentage ?? '0'
  };
}

export function safeMetricsAccess(metrics: any): Partial<AdvancedMetrics> {
  if (!metrics) {
    return {};
  }

  return {
    totalTrades: metrics.totalTrades ?? 0,
    winRate: metrics.winRate ?? 0,
    profitFactor: metrics.profitFactor ?? 0,
    sharpeRatio: metrics.sharpeRatio ?? 0,
    maxDrawdown: metrics.maxDrawdown ?? 0,
    calmarRatio: metrics.calmarRatio ?? 0,
    accuracy: metrics.accuracy ?? 0,
    precision: metrics.precision ?? 0,
    gainToLossRatio: metrics.gainToLossRatio ?? 0,
    payoffRatio: metrics.payoffRatio ?? 0,
    expectancy: metrics.expectancy ?? 0,
    systemQualityNumber: metrics.systemQualityNumber ?? 0,
    painIndex: metrics.painIndex ?? 0,
    martinRatio: metrics.martinRatio ?? 0,
    burkeRatio: metrics.burkeRatio ?? 0,
    skewness: metrics.skewness ?? 0,
    kurtosis: metrics.kurtosis ?? 0,
    upnessIndex: metrics.upnessIndex ?? 0,
    upsidePotentialRatio: metrics.upsidePotentialRatio ?? 0,
    gainToPainRatio: metrics.gainToPainRatio ?? 0
  };
}

// Add type conversion utility for strategies
export function ensureStrategyType(strategy: any): EnhancedStrategy {
  if (!strategy) {
    throw new Error('Strategy object is required');
  }

  // Validate and convert strategy type
  const validTypes: StrategyTypeUnion[] = [
    'scalping', 'swing', 'arbitrage', 'momentum', 
    'mean_reversion', 'trend_following', 'ml_based', 'grid', 'dca'
  ];
  
  let strategyType: StrategyTypeUnion = 'momentum'; // default
  if (typeof strategy.type === 'string') {
    const lowerType = strategy.type.toLowerCase();
    const foundType = validTypes.find(t => t === lowerType || t.includes(lowerType));
    if (foundType) {
      strategyType = foundType;
    }
  }

  return {
    id: strategy.id ?? `strategy_${Date.now()}`,
    name: strategy.name ?? 'Unnamed Strategy',
    type: strategyType,
    symbol: strategy.symbol ?? 'BTC-USDT',
    timeframe: strategy.timeframe ?? '1h',
    parameters: strategy.parameters ?? {},
    confidence: strategy.confidence ?? 0,
    profitPotential: strategy.profitPotential ?? 0,
    riskScore: strategy.riskScore ?? 0,
    description: strategy.description ?? 'No description available',
    learningMetrics: {
      adaptationRate: strategy.learningMetrics?.adaptationRate ?? 0,
      consistencyScore: strategy.learningMetrics?.consistencyScore ?? 0,
      marketConditionPerformance: strategy.learningMetrics?.marketConditionPerformance ?? {},
      timestamp: strategy.learningMetrics?.timestamp ?? Date.now()
    },
    adaptationRate: strategy.adaptationRate ?? 0,
    consistencyScore: strategy.consistencyScore ?? 0,
    marketConditionPerformance: strategy.marketConditionPerformance ?? {},
    active: strategy.active ?? true
  };
}

// Safe numeric parsing utilities
export function safeParseFloat(value: any, defaultValue: number = 0): number {
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

export function safeParseInt(value: any, defaultValue: number = 0): number {
  if (typeof value === 'number' && !isNaN(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}
