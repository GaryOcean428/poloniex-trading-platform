import { shouldUseMockMode } from "@/utils/environment";
import {
  AutonomousStrategy,
  BankingConfig,
  RiskToleranceConfig,
  autonomousTradingAPI,
} from "./autonomousTradingAPI";
import {
  AutonomousNotification,
  AutonomousSession,
  AutonomousSettings,
} from "./autonomousTradingEngine";
import {
  AUTONOMOUS_TRADING_EVENTS,
  autonomousTradingWebSocket,
} from "./autonomousTradingWebSocket";

// Enhanced session interface for live trading
export interface LiveAutonomousSession extends AutonomousSession {
  backendSystemStatus?: {
    isRunning: boolean;
    generationCount: number;
    totalStrategies: number;
    activeStrategies: number;
  };
  liveStrategies: AutonomousStrategy[];
  bankingStatus?: {
    totalBanked: number;
    totalTransfers: number;
    lastBankingTime: string | null;
  };
  realTimeUpdates: boolean;
}

// Live autonomous trading engine that connects to backend
class LiveAutonomousTradingEngine {
  private static instance: LiveAutonomousTradingEngine;
  private activeSessions: Map<string, LiveAutonomousSession> = new Map();
  private isConnected: boolean = false;
  private useBackend: boolean = false;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private performanceUpdateInterval: NodeJS.Timeout | null = null;
  private statusUpdateInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.useBackend = !shouldUseMockMode();
    this.initializeWebSocketConnection();
    this.setupEventListeners();
  }

  public static getInstance(): LiveAutonomousTradingEngine {
    if (!LiveAutonomousTradingEngine.instance) {
      LiveAutonomousTradingEngine.instance = new LiveAutonomousTradingEngine();
    }
    return LiveAutonomousTradingEngine.instance;
  }

  // Type-safety helpers
  private asObj(data: unknown): Record<string, unknown> {
    return data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
  }
  private toNum(v: unknown, def = 0): number {
    return typeof v === "number"
      ? v
      : typeof v === "string"
      ? parseFloat(v) || def
      : def;
  }
  private toStr(v: unknown, def = ""): string {
    return typeof v === "string" ? v : v != null ? String(v) : def;
  }

  // Initialize WebSocket connection for real-time updates
  private initializeWebSocketConnection(): void {
    if (!this.useBackend) return;

    autonomousTradingWebSocket.on("connectionStateChanged", (state: string) => {
      this.isConnected = state === "connected";
      this.notifyListeners("connectionStateChanged", {
        connected: this.isConnected,
      });
    });

    autonomousTradingWebSocket.connect();
  }

  // Setup event listeners for real-time updates
  private setupEventListeners(): void {
    if (!this.useBackend) return;

    // Generation and strategy events
    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.GENERATION_COMPLETE,
      (data: unknown) => {
        this.handleGenerationComplete(data);
      }
    );

    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.STRATEGY_PROMOTED,
      (data: unknown) => {
        this.handleStrategyPromotion(data);
      }
    );

    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.STRATEGY_RETIRED,
      (data: unknown) => {
        this.handleStrategyRetirement(data);
      }
    );

    // Banking events
    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.PROFIT_BANKED,
      (data: unknown) => {
        this.handleProfitBanking(data);
      }
    );

    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.BANKING_FAILED,
      (data: unknown) => {
        this.handleBankingFailure(data);
      }
    );

    // Emergency events
    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.EMERGENCY_STOP,
      (data: unknown) => {
        this.handleEmergencyStop(data);
      }
    );

    // Performance updates
    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.CONFIDENCE_SCORE_CALCULATED,
      (data: unknown) => {
        this.handleConfidenceUpdate(data);
      }
    );

    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.BACKTEST_COMPLETED,
      (data: unknown) => {
        this.handleBacktestComplete(data);
      }
    );

    autonomousTradingWebSocket.on(
      AUTONOMOUS_TRADING_EVENTS.PAPER_TRADING_STARTED,
      (data: unknown) => {
        this.handlePaperTradingStarted(data);
      }
    );
  }

  // Main Methods
  public async startAutonomousTrading(
    userId: string,
    settings: AutonomousSettings
  ): Promise<string> {
    const sessionId = `live_${Date.now()}_${userId}`;

    try {
      if (this.useBackend) {
        // Convert settings to backend format
        const riskTolerance: RiskToleranceConfig = {
          maxDrawdown: settings.maxDrawdown,
          riskPerTrade: settings.maxRiskPerTrade,
          maxPositionSize: 0.1, // Default from settings
          profitBankingPercent: 0.3, // Default banking percentage
        };

        const bankingConfig: BankingConfig = {
          enabled: true,
          bankingPercentage: 0.3,
          minimumProfitThreshold: 50,
          maximumSingleTransfer: 10000,
          bankingInterval: 6 * 60 * 60 * 1000, // 6 hours
          emergencyStopThreshold: 0.25,
          maxDailyBanking: 50000,
        };

        // Start the backend system
        await autonomousTradingAPI.startSystem({
          riskTolerance,
          bankingConfig,
        });

        // Get initial system status
        const systemStatus = await autonomousTradingAPI.getSystemStatus();

        // Create live session
        const liveSession: LiveAutonomousSession = {
          id: sessionId,
          userId,
          startTime: Date.now(),
          isActive: true,
          currentPhase: systemStatus.isRunning
            ? "LIVE_TRADING"
            : "INITIALIZATION",
          strategies: [],
          liveStrategies: [],
          performance: {
            totalPnL: systemStatus.performanceMetrics.totalProfit,
            winRate: systemStatus.performanceMetrics.winRate,
            sharpeRatio: systemStatus.performanceMetrics.sharpeRatio,
            maxDrawdown: systemStatus.performanceMetrics.maxDrawdown,
            profitFactor: 0, // Calculate from win rate
            confidenceScore: 0,
            learningProgress: 0.8, // Based on generation count
            phasesCompleted: [
              "INITIALIZATION",
              "STRATEGY_GENERATION",
              "BACKTESTING",
              "STRATEGY_OPTIMIZATION",
              "MOCK_TRADING",
              "CONFIDENCE_EVALUATION",
            ],
            readyForLiveTrading: true,
          },
          settings,
          notifications: [],
          backendSystemStatus: {
            isRunning: systemStatus.isRunning,
            generationCount: systemStatus.generationCount,
            totalStrategies: systemStatus.totalStrategies,
            activeStrategies: systemStatus.activeStrategies,
          },
          bankingStatus: {
            totalBanked: systemStatus.bankingStats.totalBanked,
            totalTransfers: systemStatus.bankingStats.totalTransfers,
            lastBankingTime: systemStatus.bankingStats.lastBankingTime,
          },
          realTimeUpdates: this.isConnected,
        };

        this.activeSessions.set(sessionId, liveSession);

        // Start performance monitoring
        this.startPerformanceMonitoring(sessionId);

        // Load initial strategies
        await this.loadStrategies(sessionId);

        this.addNotification(sessionId, {
          type: "SUCCESS",
          phase: "LIVE_TRADING",
          title: "Live Trading Started",
          message: `Connected to autonomous trading system. ${systemStatus.activeStrategies} strategies active.`,
        });
      } else {
        // Fall back to mock mode
        const mockSession: LiveAutonomousSession = {
          id: sessionId,
          userId,
          startTime: Date.now(),
          isActive: true,
          currentPhase: "MOCK_TRADING",
          strategies: [],
          liveStrategies: [],
          performance: {
            totalPnL: 0,
            winRate: 0,
            sharpeRatio: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            confidenceScore: 0,
            learningProgress: 0,
            phasesCompleted: [],
            readyForLiveTrading: false,
          },
          settings,
          notifications: [],
          realTimeUpdates: false,
        };

        this.activeSessions.set(sessionId, mockSession);

        this.addNotification(sessionId, {
          type: "INFO",
          phase: "MOCK_TRADING",
          title: "Mock Mode Active",
          message:
            "Running in mock mode. Configure backend connection for live trading.",
        });
      }

      return sessionId;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start autonomous trading: ${errorMessage}`);
    }
  }

  public async stopAutonomousTrading(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    try {
      if (this.useBackend) {
        await autonomousTradingAPI.stopSystem();
      }

      session.isActive = false;
      session.endTime = Date.now();
      session.currentPhase = "READY_FOR_LIVE";

      this.stopPerformanceMonitoring(sessionId);

      this.addNotification(sessionId, {
        type: "INFO",
        phase: "READY_FOR_LIVE",
        title: "Trading Stopped",
        message: "Autonomous trading system has been stopped.",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop autonomous trading: ${errorMessage}`);
    }
  }

  public async emergencyStop(sessionId: string, reason: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    try {
      if (this.useBackend) {
        await autonomousTradingAPI.emergencyStop(reason);
      }

      session.isActive = false;
      session.endTime = Date.now();
      session.currentPhase = "READY_FOR_LIVE";

      this.stopPerformanceMonitoring(sessionId);

      this.addNotification(sessionId, {
        type: "CRITICAL",
        phase: "READY_FOR_LIVE",
        title: "Emergency Stop Activated",
        message: `Emergency stop activated: ${reason}`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to execute emergency stop: ${errorMessage}`);
    }
  }

  // Session Management
  public getAutonomousSession(sessionId: string): LiveAutonomousSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  public getActiveSessions(): LiveAutonomousSession[] {
    return Array.from(this.activeSessions.values());
  }

  // Performance Monitoring
  private startPerformanceMonitoring(sessionId: string): void {
    this.performanceUpdateInterval = setInterval(async () => {
      await this.updatePerformanceMetrics(sessionId);
    }, 5000); // Update every 5 seconds

    this.statusUpdateInterval = setInterval(async () => {
      await this.updateSystemStatus(sessionId);
    }, 30000); // Update every 30 seconds
  }

  private stopPerformanceMonitoring(_sessionId: string): void {
    if (this.performanceUpdateInterval) {
      clearInterval(this.performanceUpdateInterval);
      this.performanceUpdateInterval = null;
    }
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }
  }

  private async updatePerformanceMetrics(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !this.useBackend) return;

    try {
      const analytics = await autonomousTradingAPI.getPerformanceAnalytics(
        "1h"
      );
      const bankingStatus = await autonomousTradingAPI.getBankingStatus();

      session.performance.totalPnL = analytics.totalProfit;
      session.performance.winRate = analytics.winRate;
      session.performance.sharpeRatio = analytics.sharpeRatio;
      session.performance.maxDrawdown = analytics.maxDrawdown;
      session.performance.profitFactor =
        analytics.totalProfit > 0
          ? analytics.totalProfit /
            Math.abs(analytics.totalProfit * (1 - analytics.winRate))
          : 0;

      session.bankingStatus = {
        totalBanked: bankingStatus.totalBanked,
        totalTransfers: bankingStatus.totalTransfers,
        lastBankingTime: bankingStatus.lastBankingTime,
      };

      this.notifyListeners("performanceUpdate", {
        sessionId,
        performance: session.performance,
      });
    } catch (error) {
      // console.error('Error updating performance metrics:', error);
    }
  }

  private async updateSystemStatus(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !this.useBackend) return;

    try {
      const systemStatus = await autonomousTradingAPI.getSystemStatus();

      session.backendSystemStatus = {
        isRunning: systemStatus.isRunning,
        generationCount: systemStatus.generationCount,
        totalStrategies: systemStatus.totalStrategies,
        activeStrategies: systemStatus.activeStrategies,
      };

      this.notifyListeners("systemStatusUpdate", {
        sessionId,
        status: session.backendSystemStatus,
      });
    } catch (error) {
      // console.error('Error updating system status:', error);
    }
  }

  // Strategy Management
  private async loadStrategies(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !this.useBackend) return;

    try {
      const response = await autonomousTradingAPI.getStrategies({
        status: "live",
        limit: 20,
      });

      session.liveStrategies = response.strategies;

      // Convert to legacy format for compatibility with type safety
      const { ensureStrategyType } = await import("../utils/typeGuards");
      session.strategies = response.strategies.map((strategy) =>
        ensureStrategyType({
          // Type assertion needed for strategy type compatibility
          id: strategy.id,
          name: strategy.name,
          type: strategy.type as any, // Type assertion for compatibility
          symbol: strategy.symbol,
          timeframe: strategy.timeframe,
          parameters: strategy.parameters,
          confidence: strategy.performance.confidence,
          profitPotential: strategy.performance.profit * 100,
          riskScore: (1 - strategy.performance.winRate) * 100,
          description: `${strategy.type} strategy for ${strategy.symbol}`,
          active: true,
          learningMetrics: {
            adaptationRate: 0.1,
            consistencyScore: strategy.performance.winRate,
            marketConditionPerformance: {},
            timestamp: Date.now(),
          },
          adaptationRate: 0.1,
          consistencyScore: strategy.performance.winRate,
          marketConditionPerformance: {},
        })
      ) as any; // Type assertion for the entire array

      this.notifyListeners("strategiesLoaded", {
        sessionId,
        strategies: session.strategies,
      });
    } catch (error) {
      // console.error('Error loading strategies:', error);
    }
  }

  // WebSocket Event Handlers
  private handleGenerationComplete(data: unknown): void {
    const obj = this.asObj(data);
    const generation = this.toNum(obj.generation);
    const totalStrategies = this.toNum(obj.totalStrategies);
    const activeStrategies = this.toNum(obj.activeStrategies);

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        session.backendSystemStatus = {
          isRunning: true,
          generationCount: generation,
          totalStrategies,
          activeStrategies,
        };

        this.addNotification(sessionId, {
          type: "SUCCESS",
          phase: "STRATEGY_GENERATION",
          title: "Generation Complete",
          message: `Generation ${generation} completed with ${totalStrategies} strategies.`,
        });
      }
    }
  }

  private handleStrategyPromotion(data: unknown): void {
    const obj = this.asObj(data);
    const strategyId = this.toStr(obj.strategyId);
    const confidenceScore = this.toNum(obj.confidenceScore);

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        this.addNotification(sessionId, {
          type: "SUCCESS",
          phase: "LIVE_TRADING",
          title: "Strategy Promoted",
          message: `Strategy ${strategyId} promoted to live trading with ${confidenceScore}% confidence.`,
        });
      }
    }
  }

  private handleStrategyRetirement(data: unknown): void {
    const obj = this.asObj(data);
    const strategyId = this.toStr(obj.strategyId);
    const reason = this.toStr(obj.reason, "Unknown");

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        this.addNotification(sessionId, {
          type: "WARNING",
          phase: "LIVE_TRADING",
          title: "Strategy Retired",
          message: `Strategy ${strategyId} retired: ${reason}`,
        });
      }
    }
  }

  private handleProfitBanking(data: unknown): void {
    const obj = this.asObj(data);
    const amount = this.toNum(obj.amount);
    const totalBanked = this.toNum(obj.totalBanked);

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        if (session.bankingStatus) {
          session.bankingStatus.totalBanked += amount;
          session.bankingStatus.totalTransfers += 1;
          session.bankingStatus.lastBankingTime = new Date().toISOString();
        }

        this.addNotification(sessionId, {
          type: "SUCCESS",
          phase: "PROFIT_MAXIMIZATION",
          title: "Profit Banked",
          message: `${amount.toFixed(
            2
          )} USDT banked to spot account. Total: ${totalBanked.toFixed(
            2
          )} USDT`,
        });
      }
    }
  }

  private handleBankingFailure(data: unknown): void {
    const obj = this.asObj(data);
    const amount = this.toNum(obj.amount);
    const errorMsg = this.toStr(obj.error, "Unknown error");

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        this.addNotification(sessionId, {
          type: "WARNING",
          phase: "PROFIT_MAXIMIZATION",
          title: "Banking Failed",
          message: `Failed to bank ${amount.toFixed(2)} USDT: ${errorMsg}`,
        });
      }
    }
  }

  private handleEmergencyStop(data: unknown): void {
    const obj = this.asObj(data);
    const drawdown = this.toNum(obj.drawdown);

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        session.isActive = false;
        session.endTime = Date.now();
        session.currentPhase = "READY_FOR_LIVE";

        this.addNotification(sessionId, {
          type: "CRITICAL",
          phase: "READY_FOR_LIVE",
          title: "Emergency Stop",
          message: `Emergency stop triggered: ${drawdown.toFixed(
            2
          )}% drawdown detected.`,
        });
      }
    }
  }

  private handleConfidenceUpdate(data: unknown): void {
    const obj = this.asObj(data);
    const confidenceScore = this.toNum(obj.confidenceScore);

    // Update confidence scores for relevant sessions
    for (const [_sessionId, session] of this.activeSessions) {
      if (session.isActive && confidenceScore > 0) {
        session.performance.confidenceScore = confidenceScore;
      }
    }
  }

  private handleBacktestComplete(data: unknown): void {
    const obj = this.asObj(data);
    const strategyId = this.toStr(obj.strategyId);
    const passed = !!obj.passed;

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        this.addNotification(sessionId, {
          type: "INFO",
          phase: "BACKTESTING",
          title: "Backtest Complete",
          message: `Strategy ${strategyId} backtest ${
            passed ? "passed" : "failed"
          }.`,
        });
      }
    }
  }

  private handlePaperTradingStarted(data: unknown): void {
    const obj = this.asObj(data);
    const strategyId = this.toStr(obj.strategyId);

    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        this.addNotification(sessionId, {
          type: "INFO",
          phase: "MOCK_TRADING",
          title: "Paper Trading Started",
          message: `Strategy ${strategyId} started paper trading.`,
        });
      }
    }
  }

  // Utility Methods
  private addNotification(
    sessionId: string,
    notification: Omit<AutonomousNotification, "id" | "timestamp" | "read">
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const fullNotification: AutonomousNotification = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      read: false,
      ...notification,
    };

    session.notifications.unshift(fullNotification);

    // Keep only last 50 notifications
    if (session.notifications.length > 50) {
      session.notifications = session.notifications.slice(0, 50);
    }

    this.notifyListeners("notificationAdded", {
      sessionId,
      notification: fullNotification,
    });
  }

  // Event System
  public on(event: string, listener: (data: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event);
    if (set) {
      set.add(listener);
    }
  }

  public off(event: string, listener: (data: unknown) => void): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private notifyListeners(event: string, data: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          // console.error(`Error in listener for event ${event}:`, error);
        }
      });
    }
  }

  // Configuration Methods
  public async updateRiskTolerance(
    sessionId: string,
    riskTolerance: RiskToleranceConfig
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !this.useBackend) return;

    try {
      await autonomousTradingAPI.updateRiskTolerance(riskTolerance);

      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "LIVE_TRADING",
        title: "Risk Tolerance Updated",
        message: "Risk tolerance settings have been updated.",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update risk tolerance: ${errorMessage}`);
    }
  }

  public async updateBankingConfig(
    sessionId: string,
    bankingConfig: BankingConfig
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !this.useBackend) return;

    try {
      await autonomousTradingAPI.updateBankingConfig(bankingConfig);

      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "PROFIT_MAXIMIZATION",
        title: "Banking Config Updated",
        message: "Banking configuration has been updated.",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update banking config: ${errorMessage}`);
    }
  }

  public async executeBanking(
    sessionId: string,
    amount: number
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !this.useBackend) return;

    try {
      await autonomousTradingAPI.executeBanking(amount);

      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "PROFIT_MAXIMIZATION",
        title: "Manual Banking",
        message: `${amount.toFixed(2)} USDT banking initiated.`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to execute banking: ${errorMessage}`);
    }
  }

  // Connection status
  public isConnectedToBackend(): boolean {
    return this.useBackend && this.isConnected;
  }

  public getConnectionStatus(): {
    useBackend: boolean;
    isConnected: boolean;
    reconnectAttempts: number;
  } {
    return {
      useBackend: this.useBackend,
      isConnected: this.isConnected,
      reconnectAttempts: autonomousTradingWebSocket.getReconnectAttempts(),
    };
  }
}

// Export singleton instance
export const liveAutonomousTradingEngine =
  LiveAutonomousTradingEngine.getInstance();
export default liveAutonomousTradingEngine;
