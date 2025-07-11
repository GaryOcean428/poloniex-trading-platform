import { MarketData } from '@/types';
import { combineIndicatorSignals } from './technicalIndicators';
import { createRiskManager, RiskManager } from './riskManagement';

/**
 * Enhanced Backtesting Framework with Walk-Forward Analysis
 * Provides comprehensive strategy validation and optimization
 */

export interface BacktestConfig {
  // Data settings
  startDate: string;
  endDate: string;
  timeframe: string;
  pair: string;
  
  // Strategy settings
  useRSI: boolean;
  useMACD: boolean;
  useBollingerBands: boolean;
  useMovingAverages: boolean;
  useStochastic: boolean;
  
  // Indicator weights
  indicatorWeights: {
    rsi: number;
    macd: number;
    bb: number;
    stochastic: number;
    ma: number;
  };
  
  // Risk settings
  initialBalance: number;
  riskPerTrade: number;
  maxLeverage: number;
  useATRStops: boolean;
  stopLossPercent: number;
  takeProfitRatio: number;
  
  // Backtesting settings
  commission: number; // Commission per trade (percentage)
  slippage: number; // Slippage per trade (percentage)
  confidenceThreshold: number; // Minimum signal confidence
  
  // Walk-forward settings
  useWalkForward: boolean;
  trainingPeriod: number; // Days
  testingPeriod: number; // Days
  optimizationSteps: number;
}

export interface Trade {
  entryTime: number;
  exitTime: number;
  pair: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  commission: number;
  slippage: number;
  netPnl: number;
  stopLoss?: number;
  takeProfit?: number;
  exitReason: 'stop_loss' | 'take_profit' | 'signal' | 'end_of_data';
  confidence: number;
}

export interface BacktestResults {
  // Basic metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  // P&L metrics
  totalReturn: number;
  totalReturnPercent: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  
  // Risk metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  
  // Trade analysis
  averageTradeLength: number; // in hours
  averageWinLength: number;
  averageLossLength: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  
  // Risk-adjusted metrics
  maxRisk: number;
  averageRisk: number;
  recoveryFactor: number;
  
  // Detailed data
  trades: Trade[];
  equityCurve: Array<{ time: number; balance: number; drawdown: number }>;
  monthlyReturns: Array<{ month: string; return: number }>;
  
  // Walk-forward results (if applicable)
  walkForwardResults?: WalkForwardResult[];
}

export interface WalkForwardResult {
  period: number;
  startDate: string;
  endDate: string;
  trainingStart: string;
  trainingEnd: string;
  testingStart: string;
  testingEnd: string;
  trainingReturn: number;
  testingReturn: number;
  efficiency: number; // testing return / training return
  optimizedParameters: any;
}

export class EnhancedBacktester {
  private config: BacktestConfig;
  private riskManager: RiskManager;
  
  constructor(config: BacktestConfig) {
    this.config = config;
    this.riskManager = createRiskManager({
      maxAccountRisk: config.riskPerTrade,
      maxLeverage: config.maxLeverage,
      useATRStops: config.useATRStops,
      stopLossPercent: config.stopLossPercent,
      takeProfitRatio: config.takeProfitRatio
    });
  }

  /**
   * Run comprehensive backtest with optional walk-forward analysis
   */
  async runBacktest(marketData: MarketData[]): Promise<BacktestResults> {
    if (this.config.useWalkForward) {
      return this.runWalkForwardBacktest(marketData);
    } else {
      return this.runSingleBacktest(marketData);
    }
  }

