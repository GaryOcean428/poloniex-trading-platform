import { advancedBacktestService } from "@/services/advancedBacktestService";
import { liveTradingService } from "@/services/liveTradingService";
import { mockTradingService } from "@/services/mockTradingService";
import { Strategy, StrategyParameters, StrategyTypeUnion } from "@/types";
import { BacktestOptions, BacktestResult } from "@/types/backtest";

// Autonomous Engine Interfaces
export interface AutonomousSession {
  id: string;
  userId: string;
  startTime: number;
  endTime?: number;
  isActive: boolean;
  currentPhase: AutonomousPhase;
  strategies: EnhancedStrategy[];
  performance: AutonomousPerformance;
  settings: AutonomousSettings;
  notifications: AutonomousNotification[];
}

export interface EnhancedStrategy extends Strategy {
  confidence: number;
  profitPotential: number;
  riskScore: number;
  description: string;
  backtestResults?: BacktestResult;
  mockTradingSessionId?: string;
  liveTradingSessionId?: string;
  learningMetrics: LearningMetrics;
  // For backward compatibility with direct property access
  adaptationRate: number;
  consistencyScore: number;
  marketConditionPerformance: Record<string, number>;
}

export interface AutonomousPerformance {
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  confidenceScore: number;
  learningProgress: number;
  phasesCompleted: AutonomousPhase[];
  readyForLiveTrading: boolean;
}

export interface AutonomousSettings {
  initialBalance: number;
  maxRiskPerTrade: number; // 2%
  maxDrawdown: number; // 15%
  confidenceThreshold: number; // 75%
  profitTarget: number; // 20% monthly
  timeHorizon: number; // 30 days
  aggressiveness: "conservative" | "moderate" | "aggressive";
  autoProgressToLive: boolean;
  stopLossGlobal: number;
  takeProfitGlobal: number;
}

export interface AutonomousNotification {
  id: string;
  timestamp: number;
  type: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  phase: AutonomousPhase;
  title: string;
  message: string;
  action?: {
    label: string;
    callback: () => void;
  };
  read: boolean;
}

export type AutonomousPhase =
  | "INITIALIZATION"
  | "STRATEGY_GENERATION"
  | "BACKTESTING"
  | "STRATEGY_OPTIMIZATION"
  | "MOCK_TRADING"
  | "CONFIDENCE_EVALUATION"
  | "READY_FOR_LIVE"
  | "LIVE_TRADING"
  | "LEARNING_ADAPTATION"
  | "PROFIT_MAXIMIZATION";

// Strategy Generation Templates
const STRATEGY_TEMPLATES = [
  {
    name: "Adaptive MA Cross",
    type: "trend_following",
    baseConfig: {
      indicators: ["SMA", "EMA"],
      timeframes: ["1h", "4h"],
      riskLevel: "moderate",
    },
  },
  {
    name: "Mean Reversion RSI",
    type: "mean_reversion",
    baseConfig: {
      indicators: ["RSI", "BOLLINGER"],
      timeframes: ["15m", "1h"],
      riskLevel: "conservative",
    },
  },
  {
    name: "Momentum Breakout",
    type: "momentum",
    baseConfig: {
      indicators: ["MACD", "VOLUME"],
      timeframes: ["1h", "4h"],
      riskLevel: "aggressive",
    },
  },
  {
    name: "Multi-Timeframe Convergence",
    type: "convergence",
    baseConfig: {
      indicators: ["EMA", "RSI", "MACD"],
      timeframes: ["15m", "1h", "4h"],
      riskLevel: "moderate",
    },
  },
];

export class AutonomousTradingEngine {
  private static instance: AutonomousTradingEngine;
  private activeSessions: Map<string, AutonomousSession> = new Map();
  private learningDatabase: Map<string, MarketConditions | string[] | LearningMetrics> =
    new Map();
  private marketAnalyzer: MarketConditionAnalyzer;

  private constructor() {
    this.marketAnalyzer = new MarketConditionAnalyzer();
    this.startLearningLoop();
  }

  public static getInstance(): AutonomousTradingEngine {
    if (!AutonomousTradingEngine.instance) {
      AutonomousTradingEngine.instance = new AutonomousTradingEngine();
    }
    return AutonomousTradingEngine.instance;
  }

  /**
   * Start autonomous trading system for a user
   */
  public async startAutonomousTrading(
    userId: string,
    settings: AutonomousSettings
  ): Promise<string> {
    const sessionId = `auto_${userId}_${Date.now()}`;

    const session: AutonomousSession = {
      id: sessionId,
      userId,
      startTime: Date.now(),
      isActive: true,
      currentPhase: "INITIALIZATION",
      strategies: [],
      performance: this.createInitialPerformance(),
      settings,
      notifications: [],
    };

    this.activeSessions.set(sessionId, session);

    // Start the autonomous workflow
    this.runAutonomousWorkflow(sessionId);

    this.addNotification(sessionId, {
      type: "SUCCESS",
      phase: "INITIALIZATION",
      title: "Autonomous Trading Started",
      message:
        "Your autonomous trading system has been initialized and is beginning strategy generation.",
      action: {
        label: "View Progress",
        callback: () => this.getSessionProgress(sessionId),
      },
    });

    return sessionId;
  }

