import { Strategy, MarketData, StrategyParameters, BacktestTrade } from '../../../shared/types';
import { executeStrategy, StrategyResult } from './strategyExecutors';

export interface BacktestResult {
  strategy: Strategy;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  parameters: StrategyParameters;
  marketData: MarketData[];
  metrics: Record<string, number>;
}

export interface EquityPoint {
  date: Date;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
}

export interface StrategyOptimizationResult {
  bestParameters: StrategyParameters;
  bestResult: BacktestResult;
  allResults: BacktestResult[];
  optimizationMetric: string;
  optimizationTime: number;
  parameterRanges: Record<string, [number, number, number]>; // [min, max, step]
  parameterHeatmap: ParameterHeatmapPoint[];
}

export interface ParameterHeatmapPoint {
  parameters: Record<string, number>;
  value: number;
}

export interface StrategyTestOptions {
  initialBalance: number;
  feePercent: number;
  slippagePercent: number;
  positionSizePercent: number;
  useStopLoss: boolean;
  stopLossPercent?: number;
  useTakeProfit: boolean;
  takeProfitPercent?: number;
  useTrailingStop: boolean;
  trailingStopPercent?: number;
  confidenceThreshold: number;
  allowSimultaneousPositions: boolean;
  maxOpenPositions: number;
  reinvestProfits: boolean;
}

const DEFAULT_TEST_OPTIONS: StrategyTestOptions = {
  initialBalance: 10000,
  feePercent: 0.1,
  slippagePercent: 0.05,
  positionSizePercent: 10,
  useStopLoss: false,
  stopLossPercent: 5,
  useTakeProfit: false,
  takeProfitPercent: 10,
  useTrailingStop: false,
  trailingStopPercent: 2,
  confidenceThreshold: 0.5,
  allowSimultaneousPositions: false,
  maxOpenPositions: 1,
  reinvestProfits: true
};

/**
 * Backtest a trading strategy against historical market data
 */
