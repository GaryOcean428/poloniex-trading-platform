import { Strategy, MarketData } from '@/types';
import { BacktestResult, BacktestTrade, BacktestOptions, OptimizationResult } from '@/types/backtest';

// Define BacktestMetrics interface
interface BacktestMetrics {
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
import { executeStrategy } from '@/utils/strategyExecutors';
import { poloniexApi } from '@/services/poloniexAPI';

export class BacktestService {
  private static instance: BacktestService;
  private historicalData: Map<string, MarketData[]> = new Map();
  
  private constructor() {}
  
  public static getInstance(): BacktestService {
    if (!BacktestService.instance) {
      BacktestService.instance = new BacktestService();
    }
    return BacktestService.instance;
  }
  
  /**
   * Run backtest for a strategy
   */
  public async runBacktest(
    strategy: Strategy,
    options: BacktestOptions
  ): Promise<BacktestResult> {
    try {
      // Load historical data
      const data = await this.getHistoricalData(
        strategy.parameters.pair,
        options.startDate,
        options.endDate
      );
      
      // Initialize backtest state
      const balance = options.initialBalance;
      // Position tracking variable (not currently used but kept for future implementation)
      // let position = 0;
      const trades: BacktestTrade[] = [];
      
      // Run strategy on each candle
      for (let i = 50; i < data.length; i++) {
        const marketData = data.slice(0, i + 1);
        const signal = executeStrategy(strategy, marketData);
        
        if (signal.signal) {
          const price = data[i].close;
          const amount = this.calculatePositionSize(balance, price);
          
          // Execute trade
          const trade = this.executeTrade(
            signal.signal,
            price,
            amount,
            balance,
            options.feeRate,
            options.slippage,
            data[i].timestamp
          );
          
          // Update state
          trades.push(trade);
          balance = trade.balance;
          // Update position tracking (commented out as variable is not used)
          // position = signal.signal === 'BUY' ? amount : 0;
        }
      }
      
      // Calculate final metrics
      const metrics = this.calculateMetrics(trades, options.initialBalance);
      
      return {
        strategyId: strategy.id,
        startDate: options.startDate,
        endDate: options.endDate,
        initialBalance: options.initialBalance,
        finalBalance: balance,
        totalPnL: balance - options.initialBalance,
        totalTrades: trades.length,
        winningTrades: trades.filter(t => t.pnl > 0).length,
        losingTrades: trades.filter(t => t.pnl < 0).length,
        winRate: trades.filter(t => t.pnl > 0).length / trades.length,
        maxDrawdown: this.calculateMaxDrawdown(trades),
        sharpeRatio: this.calculateSharpeRatio(trades),
        trades,
        metrics
      };
    } catch (error) {
      // console.error('Backtest failed:', error);
      throw error;
    }
  }
  
  /**
   * Optimize strategy parameters
   */
  public async optimizeStrategy(
    strategy: Strategy,
    options: BacktestOptions,
    parameterRanges: Record<string, [number, number, number]>
  ): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];
    
    // Generate parameter combinations
    const combinations = this.generateParameterCombinations(parameterRanges);
    
    // Test each combination
    for (const params of combinations) {
      const testStrategy = {
        ...strategy,
        parameters: {
          ...strategy.parameters,
          ...params
        }
      };
      
      const result = await this.runBacktest(testStrategy, options);
      
      results.push({
        parameters: params,
        performance: result
      });
    }
    
