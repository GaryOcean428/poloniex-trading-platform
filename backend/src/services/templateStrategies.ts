/**
 * Template Trading Strategies
 * Pre-built strategies that work without AI generation
 */

export interface TemplateStrategy {
  id: string;
  name: string;
  type: 'trend_following' | 'mean_reversion' | 'momentum' | 'breakout' | 'scalping' | 'swing';
  description: string;
  longDescription: string;
  parameters: Record<string, any>;
  entryConditions: string[];
  exitConditions: string[];
  riskManagement: {
    stopLossPercent: number;
    takeProfitPercent: number;
    maxPositionSize: number;
    maxDrawdown: number;
  };
  expectedPerformance: {
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
  };
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  timeframes: string[];
  bestMarkets: string[];
}

export const TEMPLATE_STRATEGIES: TemplateStrategy[] = [
  {
    id: 'template-rsi-mean-reversion',
    name: 'RSI Mean Reversion',
    type: 'mean_reversion',
    description: 'Buy oversold, sell overbought using RSI indicator',
    longDescription: `
      This strategy identifies oversold and overbought conditions using the Relative Strength Index (RSI).
      It buys when RSI drops below 30 (oversold) and sells when RSI rises above 70 (overbought).
      Works best in ranging markets with clear support and resistance levels.
    `,
    parameters: {
      rsiPeriod: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70,
      volumeConfirmation: true,
      volumeMultiplier: 1.2
    },
    entryConditions: [
      'RSI < 30 (oversold)',
      'Volume > 1.2x average (confirmation)',
      'Price near support level'
    ],
    exitConditions: [
      'RSI > 70 (overbought)',
      'Stop loss hit (-2%)',
      'Take profit hit (+4%)'
    ],
    riskManagement: {
      stopLossPercent: 2,
      takeProfitPercent: 4,
      maxPositionSize: 5,
      maxDrawdown: 10
    },
    expectedPerformance: {
      winRate: 0.65,
      profitFactor: 1.8,
      sharpeRatio: 1.2
    },
    difficulty: 'beginner',
    timeframes: ['15m', '1h', '4h'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT']
  },
  {
    id: 'template-ma-crossover',
    name: 'Moving Average Crossover',
    type: 'trend_following',
    description: 'Follow trends using fast and slow moving average crossovers',
    longDescription: `
      Classic trend-following strategy that uses two moving averages of different periods.
      Buys when the fast MA crosses above the slow MA (golden cross) and sells when it crosses below (death cross).
      Works best in trending markets with clear directional moves.
    `,
    parameters: {
      fastPeriod: 10,
      slowPeriod: 30,
      maType: 'EMA', // Exponential Moving Average
      trendConfirmation: true
    },
    entryConditions: [
      'Fast MA (10) crosses above Slow MA (30)',
      'Price > Slow MA (uptrend confirmation)',
      'Volume increasing'
    ],
    exitConditions: [
      'Fast MA crosses below Slow MA',
      'Stop loss hit (-3%)',
      'Take profit hit (+6%)'
    ],
    riskManagement: {
      stopLossPercent: 3,
      takeProfitPercent: 6,
      maxPositionSize: 5,
      maxDrawdown: 15
    },
    expectedPerformance: {
      winRate: 0.58,
      profitFactor: 1.5,
      sharpeRatio: 1.0
    },
    difficulty: 'beginner',
    timeframes: ['1h', '4h', '1d'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT']
  },
  {
    id: 'template-bollinger-breakout',
    name: 'Bollinger Band Breakout',
    type: 'breakout',
    description: 'Trade breakouts from Bollinger Band compression',
    longDescription: `
      Identifies periods of low volatility (Bollinger Band squeeze) followed by explosive breakouts.
      Buys when price breaks above the upper band with strong volume, indicating a potential trend start.
      Works best in volatile markets with clear breakout patterns.
    `,
    parameters: {
      period: 20,
      stdDev: 2,
      volumeMultiplier: 1.5,
      bandwidthThreshold: 0.05 // Squeeze detection
    },
    entryConditions: [
      'Price breaks above upper Bollinger Band',
      'Volume > 1.5x average (strong breakout)',
      'Bandwidth was compressed (< 5%)',
      'Momentum positive'
    ],
    exitConditions: [
      'Price touches middle band',
      'Stop loss hit (-2%)',
      'Take profit hit (+5%)',
      'Volume declining'
    ],
    riskManagement: {
      stopLossPercent: 2,
      takeProfitPercent: 5,
      maxPositionSize: 4,
      maxDrawdown: 12
    },
    expectedPerformance: {
      winRate: 0.62,
      profitFactor: 1.7,
      sharpeRatio: 1.3
    },
    difficulty: 'intermediate',
    timeframes: ['15m', '1h', '4h'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT', 'BNB_USDT']
  },
  {
    id: 'template-macd-momentum',
    name: 'MACD Momentum',
    type: 'momentum',
    description: 'Capture momentum shifts using MACD indicator',
    longDescription: `
      Uses the MACD (Moving Average Convergence Divergence) to identify momentum changes.
      Buys when MACD line crosses above signal line and histogram is positive.
      Works best in trending markets with clear momentum shifts.
    `,
    parameters: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      histogramThreshold: 0
    },
    entryConditions: [
      'MACD line crosses above signal line',
      'MACD histogram > 0 (positive momentum)',
      'Price above 50-period MA (uptrend)',
      'RSI > 50 (bullish)'
    ],
    exitConditions: [
      'MACD line crosses below signal line',
      'MACD histogram turns negative',
      'Stop loss hit (-2.5%)',
      'Take profit hit (+5%)'
    ],
    riskManagement: {
      stopLossPercent: 2.5,
      takeProfitPercent: 5,
      maxPositionSize: 5,
      maxDrawdown: 12
    },
    expectedPerformance: {
      winRate: 0.60,
      profitFactor: 1.6,
      sharpeRatio: 1.1
    },
    difficulty: 'intermediate',
    timeframes: ['1h', '4h', '1d'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT', 'ADA_USDT']
  },
  {
    id: 'template-support-resistance',
    name: 'Support & Resistance Bounce',
    type: 'mean_reversion',
    description: 'Trade bounces from key support and resistance levels',
    longDescription: `
      Identifies key support and resistance levels and trades bounces from these levels.
      Buys when price bounces from support with confirmation, sells at resistance.
      Works best in ranging markets with well-defined levels.
    `,
    parameters: {
      lookbackPeriod: 50,
      touchThreshold: 0.5, // % from level
      confirmationCandles: 2,
      volumeConfirmation: true
    },
    entryConditions: [
      'Price touches support level (within 0.5%)',
      '2 confirmation candles showing bounce',
      'Volume spike on bounce',
      'RSI oversold (< 40)'
    ],
    exitConditions: [
      'Price reaches resistance level',
      'Stop loss hit (-2%)',
      'Take profit hit (+4%)',
      'Support level broken'
    ],
    riskManagement: {
      stopLossPercent: 2,
      takeProfitPercent: 4,
      maxPositionSize: 5,
      maxDrawdown: 10
    },
    expectedPerformance: {
      winRate: 0.68,
      profitFactor: 1.9,
      sharpeRatio: 1.4
    },
    difficulty: 'intermediate',
    timeframes: ['1h', '4h', '1d'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT']
  },
  {
    id: 'template-triple-ema',
    name: 'Triple EMA Trend',
    type: 'trend_following',
    description: 'Advanced trend following with three EMAs',
    longDescription: `
      Uses three exponential moving averages (fast, medium, slow) to identify strong trends.
      Buys when all three EMAs are aligned (fast > medium > slow) indicating a strong uptrend.
      Works best in strongly trending markets.
    `,
    parameters: {
      fastPeriod: 8,
      mediumPeriod: 21,
      slowPeriod: 55,
      trendStrengthFilter: true
    },
    entryConditions: [
      'Fast EMA (8) > Medium EMA (21) > Slow EMA (55)',
      'Price > all EMAs',
      'EMAs spreading apart (trend strengthening)',
      'Volume above average'
    ],
    exitConditions: [
      'Fast EMA crosses below Medium EMA',
      'Price closes below Medium EMA',
      'Stop loss hit (-3%)',
      'Take profit hit (+7%)'
    ],
    riskManagement: {
      stopLossPercent: 3,
      takeProfitPercent: 7,
      maxPositionSize: 4,
      maxDrawdown: 15
    },
    expectedPerformance: {
      winRate: 0.55,
      profitFactor: 1.8,
      sharpeRatio: 1.2
    },
    difficulty: 'advanced',
    timeframes: ['4h', '1d'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT']
  },
  {
    id: 'template-volume-breakout',
    name: 'Volume Breakout',
    type: 'breakout',
    description: 'Trade high-volume breakouts from consolidation',
    longDescription: `
      Identifies consolidation periods followed by high-volume breakouts.
      Buys when price breaks out of a consolidation range with volume 2x+ average.
      Works best in markets transitioning from consolidation to trending.
    `,
    parameters: {
      consolidationPeriod: 20,
      volumeMultiplier: 2.0,
      breakoutThreshold: 1.5, // % above consolidation high
      atrMultiplier: 1.5
    },
    entryConditions: [
      'Price consolidating for 20+ periods',
      'Price breaks above consolidation high by 1.5%',
      'Volume > 2x average',
      'ATR expanding (volatility increasing)'
    ],
    exitConditions: [
      'Price returns to consolidation range',
      'Volume dries up',
      'Stop loss hit (-2.5%)',
      'Take profit hit (+6%)'
    ],
    riskManagement: {
      stopLossPercent: 2.5,
      takeProfitPercent: 6,
      maxPositionSize: 4,
      maxDrawdown: 12
    },
    expectedPerformance: {
      winRate: 0.63,
      profitFactor: 1.7,
      sharpeRatio: 1.3
    },
    difficulty: 'advanced',
    timeframes: ['1h', '4h'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT']
  },
  {
    id: 'template-scalping-quick',
    name: 'Quick Scalping',
    type: 'scalping',
    description: 'Fast scalping strategy for quick profits',
    longDescription: `
      High-frequency scalping strategy targeting small, quick profits.
      Uses tight stops and quick exits. Requires active monitoring.
      Works best in liquid, volatile markets with tight spreads.
    `,
    parameters: {
      rsiPeriod: 7,
      oversoldLevel: 35,
      overboughtLevel: 65,
      quickExit: true,
      maxHoldTime: 15 // minutes
    },
    entryConditions: [
      'RSI < 35 (short-term oversold)',
      'Price bouncing from intraday support',
      'Volume spike',
      'Tight spread (< 0.1%)'
    ],
    exitConditions: [
      'RSI > 65 (short-term overbought)',
      'Quick profit target hit (+0.5%)',
      'Stop loss hit (-0.3%)',
      'Max hold time reached (15 min)'
    ],
    riskManagement: {
      stopLossPercent: 0.3,
      takeProfitPercent: 0.5,
      maxPositionSize: 10,
      maxDrawdown: 5
    },
    expectedPerformance: {
      winRate: 0.70,
      profitFactor: 1.5,
      sharpeRatio: 0.9
    },
    difficulty: 'advanced',
    timeframes: ['1m', '5m', '15m'],
    bestMarkets: ['BTC_USDT', 'ETH_USDT']
  }
];

/**
 * Get all template strategies
 */
export function getAllTemplates(): TemplateStrategy[] {
  return TEMPLATE_STRATEGIES;
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): TemplateStrategy | undefined {
  return TEMPLATE_STRATEGIES.find(s => s.id === id);
}

/**
 * Get templates by difficulty
 */
export function getTemplatesByDifficulty(difficulty: 'beginner' | 'intermediate' | 'advanced'): TemplateStrategy[] {
  return TEMPLATE_STRATEGIES.filter(s => s.difficulty === difficulty);
}

/**
 * Get templates by type
 */
export function getTemplatesByType(type: string): TemplateStrategy[] {
  return TEMPLATE_STRATEGIES.filter(s => s.type === type);
}