  /**
   * Run single period backtest
   */
  private async runSingleBacktest(marketData: MarketData[]): Promise<BacktestResults> {
    const trades: Trade[] = [];
    let balance = this.config.initialBalance;
    let maxBalance = balance;
    let maxDrawdown = 0;
    let position: { side: 'long' | 'short'; entryPrice: number; entryTime: number; quantity: number; stopLoss?: number; takeProfit?: number; confidence: number } | null = null;
    
    const equityCurve: Array<{ time: number; balance: number; drawdown: number }> = [];
    const monthlyReturns: Array<{ month: string; return: number }> = [];
    let lastMonthBalance = balance;
    let currentMonth = '';
    
    for (let i = 50; i < marketData.length; i++) { // Start after enough data for indicators
      const currentCandle = marketData[i];
      const historicalData = marketData.slice(0, i + 1);
      
      // Update monthly returns
      const candleMonth = new Date(currentCandle.timestamp).toISOString().substr(0, 7);
      if (candleMonth !== currentMonth) {
        if (currentMonth !== '') {
          const monthReturn = ((balance - lastMonthBalance) / lastMonthBalance) * 100;
          monthlyReturns.push({ month: currentMonth, return: monthReturn });
        }
        currentMonth = candleMonth;
        lastMonthBalance = balance;
      }
      
      // Check for stop loss or take profit if in position
      if (position) {
        let exitTriggered = false;
        let exitReason: Trade['exitReason'] = 'signal';
        let exitPrice = currentCandle.close;
        
        if (position.side === 'long') {
          if (position.stopLoss && currentCandle.low <= position.stopLoss) {
            exitTriggered = true;
            exitPrice = position.stopLoss;
            exitReason = 'stop_loss';
          } else if (position.takeProfit && currentCandle.high >= position.takeProfit) {
            exitTriggered = true;
            exitPrice = position.takeProfit;
            exitReason = 'take_profit';
          }
        } else {
          if (position.stopLoss && currentCandle.high >= position.stopLoss) {
            exitTriggered = true;
            exitPrice = position.stopLoss;
            exitReason = 'stop_loss';
          } else if (position.takeProfit && currentCandle.low <= position.takeProfit) {
            exitTriggered = true;
            exitPrice = position.takeProfit;
            exitReason = 'take_profit';
          }
        }
        
        if (exitTriggered) {
          const trade = this.closePosition(position, exitPrice, currentCandle.timestamp, exitReason);
          trades.push(trade);
          balance += trade.netPnl;
          position = null;
        }
      }
      
      // Generate trading signals only if not in position
      if (!position) {
        const signals = combineIndicatorSignals(historicalData, {
          useRSI: this.config.useRSI,
          useMACD: this.config.useMACD,
          useBB: this.config.useBollingerBands,
          useStochastic: this.config.useStochastic,
          useMA: this.config.useMovingAverages,
          weights: this.config.indicatorWeights
        });
        
        // Enter position if signal is strong enough
        if (signals.signal !== 'HOLD' && signals.confidence >= this.config.confidenceThreshold) {
          const direction = signals.signal === 'BUY' ? 'long' : 'short';
          const entryPrice = currentCandle.close;
          
          // Calculate position size and risk levels
          const levels = this.riskManager.calculateATRLevels(historicalData, entryPrice, direction);
          const positionSize = this.riskManager.calculatePositionSize(
            balance,
            entryPrice,
            levels.stopLoss,
            historicalData
          );
          
          // Account for slippage
          const slippageAdjustment = entryPrice * (this.config.slippage / 100);
          const adjustedEntryPrice = direction === 'long' 
            ? entryPrice + slippageAdjustment 
            : entryPrice - slippageAdjustment;
          
          if (positionSize > 0) {
            position = {
              side: direction,
              entryPrice: adjustedEntryPrice,
              entryTime: currentCandle.timestamp,
              quantity: positionSize,
              stopLoss: levels.stopLoss,
              takeProfit: levels.takeProfit,
              confidence: signals.confidence
            };
          }
        }
      }
      
      // Update equity curve and drawdown
      maxBalance = Math.max(maxBalance, balance);
      const currentDrawdown = ((maxBalance - balance) / maxBalance) * 100;
      maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
      
      equityCurve.push({
        time: currentCandle.timestamp,
        balance,
        drawdown: currentDrawdown
      });
    }
    
    // Close any remaining position at the end
    if (position) {
      const lastCandle = marketData[marketData.length - 1];
      const trade = this.closePosition(position, lastCandle.close, lastCandle.timestamp, 'end_of_data');
      trades.push(trade);
      balance += trade.netPnl;
    }
    
    // Add final monthly return
    if (currentMonth !== '') {
      const monthReturn = ((balance - lastMonthBalance) / lastMonthBalance) * 100;
      monthlyReturns.push({ month: currentMonth, return: monthReturn });
    }
    
    return this.calculateResults(trades, balance, maxDrawdown, equityCurve, monthlyReturns);
  }

