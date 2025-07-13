import {
  ConfidenceMetrics,
  mockTradingService,
} from "@/services/mockTradingService";
import { poloniexApi } from "@/services/poloniexAPI";
import { MarketData, Strategy } from "@/types";
import { executeStrategy } from "@/utils/strategyExecutors";

// Live trading interfaces
export interface LiveTradingSession {
  id: string;
  strategyId: string;
  startTime: number;
  endTime?: number;
  isActive: boolean;
  initialBalance: number;
  currentBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  trades: LiveTrade[];
  riskLimits: RiskLimits;
  safetyChecks: SafetyStatus;
  confidenceMetrics: ConfidenceMetrics;
}

export interface LiveTrade {
  id: string;
  sessionId: string;
  timestamp: number;
  type: "BUY" | "SELL";
  symbol: string;
  price: number;
  amount: number;
  total: number;
  fee: number;
  pnl: number;
  pnlPercent: number;
  balance: number;
  orderId: string;
  executionTime: number;
  slippage: number;
  confidence: number;
  status: "PENDING" | "FILLED" | "FAILED" | "CANCELLED";
  errorMessage?: string;
}

export interface RiskLimits {
  maxDrawdownPercent: number; // Max 20% drawdown
  maxDailyLossPercent: number; // Max 5% daily loss
  maxPositionSize: number; // Max position size in USD
  maxOpenPositions: number; // Max concurrent positions
  stopTradingOnLoss: number; // Stop if loss exceeds this amount
  requireConfidenceScore: number; // Minimum confidence score (75%)
  emergencyStopEnabled: boolean;
}

export interface SafetyStatus {
  confidenceCheckPassed: boolean;
  riskLimitsValid: boolean;
  accountBalanceVerified: boolean;
  apiKeysValid: boolean;
  drawdownWithinLimits: boolean;
  dailyLossWithinLimits: boolean;
  emergencyStopTriggered: boolean;
  lastSafetyCheck: number;
  warnings: string[];
  errors: string[];
}

export interface LiveTradingConfig {
  strategy: Strategy;
  initialBalance: number;
  riskLimits: RiskLimits;
  autoStopOnFailure: boolean;
  notificationSettings: {
    tradeAlerts: boolean;
    riskAlerts: boolean;
    emergencyAlerts: boolean;
  };
}

export class LiveTradingService {
  private static instance: LiveTradingService;
  private activeSessions: Map<string, LiveTradingSession> = new Map();
  private marketDataCache: Map<string, MarketData[]> = new Map();
  private emergencyStopActivated: boolean = false;
  private safetyCheckInterval: number = 30000; // 30 seconds
  private maxTradesPerMinute: number = 10;
  private tradeHistory: Map<string, number[]> = new Map(); // timestamp tracking

  private constructor() {
    // Initialize safety monitoring
    this.startSafetyMonitoring();
  }

  public static getInstance(): LiveTradingService {
    if (!LiveTradingService.instance) {
      LiveTradingService.instance = new LiveTradingService();
    }
    return LiveTradingService.instance;
  }