  /**
   * Get autonomous session status
   */
  public getAutonomousSession(sessionId: string): AutonomousSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Stop autonomous trading
   */
  public async stopAutonomousTrading(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.isActive = false;
    session.endTime = Date.now();

    // Stop any active trading sessions
    if (session.strategies.some((s) => s.liveTradingSessionId)) {
      await Promise.all(
        session.strategies
          .filter((s) => s.liveTradingSessionId)
          .map((s) =>
            liveTradingService.stopLiveTrading(
              s.liveTradingSessionId!,
              "Autonomous session stopped"
            )
          )
      );
    }

    this.addNotification(sessionId, {
      type: "INFO",
      phase: session.currentPhase,
      title: "Autonomous Trading Stopped",
      message: "Your autonomous trading session has been stopped successfully.",
    });
  }

  /**
   * Main autonomous workflow orchestrator
   */
  private async runAutonomousWorkflow(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    try {
      while (session.isActive) {
        switch (session.currentPhase) {
          case "INITIALIZATION":
            await this.initializeSystem(sessionId);
            break;
          case "STRATEGY_GENERATION":
            await this.generateOptimalStrategies(sessionId);
            break;
          case "BACKTESTING":
            await this.runComprehensiveBacktests(sessionId);
            break;
          case "STRATEGY_OPTIMIZATION":
            await this.optimizeStrategies(sessionId);
            break;
          case "MOCK_TRADING":
            await this.runMockTrading(sessionId);
            break;
          case "CONFIDENCE_EVALUATION":
            await this.evaluateConfidence(sessionId);
            break;
          case "READY_FOR_LIVE":
            await this.promptUserForLiveTrading(sessionId);
            break;
          case "LIVE_TRADING":
            await this.manageLiveTrading(sessionId);
            break;
          case "LEARNING_ADAPTATION":
            await this.adaptAndLearn(sessionId);
            break;
          case "PROFIT_MAXIMIZATION":
            await this.maximizeProfits(sessionId);
            break;
        }

        // Wait before next iteration
        await this.sleep(5000);
      }
    } catch (error) {
      this.addNotification(sessionId, {
        type: "CRITICAL",
        phase: session.currentPhase,
        title: "Workflow Error",
        message: `Error in ${session.currentPhase}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Phase 1: Initialize system and market analysis
   */
  private async initializeSystem(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "INITIALIZATION",
      title: "Analyzing Market Conditions",
      message:
        "Evaluating current market conditions and optimal trading pairs.",
    });

    // Analyze current market conditions
    const marketConditions = await this.marketAnalyzer.analyzeCurrentMarket();

    // Select optimal trading pairs based on volatility and volume
    const optimalPairs = await this.selectOptimalTradingPairs(marketConditions);

    // Store learning data
    this.learningDatabase.set(
      `${sessionId}_market_conditions`,
      marketConditions
    );
    this.learningDatabase.set(
      `${sessionId}_optimal_pairs`,
      optimalPairs
    );

    this.addNotification(sessionId, {
      type: "SUCCESS",
      phase: "INITIALIZATION",
      title: "Market Analysis Complete",
      message: `Identified ${optimalPairs.length} optimal trading pairs. Moving to strategy generation.`,
    });

    session.currentPhase = "STRATEGY_GENERATION";
  }

  /**
   * Phase 2: Generate multiple strategies optimized for current market
   */
  private async generateOptimalStrategies(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;
    const marketConditions = this.learningDatabase.get(
      `${sessionId}_market_conditions`
    ) as MarketConditions | undefined;
    const optimalPairs = this.learningDatabase.get(
      `${sessionId}_optimal_pairs`
    ) as string[] | undefined;

    if (!marketConditions || !optimalPairs) {
      throw new Error('Market conditions or optimal pairs not found in learning database');
    }

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "STRATEGY_GENERATION",
      title: "Generating Strategies",
      message:
        "Creating multiple optimized strategies for current market conditions.",
    });

    const strategies: EnhancedStrategy[] = [];

    // Generate strategies for each optimal pair
    if (optimalPairs && marketConditions) {
      for (const pair of optimalPairs) {
        for (const template of STRATEGY_TEMPLATES) {
          const strategy = await this.generateStrategyFromTemplate(
            template,
            pair,
            marketConditions,
            session.settings
          );
          strategies.push(strategy);
        }
      }

      // Score and rank strategies
      const rankedStrategies = await this.rankStrategiesByPotential(
        strategies,
        marketConditions
      );

      // Keep top 5 strategies
      session.strategies = rankedStrategies.slice(0, 5);
    }

    this.addNotification(sessionId, {
      type: "SUCCESS",
      phase: "STRATEGY_GENERATION",
      title: "Strategies Generated",
      message: `Created ${session.strategies.length} optimized strategies. Starting comprehensive backtesting.`,
    });

    session.currentPhase = "BACKTESTING";
  }

  /**
   * Phase 3: Run comprehensive backtests
   */
  private async runComprehensiveBacktests(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "BACKTESTING",
      title: "Running Backtests",
      message:
        "Testing strategies against historical data with advanced metrics.",
    });

    const backtestOptions: BacktestOptions = {
      startDate: this.getBacktestStartDate(session.settings.timeHorizon),
      endDate: new Date().toISOString(),
      initialBalance: session.settings.initialBalance,
      feeRate: 0.001,
      slippage: 0.001,
      useHistoricalData: true,
    };

    // Run backtests for each strategy
    for (let i = 0; i < session.strategies.length; i++) {
      const strategy = session.strategies[i];

      try {
        const result = await advancedBacktestService.runAdvancedBacktest(
          strategy,
          backtestOptions
        );

        strategy.backtestResults = result;
        strategy.confidence = this.calculateStrategyConfidence(result);
        strategy.profitPotential =
          result.totalPnL / backtestOptions.initialBalance;
        strategy.riskScore = result.maxDrawdown;

        this.addNotification(sessionId, {
          type: "INFO",
          phase: "BACKTESTING",
          title: `Strategy ${i + 1} Tested`,
          message: `${strategy.name}: ${(
            strategy.profitPotential * 100
          ).toFixed(2)}% return, ${(strategy.confidence * 100).toFixed(
            1
          )}% confidence`,
        });
      } catch (error) {
        const session = this.getSessionProgress(sessionId);
        if (session) {
          this.addNotification(sessionId, {
            type: 'CRITICAL',
            phase: session.currentPhase,
            title: 'Backtest Failed',
            message: `Backtest failed for strategy ${strategy.name}: ${error instanceof Error ? error.message : String(error)}`
          });
        }
        strategy.confidence = 0;
        strategy.profitPotential = 0;
        strategy.riskScore = 1;
      }
    }

    // Sort by combined score (profit potential + confidence - risk)
    session.strategies.sort((a, b) => {
      const scoreA =
        a.profitPotential * 0.4 + a.confidence * 0.4 - a.riskScore * 0.2;
      const scoreB =
        b.profitPotential * 0.4 + b.confidence * 0.4 - b.riskScore * 0.2;
      return scoreB - scoreA;
    });

    const topStrategy = session.strategies[0];
    this.addNotification(sessionId, {
      type: "SUCCESS",
      phase: "BACKTESTING",
      title: "Backtesting Complete",
      message: topStrategy
        ? `Best strategy: ${topStrategy.name} with ${(topStrategy.profitPotential * 100).toFixed(2)}% potential return.`
        : "No strategies passed backtesting.",
    });

    session.currentPhase = "STRATEGY_OPTIMIZATION";
  }

  /**
   * Phase 4: Optimize top strategies
   */
  private async optimizeStrategies(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "STRATEGY_OPTIMIZATION",
      title: "Optimizing Strategies",
      message: "Fine-tuning parameters for maximum profitability.",
    });

    // Optimize top 3 strategies
    const topStrategies = session.strategies.slice(0, 3);

    for (const strategy of topStrategies) {
      await this.optimizeStrategyParameters(strategy, session.settings);
    }

    this.addNotification(sessionId, {
      type: "SUCCESS",
      phase: "STRATEGY_OPTIMIZATION",
      title: "Optimization Complete",
      message: "Strategies have been optimized. Starting mock trading phase.",
    });

    session.currentPhase = "MOCK_TRADING";
  }

  /**
   * Phase 5: Run mock trading with real market data
   */
  private async runMockTrading(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "MOCK_TRADING",
      title: "Starting Mock Trading",
      message: "Testing strategies with real market data and live prices.",
    });

    // Start mock trading for best strategy
    const bestStrategy = session.strategies[0];
    if (!bestStrategy) {
      this.addNotification(sessionId, {
        type: "WARNING",
        phase: "MOCK_TRADING",
        title: "No Strategy Available",
        message:
          "No strategies available to start mock trading. Regenerating strategies.",
      });
      session.currentPhase = "STRATEGY_GENERATION";
      return;
    }

    try {
      const mockSessionId = await mockTradingService.startMockSession(
        bestStrategy,
        session.settings.initialBalance
      );

      bestStrategy.mockTradingSessionId = mockSessionId;

      // Let it run for a period to gather confidence data
      const mockDuration = this.calculateMockTradingDuration(
        session.settings.aggressiveness
      );

      this.addNotification(sessionId, {
        type: "INFO",
        phase: "MOCK_TRADING",
        title: "Mock Trading Active",
        message: `Strategy is trading with mock funds. Will evaluate confidence after ${
          mockDuration / (1000 * 60 * 60)
        } hours.`,
      });

      // Wait for mock trading to gather sufficient data
      setTimeout(() => {
        if (session.isActive) {
          session.currentPhase = "CONFIDENCE_EVALUATION";
        }
      }, mockDuration);
    } catch {
      this.addNotification(sessionId, {
        type: "WARNING",
        phase: "MOCK_TRADING",
        title: "Mock Trading Issue",
        message:
          "Failed to start mock trading. Retrying with next best strategy.",
      });
    }
  }

  /**
   * Phase 6: Evaluate confidence and readiness
   */
  private async evaluateConfidence(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;
    const bestStrategy = session.strategies[0];
    if (!bestStrategy) {
      this.addNotification(sessionId, {
        type: "WARNING",
        phase: "CONFIDENCE_EVALUATION",
        title: "No Strategy to Evaluate",
        message: "No strategy available for confidence evaluation. Returning to generation phase.",
      });
      session.currentPhase = "STRATEGY_GENERATION";
      return;
    }

    if (!bestStrategy.mockTradingSessionId) {
      session.currentPhase = "MOCK_TRADING";
      return;
    }

    const mockSession = mockTradingService.getMockSession(
      bestStrategy.mockTradingSessionId
    );
    if (!mockSession) {
      session.currentPhase = "MOCK_TRADING";
      return;
    }

    const confidence = mockTradingService.calculateConfidenceScore(mockSession);

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "CONFIDENCE_EVALUATION",
      title: "Evaluating Performance",
      message: `Confidence Score: ${confidence.overall}% | Recommendation: ${confidence.recommendation}`,
    });

    // Update session performance
    session.performance.confidenceScore = confidence.overall;
    session.performance.readyForLiveTrading =
      confidence.recommendation === "READY_FOR_LIVE";

    if (
      confidence.overall >= session.settings.confidenceThreshold &&
      confidence.recommendation === "READY_FOR_LIVE"
    ) {
      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "CONFIDENCE_EVALUATION",
        title: "Ready for Live Trading!",
        message: `Strategy achieved ${confidence.overall}% confidence score. Ready to start live trading with real funds.`,
        action: {
          label: "Start Live Trading",
          callback: () => this.initiateLiveTrading(sessionId),
        },
      });

      session.currentPhase = "READY_FOR_LIVE";
    } else {
      this.addNotification(sessionId, {
        type: "WARNING",
        phase: "CONFIDENCE_EVALUATION",
        title: "More Training Needed",
        message: `Confidence score: ${confidence.overall}%. Continuing mock trading to improve performance.`,
      });

      // Continue mock trading
      session.currentPhase = "MOCK_TRADING";
    }
  }

  /**
   * Phase 7: Prompt user for live trading approval
   */
  private async promptUserForLiveTrading(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    if (session.settings.autoProgressToLive) {
      await this.initiateLiveTrading(sessionId);
    } else {
      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "READY_FOR_LIVE",
        title: "Awaiting User Approval",
        message:
          "Strategy is ready for live trading. Please approve to start trading with real funds.",
        action: {
          label: "Approve Live Trading",
          callback: () => this.initiateLiveTrading(sessionId),
        },
      });
    }
  }

  /**
   * Phase 8: Manage live trading
   */
  private async manageLiveTrading(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;
    const bestStrategy = session.strategies[0];
    if (!bestStrategy) {
      this.addNotification(sessionId, {
        type: "WARNING",
        phase: "LIVE_TRADING",
        title: "No Active Strategy",
        message: "No strategy available for live trading. Regenerating strategies.",
      });
      session.currentPhase = "STRATEGY_GENERATION";
      return;
    }

    if (!bestStrategy.liveTradingSessionId) {
      await this.initiateLiveTrading(sessionId);
      return;
    }

    const liveSession = liveTradingService.getLiveTradingSession(
      bestStrategy.liveTradingSessionId
    );
    if (!liveSession || !liveSession.isActive) {
      session.currentPhase = "LEARNING_ADAPTATION";
      return;
    }

    // Monitor performance and safety
    const currentPerformance = this.calculateCurrentPerformance(liveSession);

    // Check if targets are met or stop losses triggered
    if (currentPerformance.totalReturn >= session.settings.profitTarget) {
      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "LIVE_TRADING",
        title: "Profit Target Achieved!",
        message: `Achieved ${(currentPerformance.totalReturn * 100).toFixed(
          2
        )}% return. Moving to profit maximization mode.`,
      });
      session.currentPhase = "PROFIT_MAXIMIZATION";
    } else if (currentPerformance.drawdown >= session.settings.maxDrawdown) {
      await liveTradingService.stopLiveTrading(
        bestStrategy.liveTradingSessionId,
        "Maximum drawdown reached"
      );
      session.currentPhase = "LEARNING_ADAPTATION";
    } else {
      // Continue monitoring
      session.performance = this.updatePerformance(
        session.performance,
        currentPerformance
      );
    }
  }

  /**
   * Phase 9: Continuous learning and adaptation
   */
  private async adaptAndLearn(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    this.addNotification(sessionId, {
      type: "INFO",
      phase: "LEARNING_ADAPTATION",
      title: "Learning from Results",
      message: "Analyzing performance data to improve future strategies.",
    });

    // Analyze what worked and what didn't
    await this.analyzePerformanceData(sessionId);

    // Update learning database
    await this.updateLearningDatabase(sessionId);

    // Generate improved strategies
    session.currentPhase = "STRATEGY_GENERATION";
  }

  /**
   * Phase 10: Maximize profits with proven strategies
   */
  private async maximizeProfits(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;

    this.addNotification(sessionId, {
      type: "SUCCESS",
      phase: "PROFIT_MAXIMIZATION",
      title: "Profit Maximization Mode",
      message: "Scaling successful strategies for maximum returns.",
    });

    // Scale position sizes, optimize timing, compound profits
    await this.optimizeForProfitMaximization(sessionId);

    // Continue with enhanced live trading
    session.currentPhase = "LIVE_TRADING";
  }

  // Helper methods
  private async initiateLiveTrading(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)!;
    const bestStrategy = session.strategies[0];
    if (!bestStrategy) {
      this.addNotification(sessionId, {
        type: "CRITICAL",
        phase: "READY_FOR_LIVE",
        title: "Live Trading Not Possible",
        message: "No strategy found to initiate live trading.",
      });
      return;
    }

    try {
      const liveTradingSessionId = await liveTradingService.startLiveTrading({
        strategy: bestStrategy,
        initialBalance: session.settings.initialBalance,
        riskLimits: {
          maxDrawdownPercent: session.settings.maxDrawdown,
          maxDailyLossPercent: 0.05,
          maxPositionSize: session.settings.initialBalance * 0.1,
          maxOpenPositions: 3,
          stopTradingOnLoss: session.settings.initialBalance * 0.2,
          requireConfidenceScore: session.settings.confidenceThreshold,
          emergencyStopEnabled: true,
        },
        autoStopOnFailure: true,
        notificationSettings: {
          tradeAlerts: true,
          riskAlerts: true,
          emergencyAlerts: true,
        },
      });

      bestStrategy.liveTradingSessionId = liveTradingSessionId;
      session.currentPhase = "LIVE_TRADING";

      this.addNotification(sessionId, {
        type: "SUCCESS",
        phase: "LIVE_TRADING",
        title: "Live Trading Started!",
        message:
          "Your strategy is now trading with real funds. Monitoring performance closely.",
      });
    } catch (error) {
      this.addNotification(sessionId, {
        type: "CRITICAL",
        phase: "READY_FOR_LIVE",
        title: "Live Trading Failed",
        message: `Failed to start live trading: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  // Utility methods
  private createInitialPerformance(): AutonomousPerformance {
    return {
      totalPnL: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      confidenceScore: 0,
      learningProgress: 0,
      phasesCompleted: [],
      readyForLiveTrading: false,
    };
  }

  private addNotification(
    sessionId: string,
    notification: Omit<AutonomousNotification, "id" | "timestamp" | "read">
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const fullNotification: AutonomousNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      read: false,
      ...notification,
    };

    session.notifications.push(fullNotification);

    // Keep only last 50 notifications
    if (session.notifications.length > 50) {
      session.notifications = session.notifications.slice(-50);
    }

    // In a production environment, consider using a proper logging service
    // For now, we'll just add the notification to the session
    // which will be available through the getAutonomousSession API
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateInitialConfidence(
    marketConditions: MarketConditions,
    strategyType: string
  ): number {
    // Base confidence on market conditions and strategy type match
    let confidence = 0.5; // Base confidence

    // Adjust based on market volatility
    if (marketConditions.volatility === 'high') {
      // Trend-following strategies typically perform better in high volatility
      if (strategyType.toLowerCase().includes('trend')) {
        confidence += 0.15;
      } else if (strategyType.toLowerCase().includes('mean')) {
        // Mean reversion strategies may struggle in high volatility
        confidence -= 0.1;
      } else {
        confidence += 0.1;
      }
    } else if (marketConditions.volatility === 'low') {
      // Mean reversion strategies often perform better in low volatility
      if (strategyType.toLowerCase().includes('mean')) {
        confidence += 0.15;
      } else if (strategyType.toLowerCase().includes('trend')) {
        // Trend-following strategies may struggle in low volatility
        confidence -= 0.1;
      } else {
        confidence -= 0.1;
      }
    }

    // Adjust based on trend strength
    if (marketConditions.trend === 'strong') {
      // Trend-following strategies excel in strong trends
      if (strategyType.toLowerCase().includes('trend')) {
        confidence += 0.2;
      } else if (strategyType.toLowerCase().includes('mean')) {
        // Mean reversion strategies may struggle in strong trends
        confidence -= 0.1;
      } else {
        confidence += 0.1;
      }
    } else if (marketConditions.trend === 'weak' || marketConditions.trend === 'ranging') {
      // Mean reversion strategies often perform better in ranging markets
      if (strategyType.toLowerCase().includes('mean')) {
        confidence += 0.15;
      } else if (strategyType.toLowerCase().includes('trend')) {
        // Trend-following strategies may struggle in ranging markets
        confidence -= 0.15;
      } else {
        confidence -= 0.05;
      }
    }

    // Ensure confidence is within bounds
    return Math.min(Math.max(confidence, 0.1), 0.9);
  }

  private calculateProfitPotential(
    marketConditions: MarketConditions,
    strategyType: string,
    aggressiveness: 'conservative' | 'moderate' | 'aggressive'
  ): number {
    let potential = 0.3; // Base potential

    // Adjust based on market conditions
    if (marketConditions.volatility === 'high') {
      potential += 0.2;
    }

    if (marketConditions.trend === 'strong') {
      potential += 0.15;
    }

    // Adjust based on strategy type
    if (strategyType === 'trend_following' && marketConditions.trend === 'strong') {
      potential += 0.2;
    } else if (strategyType === 'mean_reversion' && marketConditions.volatility === 'high') {
      potential += 0.15;
    }

    // Adjust based on aggressiveness setting
    const aggressivenessMultiplier = {
      conservative: 0.8,
      moderate: 1.0,
      aggressive: 1.3
    };

    return potential * aggressivenessMultiplier[aggressiveness];
  }

  private calculateRiskScore(
    marketConditions: MarketConditions,
    strategyType: string,
    maxRiskPerTrade: number
  ): number {
    let risk = 0.5; // Base risk

    // Adjust based on market conditions
    if (marketConditions.volatility === 'high') {
      risk += 0.3;
    } else if (marketConditions.volatility === 'low') {
      risk -= 0.2;
    }

    // Adjust based on strategy type
    if (strategyType === 'trend_following') {
      risk -= 0.1;
    } else if (strategyType === 'mean_reversion') {
      risk += 0.1;
    }

    // Adjust based on max risk per trade setting
    const riskAdjustment = (maxRiskPerTrade / 2) * 2; // Normalize to 0-1 range
    risk = risk * (1 + (riskAdjustment - 0.5));

    // Ensure risk is within bounds
    return Math.min(Math.max(risk, 0.1), 0.9);
  }

  private getSessionProgress(sessionId: string): AutonomousSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  // Helper method implementations
  private async generateStrategyFromTemplate(
    template: StrategyTemplate,
    pair: string,
    marketConditions: MarketConditions,
    settings: AutonomousSettings
  ): Promise<EnhancedStrategy> {
    // Generate appropriate parameters based on template type and market conditions
    let parameters: StrategyParameters;

    switch (template.type) {
      case "trend_following":
        parameters = {
          pair,
          timeframe: "1h",
          fastPeriod: 12,
          slowPeriod: 26,
        };
        break;
      case "mean_reversion":
        parameters = {
          pair,
          timeframe: "1h",
          period: 14,
          overbought: 70,
          oversold: 30,
        };
        break;
      default:
        parameters = {
          pair,
          timeframe: "1h",
          fastPeriod: 12,
          slowPeriod: 26,
        };
    }

    const strategy: EnhancedStrategy = {
      id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: `${template.name} - ${pair}`,
      type: template.type as StrategyTypeUnion,
      active: true, // Required property from Strategy interface
      description: `Auto-generated ${template.type} strategy for ${pair}`,
      parameters,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: this.calculateInitialConfidence(marketConditions, template.type),
      profitPotential: this.calculateProfitPotential(marketConditions, template.type, settings.aggressiveness),
      riskScore: this.calculateRiskScore(marketConditions, template.type, settings.maxRiskPerTrade),
      learningMetrics: {
        adaptationRate: 0,
        consistencyScore: 0,
        marketConditionPerformance: {},
        timestamp: Date.now(),
        lastUpdated: new Date().toISOString(),
        strategyType: template.type,
        performanceScore: 0
      },
      // For backward compatibility with direct property access
      adaptationRate: 0,
      consistencyScore: 0,
      marketConditionPerformance: {}
    };

    // Ensure the direct properties are in sync with learningMetrics
    strategy.adaptationRate = strategy.learningMetrics.adaptationRate;
    strategy.consistencyScore = strategy.learningMetrics.consistencyScore;
    strategy.marketConditionPerformance = strategy.learningMetrics.marketConditionPerformance;

    return strategy;
  }

  private async rankStrategiesByPotential(
    strategies: EnhancedStrategy[],
    marketConditions: MarketConditions
  ): Promise<EnhancedStrategy[]> {
    // Score strategies based on market conditions and strategy type
    return strategies.map((strategy) => {
      let score = 0.5; // Base score

      // Adjust score based on market conditions
      if (marketConditions.volatility === 'high' && strategy.type === 'mean_reversion') {
        score += 0.3;
      } else if (marketConditions.trend === 'strong' && strategy.type === 'trend_following') {
        score += 0.3;
      }

      // Adjust based on volume
      if (marketConditions.volume === 'high') {
        score += 0.1;
      }

      // Adjust based on sentiment
      if (marketConditions.sentiment === 'bullish' && strategy.type === 'trend_following') {
        score += 0.1;
      } else if (marketConditions.sentiment === 'bearish' && strategy.type === 'mean_reversion') {
        score += 0.1;
      }

      // Ensure score is within bounds
      score = Math.min(Math.max(score, 0.1), 0.9);

      return {
        ...strategy,
        profitPotential: score,
        riskScore: 1 - score // Inverse relationship between profit potential and risk
      };
    }).sort((a, b) => b.profitPotential - a.profitPotential);
  }

  private calculateStrategyConfidence(backtestResult: BacktestResult): number {
    const winRate = backtestResult.winRate / 100;
    const profitFactor =
      Math.min(backtestResult.metrics.profitFactor || 0, 3) / 3;
    const sharpeRatio =
      Math.min(Math.max(backtestResult.sharpeRatio || 0, 0), 2) / 2;
    const drawdownPenalty = Math.max(
      0,
      1 - (backtestResult.maxDrawdown || 0) * 2
    );

    return (
      winRate * 0.3 +
      profitFactor * 0.3 +
      sharpeRatio * 0.2 +
      drawdownPenalty * 0.2
    );
  }

  private getBacktestStartDate(timeHorizon: number): string {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeHorizon);
    return startDate.toISOString();
  }

  private async optimizeStrategyParameters(
    strategy: EnhancedStrategy,
    settings: AutonomousSettings
  ): Promise<void> {
    // Base improvement based on strategy type and market conditions
    let improvementFactor = 1.0;

    // Adjust improvement based on aggressiveness setting
    switch (settings.aggressiveness) {
      case 'conservative':
        improvementFactor = 1.05;
        break;
      case 'moderate':
        improvementFactor = 1.1;
        break;
      case 'aggressive':
        improvementFactor = 1.15;
        break;
      default:
        improvementFactor = 1.05;
    }

    // Apply improvement to confidence, but cap at 0.95 to avoid overconfidence
    strategy.confidence = Math.min(0.95, strategy.confidence * improvementFactor);

    // Adjust position size based on risk settings if strategy has position size
    if (strategy.parameters.positionSize) {
      // Ensure position size doesn't exceed max risk per trade setting
      strategy.parameters.positionSize = Math.min(
        settings.maxRiskPerTrade,
        strategy.parameters.positionSize * improvementFactor
      );
    }

    // Update learning metrics to reflect optimization
    if (!strategy.learningMetrics) {
      strategy.learningMetrics = {
        adaptationRate: 0.5,
        consistencyScore: 0.5,
        marketConditionPerformance: {},
        timestamp: Date.now(),
        lastUpdated: new Date().toISOString(),
        strategyType: strategy.type || 'unknown',
        performanceScore: 0.5
      };
    }

    // Slight improvement to learning metrics
    strategy.learningMetrics.adaptationRate = Math.min(
      1.0,
      (strategy.learningMetrics.adaptationRate || 0.5) * 1.05
    );
    strategy.learningMetrics.consistencyScore = Math.min(
      1.0,
      (strategy.learningMetrics.consistencyScore || 0.5) * 1.03
    );
  }

  private calculateMockTradingDuration(
    aggressiveness: "conservative" | "moderate" | "aggressive"
  ): number {
    switch (aggressiveness) {
      case "aggressive":
        return 2 * 60 * 60 * 1000; // 2 hours
      case "moderate":
        return 4 * 60 * 60 * 1000; // 4 hours
      case "conservative":
        return 8 * 60 * 60 * 1000; // 8 hours
    }
  }

  private calculateCurrentPerformance(
    liveSession: LiveSession
  ): PerformanceData {
    return {
      totalReturn:
        (liveSession.currentBalance - liveSession.initialBalance) /
        liveSession.initialBalance,
      drawdown: Math.max(
        ...(liveSession.trades.map(
          (t: LiveTrade) =>
            (Math.max(
              ...liveSession.trades
                .slice(0, liveSession.trades.indexOf(t) + 1)
                .map((trade: LiveTrade) => trade.balance)
            ) -
              t.balance) /
            Math.max(
              ...liveSession.trades
                .slice(0, liveSession.trades.indexOf(t) + 1)
                .map((trade: LiveTrade) => trade.balance)
            )
        ) || [0])
      ),
    };
  }

  private updatePerformance(
    current: AutonomousPerformance,
    newData: PerformanceData
  ): AutonomousPerformance {
    return {
      ...current,
      totalPnL: newData.totalReturn * current.totalPnL,
      maxDrawdown: Math.max(current.maxDrawdown, newData.drawdown),
    };
  }

  private async analyzePerformanceData(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Analyze strategy performance and update learning metrics
    for (const strategy of session.strategies) {
      if (strategy.backtestResults) {
        const confidence = this.calculateStrategyConfidence(strategy.backtestResults);
        strategy.confidence = confidence;

        // Update learning metrics based on performance
        strategy.learningMetrics.adaptationRate = Math.min(1, confidence * 1.2);
        strategy.learningMetrics.consistencyScore = Math.min(1, confidence * 0.8);
      }
    }
  }

  private async updateLearningDatabase(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Store market conditions and strategy performance for future learning
    const marketConditions = this.learningDatabase.get(
      `${sessionId}_market_conditions`
    ) as MarketConditions | undefined;

    if (marketConditions) {
      // Store performance data for each strategy
      session.strategies.forEach((strategy) => {
        const strategyKey = `${strategy.id}_${marketConditions.volatility}_${marketConditions.trend}`;
        this.learningDatabase.set(strategyKey, {
          ...strategy.learningMetrics,
          timestamp: Date.now(),
        } as LearningMetrics);
      });
    }
  }

  private async optimizeForProfitMaximization(
    sessionId: string
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Sort strategies by profit potential and risk
    const sortedStrategies = [...session.strategies].sort((a, b) => {
      const scoreA = a.confidence * a.profitPotential * (1 - a.riskScore);
      const scoreB = b.confidence * b.profitPotential * (1 - b.riskScore);
      return scoreB - scoreA;
    });

    // Allocate more capital to top-performing strategies
    const topStrategies = sortedStrategies.slice(0, 3);
    const remainingStrategies = sortedStrategies.slice(3);

    // Update allocation based on performance
    topStrategies.forEach((strategy) => {
      strategy.parameters.positionSize = Math.min(
        session.settings.maxRiskPerTrade * 1.5,
        session.settings.maxRiskPerTrade * 2
      );
    });

    // Reduce allocation for underperforming strategies
    remainingStrategies.forEach((strategy) => {
      strategy.parameters.positionSize = Math.max(
        session.settings.maxRiskPerTrade * 0.5,
        session.settings.maxRiskPerTrade * 0.1
      );
    });
  }

  private startLearningLoop(): void {
    // Run learning loop every 6 hours
    setInterval(async () => {
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.isActive) {
          try {
            await this.analyzePerformanceData(sessionId);
            await this.updateLearningDatabase(sessionId);
            await this.optimizeForProfitMaximization(sessionId);
          } catch (error) {
            const session = this.getSessionProgress(sessionId);
            if (session) {
              this.addNotification(sessionId, {
                type: 'CRITICAL',
                phase: session.currentPhase,
                title: 'Learning Loop Error',
                message: `Error in learning loop: ${error instanceof Error ? error.message : String(error)}`
              });
            }
          }
        }
      }
    }, 6 * 60 * 60 * 1000); // 6 hours
  }

  private async selectOptimalTradingPairs(
    marketConditions: MarketConditions
  ): Promise<string[]> {
    // Base pairs with different characteristics
    const basePairs = [
      { symbol: 'BTC-USDT', volatility: 'high', volume: 'very high' },
      { symbol: 'ETH-USDT', volatility: 'high', volume: 'high' },
      { symbol: 'SOL-USDT', volatility: 'very high', volume: 'high' },
      { symbol: 'XRP-USDT', volatility: 'medium', volume: 'high' },
      { symbol: 'ADA-USDT', volatility: 'medium', volume: 'medium' },
      { symbol: 'DOGE-USDT', volatility: 'very high', volume: 'medium' },
      { symbol: 'DOT-USDT', volatility: 'medium', volume: 'medium' },
      { symbol: 'LTC-USDT', volatility: 'low', volume: 'medium' },
      { symbol: 'LINK-USDT', volatility: 'high', volume: 'medium' },
      { symbol: 'MATIC-USDT', volatility: 'high', volume: 'medium' },
    ];

    // Filter pairs based on market conditions
    let filteredPairs = [...basePairs];

    // Adjust pair selection based on market volatility
    if (marketConditions.volatility === 'high') {
      // In high volatility, prefer more established pairs
      filteredPairs = filteredPairs.filter(
        pair => pair.volatility !== 'very high' && pair.volume === 'high'
      );
    } else if (marketConditions.volatility === 'low') {
      // In low volatility, can take on more risk with higher volatility pairs
      filteredPairs = filteredPairs.filter(
        pair => pair.volatility !== 'low' && pair.volume !== 'low'
      );
    }

    // Adjust based on market trend
    if (marketConditions.trend === 'strong uptrend') {
      // In strong uptrends, prefer higher beta (more volatile) assets
      filteredPairs = filteredPairs.sort((a, b) => {
        const volatilityOrder = { 'low': 0, 'medium': 1, 'high': 2, 'very high': 3 };
        return (volatilityOrder[b.volatility as keyof typeof volatilityOrder] || 0) -
               (volatilityOrder[a.volatility as keyof typeof volatilityOrder] || 0);
      });
    } else if (marketConditions.trend === 'strong downtrend') {
      // In strong downtrends, prefer more stable assets
      filteredPairs = filteredPairs.sort((a, b) => {
        const volatilityOrder = { 'low': 0, 'medium': 1, 'high': 2, 'very high': 3 };
        return (volatilityOrder[a.volatility as keyof typeof volatilityOrder] || 0) -
               (volatilityOrder[b.volatility as keyof typeof volatilityOrder] || 0);
      });
    }

    // Ensure we have at least 3 pairs, but no more than 5
    const maxPairs = Math.min(5, Math.max(3, filteredPairs.length));
    return filteredPairs.slice(0, maxPairs).map(pair => pair.symbol);
  }
}

// Type definitions
interface StrategyTemplate {
  name: string;
  type: string;
  baseConfig: {
    indicators: string[];
    timeframes: string[];
    riskLevel: string;
  };
}

interface LearningMetrics {
  adaptationRate: number;
  consistencyScore: number;
  marketConditionPerformance: Record<string, number>;
  timestamp: number; // Track when metrics were last updated
  lastUpdated?: string; // Optional ISO timestamp for display
  strategyType?: string; // Optional strategy type for categorization
  performanceScore?: number; // Optional overall performance metric
}

interface MarketConditions {
  volatility: string;
  trend: string;
  volume: string;
  sentiment: string;
  timestamp: number;
}

interface LiveSession {
  currentBalance: number;
  initialBalance: number;
  trades: LiveTrade[];
}

interface LiveTrade {
  balance: number;
}

interface PerformanceData {
  totalReturn: number;
  drawdown: number;
}

// Market Condition Analyzer class
class MarketConditionAnalyzer {
  async analyzeCurrentMarket(): Promise<MarketConditions> {
    // Placeholder market analysis
    return {
      volatility: "medium",
      trend: "neutral",
      volume: "high",
      sentiment: "bullish",
      timestamp: Date.now(),
    };
  }
}

export const autonomousTradingEngine = AutonomousTradingEngine.getInstance();