export function backtestStrategy(
  strategy: Strategy,
  marketData: MarketData[],
  options: Partial<StrategyTestOptions> = {}
): BacktestResult {
  // Merge default options with provided options
  const testOptions: StrategyTestOptions = { ...DEFAULT_TEST_OPTIONS, ...options };
  
  // Sort market data by timestamp
  const sortedData = [...marketData].sort((a, b) => a.timestamp - b.timestamp);
  
  // Initialize backtest state
  const balance = testOptions.initialBalance;
  let equity = balance;
  let maxEquity = balance;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const openPositions: BacktestTrade[] = [];
  
  // Track profit/loss for metrics
  const totalProfit = 0;
  const totalLoss = 0;
  const winningTrades = 0;
  const losingTrades = 0;
  
  // Daily returns for Sharpe ratio
  const dailyReturns: number[] = [];
  let lastDayEquity = balance;
  let lastDay = new Date(sortedData[0].timestamp).toDateString();
  
  // Process each candle
  for (let i = 50; i < sortedData.length; i++) { // Start at 50 to have enough data for indicators
    const currentCandle = sortedData[i];
    const currentDate = new Date(currentCandle.timestamp);
    const currentPrice = currentCandle.close;
    
    // Get data slice up to current candle for strategy execution
    const dataSlice = sortedData.slice(0, i + 1);
    
    // Check for stop loss, take profit, or trailing stop on open positions
    checkExitConditions(openPositions, currentCandle, testOptions);
    
    // Execute strategy on current data
    const result = executeStrategy(strategy, dataSlice);
    
    // Process strategy signals
    if (result.signal && result.confidence >= testOptions.confidenceThreshold) {
      processSignal(
        result, 
        currentCandle, 
        openPositions, 
        trades, 
        balance, 
        testOptions
      );
    }
    
    // Update equity based on open positions
    equity = calculateEquity(balance, openPositions, currentPrice);
    
    // Track maximum equity and drawdown
    if (equity > maxEquity) {
      maxEquity = equity;
    }
    
    const drawdown = maxEquity - equity;
    const drawdownPercent = (drawdown / maxEquity) * 100;
    
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
    
    // Add to equity curve
    equityCurve.push({
      date: currentDate,
      equity,
      drawdown,
      drawdownPercent
    });
    
    // Track daily returns for Sharpe ratio
    const currentDay = currentDate.toDateString();
    if (currentDay !== lastDay) {
      const dailyReturn = (equity - lastDayEquity) / lastDayEquity;
      dailyReturns.push(dailyReturn);
      lastDayEquity = equity;
      lastDay = currentDay;
    }
  }
  
  // Close any remaining open positions at the last price
  const lastCandle = sortedData[sortedData.length - 1];
  closeAllPositions(openPositions, trades, lastCandle);
  
  // Recalculate final equity
  const finalEquity = calculateEquity(balance, [], lastCandle.close);
  
  // Calculate metrics
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;
  const profitFactor = totalLoss !== 0 ? totalProfit / Math.abs(totalLoss) : totalProfit > 0 ? Infinity : 0;
  
  // Calculate Sharpe ratio (assuming risk-free rate of 0% for simplicity)
  const averageDailyReturn = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
  const dailyReturnStdDev = Math.sqrt(
    dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - averageDailyReturn, 2), 0) / dailyReturns.length
  );
  const sharpeRatio = dailyReturnStdDev !== 0 ? (averageDailyReturn / dailyReturnStdDev) * Math.sqrt(252) : 0; // Annualized
  
  return {
    strategy,
    startDate: new Date(sortedData[0].timestamp),
    endDate: new Date(sortedData[sortedData.length - 1].timestamp),
    initialBalance: testOptions.initialBalance,
    finalBalance: finalEquity,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    maxDrawdown,
    maxDrawdownPercent,
    sharpeRatio,
    trades,
    equityCurve,
    parameters: strategy.parameters,
    marketData: sortedData,
    metrics: {
      totalProfit,
      totalLoss,
      netProfit: totalProfit + totalLoss,
      averageProfit: winningTrades > 0 ? totalProfit / winningTrades : 0,
      averageLoss: losingTrades > 0 ? totalLoss / losingTrades : 0,
      averageTrade: trades.length > 0 ? (totalProfit + totalLoss) / trades.length : 0,
      returnPercent: ((finalEquity - testOptions.initialBalance) / testOptions.initialBalance) * 100,
      annualizedReturn: calculateAnnualizedReturn(
        testOptions.initialBalance, 
        finalEquity, 
        sortedData[0].timestamp, 
        sortedData[sortedData.length - 1].timestamp
      )
    }
  };
}

/**
 * Check exit conditions for open positions
 */
function checkExitConditions(
  openPositions: BacktestTrade[],
  currentCandle: MarketData,
  options: StrategyTestOptions
): void {
  const currentPrice = currentCandle.close;
  const currentDate = new Date(currentCandle.timestamp);
  
  for (let i = openPositions.length - 1; i >= 0; i--) {
    const position = openPositions[i];
    const entryPrice = position.entryPrice;
    
    // Calculate current profit/loss
    const isProfitable = position.type === 'BUY' 
      ? currentPrice > entryPrice 
      : currentPrice < entryPrice;
    
    const priceDiff = position.type === 'BUY'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;
    
    const profitPercent = (priceDiff / entryPrice) * 100;
    
    // Check stop loss
    if (options.useStopLoss && !isProfitable && Math.abs(profitPercent) >= (options.stopLossPercent || 0)) {
      position.exitDate = currentDate;
      position.exitPrice = currentPrice;
      position.profit = priceDiff * position.quantity;
      position.profitPercent = profitPercent;
      position.reason += ' (Stop Loss)';
      
      // Remove from open positions
      openPositions.splice(i, 1);
      continue;
    }
    
    // Check take profit
    if (options.useTakeProfit && isProfitable && profitPercent >= (options.takeProfitPercent || 0)) {
      position.exitDate = currentDate;
      position.exitPrice = currentPrice;
      position.profit = priceDiff * position.quantity;
      position.profitPercent = profitPercent;
      position.reason += ' (Take Profit)';
      
      // Remove from open positions
      openPositions.splice(i, 1);
      continue;
    }
    
    // Check trailing stop
    if (options.useTrailingStop && position.highestProfit && 
        position.highestProfit - profitPercent >= (options.trailingStopPercent || 0)) {
      position.exitDate = currentDate;
      position.exitPrice = currentPrice;
      position.profit = priceDiff * position.quantity;
      position.profitPercent = profitPercent;
      position.reason += ' (Trailing Stop)';
      
      // Remove from open positions
      openPositions.splice(i, 1);
      continue;
    }
    
    // Update highest profit for trailing stop
    if (options.useTrailingStop && isProfitable) {
      position.highestProfit = Math.max(position.highestProfit || 0, profitPercent);
    }
  }
}