  /**
   * Run walk-forward backtest with optimization
   */
  private async runWalkForwardBacktest(marketData: MarketData[]): Promise<BacktestResults> {
    const trainingDays = this.config.trainingPeriod;
    const testingDays = this.config.testingPeriod;
    const totalDays = (marketData.length * 24) / (24 * 60 * 60 * 1000); // Assuming 1-hour candles
    
    const walkForwardResults: WalkForwardResult[] = [];
    let allTrades: Trade[] = [];
    let cumulativeBalance = this.config.initialBalance;
    let maxBalance = cumulativeBalance;
    let maxDrawdown = 0;
    const equityCurve: Array<{ time: number; balance: number; drawdown: number }> = [];
    
    let currentStartIndex = 0;
    let period = 1;
    
    while (currentStartIndex + trainingDays + testingDays <= marketData.length) {
      const trainingStart = currentStartIndex;
      const trainingEnd = trainingStart + trainingDays;
      const testingStart = trainingEnd;
      const testingEnd = Math.min(testingStart + testingDays, marketData.length);
      
      // Extract training and testing data
      const trainingData = marketData.slice(trainingStart, trainingEnd);
      const testingData = marketData.slice(testingStart, testingEnd);
      
      // Optimize parameters on training data
      const optimizedConfig = await this.optimizeParameters(trainingData);
      
      // Run backtest on training data to get baseline
      const trainingBacktest = new EnhancedBacktester({
        ...this.config,
        ...optimizedConfig,
        useWalkForward: false
      });
      const trainingResults = await trainingBacktest.runSingleBacktest(trainingData);
      
      // Apply optimized parameters to testing data
      const testingBacktest = new EnhancedBacktester({
        ...this.config,
        ...optimizedConfig,
        useWalkForward: false,
        initialBalance: cumulativeBalance
      });
      const testingResults = await testingBacktest.runSingleBacktest(testingData);
      
      // Calculate efficiency (out-of-sample vs in-sample performance)
      const efficiency = trainingResults.totalReturnPercent > 0 
        ? testingResults.totalReturnPercent / trainingResults.totalReturnPercent 
        : 0;
      
      walkForwardResults.push({
        period,
        startDate: new Date(marketData[trainingStart].timestamp).toISOString(),
        endDate: new Date(marketData[testingEnd - 1].timestamp).toISOString(),
        trainingStart: new Date(marketData[trainingStart].timestamp).toISOString(),
        trainingEnd: new Date(marketData[trainingEnd - 1].timestamp).toISOString(),
        testingStart: new Date(marketData[testingStart].timestamp).toISOString(),
        testingEnd: new Date(marketData[testingEnd - 1].timestamp).toISOString(),
        trainingReturn: trainingResults.totalReturnPercent,
        testingReturn: testingResults.totalReturnPercent,
        efficiency,
        optimizedParameters: optimizedConfig
      });
      
      // Add testing trades to overall results
      allTrades.push(...testingResults.trades);
      cumulativeBalance = testingResults.totalReturn;
      
      // Update equity curve
      for (const point of testingResults.equityCurve) {
        maxBalance = Math.max(maxBalance, point.balance);
        const currentDrawdown = ((maxBalance - point.balance) / maxBalance) * 100;
        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
        
        equityCurve.push({
          time: point.time,
          balance: point.balance,
          drawdown: currentDrawdown
        });
      }
      
      // Move to next period
      currentStartIndex = testingStart;
      period++;
    }
    
    const results = this.calculateResults(allTrades, cumulativeBalance, maxDrawdown, equityCurve, []);
    results.walkForwardResults = walkForwardResults;
    
    return results;
  }

