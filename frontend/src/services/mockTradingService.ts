import { poloniexApi } from "@/services/poloniexAPI";
import { MarketData, Strategy } from "@/types";
import { BacktestTrade } from "@/types/backtest";
import { executeStrategy } from "@/utils/strategyExecutors";

// Mock trading interfaces
export interface MockTrade extends BacktestTrade {
  realPrice: number; // Actual market price at execution
  slippage: number; // Actual slippage experienced
  latency: number; // Execution latency in ms
  confidence: number; // Trade confidence score (0-1)
  marketConditions: {
    volatility: number;
    volume: number;
    spread: number;
    momentum: number;
  };
}

export interface MockPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryTime: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  marketValue: number;
  marginUsed: number;
}

export interface MockPortfolio {
  balance: number;
  equity: number;
  availableBalance: number;
  positions: MockPosition[];
  totalUnrealizedPnL: number;
  marginUsed: number;
  marginLevel: number;
  dayPnL: number;
  totalPnL: number;
}

export interface MockTradingSession {
  id: string;
  strategyId: string;
  startTime: number;
  endTime?: number;
  initialBalance: number;
  currentBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  trades: MockTrade[];
  portfolio: MockPortfolio;
  performance: MockSessionPerformance;
  isActive: boolean;
}

export interface MockSessionPerformance {
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  averageWin: number;
  averageLoss: number;
  totalReturn: number;
  volatility: number;
  confidenceScore: number;
  riskAdjustedReturn: number;
  consistencyScore: number;
  stabilityIndex: number;
}

export interface ConfidenceMetrics {
  overall: number; // 0-100 confidence score
  profitability: number;
  consistency: number;
  riskManagement: number;
  executionQuality: number;
  marketAdaptability: number;
  timeStability: number;
  components: {
    winRate: { score: number; weight: number; value: number };
    profitFactor: { score: number; weight: number; value: number };
    sharpeRatio: { score: number; weight: number; value: number };
    maxDrawdown: { score: number; weight: number; value: number };
    consistency: { score: number; weight: number; value: number };
    riskAdjustedReturn: { score: number; weight: number; value: number };
    executionLatency: { score: number; weight: number; value: number };
    slippageControl: { score: number; weight: number; value: number };
  };
  recommendation:
    | "READY_FOR_LIVE"
    | "NEEDS_IMPROVEMENT"
    | "HIGH_RISK"
    | "INSUFFICIENT_DATA";
  requiredConfidence: number;
  timeInMockMode: number; // days
  minimumTimeRequired: number; // days
  readinessChecklist: {
    profitabilityTest: boolean;
    riskManagementTest: boolean;
    consistencyTest: boolean;
    executionTest: boolean;
    timeTest: boolean;
    drawdownTest: boolean;
  };
}

export class MockTradingService {
  private static instance: MockTradingService;
  private activeSessions: Map<string, MockTradingSession> = new Map();
  private marketDataCache: Map<string, MarketData[]> = new Map();
  private priceSubscriptions: Map<string, (data: MarketData) => void> =
    new Map();
  // Flag to track service state (for future use)
  private _isRunning: boolean = false;

  private constructor() {}

  public static getInstance(): MockTradingService {
    if (!MockTradingService.instance) {
      MockTradingService.instance = new MockTradingService();
    }
    return MockTradingService.instance;
  }