/**
 * Process a strategy signal
 */
function processSignal(
  result: StrategyResult,
  currentCandle: MarketData,
  openPositions: BacktestTrade[],
  trades: BacktestTrade[],
  balance: number,
  options: StrategyTestOptions
): void {
  if (!result.signal) return;
  
  const currentPrice = currentCandle.close;
  const currentDate = new Date(currentCandle.timestamp);
  
  // Check if we can open a new position
  if (openPositions.length >= options.maxOpenPositions && !options.allowSimultaneousPositions) {
    return;
  }
  
  // Calculate position size
  const positionSize = (balance * options.positionSizePercent) / 100;
  const quantity = positionSize / currentPrice;
  
  // Apply slippage to entry price
  const slippageFactor = 1 + (options.slippagePercent / 100) * (result.signal === 'BUY' ? 1 : -1);
  const entryPrice = currentPrice * slippageFactor;
  
  // Create new trade
  const newTrade: BacktestTrade = {
    id: `trade-${currentDate.getTime()}-${result.signal}`,
    entryPrice,
    exitPrice: null,
    entryTime: currentDate.toISOString(),
    exitTime: null,
    side: result.signal === 'BUY' ? 'long' : 'short',
    status: 'open',
    pnl: 0,
    pnlPercent: 0,
    balance: 0, // Will be updated later
    size: quantity,
    fee: 0, // Will be calculated later
    reason: result.reason,
    confidence: result.confidence,
    highestProfit: 0, // For trailing stop
    // Compatibility properties
    entryDate: currentDate,
    exitDate: null,
    type: result.signal,
    quantity,
    profit: 0,
    profitPercent: 0
  };
  
  // Add to open positions
  openPositions.push(newTrade);
  
  // Add to all trades
  trades.push(newTrade);
}

/**
 * Close all open positions
 */
function closeAllPositions(
  openPositions: BacktestTrade[],
  trades: BacktestTrade[],
  lastCandle: MarketData
): void {
  const currentPrice = lastCandle.close;
  const currentDate = new Date(lastCandle.timestamp);
  
  for (let i = openPositions.length - 1; i >= 0; i--) {
    const position = openPositions[i];
    const entryPrice = position.entryPrice;
    
    // Calculate profit/loss
    const priceDiff = position.type === 'BUY'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;
    
    const profitPercent = (priceDiff / entryPrice) * 100;
    
    // Update trade
    position.exitDate = currentDate;
    position.exitPrice = currentPrice;
    position.profit = priceDiff * position.quantity;
    position.profitPercent = profitPercent;
    position.reason += ' (End of Test)';
    
    // Update corresponding trade in trades array
    const tradeIndex = trades.findIndex(t => 
      t.entryDate === position.entryDate && 
      t.entryPrice === position.entryPrice &&
      t.type === position.type
    );
    
    if (tradeIndex !== -1) {
      trades[tradeIndex] = { ...position };
    }
    
    // Remove from open positions
    openPositions.splice(i, 1);
  }
}

/**
 * Calculate current equity based on balance and open positions
 */