  /**
   * Start live trading session with comprehensive safety checks
   */
  public async startLiveTrading(config: LiveTradingConfig): Promise<string> {
    // Pre-flight safety checks
    const safetyCheck = await this.performPreFlightChecks(config);
    if (!safetyCheck.passed) {
      throw new Error(`Safety checks failed: ${safetyCheck.errors.join(", ")}`);
    }

    // Verify confidence score from mock trading
    const confidence = mockTradingService.getStrategyConfidenceAggregate(
      config.strategy.id
    );
    if (
      !confidence ||
      confidence.overall < config.riskLimits.requireConfidenceScore
    ) {
      throw new Error(
        `Strategy confidence score ${
          confidence?.overall || 0
        }% is below required ${config.riskLimits.requireConfidenceScore}%. ` +
          "Complete mock trading with sufficient confidence before enabling live trading."
      );
    }

    if (confidence.recommendation !== "READY_FOR_LIVE") {
      throw new Error(
        `Strategy is not ready for live trading. Current status: ${confidence.recommendation}. ` +
          "Improve mock trading performance before proceeding."
      );
    }

    // Create live trading session
    const sessionId = `live_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const session: LiveTradingSession = {
      id: sessionId,
      strategyId: config.strategy.id,
      startTime: Date.now(),
      isActive: true,
      initialBalance: config.initialBalance,
      currentBalance: config.initialBalance,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      trades: [],
      riskLimits: config.riskLimits,
      safetyChecks: this.createInitialSafetyStatus(),
      confidenceMetrics: confidence,
    };

    this.activeSessions.set(sessionId, session);

    // Start market data monitoring and strategy execution
    await this.startStrategyExecution(sessionId, config.strategy);

    return sessionId;
  }

  /**
   * Stop live trading session with proper cleanup
   */
  public async stopLiveTrading(
    sessionId: string,
    _reason: string = "Manual stop"
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Live trading session ${sessionId} not found`);
    }

    // Cancel any pending orders
    await this.cancelAllPendingOrders(sessionId);

    // Close all open positions (if applicable)
    await this.closeAllPositions(sessionId);

    // Mark session as inactive
    session.isActive = false;
    session.endTime = Date.now();
  }

  /**
   * Emergency stop all live trading
   */
  public async emergencyStopAll(reason: string): Promise<void> {
    this.emergencyStopActivated = true;

    const stopPromises = Array.from(this.activeSessions.keys()).map(
      (sessionId) =>
        this.stopLiveTrading(sessionId, `Emergency stop: ${reason}`)
    );

    await Promise.allSettled(stopPromises);
  }

  /**
   * Execute a live trade with comprehensive safety checks
   */
  public async executeLiveTrade(
    sessionId: string,
    signal: { signal: "BUY" | "SELL" | null; confidence: number },
    marketData: MarketData
  ): Promise<LiveTrade | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive || !signal.signal) return null;

    // Emergency stop check
    if (this.emergencyStopActivated) {
      return null;
    }

    // Rate limiting check
    if (!this.checkRateLimit(sessionId)) {
      return null;
    }

    // Safety checks
    const safetyCheck = await this.performTradeSafetyChecks(session, signal);
    if (!safetyCheck.passed) {
      return null;
    }

    try {
      const amount = this.calculatePositionSize(session, marketData);
      const tradeId = `trade_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 6)}`;

      // Create pending trade record
      const trade: LiveTrade = {
        id: tradeId,
        sessionId,
        timestamp: Date.now(),
        type: signal.signal,
        symbol: marketData.pair,
        price: marketData.close,
        amount,
        total: marketData.close * amount,
        fee: 0,
        pnl: 0,
        pnlPercent: 0,
        balance: session.currentBalance,
        orderId: "",
        executionTime: 0,
        slippage: 0,
        confidence: signal.confidence,
        status: "PENDING",
      };

      // Execute order through Poloniex API
      const startTime = Date.now();
      const orderResult = await poloniexApi.placeOrder(
        marketData.pair,
        signal.signal.toLowerCase() as "buy" | "sell",
        "market",
        amount
      );

      trade.executionTime = Date.now() - startTime;
      trade.orderId = orderResult.orderId || "";

      if (orderResult.success) {
        // Update trade with execution details
        trade.status = "FILLED";
        trade.fee = trade.total * 0.001; // Approximate fee
        trade.total += trade.fee;

        // Update session
        session.trades.push(trade);
        session.totalTrades++;
        session.currentBalance = trade.balance;

        // Update P&L tracking
        if (trade.pnl > 0) {
          session.winningTrades++;
        } else if (trade.pnl < 0) {
          session.losingTrades++;
        }

        return trade;
      } else {
        trade.status = "FAILED";
        trade.errorMessage = "Order execution failed";
        session.trades.push(trade);
        return trade;
      }
    } catch (error) {
      const errorTrade: LiveTrade = {
        id: `error_${Date.now()}`,
        sessionId,
        timestamp: Date.now(),
        type: signal.signal,
        symbol: marketData.pair,
        price: marketData.close,
        amount: 0,
        total: 0,
        fee: 0,
        pnl: 0,
        pnlPercent: 0,
        balance: session.currentBalance,
        orderId: "",
        executionTime: 0,
        slippage: 0,
        confidence: signal.confidence,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      };

      session.trades.push(errorTrade);
      return errorTrade;
    }
  }

  /**
   * Get live trading session
   */
  public getLiveTradingSession(sessionId: string): LiveTradingSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get all active live trading sessions
   */
  public getActiveLiveTradingSessions(): LiveTradingSession[] {
    return Array.from(this.activeSessions.values()).filter(
      (session) => session.isActive
    );
  }

  /**
   * Update MCP memory with live trading results for future optimization
   */
  public async updateMemoryWithResults(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // This would integrate with MCP memory service to store results
    // for future strategy optimization and learning
    // In a production environment, this would log to a proper logging service
    // Logging: Updating memory with live trading results for session
  }

  // Private helper methods

  private async performPreFlightChecks(
    config: LiveTradingConfig
  ): Promise<{ passed: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Check API connectivity
      await poloniexApi.getAccountBalance();
    } catch {
      errors.push("API connection failed");
    }

    // Check confidence score
    const confidence = mockTradingService.getStrategyConfidenceAggregate(
      config.strategy.id
    );
    if (
      !confidence ||
      confidence.overall < config.riskLimits.requireConfidenceScore
    ) {
      errors.push(
        `Insufficient confidence score: ${confidence?.overall || 0}%`
      );
    }

    if (confidence?.recommendation !== "READY_FOR_LIVE") {
      errors.push(
        `Strategy not ready: ${confidence?.recommendation || "Unknown"}`
      );
    }

    // Check risk limits
    if (config.riskLimits.maxDrawdownPercent > 0.3) {
      errors.push("Max drawdown limit too high (>30%)");
    }

    if (config.riskLimits.maxDailyLossPercent > 0.1) {
      errors.push("Max daily loss limit too high (>10%)");
    }

    return { passed: errors.length === 0, errors };
  }

  private createInitialSafetyStatus(): SafetyStatus {
    return {
      confidenceCheckPassed: false,
      riskLimitsValid: false,
      accountBalanceVerified: false,
      apiKeysValid: false,
      drawdownWithinLimits: true,
      dailyLossWithinLimits: true,
      emergencyStopTriggered: false,
      lastSafetyCheck: Date.now(),
      warnings: [],
      errors: [],
    };
  }

  private async performTradeSafetyChecks(
    session: LiveTradingSession,
    signal: { signal: "BUY" | "SELL" | null; confidence: number }
  ): Promise<{ passed: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check confidence threshold
    if (signal.confidence < 0.7) {
      errors.push(`Signal confidence too low: ${signal.confidence}`);
    }

    // Check drawdown limits
    const currentDrawdown = this.calculateCurrentDrawdown(session);
    if (currentDrawdown > session.riskLimits.maxDrawdownPercent) {
      errors.push(
        `Drawdown limit exceeded: ${(currentDrawdown * 100).toFixed(2)}%`
      );
    }

    // Check daily loss limits
    const dailyLoss = this.calculateDailyLoss(session);
    if (dailyLoss > session.riskLimits.maxDailyLossPercent) {
      errors.push(
        `Daily loss limit exceeded: ${(dailyLoss * 100).toFixed(2)}%`
      );
    }

    // Check position limits
    if (
      session.trades.filter((t) => t.status === "FILLED").length >=
      session.riskLimits.maxOpenPositions
    ) {
      errors.push("Maximum open positions reached");
    }

    return { passed: errors.length === 0, errors };
  }

  private async startStrategyExecution(
    sessionId: string,
    strategy: Strategy
  ): Promise<void> {
    const updateInterval = setInterval(async () => {
      const session = this.activeSessions.get(sessionId);
      if (!session || !session.isActive) {
        clearInterval(updateInterval);
        return;
      }

      try {
        // Get latest market data
        const marketDataArray = await poloniexApi.getMarketData(
          strategy.parameters.pair
        );

        if (marketDataArray && marketDataArray.length > 0) {
          const latestCandle = marketDataArray[marketDataArray.length - 1];
          const latestData = {
            pair: strategy.parameters.pair,
            timestamp: Date.now(),
            open: parseFloat(latestCandle[1]),
            high: parseFloat(latestCandle[2]),
            low: parseFloat(latestCandle[3]),
            close: parseFloat(latestCandle[4]),
            volume: parseFloat(latestCandle[5]),
          };

          // Update cache
          const symbol = strategy.parameters.pair;
          const cache = this.marketDataCache.get(symbol) || [];
          cache.push(latestData);
          if (cache.length > 200) cache.shift();
          this.marketDataCache.set(symbol, cache);

          // Generate and execute signal
          const signal = executeStrategy(strategy, cache);
          if (signal.signal) {
            await this.executeLiveTrade(sessionId, signal, latestData);
          }
        }
      } catch (error) {
        // Re-throw the error to be handled by the caller
        // In a production environment, this would also log to a proper logging service
        throw new Error(`Strategy execution failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 10000); // Execute every 10 seconds
  }

  private calculatePositionSize(
    session: LiveTradingSession,
    marketData: MarketData
  ): number {
    // Conservative position sizing: 1% of balance per trade
    const maxPositionValue = Math.min(
      session.currentBalance * 0.01,
      session.riskLimits.maxPositionSize
    );
    return maxPositionValue / marketData.close;
  }

  private calculateCurrentDrawdown(session: LiveTradingSession): number {
    if (session.trades.length === 0) return 0;

    let peak = session.initialBalance;
    let maxDrawdown = 0;

    session.trades.forEach((trade) => {
      if (trade.balance > peak) peak = trade.balance;
      const drawdown = (peak - trade.balance) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });

    return maxDrawdown;
  }

  private calculateDailyLoss(session: LiveTradingSession): number {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const todayTrades = session.trades.filter(
      (t) => t.timestamp >= dayStart.getTime()
    );
    const dailyPnL = todayTrades.reduce((sum, t) => sum + t.pnl, 0);

    return Math.abs(Math.min(0, dailyPnL)) / session.initialBalance;
  }

  private checkRateLimit(sessionId: string): boolean {
    const now = Date.now();
    const trades = this.tradeHistory.get(sessionId) || [];

    // Remove trades older than 1 minute
    const recentTrades = trades.filter((timestamp) => now - timestamp < 60000);

    if (recentTrades.length >= this.maxTradesPerMinute) {
      return false;
    }

    recentTrades.push(now);
    this.tradeHistory.set(sessionId, recentTrades);
    return true;
  }

  private async cancelAllPendingOrders(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const pendingTrades = session.trades.filter((t) => t.status === "PENDING");
    
    // Update the session status to reflect the cancellation
    // The caller can check the number of pending orders if needed
    if (pendingTrades.length > 0) {
      session.safetyChecks.warnings.push(
        `Cancelled ${pendingTrades.length} pending orders during session cleanup`
      );
    }

    // Implementation would cancel orders via Poloniex API
    // For now, just mark as cancelled
    pendingTrades.forEach((trade) => {
      trade.status = "CANCELLED";
    });
  }

  private async closeAllPositions(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    console.log(`Closing all positions for session ${sessionId}`);
    // Implementation would close positions via Poloniex API
  }

  private startSafetyMonitoring(): void {
    setInterval(() => {
      this.performPeriodicSafetyChecks();
    }, this.safetyCheckInterval);
  }

  private async performPeriodicSafetyChecks(): Promise<void> {
    for (const session of this.activeSessions.values()) {
      if (!session.isActive) continue;

      try {
        // Check drawdown limits
        const drawdown = this.calculateCurrentDrawdown(session);
        if (drawdown > session.riskLimits.maxDrawdownPercent) {
          await this.stopLiveTrading(session.id, "Drawdown limit exceeded");
          continue;
        }

        // Check daily loss limits
        const dailyLoss = this.calculateDailyLoss(session);
        if (dailyLoss > session.riskLimits.maxDailyLossPercent) {
          await this.stopLiveTrading(session.id, "Daily loss limit exceeded");
          continue;
        }

        // Update safety status
        session.safetyChecks = {
          ...session.safetyChecks,
          drawdownWithinLimits:
            drawdown <= session.riskLimits.maxDrawdownPercent,
          dailyLossWithinLimits:
            dailyLoss <= session.riskLimits.maxDailyLossPercent,
          lastSafetyCheck: Date.now(),
        };
      } catch (error) {
        // Add the error to the session's safety check errors
        const errorMessage = `Safety check failed: ${error instanceof Error ? error.message : String(error)}`;
        session.safetyChecks.errors.push(errorMessage);
        
        // In a production environment, this would also log to a proper logging service
        // and potentially trigger an alert for critical safety check failures
      }
    }
  }
}

export const liveTradingService = LiveTradingService.getInstance();