  /**
   * Optimize strategy parameters using training data
   */
  private async optimizeParameters(trainingData: MarketData[]): Promise<Partial<BacktestConfig>> {
    const parameterSets = this.generateParameterSets();
    let bestPerformance = -Infinity;
    let bestParameters = {};
    
    for (const params of parameterSets) {
      const testConfig = { ...this.config, ...params, useWalkForward: false };
      const testBacktester = new EnhancedBacktester(testConfig);
      
      try {
        const results = await testBacktester.runSingleBacktest(trainingData);
        
        // Use Sharpe ratio as optimization target
        const performance = results.sharpeRatio;
        
        if (performance > bestPerformance && results.totalTrades >= 10) {
          bestPerformance = performance;
          bestParameters = params;
        }
      } catch (error) {
        // Skip this parameter set if it causes errors
        continue;
      }
    }
    
    return bestParameters;
  }

  /**
   * Generate parameter sets for optimization
   */
  private generateParameterSets(): Partial<BacktestConfig>[] {
    const sets: Partial<BacktestConfig>[] = [];
    
    // RSI variations
    const rsiWeights = [0.2, 0.3, 0.4];
    const macdWeights = [0.2, 0.3, 0.4];
    const bbWeights = [0.1, 0.2, 0.3];
    const maWeights = [0.1, 0.2];
    const confidenceThresholds = [0.6, 0.7, 0.8];
    const stopLossPercents = [1.5, 2.0, 2.5];
    
    // Generate combinations (limited to avoid exponential explosion)
    for (const rsiW of rsiWeights) {
      for (const macdW of macdWeights) {
        for (const conf of confidenceThresholds) {
          for (const sl of stopLossPercents) {
            if (rsiW + macdW + 0.2 + 0.1 <= 1.0) { // Ensure weights sum to <= 1
              sets.push({
                indicatorWeights: {
                  rsi: rsiW,
                  macd: macdW,
                  bb: 0.2,
                  stochastic: 0.1,
                  ma: 1.0 - rsiW - macdW - 0.2 - 0.1
                },
                confidenceThreshold: conf,
                stopLossPercent: sl
              });
            }
          }
        }
      }
    }
    
    return sets.slice(0, this.config.optimizationSteps); // Limit number of tests
  }

  /**
   * Close a position and create trade record
   */
  private closePosition(
    position: any,
    exitPrice: number,
    exitTime: number,
    exitReason: Trade['exitReason']
  ): Trade {
    const priceChange = position.side === 'long' 
      ? exitPrice - position.entryPrice 
      : position.entryPrice - exitPrice;
    
    const pnl = priceChange * position.quantity;
    const pnlPercent = (priceChange / position.entryPrice) * 100;
    
    // Calculate costs
    const notionalValue = position.quantity * position.entryPrice;
    const commission = notionalValue * (this.config.commission / 100) * 2; // Entry + exit
    const slippageAmount = notionalValue * (this.config.slippage / 100);
    
    const netPnl = pnl - commission - slippageAmount;
    
    return {
      entryTime: position.entryTime,
      exitTime,
      pair: this.config.pair,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl,
      pnlPercent,
      commission,
      slippage: slippageAmount,
      netPnl,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      exitReason,
      confidence: position.confidence
    };
  }

  /**
   * Calculate comprehensive backtest results
   */
  private calculateResults(
    trades: Trade[],
    finalBalance: number,
    maxDrawdown: number,
    equityCurve: Array<{ time: number; balance: number; drawdown: number }>,
    monthlyReturns: Array<{ month: string; return: number }>
  ): BacktestResults {
    if (trades.length === 0) {
      return this.getEmptyResults();
    }
    
    const winningTrades = trades.filter(t => t.netPnl > 0);
    const losingTrades = trades.filter(t => t.netPnl < 0);
    
    const totalReturn = finalBalance - this.config.initialBalance;
    const totalReturnPercent = (totalReturn / this.config.initialBalance) * 100;
    
    const averageWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + t.netPnl, 0) / winningTrades.length 
      : 0;
    