function calculateEquity(
  balance: number,
  openPositions: BacktestTrade[],
  currentPrice: number
): number {
  let equity = balance;
  
  for (const position of openPositions) {
    const entryPrice = position.entryPrice;
    
    // Calculate profit/loss
    const priceDiff = position.type === 'BUY'
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;
    
    const positionProfit = priceDiff * position.quantity;
    
    equity += positionProfit;
  }
  
  return equity;
}

/**
 * Calculate annualized return
 */
function calculateAnnualizedReturn(
  initialBalance: number,
  finalBalance: number,
  startTimestamp: number,
  endTimestamp: number
): number {
  const totalReturn = (finalBalance - initialBalance) / initialBalance;
  const years = (endTimestamp - startTimestamp) / (1000 * 60 * 60 * 24 * 365);
  
  if (years <= 0) return 0;
  
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

/**
 * Optimize strategy parameters using grid search
 */
export function optimizeStrategy(
  strategy: Strategy,
  data: MarketData[],
  parameterRanges: Record<string, [number, number, number]>,
  optimizationMetric: keyof BacktestResult['metrics'] = 'netProfit',
  baseParameters: Record<string, unknown> = {},
  testOptions: Partial<StrategyTestOptions> = {}
): StrategyOptimizationResult {
  const startTime = Date.now();
  const results: BacktestResult[] = [];
  const parameterCombinations: Record<string, unknown>[] = generateParameterCombinations(parameterRanges, baseParameters);
  
  console.log(`Testing ${parameterCombinations.length} parameter combinations...`);
  
  // Test each parameter combination
  for (const parameters of parameterCombinations) {
    const testStrategy: Strategy = {
      id: 'optimization-test',
      name: `${strategy.type} Optimization`,
      type: strategy.type,
      parameters: parameters as StrategyParameters,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const result = backtestStrategy(testStrategy, data, testOptions);
    results.push(result);
  }
  
  // Find best result based on optimization metric
  const sortedResults = [...results].sort((a, b) => {
    const metricA = a.metrics[optimizationMetric] || 0;
    const metricB = b.metrics[optimizationMetric] || 0;
    return metricB - metricA; // Descending order
  });
  
  const bestResult = sortedResults[0];
  const bestParameters = bestResult.parameters;
  
  // Generate parameter heatmap
  const parameterHeatmap = generateParameterHeatmap(results, parameterRanges, optimizationMetric);
  
  return {
    bestParameters,
    bestResult,
    allResults: results,
    optimizationMetric: optimizationMetric,
    optimizationTime: Date.now() - startTime,
    parameterRanges,
    parameterHeatmap
  };
}

/**
 * Generate all possible parameter combinations
 */
function generateParameterCombinations(
  parameterRanges: Record<string, [number, number, number]>,
  baseParameters: Record<string, unknown> = {}
): Record<string, unknown>[] {
  const parameterNames = Object.keys(parameterRanges);
  const combinations: Record<string, unknown>[] = [];
  
  function generateCombination(index: number, currentParams: Record<string, unknown>): void {
    if (index >= parameterNames.length) {
      combinations.push({ ...baseParameters, ...currentParams });
      return;
    }
    
    const paramName = parameterNames[index];
    const [min, max, step] = parameterRanges[paramName];
    
    for (let value = min; value <= max; value += step) {
      generateCombination(index + 1, { ...currentParams, [paramName]: value });
    }
  }
  
  generateCombination(0, { ...baseParameters });
  return combinations;
}

/**
 * Generate parameter heatmap for visualization
 */
function generateParameterHeatmap(
  results: BacktestResult[],
  parameterRanges: Record<string, [number, number, number]>,
  metric: string
): ParameterHeatmapPoint[] {
  const heatmap: ParameterHeatmapPoint[] = [];
  
  // If we have only one or two parameters, generate a detailed heatmap
  const parameterNames = Object.keys(parameterRanges);
  
  if (parameterNames.length <= 2) {
    for (const result of results) {
      const parameters: Record<string, number> = {};
      
      for (const paramName of parameterNames) {
        parameters[paramName] = (result.parameters as Record<string, unknown>)[paramName] as number;
      }
      
      heatmap.push({
        parameters,
        value: result.metrics[metric] || 0
      });
    }
  } else {
    // For more than two parameters, create a simplified heatmap
    // by varying only the two most significant parameters
    
    // Find the two most significant parameters by correlation with the metric
    const parameterCorrelations: Record<string, number> = {};
    
    for (const paramName of parameterNames) {
      const values = results.map(r => (r.parameters as Record<string, unknown>)[paramName] as number);
      const metricValues = results.map(r => r.metrics[metric] || 0);
      
      parameterCorrelations[paramName] = Math.abs(calculateCorrelation(values, metricValues));
    }
    
    // Sort parameters by correlation
    const sortedParameters = Object.entries(parameterCorrelations)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, 2);
    
    // Group results by the most significant parameters
    const groupedResults: Record<string, BacktestResult[]> = {};
    
    for (const result of results) {
      const key = sortedParameters.map(param => `${param}:${(result.parameters as Record<string, unknown>)[param]}`).join(',');
      
      if (!groupedResults[key]) {
        groupedResults[key] = [];
      }
      
      groupedResults[key].push(result);
    }
    
    // Create heatmap points using the average metric value for each group
    for (const [key, groupResults] of Object.entries(groupedResults)) {
      const parameters: Record<string, number> = {};
      const keyParts = key.split(',');
      
      for (const part of keyParts) {
        const [paramName, valueStr] = part.split(':');
        parameters[paramName] = parseFloat(valueStr);
      }
      
      const avgValue = groupResults.reduce((sum, r) => sum + (r.metrics[metric] || 0), 0) / groupResults.length;
      
      heatmap.push({
        parameters,
        value: avgValue
      });
    }
  }
  
  return heatmap;
}

/**
 * Calculate correlation coefficient between two arrays
 */
function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  
  // Calculate means
  const xMean = x.reduce((sum, val) => sum + val, 0) / n;
  const yMean = y.reduce((sum, val) => sum + val, 0) / n;
  
  // Calculate covariance and variances
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  
  for (let i = 0; i < n; i++) {
    const xDiff = x[i] - xMean;
    const yDiff = y[i] - yMean;
    
    covariance += xDiff * yDiff;
    xVariance += xDiff * xDiff;
    yVariance += yDiff * yDiff;
  }
  
  // Calculate correlation coefficient
  return covariance / (Math.sqrt(xVariance) * Math.sqrt(yVariance));
}

