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

/**
 * Enhanced market data with safe extraction and price fallback
 */
export function enhanceMarketData(data: unknown): MarketData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid market data provided');
  }

  const obj = data as Record<string, unknown>;

  const pair =
    typeof obj.pair === 'string'
      ? obj.pair
      : typeof obj.symbol === 'string'
        ? (obj.symbol as string).replace('_', '-')
        : 'BTC-USDT';

  const toNum = (v: unknown, def = 0): number =>
    typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || def : def;

  const timestamp =
    typeof obj.timestamp === 'number'
      ? obj.timestamp
      : typeof obj.ts === 'number'
        ? obj.ts
        : Date.now();

  const open = toNum(obj.open);
  const high = toNum(obj.high);
  const low = toNum(obj.low);
  const close = toNum((obj as any).close ?? (obj as any).last ?? 0);
  const volume = toNum(obj.volume);

  const price = toNum((obj as any).price ?? (obj as any).close ?? (obj as any).last);

  return {
    pair,
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    price,
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

  const m = metrics as Partial<AdvancedMetrics>;

  const ensureNumber = (v: unknown, def = 0): number =>
    typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || def : def;

  return {
    totalTrades: ensureNumber(m.totalTrades),
    winRate: ensureNumber(m.winRate),
    profitFactor: ensureNumber(m.profitFactor),
    sharpeRatio: ensureNumber(m.sharpeRatio),
    maxDrawdown: ensureNumber(m.maxDrawdown),
    calmarRatio: ensureNumber(m.calmarRatio),

    // Extended metrics (previously accessed via untyped object)
    gainToLossRatio: ensureNumber((m as any).gainToLossRatio),
    payoffRatio: ensureNumber((m as any).payoffRatio),
    expectancy: ensureNumber((m as any).expectancy),
    systemQualityNumber: ensureNumber((m as any).systemQualityNumber),

    painIndex: ensureNumber((m as any).painIndex),
    martinRatio: ensureNumber((m as any).martinRatio),
    burkeRatio: ensureNumber((m as any).burkeRatio),

    skewness: ensureNumber(m.skewness),
    kurtosis: ensureNumber(m.kurtosis),
    upnessIndex: ensureNumber(m.upnessIndex),
    upsidePotentialRatio: ensureNumber(m.upsidePotentialRatio),
    gainToPainRatio: ensureNumber(m.gainToPainRatio),
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