    const averageLoss = losingTrades.length > 0 
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.netPnl, 0) / losingTrades.length) 
      : 0;
    
    const profitFactor = averageLoss > 0 ? (averageWin * winningTrades.length) / (averageLoss * losingTrades.length) : 0;
    
    // Calculate volatility
    const returns = equityCurve.slice(1).map((point, i) => 
      (point.balance - equityCurve[i].balance) / equityCurve[i].balance
    );
    
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance * 252); // Annualized volatility
    
    // Calculate Sharpe ratio (assuming 0% risk-free rate)
    const annualizedReturn = totalReturnPercent;
    const sharpeRatio = volatility > 0 ? annualizedReturn / (volatility * 100) : 0;
    
    // Calculate Sortino ratio (downside deviation)
    const downReturns = returns.filter(ret => ret < 0);
    const downVolatility = downReturns.length > 0 
      ? Math.sqrt(downReturns.reduce((sum, ret) => sum + Math.pow(ret, 2), 0) / downReturns.length * 252)
      : 0;
    const sortinoRatio = downVolatility > 0 ? annualizedReturn / (downVolatility * 100) : 0;
    
    // Calculate other metrics
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
    const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;
    
    // Trade length analysis
    const tradeLengths = trades.map(t => (t.exitTime - t.entryTime) / (1000 * 60 * 60)); // in hours
    const averageTradeLength = tradeLengths.reduce((sum, len) => sum + len, 0) / tradeLengths.length;
    
    const winLengths = winningTrades.map(t => (t.exitTime - t.entryTime) / (1000 * 60 * 60));
    const averageWinLength = winLengths.length > 0 
      ? winLengths.reduce((sum, len) => sum + len, 0) / winLengths.length 
      : 0;
    
    const lossLengths = losingTrades.map(t => (t.exitTime - t.entryTime) / (1000 * 60 * 60));
    const averageLossLength = lossLengths.length > 0 
      ? lossLengths.reduce((sum, len) => sum + len, 0) / lossLengths.length 
      : 0;
    
    // Consecutive wins/losses
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    
    for (const trade of trades) {
      if (trade.netPnl > 0) {
        consecutiveWins++;
        consecutiveLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
      } else {
        consecutiveLosses++;
        consecutiveWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
      }
    }
    
    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      
      totalReturn,
      totalReturnPercent,
      averageWin,
      averageLoss,
      profitFactor,
      
      maxDrawdown,
      maxDrawdownPercent: maxDrawdown,
      volatility: volatility * 100,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      
      averageTradeLength,
      averageWinLength,
      averageLossLength,
      largestWin: Math.max(...trades.map(t => t.netPnl)),
      largestLoss: Math.min(...trades.map(t => t.netPnl)),
      consecutiveWins: maxConsecutiveWins,
      consecutiveLosses: maxConsecutiveLosses,
      
      maxRisk: Math.max(...trades.map(t => Math.abs(t.quantity * (t.entryPrice - (t.stopLoss || t.entryPrice))))),
      averageRisk: trades.reduce((sum, t) => sum + Math.abs(t.quantity * (t.entryPrice - (t.stopLoss || t.entryPrice))), 0) / trades.length,
      recoveryFactor,
      
      trades,
      equityCurve,
      monthlyReturns
    };
  }

  /**
   * Return empty results structure
   */
  private getEmptyResults(): BacktestResults {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      volatility: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      averageTradeLength: 0,
      averageWinLength: 0,
      averageLossLength: 0,
      largestWin: 0,
      largestLoss: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxRisk: 0,
      averageRisk: 0,
      recoveryFactor: 0,
      trades: [],
      equityCurve: [],
      monthlyReturns: []
    };
  }
}

/**
 * Default backtest configuration
 */
export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
  endDate: new Date().toISOString(),
  timeframe: '1h',
  pair: 'BTC-USDT',
  
  useRSI: true,
  useMACD: true,
  useBollingerBands: true,
  useMovingAverages: true,
  useStochastic: false,
  
  indicatorWeights: {
    rsi: 0.3,
    macd: 0.3,
    bb: 0.2,
    stochastic: 0.1,
    ma: 0.1
  },
  
  initialBalance: 10000,
  riskPerTrade: 2,
  maxLeverage: 3,
  useATRStops: true,
  stopLossPercent: 2,
  takeProfitRatio: 2,
  
  commission: 0.1,
  slippage: 0.05,
  confidenceThreshold: 0.7,
  
  useWalkForward: false,
  trainingPeriod: 100,
  testingPeriod: 30,
  optimizationSteps: 50
};