/**
 * Monte Carlo simulation to estimate strategy robustness
 */
export function monteCarloSimulation(
  backtestResult: BacktestResult,
  numSimulations: number = 1000
): {
  confidenceIntervals: Record<string, [number, number]>; // 95% confidence intervals
  worstCase: Record<string, number>;
  bestCase: Record<string, number>;
  medianCase: Record<string, number>;
  distributions: Record<string, number[]>;
} {
  const { trades } = backtestResult;
  const distributions: Record<string, number[]> = {
    finalBalance: [],
    maxDrawdownPercent: [],
    winRate: [],
    profitFactor: [],
    sharpeRatio: []
  };
  
  // Run simulations
  for (let i = 0; i < numSimulations; i++) {
    // Shuffle trades to simulate different order
    const shuffledTrades = shuffleArray([...trades]);
    
    // Simulate equity curve with shuffled trades
    const { 
      finalBalance, 
      maxDrawdownPercent, 
      winRate, 
      profitFactor, 
      sharpeRatio 
    } = simulateEquityCurve(shuffledTrades, backtestResult.initialBalance);
    
    // Store results
    distributions.finalBalance.push(finalBalance);
    distributions.maxDrawdownPercent.push(maxDrawdownPercent);
    distributions.winRate.push(winRate);
    distributions.profitFactor.push(profitFactor);
    distributions.sharpeRatio.push(sharpeRatio);
  }
  
  // Calculate statistics
  const confidenceIntervals: Record<string, [number, number]> = {};
  const worstCase: Record<string, number> = {};
  const bestCase: Record<string, number> = {};
  const medianCase: Record<string, number> = {};
  
  for (const [key, values] of Object.entries(distributions)) {
    // Sort values
    values.sort((a, b) => a - b);
    
    // Calculate 95% confidence interval (2.5th and 97.5th percentiles)
    const lowerIndex = Math.floor(values.length * 0.025);
    const upperIndex = Math.floor(values.length * 0.975);
    
    confidenceIntervals[key] = [values[lowerIndex], values[upperIndex]];
    worstCase[key] = values[0];
    bestCase[key] = values[values.length - 1];
    medianCase[key] = values[Math.floor(values.length / 2)];
  }
  
  return {
    confidenceIntervals,
    worstCase,
    bestCase,
    medianCase,
    distributions
  };
}

