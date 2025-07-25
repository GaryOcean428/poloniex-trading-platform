import { poloniexApi } from "@/services/poloniexAPI";
import { MarketData, Strategy } from "@/types";
import {
  BacktestOptions,
  BacktestResult,
  BacktestTrade,
} from "@/types/backtest";
import { executeStrategy } from "@/utils/strategyExecutors";

// Enhanced metrics for Phase 4
interface AdvancedBacktestMetrics {
  // Existing metrics
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

  // Phase 4 Advanced metrics
  valueAtRisk95: number;
  valueAtRisk99: number;
  conditionalVaR95: number;
  conditionalVaR99: number;
  calmarRatio: number;
  sortinoRatio: number;
  omegaRatio: number;
  kappa3: number;
  gainToPainRatio: number;
  ulcerIndex: number;
  martinRatio: number;
  painIndex: number;
  burkeRatio: number;
  modifiedSharpe: number;
  treynorRatio: number;
  informationRatio: number;
  modigliani: number;
  excessReturnOnVaR: number;
  conditionalSharpe: number;
  skewness: number;
  kurtosis: number;
  tailRatio: number;
  upnessIndex: number;
  upsidePotentialRatio: number;
}

// Enhanced historical data management
interface HistoricalDataRequest {
  symbols: string[];
  timeframes: string[];
  startDate: string;
  endDate: string;
  includeVolume: boolean;
  adjustForSplits: boolean;
  adjustForDividends: boolean;
}

interface MultiTimeframeData {
  [timeframe: string]: MarketData[];
}

// Portfolio backtesting interface
interface PortfolioBacktestOptions extends BacktestOptions {
  strategies: Strategy[];
  weights: number[];
  rebalanceFrequency: "daily" | "weekly" | "monthly" | "quarterly";
  correlationThreshold: number;
  maxAllocation: number;
}

interface PortfolioBacktestResult {
  portfolioBalance: number;
  strategyReturns: BacktestResult[];
  correlationMatrix: number[][];
  diversificationRatio: number;
  portfolioSharpe: number;
  portfolioVolatility: number;
  maxPortfolioDrawdown: number;
  rebalanceEvents: RebalanceEvent[];
}

interface RebalanceEvent {
  date: string;
  newWeights: number[];
  reason: string;
  transactionCosts: number;
}

// Stress testing interface
interface StressTestScenario {
  name: string;
  marketConditions: {
    volatilityMultiplier: number;
    returnShift: number;
    correlationShift: number;
    liquidityImpact: number;
  };
}