  /**
   * Start a new mock trading session
   */
  public async startMockSession(
    strategy: Strategy,
    initialBalance: number = 10000,
    _options: {
      maxDrawdownLimit?: number;
      stopLossPercent?: number;
      takeProfitPercent?: number;
      maxPositions?: number;
    } = {}
  ): Promise<string> {
    const sessionId = `mock_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const session: MockTradingSession = {
      id: sessionId,
      strategyId: strategy.id,
      startTime: Date.now(),
      initialBalance,
      currentBalance: initialBalance,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      trades: [],
      portfolio: this.createInitialPortfolio(initialBalance),
      performance: this.createInitialPerformance(),
      isActive: true,
    };

    this.activeSessions.set(sessionId, session);

    // Start monitoring market data for this strategy
    await this.startMarketDataMonitoring(sessionId, strategy);

    return sessionId;
  }

  /**
   * Stop a mock trading session
   */
  public stopMockSession(sessionId: string): MockTradingSession | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    session.isActive = false;
    session.endTime = Date.now();

    // Close all open positions
    this.closeAllPositions(sessionId);

    // Calculate final performance
    session.performance = this.calculateSessionPerformance(session);

    return session;
  }

  /**
   * Get active mock session
   */
  public getMockSession(sessionId: string): MockTradingSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get all mock sessions for a strategy
   */
  public getStrategyMockSessions(strategyId: string): MockTradingSession[] {
    return Array.from(this.activeSessions.values()).filter(
      (session) => session.strategyId === strategyId
    );
  }

  /**
   * Execute a mock trade based on strategy signal
   */
  public async executeMockTrade(
    sessionId: string,
    signal: { signal: "BUY" | "SELL" | null; confidence: number },
    marketData: MarketData,
    options: {
      amount?: number;
      leverage?: number;
      orderType?: "MARKET" | "LIMIT";
      limitPrice?: number;
    } = {}
  ): Promise<MockTrade | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive || !signal.signal) return null;

    const { amount = this.calculatePositionSize(session), leverage: _leverage = 1 } =
      options;

    // Calculate realistic execution parameters
    const executionLatency = this.simulateExecutionLatency();
    const slippage = this.simulateSlippage(marketData, amount);
    const executionPrice = this.calculateExecutionPrice(
      marketData.close,
      signal.signal,
      slippage
    );

    // Create mock trade
    const trade: MockTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: signal.signal,
      price: executionPrice,
      amount,
      total: executionPrice * amount,
      pnl: 0, // Will be calculated when position is closed
      pnlPercent: 0,
      balance: session.currentBalance,
      realPrice: marketData.close,
      slippage,
      latency: executionLatency,
      confidence: signal.confidence,
      entryPrice: executionPrice,
      exitPrice: null,
      entryTime: new Date().toISOString(),
      exitTime: null,
      side: signal.signal === 'BUY' ? 'long' : 'short',
      status: 'open',
      size: amount,
      fee: executionPrice * amount * 0.001,
      marketConditions: {
        volatility: this.calculateVolatility(marketData),
        volume: marketData.volume || 0,
        spread: this.calculateSpread(marketData),
        momentum: this.calculateMomentum(marketData),
      },
    };

    // Update session
    session.trades.push(trade);
    session.totalTrades++;

    // Update portfolio
    this.updatePortfolio(session, trade, marketData);

    // Calculate updated performance
    session.performance = this.calculateSessionPerformance(session);

    return trade;
  }

  /**
   * Calculate confidence score for a mock trading session
   */
  public calculateConfidenceScore(
    session: MockTradingSession
  ): ConfidenceMetrics {
    const trades = session.trades;
    const performance = session.performance;
    const timeInMockMode =
      (Date.now() - session.startTime) / (1000 * 60 * 60 * 24); // days

    // Define scoring weights and targets
    const weights = {
      winRate: 0.15,
      profitFactor: 0.2,
      sharpeRatio: 0.18,
      maxDrawdown: 0.15,
      consistency: 0.12,
      riskAdjustedReturn: 0.1,
      executionLatency: 0.05,
      slippageControl: 0.05,
    };

    // Calculate component scores (0-100)
    const components = {
      winRate: this.scoreWinRate(performance.winRate, 0.6), // Target 60%+
      profitFactor: this.scoreProfitFactor(performance.profitFactor, 1.5), // Target 1.5+
      sharpeRatio: this.scoreSharpeRatio(performance.sharpeRatio, 1.0), // Target 1.0+
      maxDrawdown: this.scoreMaxDrawdown(performance.maxDrawdown, 0.2), // Target <20%
      consistency: this.scoreConsistency(trades),
      riskAdjustedReturn: this.scoreRiskAdjustedReturn(
        performance.riskAdjustedReturn,
        0.15
      ), // Target 15%+
      executionLatency: this.scoreExecutionLatency(trades),
      slippageControl: this.scoreSlippageControl(trades),
    };

    // Calculate weighted overall score
    const overallScore = Object.entries(components).reduce(
      (sum, [key, component]) => {
        return sum + component.score * weights[key as keyof typeof weights];
      },
      0
    );

    // Calculate category scores
    const profitability =
      components.winRate.score * 0.4 + components.profitFactor.score * 0.6;
    const consistency = components.consistency.score;
    const riskManagement =
      components.maxDrawdown.score * 0.6 +
      components.riskAdjustedReturn.score * 0.4;
    const executionQuality =
      components.executionLatency.score * 0.5 +
      components.slippageControl.score * 0.5;
    const marketAdaptability = this.calculateMarketAdaptability(trades);
    const timeStability = this.calculateTimeStability(session);

    // Readiness checklist
    const requiredConfidence = 75; // Minimum 75% confidence for live trading
    const minimumTimeRequired = 7; // Minimum 7 days of mock trading

    const readinessChecklist = {
      profitabilityTest: profitability >= 70,
      riskManagementTest: riskManagement >= 70,
      consistencyTest: consistency >= 60,
      executionTest: executionQuality >= 75,
      timeTest: timeInMockMode >= minimumTimeRequired,
      drawdownTest: performance.maxDrawdown <= 0.25, // Max 25% drawdown
    };

    // Determine recommendation
    let recommendation: ConfidenceMetrics["recommendation"] =
      "INSUFFICIENT_DATA";

    if (trades.length < 10) {
      recommendation = "INSUFFICIENT_DATA";
    } else if (
      overallScore >= requiredConfidence &&
      Object.values(readinessChecklist).every(Boolean)
    ) {
      recommendation = "READY_FOR_LIVE";
    } else if (overallScore >= 50 && riskManagement >= 60) {
      recommendation = "NEEDS_IMPROVEMENT";
    } else {
      recommendation = "HIGH_RISK";
    }

    return {
      overall: Math.round(overallScore),
      profitability: Math.round(profitability),
      consistency: Math.round(consistency),
      riskManagement: Math.round(riskManagement),
      executionQuality: Math.round(executionQuality),
      marketAdaptability: Math.round(marketAdaptability),
      timeStability: Math.round(timeStability),
      components,
      recommendation,
      requiredConfidence,
      timeInMockMode,
      minimumTimeRequired,
      readinessChecklist,
    };
  }

  // Private helper methods

  private createInitialPortfolio(balance: number): MockPortfolio {
    return {
      balance,
      equity: balance,
      availableBalance: balance,
      positions: [],
      totalUnrealizedPnL: 0,
      marginUsed: 0,
      marginLevel: 0,
      dayPnL: 0,
      totalPnL: 0,
    };
  }

  private createInitialPerformance(): MockSessionPerformance {
    return {
      winRate: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      averageWin: 0,
      averageLoss: 0,
      totalReturn: 0,
      volatility: 0,
      confidenceScore: 0,
      riskAdjustedReturn: 0,
      consistencyScore: 0,
      stabilityIndex: 0,
    };
  }

  private async startMarketDataMonitoring(
    sessionId: string,
    strategy: Strategy
  ): Promise<void> {
    const symbol = strategy.parameters.pair;

    // Subscribe to live market data updates
    const callback = (data: MarketData) => {
      this.processMarketDataUpdate(sessionId, strategy, data);
    };

    this.priceSubscriptions.set(`${sessionId}_${symbol}`, callback);

    // Start receiving live data (would integrate with WebSocket service)
    // For now, simulate with periodic API calls
    this.startMarketDataSimulation(sessionId, strategy);
  }

  private async startMarketDataSimulation(
    sessionId: string,
    strategy: Strategy
  ): Promise<void> {
    const symbol = strategy.parameters.pair;

    const updateInterval = setInterval(async () => {
      const session = this.activeSessions.get(sessionId);
      if (!session || !session.isActive) {
        clearInterval(updateInterval);
        return;
      }

      try {
        // Get latest market data
        const marketDataArray = await poloniexApi.getMarketData(symbol);

        if (marketDataArray && marketDataArray.length > 0) {
          // Convert the market data format and use the latest candle
          const latestCandle = marketDataArray[marketDataArray.length - 1];
          const latestData = {
            pair: symbol,
            timestamp: Date.now(),
            open: parseFloat(latestCandle[1]),
            high: parseFloat(latestCandle[2]),
            low: parseFloat(latestCandle[3]),
            close: parseFloat(latestCandle[4]),
            volume: parseFloat(latestCandle[5]),
          };

          this.processMarketDataUpdate(sessionId, strategy, latestData);
        }
      } catch {
        // Continue trying
      }
    }, 5000); // Update every 5 seconds
  }

  private async processMarketDataUpdate(
    sessionId: string,
    strategy: Strategy,
    marketData: MarketData
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    // Update market data cache
    const symbol = strategy.parameters.pair;
    const cache = this.marketDataCache.get(symbol) || [];
    cache.push(marketData);

    // Keep last 200 data points
    if (cache.length > 200) {
      cache.shift();
    }

    this.marketDataCache.set(symbol, cache);

    // Generate trading signal
    const signal = executeStrategy(strategy, cache);

    // Execute trade if signal is generated
    if (signal.signal) {
      await this.executeMockTrade(sessionId, signal, marketData);
    }

    // Update portfolio with current prices
    this.updatePortfolioWithCurrentPrices(session, marketData);
  }

  private calculatePositionSize(session: MockTradingSession): number {
    // Use 2% risk per trade
    const riskPercent = 0.02;
    return (session.portfolio.availableBalance * riskPercent) / 100;
  }

  private simulateExecutionLatency(): number {
    // Simulate realistic execution latency (50-200ms)
    return Math.random() * 150 + 50;
  }

  private simulateSlippage(marketData: MarketData, amount: number): number {
    // Simulate slippage based on market conditions and order size
    const baseSlippage = 0.001; // 0.1%
    const volumeImpact = Math.min(
      0.005,
      (amount / (marketData.volume || 1000000)) * 0.1
    );
    const volatilityImpact =
      ((marketData.high - marketData.low) / marketData.close) * 0.01;

    return baseSlippage + volumeImpact + volatilityImpact;
  }

  private calculateExecutionPrice(
    price: number,
    side: "BUY" | "SELL",
    slippage: number
  ): number {
    return side === "BUY" ? price * (1 + slippage) : price * (1 - slippage);
  }

  private calculateVolatility(marketData: MarketData): number {
    return (marketData.high - marketData.low) / marketData.close;
  }

  private calculateSpread(marketData: MarketData): number {
    // Estimate spread from high-low range
    return ((marketData.high - marketData.low) / marketData.close) * 0.1;
  }

  private calculateMomentum(marketData: MarketData): number {
    return (marketData.close - marketData.open) / marketData.open;
  }

  private updatePortfolio(
    session: MockTradingSession,
    trade: MockTrade,
    _marketData: MarketData
  ): void {
    // Update balance
    session.currentBalance = trade.balance;
    session.portfolio.balance = trade.balance;

    // Update trade counts
    if (trade.pnl > 0) {
      session.winningTrades++;
    } else if (trade.pnl < 0) {
      session.losingTrades++;
    }

    // Update total PnL
    session.portfolio.totalPnL += trade.pnl;
  }

  private updatePortfolioWithCurrentPrices(
    session: MockTradingSession,
    _marketData: MarketData
  ): void {
    // Update portfolio equity with current market prices
    session.portfolio.equity =
      session.portfolio.balance + session.portfolio.totalUnrealizedPnL;
  }

  private closeAllPositions(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Close all open positions (simplified for mock trading)
    session.portfolio.positions = [];
    session.portfolio.totalUnrealizedPnL = 0;
    session.portfolio.marginUsed = 0;
  }

  private calculateSessionPerformance(
    session: MockTradingSession
  ): MockSessionPerformance {
    const trades = session.trades;

    if (trades.length === 0) {
      return this.createInitialPerformance();
    }

    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl < 0);

    const winRate = winningTrades.length / trades.length;
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    const averageWin =
      winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const averageLoss =
      losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;

    const totalReturn =
      (session.currentBalance - session.initialBalance) /
      session.initialBalance;
    const returns = trades.map((t) => t.pnlPercent / 100);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
        returns.length
    );

    const sharpeRatio = volatility > 0 ? avgReturn / volatility : 0;
    const maxDrawdown = this.calculateMaxDrawdown(trades);
    const riskAdjustedReturn = volatility > 0 ? totalReturn / volatility : 0;
    const consistencyScore = this.calculateConsistencyScore(trades);
    const stabilityIndex = this.calculateStabilityIndex(session);

    return {
      winRate,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      averageWin,
      averageLoss,
      totalReturn,
      volatility,
      confidenceScore: 0, // Will be calculated separately
      riskAdjustedReturn,
      consistencyScore,
      stabilityIndex,
    };
  }

  // Scoring methods for confidence calculation
  private scoreWinRate(
    value: number,
    target: number
  ): { score: number; weight: number; value: number } {
    const score = Math.min(100, (value / target) * 100);
    return { score, weight: 0.15, value };
  }

  private scoreProfitFactor(
    value: number,
    target: number
  ): { score: number; weight: number; value: number } {
    const score = Math.min(100, (value / target) * 100);
    return { score, weight: 0.2, value };
  }

  private scoreSharpeRatio(
    value: number,
    target: number
  ): { score: number; weight: number; value: number } {
    const score = Math.min(100, Math.max(0, (value / target) * 100));
    return { score, weight: 0.18, value };
  }

  private scoreMaxDrawdown(
    value: number,
    target: number
  ): { score: number; weight: number; value: number } {
    const score = Math.min(100, Math.max(0, (1 - value / target) * 100));
    return { score, weight: 0.15, value };
  }

  private scoreConsistency(trades: MockTrade[]): {
    score: number;
    weight: number;
    value: number;
  } {
    const consistency = this.calculateConsistencyScore(trades);
    return { score: consistency * 100, weight: 0.12, value: consistency };
  }

  private scoreRiskAdjustedReturn(
    value: number,
    target: number
  ): { score: number; weight: number; value: number } {
    const score = Math.min(100, (value / target) * 100);
    return { score, weight: 0.1, value };
  }

  private scoreExecutionLatency(trades: MockTrade[]): {
    score: number;
    weight: number;
    value: number;
  } {
    const avgLatency =
      trades.reduce((sum, t) => sum + t.latency, 0) / trades.length;
    const score = Math.min(100, Math.max(0, ((200 - avgLatency) / 200) * 100)); // Target <200ms
    return { score, weight: 0.05, value: avgLatency };
  }

  private scoreSlippageControl(trades: MockTrade[]): {
    score: number;
    weight: number;
    value: number;
  } {
    const avgSlippage =
      trades.reduce((sum, t) => sum + t.slippage, 0) / trades.length;
    const score = Math.min(
      100,
      Math.max(0, ((0.005 - avgSlippage) / 0.005) * 100)
    ); // Target <0.5%
    return { score, weight: 0.05, value: avgSlippage };
  }

  private calculateMaxDrawdown(trades: MockTrade[]): number {
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

  private calculateConsistencyScore(trades: MockTrade[]): number {
    if (trades.length < 10) return 0;

    // Calculate rolling win rate consistency
    const windowSize = Math.max(5, Math.floor(trades.length / 4));
    const rollingWinRates: number[] = [];

    for (let i = windowSize; i <= trades.length; i++) {
      const window = trades.slice(i - windowSize, i);
      const winRate = window.filter((t) => t.pnl > 0).length / window.length;
      rollingWinRates.push(winRate);
    }

    // Calculate standard deviation of rolling win rates
    const avgWinRate =
      rollingWinRates.reduce((sum, wr) => sum + wr, 0) / rollingWinRates.length;
    const variance =
      rollingWinRates.reduce(
        (sum, wr) => sum + Math.pow(wr - avgWinRate, 2),
        0
      ) / rollingWinRates.length;
    const stdDev = Math.sqrt(variance);

    // Lower standard deviation = higher consistency
    return Math.max(0, 1 - stdDev * 2);
  }

  private calculateMarketAdaptability(trades: MockTrade[]): number {
    // Analyze performance across different market conditions
    if (trades.length < 20) return 0;

    const highVolatilityTrades = trades.filter(
      (t) => t.marketConditions.volatility > 0.03
    );
    const lowVolatilityTrades = trades.filter(
      (t) => t.marketConditions.volatility <= 0.03
    );

    const highVolPerformance =
      highVolatilityTrades.length > 0
        ? highVolatilityTrades.filter((t) => t.pnl > 0).length /
          highVolatilityTrades.length
        : 0;

    const lowVolPerformance =
      lowVolatilityTrades.length > 0
        ? lowVolatilityTrades.filter((t) => t.pnl > 0).length /
          lowVolatilityTrades.length
        : 0;

    // Good adaptability means consistent performance across market conditions
    const adaptability = 1 - Math.abs(highVolPerformance - lowVolPerformance);
    return Math.max(0, adaptability * 100);
  }

  private calculateTimeStability(session: MockTradingSession): number {
    const trades = session.trades;
    if (trades.length < 20) return 0;

    // Analyze performance stability over time
    const timeChunks = 4;
    const chunkSize = Math.floor(trades.length / timeChunks);
    const chunkPerformances: number[] = [];

    for (let i = 0; i < timeChunks; i++) {
      const start = i * chunkSize;
      const end = i === timeChunks - 1 ? trades.length : (i + 1) * chunkSize;
      const chunk = trades.slice(start, end);

      const winRate = chunk.filter((t) => t.pnl > 0).length / chunk.length;
      chunkPerformances.push(winRate);
    }

    // Calculate coefficient of variation
    const avgPerformance =
      chunkPerformances.reduce((sum, p) => sum + p, 0) /
      chunkPerformances.length;
    const variance =
      chunkPerformances.reduce(
        (sum, p) => sum + Math.pow(p - avgPerformance, 2),
        0
      ) / chunkPerformances.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation =
      avgPerformance > 0 ? stdDev / avgPerformance : 1;

    return Math.max(0, (1 - coefficientOfVariation) * 100);
  }

  private calculateStabilityIndex(session: MockTradingSession): number {
    // Combine various stability metrics
    const timeStability = this.calculateTimeStability(session);
    const consistencyScore = this.calculateConsistencyScore(session.trades);
    const adaptability = this.calculateMarketAdaptability(session.trades);

    return (
      (timeStability * 0.4 +
        consistencyScore * 100 * 0.4 +
        adaptability * 0.2) /
      100
    );
  }

  /**
   * Get aggregated confidence metrics across all sessions for a strategy
   */
  public getStrategyConfidenceAggregate(
    strategyId: string
  ): ConfidenceMetrics | null {
    const sessions = this.getStrategyMockSessions(strategyId);
    if (sessions.length === 0) return null;

    // Calculate weighted average confidence across all sessions
    let totalTrades = 0;
    let totalScore = 0;

    sessions.forEach((session) => {
      const confidence = this.calculateConfidenceScore(session);
      const weight = session.trades.length;
      totalTrades += weight;
      totalScore += confidence.overall * weight;
    });

    const avgConfidence = totalTrades > 0 ? totalScore / totalTrades : 0;

    // Use the most recent session's detailed breakdown
    const latestSession = sessions[sessions.length - 1];
    const latestConfidence = this.calculateConfidenceScore(latestSession);

    return {
      ...latestConfidence,
      overall: Math.round(avgConfidence),
    };
  }
}

export const mockTradingService = MockTradingService.getInstance();