/**
 * Shuffle array (Fisher-Yates algorithm)
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  
  return result;
}

/**
 * Simulate equity curve with given trades
 */
function simulateEquityCurve(
  trades: BacktestTrade[],
  initialBalance: number
): {
  finalBalance: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
} {
  let balance = initialBalance;
  let maxBalance = initialBalance;
  let maxDrawdownPercent = 0;
  let winningTrades = 0;
  let totalProfit = 0;
  let totalLoss = 0;
  
  // Daily returns for Sharpe ratio
  const dailyReturns: number[] = [];
  let lastDayEquity = initialBalance;
  let lastDay = trades.length > 0 ? trades[0].entryDate.toDateString() : '';
  
  // Process each trade
  for (const trade of trades) {
    // Update balance
    balance += trade.profit;
    
    // Track maximum balance and drawdown
    if (balance > maxBalance) {
      maxBalance = balance;
    }
    
    const drawdown = maxBalance - balance;
    const drawdownPercent = (drawdown / maxBalance) * 100;
    
    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
    }
    
    // Track winning/losing trades
    if (trade.profit > 0) {
      winningTrades++;
      totalProfit += trade.profit;
    } else {
      totalLoss += trade.profit; // Note: loss is negative
    }
    
    // Track daily returns for Sharpe ratio
    if (trade.exitDate) {
      const currentDay = trade.exitDate.toDateString();
      if (currentDay !== lastDay) {
        const dailyReturn = (balance - lastDayEquity) / lastDayEquity;
        dailyReturns.push(dailyReturn);
        lastDayEquity = balance;
        lastDay = currentDay;
      }
    }
  }
  
  // Calculate metrics
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;
  const profitFactor = totalLoss !== 0 ? totalProfit / Math.abs(totalLoss) : totalProfit > 0 ? Infinity : 0;
  
  // Calculate Sharpe ratio
  let sharpeRatio = 0;
  if (dailyReturns.length > 0) {
    const averageDailyReturn = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
    const dailyReturnStdDev = Math.sqrt(
      dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - averageDailyReturn, 2), 0) / dailyReturns.length
    );
    sharpeRatio = dailyReturnStdDev !== 0 ? (averageDailyReturn / dailyReturnStdDev) * Math.sqrt(252) : 0; // Annualized
  }
  
  return {
    finalBalance: balance,
    maxDrawdownPercent,
    winRate,
    profitFactor,
    sharpeRatio
  };
}

/**
 * Walk-forward analysis to test strategy robustness
 */