export class AdvancedBacktestService {
  private static instance: AdvancedBacktestService;
  private historicalDataCache: Map<string, MultiTimeframeData> = new Map();
  private _correlationCache: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): AdvancedBacktestService {
    if (!AdvancedBacktestService.instance) {
      AdvancedBacktestService.instance = new AdvancedBacktestService();
    }
    return AdvancedBacktestService.instance;
  }

  /**
   * Enhanced backtest with advanced metrics calculation
   */
  public async runAdvancedBacktest(
    strategy: Strategy,
    options: BacktestOptions
  ): Promise<BacktestResult & { advancedMetrics: AdvancedBacktestMetrics }> {
    // Load enhanced historical data
    const data = await this.getMultiTimeframeData({
      symbols: [strategy.parameters.pair],
      timeframes: ["1h", "4h", "1d"],
      startDate: options.startDate,
      endDate: options.endDate,
      includeVolume: true,
      adjustForSplits: true,
      adjustForDividends: true,
    });

    const primaryData = data["1h"] || data["4h"] || data["1d"];
    if (!primaryData || primaryData.length === 0) {
      throw new Error("No historical data available");
    }

    // Initialize backtest state
    let balance = options.initialBalance;
    const trades: BacktestTrade[] = [];
    let highWaterMark = balance;
    const equityCurve: {
      timestamp: number;
      balance: number;
      drawdown: number;
    }[] = [];

    // Enhanced execution with market microstructure considerations
    for (let i = 50; i < primaryData.length; i++) {
      const marketData = primaryData.slice(0, i + 1);
      const signal = executeStrategy(strategy, marketData);

      if (signal.signal) {
        const price = primaryData[i].close;
        const amount = this.calculateOptimalPositionSize(
          balance,
          price,
          marketData
        );

        // Execute trade with enhanced slippage and market impact models
        const trade = this.executeAdvancedTrade(
          signal.signal,
          price,
          amount,
          balance,
          options,
          marketData[marketData.length - 1]
        );

        trades.push(trade);
        balance = trade.balance;

        // Update high water mark and calculate drawdown
        if (balance > highWaterMark) {
          highWaterMark = balance;
        }

        const drawdown = (highWaterMark - balance) / highWaterMark;
        equityCurve.push({
          timestamp: primaryData[i].timestamp,
          balance,
          drawdown,
        });
      }
    }

    // Calculate enhanced metrics
    const basicMetrics = this.calculateBasicMetrics(
      trades,
      options.initialBalance
    );
    const advancedMetrics = this.calculateAdvancedMetrics(
      trades,
      equityCurve,
      options.initialBalance
    );

    const result: BacktestResult = {
      strategyId: strategy.id,
      startDate: options.startDate,
      endDate: options.endDate,
      initialBalance: options.initialBalance,
      finalBalance: balance,
      totalPnL: balance - options.initialBalance,
      totalTrades: trades.length,
      winningTrades: trades.filter((t) => t.pnl > 0).length,
      losingTrades: trades.filter((t) => t.pnl < 0).length,
      winRate:
        trades.length > 0
          ? (trades.filter((t) => t.pnl > 0).length / trades.length) * 100
          : 0,
      maxDrawdown: this.calculateMaxDrawdown(trades),
      sharpeRatio: this.calculateSharpeRatio(trades),
      trades,
      metrics: basicMetrics,
    };

    return {
      ...result,
      advancedMetrics,
    };
  }

  /**
   * Portfolio-level backtesting
   */
  public async runPortfolioBacktest(
    options: PortfolioBacktestOptions
  ): Promise<PortfolioBacktestResult> {
    const strategyResults: BacktestResult[] = [];
    const rebalanceEvents: RebalanceEvent[] = [];

    // Run individual strategy backtests
    for (const strategy of options.strategies) {
      const result = await this.runAdvancedBacktest(strategy, options);
      strategyResults.push(result);
    }

    // Calculate portfolio metrics
    const correlationMatrix =
      this.calculateStrategyCorrelations(strategyResults);
    const portfolioReturns = this.calculatePortfolioReturns(
      strategyResults,
      options.weights
    );
    const diversificationRatio = this.calculateDiversificationRatio(
      strategyResults,
      options.weights,
      correlationMatrix
    );

    return {
      portfolioBalance: portfolioReturns.reduce(
        (sum, r) => sum + r,
        options.initialBalance
      ),
      strategyReturns: strategyResults,
      correlationMatrix,
      diversificationRatio,
      portfolioSharpe: this.calculatePortfolioSharpe(portfolioReturns),
      portfolioVolatility: this.calculatePortfolioVolatility(portfolioReturns),
      maxPortfolioDrawdown:
        this.calculatePortfolioMaxDrawdown(portfolioReturns),
      rebalanceEvents,
    };
  }

  /**
   * Stress testing with various market scenarios
   */
  public async runStressTest(
    strategy: Strategy,
    options: BacktestOptions,
    scenarios: StressTestScenario[]
  ): Promise<Record<string, BacktestResult>> {
    const results: Record<string, BacktestResult> = {};

    for (const scenario of scenarios) {
      try {
        // Modify market data according to stress scenario
        const stressedResult = await this.runStressScenario(
          strategy,
          options,
          scenario
        );
        results[scenario.name] = stressedResult;
      } catch {
        // Continue with other scenarios
      }
    }

    return results;
  }

  /**
   * Multi-timeframe data retrieval with caching
   */
  private async getMultiTimeframeData(
    request: HistoricalDataRequest
  ): Promise<MultiTimeframeData> {
    const cacheKey = JSON.stringify(request);

    if (this.historicalDataCache.has(cacheKey)) {
      return this.historicalDataCache.get(cacheKey)!;
    }

    const data: MultiTimeframeData = {};

    for (const timeframe of request.timeframes) {
      for (const symbol of request.symbols) {
        try {
          const marketData = await poloniexApi.getHistoricalData(
            symbol,
            request.startDate,
            request.endDate
          );

          if (!data[timeframe]) {
            data[timeframe] = [];
          }
          data[timeframe] = marketData;
        } catch {
          // Continue with other symbols/timeframes
        }
      }
    }

    this.historicalDataCache.set(cacheKey, data);
    return data;
  }

  /**
   * Enhanced position sizing with volatility adjustment
   */
  private calculateOptimalPositionSize(
    balance: number,
    price: number,
    marketData: MarketData[]
  ): number {
    // Calculate recent volatility
    const returns = marketData
      .slice(-20)
      .map((candle, i) => {
        if (i === 0) return 0;
        return (
          (candle.close - marketData[marketData.length - 20 + i - 1].close) /
          marketData[marketData.length - 20 + i - 1].close
        );
      })
      .slice(1);

    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + r * r, 0) / returns.length
    );

    // Kelly criterion-inspired position sizing with volatility adjustment
    const basePositionPercent = 0.02; // 2% base risk
    const volatilityAdjustment = Math.max(
      0.1,
      Math.min(2.0, 1 / (volatility * 100))
    );
    const adjustedPercent = basePositionPercent * volatilityAdjustment;

    return (balance * adjustedPercent) / price;
  }

  /**
   * Enhanced trade execution with market microstructure
   */
  private executeAdvancedTrade(
    type: "BUY" | "SELL",
    price: number,
    amount: number,
    balance: number,
    options: BacktestOptions,
    marketData: MarketData
  ): BacktestTrade {
    // Enhanced slippage model based on volume and volatility
    const volumeImpact = Math.min(
      0.001,
      (amount / (marketData.volume || 1000000)) * 0.01
    );
    const volatilityImpact =
      (Math.abs(marketData.high - marketData.low) / marketData.close) * 0.1;
    const enhancedSlippage = options.slippage + volumeImpact + volatilityImpact;

    // Apply enhanced slippage
    const executionPrice =
      type === "BUY"
        ? price * (1 + enhancedSlippage)
        : price * (1 - enhancedSlippage);

    const total = executionPrice * amount;
    const fee = total * options.feeRate;

    // Calculate PnL (simplified for single trade)
    const pnl = type === "SELL" ? total - fee - price * amount : 0;
    const pnlPercent = (pnl / (price * amount)) * 100;

    // Update balance
    const newBalance =
      type === "BUY" ? balance - total - fee : balance + total - fee;

    return {
      id: `trade-${marketData.timestamp}-${type}`,
      entryPrice: executionPrice,
      exitPrice: type === 'SELL' ? executionPrice : null,
      entryTime: new Date(marketData.timestamp).toISOString(),
      exitTime: type === 'SELL' ? new Date(marketData.timestamp).toISOString() : null,
      side: type === 'BUY' ? 'long' : 'short',
      status: type === 'SELL' ? 'closed' : 'open',
      pnl,
      pnlPercent,
      balance: newBalance,
      size: amount,
      fee,
      // Legacy compatibility
      timestamp: marketData.timestamp,
      type,
      price: executionPrice,
      amount,
      total
    };
  }

  /**
   * Calculate advanced risk and performance metrics
   */
  private calculateAdvancedMetrics(
    trades: BacktestTrade[],
    equityCurve: { timestamp: number; balance: number; drawdown: number }[],
    initialBalance: number
  ): AdvancedBacktestMetrics {
    const returns = trades.map((t) => t.pnlPercent / 100);
    const dailyReturns = this.calculateDailyReturns(trades);
    const monthlyReturns = this.calculateMonthlyReturns(trades);

    // Sort returns for quantile calculations
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const negativeReturns = returns.filter((r) => r < 0);
    const positiveReturns = returns.filter((r) => r > 0);

    // Basic statistics
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);
    const skewness = this.calculateSkewness(returns, mean, stdDev);
    const kurtosis = this.calculateKurtosis(returns, mean, stdDev);

    // VaR calculations
    const var95Index = Math.floor(0.05 * sortedReturns.length);
    const var99Index = Math.floor(0.01 * sortedReturns.length);
    const var95Value = sortedReturns[var95Index] || 0;
    const var99Value = sortedReturns[var99Index] || 0;

    // Conditional VaR (Expected Shortfall)
    const cvar95 =
      sortedReturns.slice(0, var95Index + 1).reduce((sum, r) => sum + r, 0) /
        (var95Index + 1) || 0;
    const cvar99 =
      sortedReturns.slice(0, var99Index + 1).reduce((sum, r) => sum + r, 0) /
        (var99Index + 1) || 0;

    // Downside metrics
    const downsideReturns = returns.filter((r) => r < 0);
    const downsideDeviation = Math.sqrt(
      downsideReturns.reduce((sum, r) => sum + r * r, 0) /
        downsideReturns.length
    );
    const sortinoRatio = downsideDeviation > 0 ? mean / downsideDeviation : 0;

    // Drawdown-based metrics
    const maxDrawdown = Math.max(...equityCurve.map((e) => e.drawdown));
    const calmarRatio = maxDrawdown > 0 ? (mean * 252) / maxDrawdown : 0; // Annualized

    // Advanced ratios
    const ulcerIndex = Math.sqrt(
      equityCurve.reduce((sum, e) => sum + e.drawdown * e.drawdown, 0) /
        equityCurve.length
    );
    const martinRatio = ulcerIndex > 0 ? mean / ulcerIndex : 0;

    // Omega ratio
    const threshold = 0;
    const gainsAboveThreshold = returns
      .filter((r) => r > threshold)
      .reduce((sum, r) => sum + (r - threshold), 0);
    const lossesBelowThreshold = Math.abs(
      returns
        .filter((r) => r < threshold)
        .reduce((sum, r) => sum + (r - threshold), 0)
    );
    const omegaRatio =
      lossesBelowThreshold > 0 ? gainsAboveThreshold / lossesBelowThreshold : 0;

    return {
      // Basic metrics (existing)
      dailyReturns,
      monthlyReturns,
      volatility: stdDev,
      profitFactor: this.calculateProfitFactor(trades),
      recoveryFactor:
        maxDrawdown > 0
          ? (trades[trades.length - 1]?.balance - initialBalance) /
            (maxDrawdown * initialBalance)
          : 0,
      averageWin:
        positiveReturns.reduce((sum, r) => sum + r, 0) /
          positiveReturns.length || 0,
      averageLoss:
        Math.abs(
          negativeReturns.reduce((sum, r) => sum + r, 0) /
            negativeReturns.length
        ) || 0,
      largestWin: Math.max(...returns),
      largestLoss: Math.min(...returns),
      averageHoldingPeriod: this.calculateAverageHoldingPeriod(trades),
      bestMonth: Math.max(...monthlyReturns),
      worstMonth: Math.min(...monthlyReturns),

      // Advanced metrics (Phase 4)
      valueAtRisk95: Math.abs(var95Value) * 100,
      valueAtRisk99: Math.abs(var99Value) * 100,
      conditionalVaR95: Math.abs(cvar95) * 100,
      conditionalVaR99: Math.abs(cvar99) * 100,
      calmarRatio,
      sortinoRatio,
      omegaRatio,
      kappa3: downsideDeviation > 0 ? mean / Math.pow(downsideDeviation, 3) : 0,
      gainToPainRatio: this.calculateGainToPainRatio(returns),
      ulcerIndex,
      martinRatio,
      painIndex: this.calculatePainIndex(equityCurve),
      burkeRatio: this.calculateBurkeRatio(returns, equityCurve),
      modifiedSharpe: this.calculateModifiedSharpe(returns, skewness, kurtosis),
      treynorRatio: 0, // Would need beta calculation with market data
      informationRatio: 0, // Would need benchmark data
      modigliani: 0, // Would need market data for calculation
      excessReturnOnVaR: var95Value !== 0 ? mean / Math.abs(var95Value) : 0,
      conditionalSharpe: cvar95 !== 0 ? mean / Math.abs(cvar95) : 0,
      skewness,
      kurtosis,
      tailRatio: var99Value !== 0 ? Math.abs(var95Value / var99Value) : 0,
      upnessIndex: this.calculateUpnessIndex(returns),
      upsidePotentialRatio: this.calculateUpsidePotentialRatio(returns),
    };
  }

  // Helper methods for advanced metric calculations
  private calculateSkewness(
    returns: number[],
    mean: number,
    stdDev: number
  ): number {
    if (stdDev === 0) return 0;
    const n = returns.length;
    return (
      (n / ((n - 1) * (n - 2))) *
      returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0)
    );
  }

  private calculateKurtosis(
    returns: number[],
    mean: number,
    stdDev: number
  ): number {
    if (stdDev === 0) return 0;
    const n = returns.length;
    const factor = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
    const adjustment = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
    return (
      factor *
        returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) -
      adjustment
    );
  }

  private calculateGainToPainRatio(returns: number[]): number {
    const gains = returns.filter((r) => r > 0).reduce((sum, r) => sum + r, 0);
    const pains = Math.abs(
      returns.filter((r) => r < 0).reduce((sum, r) => sum + r, 0)
    );
    return pains > 0 ? gains / pains : 0;
  }

  private calculatePainIndex(equityCurve: { drawdown: number }[]): number {
    return (
      equityCurve.reduce((sum, e) => sum + e.drawdown, 0) / equityCurve.length
    );
  }

  private calculateBurkeRatio(
    returns: number[],
    equityCurve: { drawdown: number }[]
  ): number {
    const annualizedReturn =
      (returns.reduce((sum, r) => sum + r, 0) / returns.length) * 252;
    const burkeRatio = Math.sqrt(
      equityCurve.reduce((sum, e) => sum + e.drawdown * e.drawdown, 0)
    );
    return burkeRatio > 0 ? annualizedReturn / burkeRatio : 0;
  }

  private calculateModifiedSharpe(
    returns: number[],
    skewness: number,
    kurtosis: number
  ): number {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
        returns.length
    );

    if (stdDev === 0) return 0;

    const sharpe = mean / stdDev;
    const modification =
      1 + (skewness / 6) * sharpe - ((kurtosis - 3) / 24) * sharpe * sharpe;
    return sharpe * modification;
  }

  private calculateUpnessIndex(returns: number[]): number {
    const positiveReturns = returns.filter((r) => r > 0);
    return positiveReturns.length / returns.length;
  }

  private calculateUpsidePotentialRatio(returns: number[]): number {
    const threshold = 0;
    const upsidePotential =
      returns
        .filter((r) => r > threshold)
        .reduce((sum, r) => sum + (r - threshold), 0) / returns.length;
    const downsideDeviation = Math.sqrt(
      returns
        .filter((r) => r < threshold)
        .reduce((sum, r) => sum + Math.pow(r - threshold, 2), 0) /
        returns.length
    );

    return downsideDeviation > 0 ? upsidePotential / downsideDeviation : 0;
  }

  // Existing helper methods (maintain compatibility)
  private calculateBasicMetrics(
    trades: BacktestTrade[],
    initialBalance: number
  ) {
    const dailyReturns = this.calculateDailyReturns(trades);
    const monthlyReturns = this.calculateMonthlyReturns(trades);
    const positiveReturns = trades.filter((t) => t.pnl > 0);
    const negativeReturns = trades.filter((t) => t.pnl < 0);

    return {
      dailyReturns,
      monthlyReturns,
      volatility: this.calculateVolatility(dailyReturns),
      profitFactor: this.calculateProfitFactor(trades),
      recoveryFactor:
        this.calculateMaxDrawdown(trades) > 0
          ? (trades[trades.length - 1]?.balance - initialBalance) /
            (this.calculateMaxDrawdown(trades) * initialBalance)
          : 0,
      averageWin:
        positiveReturns.reduce((sum, t) => sum + t.pnl, 0) /
          positiveReturns.length || 0,
      averageLoss:
        Math.abs(
          negativeReturns.reduce((sum, t) => sum + t.pnl, 0) /
            negativeReturns.length
        ) || 0,
      largestWin: trades.length > 0 ? Math.max(...trades.map((t) => t.pnl)) : 0,
      largestLoss:
        trades.length > 0 ? Math.min(...trades.map((t) => t.pnl)) : 0,
      averageHoldingPeriod: this.calculateAverageHoldingPeriod(trades),
      bestMonth: monthlyReturns.length > 0 ? Math.max(...monthlyReturns) : 0,
      worstMonth: monthlyReturns.length > 0 ? Math.min(...monthlyReturns) : 0,
    };
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    return Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
        returns.length
    );
  }

  private calculateDailyReturns(trades: BacktestTrade[]): number[] {
    const dailyPnL = new Map<string, number>();

    trades.forEach((trade) => {
      // Add null safety for timestamp
      if (trade.timestamp) {
        const date = new Date(trade.timestamp).toISOString().split("T")[0];
        const currentPnL = dailyPnL.get(date) || 0;
        dailyPnL.set(date, currentPnL + trade.pnl);
      }
    });

    return Array.from(dailyPnL.values());
  }

  private calculateMonthlyReturns(trades: BacktestTrade[]): number[] {
    const monthlyPnL = new Map<string, number>();

    trades.forEach((trade) => {
      // Add null safety for timestamp
      if (trade.timestamp) {
        const date = new Date(trade.timestamp);
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
        const currentPnL = monthlyPnL.get(monthKey) || 0;
        monthlyPnL.set(monthKey, currentPnL + trade.pnl);
      }
    });

    return Array.from(monthlyPnL.values());
  }

  private calculateMaxDrawdown(trades: BacktestTrade[]): number {
    let peak = -Infinity;
    let maxDrawdown = 0;

    trades.forEach((trade) => {
      if (trade.balance > peak) {
        peak = trade.balance;
      }

      const drawdown = (peak - trade.balance) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });

    return maxDrawdown;
  }

  private calculateSharpeRatio(trades: BacktestTrade[]): number {
    const returns = trades.map((t) => t.pnlPercent);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
        returns.length
    );

    return avgReturn / stdDev;
  }

  private calculateProfitFactor(trades: BacktestTrade[]): number {
    const grossProfit = trades
      .filter((t) => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);

    const grossLoss = Math.abs(
      trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
    );

    return grossProfit / grossLoss;
  }

  private calculateAverageHoldingPeriod(trades: BacktestTrade[]): number {
    let totalHoldingTime = 0;
    let positions = 0;

    for (let i = 0; i < trades.length - 1; i++) {
      if (trades[i].type === "BUY" && trades[i + 1].type === "SELL") {
        // Add null safety for timestamps
        if (trades[i + 1].timestamp && trades[i].timestamp) {
          totalHoldingTime += trades[i + 1].timestamp - trades[i].timestamp;
          positions++;
        }
      }
    }

    return totalHoldingTime / positions / (1000 * 60 * 60); // Convert to hours
  }

  // Portfolio-specific methods
  private calculateStrategyCorrelations(results: BacktestResult[]): number[][] {
    const n = results.length;
    const correlationMatrix: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          correlationMatrix[i][j] = 1;
        } else {
          const returns1 = results[i].trades.map((t) => t.pnlPercent);
          const returns2 = results[j].trades.map((t) => t.pnlPercent);
          correlationMatrix[i][j] = this.calculateCorrelation(
            returns1,
            returns2
          );
        }
      }
    }

    return correlationMatrix;
  }

  private calculateCorrelation(returns1: number[], returns2: number[]): number {
    const n = Math.min(returns1.length, returns2.length);
    if (n === 0) return 0;

    const mean1 = returns1.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
    const mean2 = returns2.slice(0, n).reduce((sum, r) => sum + r, 0) / n;

    let numerator = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;
      numerator += diff1 * diff2;
      sumSq1 += diff1 * diff1;
      sumSq2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSq1 * sumSq2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private calculatePortfolioReturns(
    results: BacktestResult[],
    weights: number[]
  ): number[] {
    const maxLength = Math.max(...results.map((r) => r.trades.length));
    const portfolioReturns: number[] = [];

    for (let i = 0; i < maxLength; i++) {
      let weightedReturn = 0;
      for (let j = 0; j < results.length; j++) {
        const trade = results[j].trades[i];
        if (trade) {
          weightedReturn += (trade.pnlPercent / 100) * weights[j];
        }
      }
      portfolioReturns.push(weightedReturn);
    }

    return portfolioReturns;
  }

  private calculateDiversificationRatio(
    results: BacktestResult[],
    weights: number[],
    correlationMatrix: number[][]
  ): number {
    // Simplified diversification ratio calculation
    const weightedVolatility = weights.reduce((sum, w, i) => {
      const volatility = Math.sqrt(
        results[i].trades.reduce((s, t) => s + t.pnlPercent * t.pnlPercent, 0) /
          results[i].trades.length
      );
      return sum + w * volatility;
    }, 0);

    // Portfolio volatility calculation (simplified)
    let portfolioVariance = 0;
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights.length; j++) {
        const vol_i = Math.sqrt(
          results[i].trades.reduce(
            (s, t) => s + t.pnlPercent * t.pnlPercent,
            0
          ) / results[i].trades.length
        );
        const vol_j = Math.sqrt(
          results[j].trades.reduce(
            (s, t) => s + t.pnlPercent * t.pnlPercent,
            0
          ) / results[j].trades.length
        );
        portfolioVariance +=
          weights[i] * weights[j] * correlationMatrix[i][j] * vol_i * vol_j;
      }
    }

    const portfolioVolatility = Math.sqrt(portfolioVariance);
    return portfolioVolatility > 0
      ? weightedVolatility / portfolioVolatility
      : 0;
  }

  private calculatePortfolioSharpe(returns: number[]): number {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) /
        returns.length
    );
    return stdDev > 0 ? mean / stdDev : 0;
  }

  private calculatePortfolioVolatility(returns: number[]): number {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    return Math.sqrt(
      returns.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) /
        returns.length
    );
  }

  private calculatePortfolioMaxDrawdown(returns: number[]): number {
    let peak = -Infinity;
    let maxDrawdown = 0;
    let cumulative = 0;

    for (const ret of returns) {
      cumulative += ret;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = (peak - cumulative) / Math.abs(peak);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  private async runStressScenario(
    strategy: Strategy,
    options: BacktestOptions,
    _scenario: StressTestScenario
  ): Promise<BacktestResult> {
    // This would modify the historical data according to the stress scenario
    // For now, returning a placeholder - full implementation would involve:
    // 1. Loading historical data
    // 2. Applying stress scenario transformations
    // 3. Running backtest on modified data

    return this.runAdvancedBacktest(strategy, options);
  }
}

export const advancedBacktestService = AdvancedBacktestService.getInstance();