    // Sort by performance (Sharpe ratio)
    return results.sort((a, b) => b.performance.sharpeRatio - a.performance.sharpeRatio);
  }
  
  /**
   * Get historical market data
   */
  private async getHistoricalData(
    pair: string,
    startDate: string,
    endDate: string
  ): Promise<MarketData[]> {
    const cacheKey = `${pair}-${startDate}-${endDate}`;
    
    if (this.historicalData.has(cacheKey)) {
      return this.historicalData.get(cacheKey)!;
    }
    
    const data = await poloniexApi.getHistoricalData(pair, startDate, endDate);
    this.historicalData.set(cacheKey, data);
    
    return data;
  }
  
  /**
   * Calculate position size based on available balance
   */
  private calculatePositionSize(balance: number, price: number): number {
    // Use 50% of available balance by default
    return (balance * 0.5) / price;
  }
  
  /**
   * Execute a simulated trade
   */
  private executeTrade(
    type: 'BUY' | 'SELL',
    price: number,
    amount: number,
    balance: number,
    feeRate: number,
    slippage: number,
    timestamp: number
  ): BacktestTrade {
    // Apply slippage to price
    const executionPrice = type === 'BUY' 
      ? price * (1 + slippage)
      : price * (1 - slippage);
    
    const total = executionPrice * amount;
    const fee = total * feeRate;
    
    // Calculate PnL
    const pnl = type === 'SELL' ? total - fee - (price * amount) : 0;
    const pnlPercent = pnl / (price * amount) * 100;
    
    // Update balance
    const newBalance = type === 'BUY'
      ? balance - total - fee
      : balance + total - fee;
    
    return {
      id: `trade-${timestamp}-${type}`,
      entryPrice: executionPrice,
      exitPrice: type === 'SELL' ? executionPrice : null,
      entryTime: new Date(timestamp).toISOString(),
      exitTime: type === 'SELL' ? new Date(timestamp).toISOString() : null,
      side: type === 'BUY' ? 'long' : 'short',
      status: type === 'SELL' ? 'closed' : 'open',
      pnl,
      pnlPercent,
      balance: newBalance,
      size: amount,
      fee,
      // Legacy compatibility
      timestamp,
      type,
      price: executionPrice,
      amount,
      total
    };
  }
  
  /**
   * Calculate backtest metrics
   */
  private calculateMetrics(trades: BacktestTrade[], initialBalance: number): BacktestMetrics {
    const dailyReturns = this.calculateDailyReturns(trades);
    const monthlyReturns = this.calculateMonthlyReturns(trades);
    
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    
    return {
      dailyReturns,
      monthlyReturns,
      volatility: this.calculateVolatility(dailyReturns),
      profitFactor: this.calculateProfitFactor(trades),
      recoveryFactor: this.calculateRecoveryFactor(trades, initialBalance),
      averageWin: winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length,
      averageLoss: losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length,
      largestWin: Math.max(...trades.map(t => t.pnl)),
      largestLoss: Math.min(...trades.map(t => t.pnl)),
      averageHoldingPeriod: this.calculateAverageHoldingPeriod(trades),
      bestMonth: Math.max(...monthlyReturns),
      worstMonth: Math.min(...monthlyReturns)
    };
  }
  
  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(trades: BacktestTrade[]): number {
    const peak = -Infinity;
    const maxDrawdown = 0;
    
    trades.forEach(trade => {
      if (trade.balance > peak) {
        peak = trade.balance;
      }
      
      const drawdown = (peak - trade.balance) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });
    
    return maxDrawdown;
  }
  
  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(trades: BacktestTrade[]): number {
    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    
    return avgReturn / stdDev;
  }
  
  /**
   * Calculate daily returns
   */
  private calculateDailyReturns(trades: BacktestTrade[]): number[] {
    const dailyPnL = new Map<string, number>();
    
    trades.forEach(trade => {
      const timestamp = trade.timestamp ?? Date.now();
      const date = new Date(timestamp).toISOString().split('T')[0];
      const currentPnL = dailyPnL.get(date) || 0;
      dailyPnL.set(date, currentPnL + trade.pnl);
    });
    
    return Array.from(dailyPnL.values());
  }
  
  /**
   * Calculate monthly returns
   */
  private calculateMonthlyReturns(trades: BacktestTrade[]): number[] {
    const monthlyPnL = new Map<string, number>();
    
    trades.forEach(trade => {
      const timestamp = trade.timestamp ?? Date.now();
      const date = new Date(timestamp);
      const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const currentPnL = monthlyPnL.get(monthKey) || 0;
      monthlyPnL.set(monthKey, currentPnL + trade.pnl);
    });
    
    return Array.from(monthlyPnL.values());
  }
  
  /**
   * Calculate volatility
   */
  private calculateVolatility(returns: number[]): number {
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    return Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
  }
  
  /**
   * Calculate profit factor
   */
  private calculateProfitFactor(trades: BacktestTrade[]): number {
    const grossProfit = trades
      .filter(t => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
      
    const grossLoss = Math.abs(
      trades
        .filter(t => t.pnl < 0)
        .reduce((sum, t) => sum + t.pnl, 0)
    );
    
    return grossProfit / grossLoss;
  }
  
  /**
   * Calculate recovery factor
   */
  private calculateRecoveryFactor(trades: BacktestTrade[], initialBalance: number): number {
    const maxDrawdown = this.calculateMaxDrawdown(trades);
    const lastTrade = trades[trades.length - 1];
    if (!lastTrade) return 0;
    
    const netProfit = lastTrade.balance - initialBalance;
    
    if (maxDrawdown === 0) return netProfit > 0 ? Infinity : 0;
    return netProfit / (maxDrawdown * initialBalance);
  }
  
  /**
   * Calculate average holding period
   */
  private calculateAverageHoldingPeriod(trades: BacktestTrade[]): number {
    const totalHoldingTime = 0;
    const positions = 0;
    
    for (let i = 0; i < trades.length - 1; i++) {
      if (trades[i].type === 'BUY' && trades[i + 1].type === 'SELL') {
        const currentTimestamp = trades[i].timestamp ?? Date.now();
        const nextTimestamp = trades[i + 1].timestamp ?? Date.now();
        totalHoldingTime += nextTimestamp - currentTimestamp;
        positions++;
      }
    }
    
    if (positions === 0) return 0; // Avoid division by zero
    return totalHoldingTime / positions / (1000 * 60 * 60); // Convert to hours
  }
  
  /**
   * Generate parameter combinations for optimization
   */
  private generateParameterCombinations(
    ranges: Record<string, [number, number, number]>
  ): Record<string, number>[] {
    const combinations: Record<string, number>[] = [];
    const parameters = Object.keys(ranges);
    
    const generateCombination = (
      current: Record<string, number>,
      paramIndex: number
    ) => {
      if (paramIndex === parameters.length) {
        combinations.push({...current});
        return;
      }
      
      const param = parameters[paramIndex];
      const [min, max, step] = ranges[param];
      
      for (let value = min; value <= max; value += step) {
        current[param] = value;
        generateCombination(current, paramIndex + 1);
      }
    };
    
    generateCombination({}, 0);
    return combinations;
  }
}

export const backtestService = BacktestService.getInstance();