export function walkForwardAnalysis(
  strategy: Strategy,
  marketData: MarketData[],
  options: {
    inSamplePercent: number;
    numFolds: number;
    optimizationMetric?: keyof BacktestResult['metrics'];
    parameterRanges?: Record<string, [number, number, number]>;
    testOptions?: Partial<StrategyTestOptions>;
  }
): {
  foldResults: Array<{
    inSample: BacktestResult;
    outOfSample: BacktestResult;
    optimizedParameters: StrategyParameters;
  }>;
  aggregateResult: {
    inSampleMetrics: Record<string, number>;
    outOfSampleMetrics: Record<string, number>;
    robustnessScore: number; // Ratio of out-of-sample to in-sample performance
  };
} {
  const {
    inSamplePercent = 70,
    numFolds = 5,
    optimizationMetric = 'netProfit',
    parameterRanges = {},
    testOptions = {}
  } = options;
  
  // Sort market data by timestamp
  const sortedData = [...marketData].sort((a, b) => a.timestamp - b.timestamp);
  
  // Calculate fold size
  const foldSize = Math.floor(sortedData.length / numFolds);
  
  const foldResults = [];
  let totalInSampleProfit = 0;
  let totalOutOfSampleProfit = 0;
  
  // Process each fold
  for (let i = 0; i < numFolds; i++) {
    // Calculate fold data indices
    const startIdx = i * foldSize;
    const endIdx = i === numFolds - 1 ? sortedData.length : (i + 1) * foldSize;
    
    // Split data into in-sample and out-of-sample
    const foldData = sortedData.slice(startIdx, endIdx);
    const inSampleSize = Math.floor(foldData.length * (inSamplePercent / 100));
    
    const inSampleData = foldData.slice(0, inSampleSize);
    const outOfSampleData = foldData.slice(inSampleSize);
    
    // Skip fold if not enough data
    if (inSampleData.length < 100 || outOfSampleData.length < 50) {
      continue;
    }
    
    // Optimize strategy on in-sample data
    let optimizedParameters: StrategyParameters;
    
    if (Object.keys(parameterRanges).length > 0) {
      // If parameter ranges provided, perform optimization
      const optimizationResult = optimizeStrategy(
        strategy,
        inSampleData,
        parameterRanges,
        optimizationMetric,
        strategy.parameters as unknown as Record<string, unknown>,
        testOptions
      );
      
      optimizedParameters = optimizationResult.bestParameters;
    } else {
      // Otherwise use original parameters
      optimizedParameters = strategy.parameters;
    }
    
    // Create optimized strategy
    const optimizedStrategy: Strategy = {
      ...strategy,
      parameters: optimizedParameters
    };
    
    // Test on in-sample data
    const inSampleResult = backtestStrategy(optimizedStrategy, inSampleData, testOptions);
    
    // Test on out-of-sample data
    const outOfSampleResult = backtestStrategy(optimizedStrategy, outOfSampleData, testOptions);
    
    // Store results
    foldResults.push({
      inSample: inSampleResult,
      outOfSample: outOfSampleResult,
      optimizedParameters
    });
    
    // Accumulate profits for robustness calculation
    totalInSampleProfit += inSampleResult.metrics.netProfit;
    totalOutOfSampleProfit += outOfSampleResult.metrics.netProfit;
  }
  
  // Calculate aggregate metrics
  const inSampleMetrics: Record<string, number> = {};
  const outOfSampleMetrics: Record<string, number> = {};
  
  // Initialize metrics
  const metricKeys = [
    'netProfit', 'winRate', 'profitFactor', 'maxDrawdownPercent', 
    'sharpeRatio', 'returnPercent', 'annualizedReturn'
  ];
  
  for (const key of metricKeys) {
    inSampleMetrics[key] = 0;
    outOfSampleMetrics[key] = 0;
  }
  
  // Calculate average metrics
  for (const fold of foldResults) {
    for (const key of metricKeys) {
      inSampleMetrics[key] += fold.inSample.metrics[key] || 0;
      outOfSampleMetrics[key] += fold.outOfSample.metrics[key] || 0;
    }
  }
  
  // Calculate averages
  for (const key of metricKeys) {
    inSampleMetrics[key] /= foldResults.length;
    outOfSampleMetrics[key] /= foldResults.length;
  }
  
  // Calculate robustness score (ratio of out-of-sample to in-sample performance)
  // A score close to 1 indicates good robustness
  const robustnessScore = totalInSampleProfit !== 0 
    ? totalOutOfSampleProfit / totalInSampleProfit 
    : totalOutOfSampleProfit > 0 ? 1 : 0;
  
  return {
    foldResults,
    aggregateResult: {
      inSampleMetrics,
      outOfSampleMetrics,
      robustnessScore
    }
  };
}
