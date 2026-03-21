/**
 * Enhanced Autonomous Trading Agent
 * 
 * Integrates AI strategy generation with autonomous trading:
 * - Generates strategies using Claude AI
 * - Creates multi-strategy combinations
 * - Manages strategy lifecycle (backtest → paper → live)
 * - Continuous learning and adaptation
 */

import { EventEmitter } from 'events';
import { pool } from '../db/connection.js';
import { getLLMStrategyGenerator } from './llmStrategyGenerator.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import automatedTradingService from './automatedTradingService.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import { logger } from '../utils/logger.js';
import {
  calculateCompositeCapabilityScore,
  generateCapabilityHints,
  getStrategyCapabilityClass
} from './agentCapabilityScoring.js';
import type { Server as SocketIOServer } from 'socket.io';

interface AgentConfig {
  userId: string;
  maxDrawdown: number;
  positionSize: number;
  maxConcurrentPositions: number;
  stopLossPercentage: number;
  tradingStyle: 'scalping' | 'day_trading' | 'swing_trading';
  preferredPairs: string[];
  preferredTimeframes: string[];
  automationLevel: 'fully_autonomous' | 'semi_autonomous' | 'manual_override';
  strategyGenerationInterval: number; // Hours
  backtestPeriodDays: number;
  paperTradingDurationHours: number;
  enableAIStrategies: boolean;
  enableMultiStrategyCombo: boolean;
}

interface AgentSession {
  id: string;
  userId: string;
  status: 'running' | 'stopped' | 'paused';
  startedAt: Date;
  stoppedAt?: Date;
  strategiesGenerated: number;
  backtestsCompleted: number;
  paperTradesExecuted: number;
  liveTradesExecuted: number;
  totalPnl: number;
  config: AgentConfig;
}

interface Strategy {
  id: string;
  sessionId: string;
  name: string;
  type: 'single' | 'combo';
  symbol: string;
  timeframe: string;
  indicators: string[];
  code: string;
  description: string;
  status: 'generated' | 'backtested' | 'paper_trading' | 'live' | 'retired';
  performance: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    totalReturn: number;
  };
  subStrategies?: {
    strategyId: string;
    weight: number;
  }[];
  createdAt: Date;
  promotedAt?: Date;
  retiredAt?: Date;
}

interface StrategyCapabilityProfile {
  strategyId: string;
  strategyName: string;
  status: Strategy['status'];
  symbol: string;
  compositeScore: number;
  capabilityClass: 'tier1' | 'tier2' | 'tier3';
  metrics: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  hints: Array<{
    metric: 'winRate' | 'profitFactor' | 'maxDrawdown';
    current: number;
    target: number;
    gap: number;
    priority: 'high' | 'medium';
    recommendation: string;
  }>;
}

class EnhancedAutonomousAgent extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map();
  private runningIntervals: Map<string, NodeJS.Timeout> = new Map();
  private strategies: Map<string, Strategy> = new Map();
  private io: SocketIOServer | null = null;
  // Maps strategy ID → paper trading session ID for result lookup
  private paperSessionIds: Map<string, string> = new Map();

  // Circuit breaker state per session
  private circuitBreakers: Map<string, {
    consecutiveLosses: number;
    dailyLoss: number;
    dailyLossResetAt: Date;
    isTripped: boolean;
    trippedAt?: Date;
    trippedReason?: string;
  }> = new Map();

  // Circuit breaker thresholds
  private static readonly MAX_CONSECUTIVE_LOSSES = 5;
  private static readonly MAX_DAILY_LOSS_PERCENT = 3; // % of capital
  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown
  private static readonly DRAWDOWN_SCALE_THRESHOLD = 10; // Start scaling at 10% drawdown
  private static readonly DRAWDOWN_HALT_THRESHOLD = 20; // Halt at 20% drawdown

  constructor() {
    super();
  }

  /**
   * Set the Socket.IO server instance for real-time updates
   */
  setSocketIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Broadcast an agent event to connected clients via WebSocket
   */
  private broadcastEvent(eventType: string, data: any): void {
    if (this.io) {
      this.io.emit('agent:activity', { type: eventType, data, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Initialize or get circuit breaker state for a session
   */
  private getCircuitBreaker(sessionId: string) {
    if (!this.circuitBreakers.has(sessionId)) {
      this.circuitBreakers.set(sessionId, {
        consecutiveLosses: 0,
        dailyLoss: 0,
        dailyLossResetAt: this.getNextDayReset(),
        isTripped: false
      });
    }
    const cb = this.circuitBreakers.get(sessionId)!;
    // Reset daily loss counter at midnight UTC
    if (new Date() >= cb.dailyLossResetAt) {
      cb.dailyLoss = 0;
      cb.dailyLossResetAt = this.getNextDayReset();
    }
    return cb;
  }

  private getNextDayReset(): Date {
    const now = new Date();
    const reset = new Date(now);
    reset.setUTCHours(0, 0, 0, 0);
    reset.setUTCDate(reset.getUTCDate() + 1);
    return reset;
  }

  /**
   * Check if the circuit breaker allows trading for this session.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  checkCircuitBreaker(sessionId: string): { allowed: boolean; reason?: string } {
    const cb = this.getCircuitBreaker(sessionId);

    // Auto-reset after cooldown
    if (cb.isTripped && cb.trippedAt) {
      const elapsed = Date.now() - cb.trippedAt.getTime();
      if (elapsed >= EnhancedAutonomousAgent.CIRCUIT_BREAKER_COOLDOWN_MS) {
        logger.info(`[CircuitBreaker] Cooldown expired for session ${sessionId} — resetting`);
        cb.isTripped = false;
        cb.consecutiveLosses = 0;
        cb.trippedReason = undefined;
        cb.trippedAt = undefined;
      }
    }

    if (cb.isTripped) {
      return { allowed: false, reason: cb.trippedReason || 'Circuit breaker tripped' };
    }
    return { allowed: true };
  }

  /**
   * Record a trade result and update circuit breaker state.
   * Called after every trade execution.
   */
  recordTradeResult(sessionId: string, pnl: number, capitalBase: number): void {
    const cb = this.getCircuitBreaker(sessionId);

    if (pnl < 0) {
      cb.consecutiveLosses++;
      cb.dailyLoss += Math.abs(pnl);
    } else {
      cb.consecutiveLosses = 0; // Reset on a win
    }

    // Check consecutive losses
    if (cb.consecutiveLosses >= EnhancedAutonomousAgent.MAX_CONSECUTIVE_LOSSES) {
      cb.isTripped = true;
      cb.trippedAt = new Date();
      cb.trippedReason = `${cb.consecutiveLosses} consecutive losses — pausing for cooldown`;
      logger.warn(`[CircuitBreaker] TRIPPED for session ${sessionId}: ${cb.trippedReason}`);
      this.broadcastEvent('circuit_breaker_tripped', {
        sessionId,
        reason: cb.trippedReason,
        consecutiveLosses: cb.consecutiveLosses
      });
    }

    // Check daily loss limit
    const dailyLossPercent = capitalBase > 0 ? (cb.dailyLoss / capitalBase) * 100 : 0;
    if (dailyLossPercent >= EnhancedAutonomousAgent.MAX_DAILY_LOSS_PERCENT) {
      cb.isTripped = true;
      cb.trippedAt = new Date();
      cb.trippedReason = `Daily loss limit reached (${dailyLossPercent.toFixed(1)}% of capital) — halting until next day`;
      logger.warn(`[CircuitBreaker] TRIPPED for session ${sessionId}: ${cb.trippedReason}`);
      this.broadcastEvent('circuit_breaker_tripped', {
        sessionId,
        reason: cb.trippedReason,
        dailyLossPercent
      });
    }
  }

  /**
   * Calculate drawdown-adjusted position size.
   * As drawdown increases, position size decreases linearly.
   * At DRAWDOWN_HALT_THRESHOLD, position size → 0.
   */
  getDrawdownAdjustedPositionSize(basePositionSize: number, currentDrawdownPercent: number): number {
    if (currentDrawdownPercent >= EnhancedAutonomousAgent.DRAWDOWN_HALT_THRESHOLD) {
      return 0; // Full halt
    }
    if (currentDrawdownPercent <= EnhancedAutonomousAgent.DRAWDOWN_SCALE_THRESHOLD) {
      return basePositionSize; // No reduction
    }
    // Linear scale-down between thresholds
    const range = EnhancedAutonomousAgent.DRAWDOWN_HALT_THRESHOLD - EnhancedAutonomousAgent.DRAWDOWN_SCALE_THRESHOLD;
    const excess = currentDrawdownPercent - EnhancedAutonomousAgent.DRAWDOWN_SCALE_THRESHOLD;
    const scale = 1 - (excess / range);
    return basePositionSize * Math.max(0, scale);
  }

  /**
   * Get circuit breaker status for frontend display
   */
  getCircuitBreakerStatus(sessionId: string): {
    isTripped: boolean;
    reason?: string;
    consecutiveLosses: number;
    dailyLossPercent: number;
    cooldownRemaining?: number;
  } {
    const cb = this.getCircuitBreaker(sessionId);
    // dailyLoss is stored as absolute $. Convert to an approximate %
    // using the session config's positionSize * 1000 as the capital proxy.
    const session = this.sessions.get(sessionId);
    const capitalBase = session ? session.config.positionSize * 1000 : 10000;
    const dailyLossPercent = capitalBase > 0 ? (cb.dailyLoss / capitalBase) * 100 : 0;

    return {
      isTripped: cb.isTripped,
      reason: cb.trippedReason,
      consecutiveLosses: cb.consecutiveLosses,
      dailyLossPercent: parseFloat(dailyLossPercent.toFixed(2)),
      cooldownRemaining: cb.isTripped && cb.trippedAt
        ? Math.max(0, EnhancedAutonomousAgent.CIRCUIT_BREAKER_COOLDOWN_MS - (Date.now() - cb.trippedAt.getTime()))
        : undefined
    };
  }

  /**
   * Restore running/paused sessions from PostgreSQL on startup.
   * Re-populates the in-memory sessions map and restarts agent loops
   * for sessions that were running when the server last stopped.
   */
  async restoreRunningSessionsFromDB(): Promise<void> {
    try {
      const result = await pool.query(
        `SELECT * FROM agent_sessions WHERE status IN ('running', 'paused') ORDER BY started_at DESC`
      );

      if (result.rows.length === 0) {
        logger.info('[Agent] No sessions to restore from database');
        return;
      }

      logger.info(`[Agent] Restoring ${result.rows.length} session(s) from database`);

      for (const row of result.rows) {
        try {
          const session: AgentSession = {
            id: row.id,
            userId: row.user_id,
            status: row.status,
            startedAt: new Date(row.started_at),
            stoppedAt: row.stopped_at ? new Date(row.stopped_at) : undefined,
            strategiesGenerated: parseInt(row.strategies_generated) || 0,
            backtestsCompleted: parseInt(row.backtests_completed) || 0,
            paperTradesExecuted: parseInt(row.paper_trades_executed) || 0,
            liveTradesExecuted: parseInt(row.live_trades_executed) || 0,
            totalPnl: parseFloat(row.total_pnl || '0'),
            config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config
          };

          this.sessions.set(session.id, session);

          // Restart the agent loop for running sessions
          if (session.status === 'running') {
            const credentials = await apiCredentialsService.getCredentials(session.userId);
            if (credentials) {
              await this.startAgentLoop(session);
              this.broadcastEvent('session_restored', { sessionId: session.id, userId: session.userId });
              logger.info(`[Agent] Restored and restarted session ${session.id} for user ${session.userId}`);
            } else {
              session.status = 'paused';
              await pool.query(
                `UPDATE agent_sessions SET status = 'paused' WHERE id = $1`,
                [session.id]
              );
              logger.warn(`[Agent] Session ${session.id} paused: Poloniex API credentials not configured. Please add your API keys in Settings.`);
            }
          }
        } catch (err: any) {
          logger.error(`[Agent] Error restoring session ${row.id}:`, err.message);
        }
      }

      logger.info(`[Agent] Session restoration complete. Active sessions: ${this.sessions.size}`);
    } catch (error: any) {
      logger.error('[Agent] Error restoring sessions from database:', error.message);
    }
  }

  /**
   * Start the enhanced autonomous agent
   */
  async startAgent(userId: string, config: Partial<AgentConfig>): Promise<AgentSession> {
    // Check if agent is already running
    const existingSession = Array.from(this.sessions.values()).find(
      s => s.userId === userId && s.status === 'running'
    );

    if (existingSession) {
      throw new Error('Agent is already running for this user');
    }

    // Verify API credentials
    const credentials = await apiCredentialsService.getCredentials(userId);
    if (!credentials) {
      throw new Error('No active API credentials found. Please add your Poloniex API keys.');
    }

    // Create default config
    const defaultConfig: AgentConfig = {
      userId,
      maxDrawdown: 15,
      positionSize: 2,
      maxConcurrentPositions: 3,
      stopLossPercentage: 5,
      tradingStyle: 'day_trading',
      preferredPairs: ['BTC_USDT', 'ETH_USDT'],
      preferredTimeframes: ['15m', '1h', '4h'],
      automationLevel: 'fully_autonomous',
      strategyGenerationInterval: 24, // Generate new strategies daily
      backtestPeriodDays: 30,
      paperTradingDurationHours: 168, // 7 days
      enableAIStrategies: true,
      enableMultiStrategyCombo: true,
      ...config
    };

    // Create session
    const session: AgentSession = {
      id: `session_${Date.now()}_${userId}`,
      userId,
      status: 'running',
      startedAt: new Date(),
      strategiesGenerated: 0,
      backtestsCompleted: 0,
      paperTradesExecuted: 0,
      liveTradesExecuted: 0,
      totalPnl: 0,
      config: defaultConfig
    };

    this.sessions.set(session.id, session);

    // Store session in database
    await this.saveSession(session);

    // Start agent loop
    await this.startAgentLoop(session);

    logger.info(`Enhanced autonomous agent started for user ${userId}`, {
      sessionId: session.id,
      config: defaultConfig
    });

    this.emit('agent:started', { userId, sessionId: session.id });

    return session;
  }

  /**
   * Main agent loop
   */
  private async startAgentLoop(session: AgentSession): Promise<void> {
    // Initial strategy generation
    if (session.config.enableAIStrategies) {
      await this.generateStrategies(session);
    }

    // Set up periodic strategy generation
    const interval = setInterval(async () => {
      try {
        if (session.status === 'running' && session.config.enableAIStrategies) {
          await this.generateStrategies(session);
        }
      } catch (error) {
        logger.error('Error in agent loop:', error);
      }
    }, session.config.strategyGenerationInterval * 60 * 60 * 1000);

    this.runningIntervals.set(session.id, interval);

    // Start profit maximization through dynamic allocation optimization
    this.startAllocationOptimization(session);
    
    logger.info(`Agent loop started for session ${session.id} with profit maximization enabled`);
  }

  /**
   * Generate AI-powered trading strategies
   */
  async generateStrategies(session: AgentSession): Promise<Strategy[]> {
    logger.info(`Generating strategies for session ${session.id} - using parallel execution`);
    
    const strategies: Strategy[] = [];
    const llmGenerator = getLLMStrategyGenerator();
    
    // Process multiple symbols in parallel for faster strategy generation
    const symbolPromises = session.config.preferredPairs.map(async (symbol) => {
      try {
        // Generate single-indicator strategies IN PARALLEL
        const [trendStrategy, momentumStrategy, volumeStrategy] = await Promise.all([
          this.generateSingleStrategy(
            session,
            symbol,
            'trend_following',
            ['SMA', 'EMA'],
            'Trend following strategy using moving averages'
          ),
          this.generateSingleStrategy(
            session,
            symbol,
            'momentum',
            ['RSI', 'MACD'],
            'Momentum strategy using RSI and MACD'
          ),
          this.generateSingleStrategy(
            session,
            symbol,
            'volume_analysis',
            ['Volume', 'OBV'],
            'Volume analysis strategy'
          )
        ]);
        
        const symbolStrategies = [trendStrategy, momentumStrategy, volumeStrategy];
        
        // Generate multi-strategy combination if enabled
        if (session.config.enableMultiStrategyCombo) {
          const comboStrategy = await this.createMultiStrategyCombo(
            session,
            symbol,
            symbolStrategies
          );
          symbolStrategies.push(comboStrategy);
        }
        
        return symbolStrategies;
      } catch (error) {
        logger.error(`Error generating strategies for ${symbol}:`, error);
        return [];
      }
    });
    
    // Wait for all symbols to complete
    const symbolResults = await Promise.all(symbolPromises);
    strategies.push(...symbolResults.flat());
    
    // Update session stats
    session.strategiesGenerated += strategies.length;
    await this.saveSession(session);
    
    // Start strategy lifecycle for ALL strategies IN PARALLEL
    // This allows backtesting, paper trading, and evaluation to run concurrently
    const lifecyclePromises = strategies.map(strategy => 
      this.runStrategyLifecycle(session, strategy).catch(error => {
        logger.error(`Error in strategy lifecycle for ${strategy.name}:`, error);
      })
    );
    
    // Fire and forget - strategies will progress through their lifecycle independently
    Promise.all(lifecyclePromises).then(() => {
      logger.info(`All ${strategies.length} strategies have completed their lifecycle for session ${session.id}`);
    });
    
    logger.info(`Generated ${strategies.length} strategies for session ${session.id} using parallel execution`);
    this.emit('strategies:generated', { sessionId: session.id, count: strategies.length });
    
    return strategies;
  }

  /**
   * Generate a single strategy
   * Falls back to rule-based strategy if LLM is unavailable
   */
  private async generateSingleStrategy(
    session: AgentSession,
    symbol: string,
    strategyType: string,
    indicators: string[],
    description: string
  ): Promise<Strategy> {
    const llmGenerator = getLLMStrategyGenerator();
    
    let strategyName = `${strategyType}_${symbol}`;
    let strategyCode = '';
    
    if (llmGenerator.isAvailable()) {
      try {
        const aiStrategy = await llmGenerator.generateStrategy({
          symbol,
          timeframe: session.config.preferredTimeframes[0],
          strategyType,
          riskTolerance: 'moderate',
          indicators,
          description
        } as any);
        
        strategyName = aiStrategy.name || strategyName;
        strategyCode = (aiStrategy as any).code || JSON.stringify(aiStrategy);
      } catch (err: any) {
        logger.warn(`[Agent] LLM strategy generation failed, using rule-based fallback: ${err.message}`);
        strategyCode = JSON.stringify(this.generateRuleBasedStrategy(strategyType, symbol, indicators, session.config));
      }
    } else {
      logger.info(`[Agent] Claude API key not configured — using rule-based ${strategyType} strategy for ${symbol}`);
      const ruleStrategy = this.generateRuleBasedStrategy(strategyType, symbol, indicators, session.config);
      strategyName = ruleStrategy.name;
      strategyCode = JSON.stringify(ruleStrategy);
    }
    
    const strategy: Strategy = {
      id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId: session.id,
      name: strategyName,
      type: 'single',
      symbol,
      timeframe: session.config.preferredTimeframes[0],
      indicators,
      code: strategyCode,
      description,
      status: 'generated',
      performance: {
        winRate: 0,
        profitFactor: 0,
        totalTrades: 0,
        totalReturn: 0
      },
      createdAt: new Date()
    };
    
    this.strategies.set(strategy.id, strategy);
    await this.saveStrategy(strategy);
    this.broadcastEvent('strategy_generated', { strategyId: strategy.id, name: strategy.name, symbol });
    
    return strategy;
  }

  /**
   * Generate a rule-based strategy when LLM is unavailable.
   */
  private generateRuleBasedStrategy(
    strategyType: string,
    symbol: string,
    indicators: string[],
    config: AgentConfig
  ): any {
    const templates: Record<string, any> = {
      trend_following: {
        name: `SMA Crossover ${symbol}`,
        type: 'trend_following',
        description: 'Enters long when SMA20 crosses above SMA50, short when below. Uses ATR-based stops.',
        parameters: { smaPeriodShort: 20, smaPeriodLong: 50, atrMultiplier: 2.0 },
        entryConditions: ['SMA(20) crosses above SMA(50) for long', 'SMA(20) crosses below SMA(50) for short'],
        exitConditions: ['ATR-based trailing stop', 'Opposite crossover signal'],
        riskManagement: { stopLossPercent: config.stopLossPercentage, takeProfitPercent: config.stopLossPercentage * 2, trailingStop: true, trailingStopPercent: config.stopLossPercentage * 0.8, maxPositionSize: config.positionSize, maxDrawdown: config.maxDrawdown }
      },
      momentum: {
        name: `RSI Momentum ${symbol}`,
        type: 'momentum',
        description: 'Buys oversold RSI conditions (<30) and sells overbought (>70). Includes MACD confirmation.',
        parameters: { rsiPeriod: 14, oversoldLevel: 30, overboughtLevel: 70, macdFast: 12, macdSlow: 26, macdSignal: 9 },
        entryConditions: ['RSI(14) < 30 AND MACD histogram positive for long', 'RSI(14) > 70 AND MACD histogram negative for short'],
        exitConditions: ['RSI returns to neutral zone (40-60)', 'MACD signal crossover', 'Fixed take-profit hit'],
        riskManagement: { stopLossPercent: config.stopLossPercentage, takeProfitPercent: config.stopLossPercentage * 1.5, trailingStop: false, maxPositionSize: config.positionSize, maxDrawdown: config.maxDrawdown }
      },
      volume_analysis: {
        name: `Volume Breakout ${symbol}`,
        type: 'breakout',
        description: 'Trades breakouts above/below Bollinger Bands with volume confirmation.',
        parameters: { bbPeriod: 20, bbStdDev: 2.0, volumeThreshold: 1.5 },
        entryConditions: ['Price closes above upper BB with 1.5x avg volume for long', 'Price closes below lower BB for short'],
        exitConditions: ['Price returns to middle band', 'Trailing stop at opposite band'],
        riskManagement: { stopLossPercent: config.stopLossPercentage, takeProfitPercent: config.stopLossPercentage * 2.5, trailingStop: true, trailingStopPercent: config.stopLossPercentage, maxPositionSize: config.positionSize, maxDrawdown: config.maxDrawdown }
      },
      mean_reversion: {
        name: `Mean Reversion ${symbol}`,
        type: 'mean_reversion',
        description: 'Trades price deviations from VWAP / EMA mean, entering when price is >2 std devs away.',
        parameters: { emaPeriod: 50, stdDevMultiplier: 2.0, vwapAnchor: 'session' },
        entryConditions: ['Price < EMA(50) - 2*StdDev for long (oversold reversion)', 'Price > EMA(50) + 2*StdDev for short (overbought reversion)'],
        exitConditions: ['Price returns to EMA(50)', 'Time-based exit after 4 hours', 'Stop loss hit'],
        riskManagement: { stopLossPercent: config.stopLossPercentage * 0.75, takeProfitPercent: config.stopLossPercentage * 1.2, trailingStop: false, maxPositionSize: config.positionSize * 0.75, maxDrawdown: config.maxDrawdown }
      },
      scalping: {
        name: `EMA Scalp ${symbol}`,
        type: 'scalping',
        description: 'Short-term EMA crossover with tight stops for quick entries and exits on lower timeframes.',
        parameters: { emaFast: 9, emaSlow: 21, rsiFilter: 14, rsiOversold: 40, rsiOverbought: 60 },
        entryConditions: ['EMA(9) crosses above EMA(21) with RSI > 40 for long', 'EMA(9) crosses below EMA(21) with RSI < 60 for short'],
        exitConditions: ['Opposite EMA crossover', 'RSI extreme reversal', 'Fixed 0.5% take-profit'],
        riskManagement: { stopLossPercent: Math.min(config.stopLossPercentage, 1.5), takeProfitPercent: Math.min(config.stopLossPercentage, 1.5) * 1.5, trailingStop: true, trailingStopPercent: 0.3, maxPositionSize: config.positionSize * 0.5, maxDrawdown: config.maxDrawdown * 0.5 }
      }
    };

    const template = templates[strategyType] || templates.trend_following;
    return {
      ...template,
      algorithm: `rule_based_${strategyType}`,
      indicators,
      expectedPerformance: { winRate: 0.5, profitFactor: 1.2, sharpeRatio: 0.8 },
      confidence: 0.6,
      reasoning: `Rule-based ${strategyType} strategy for ${symbol}.`
    };
  }

  /**
   * Generate a rule-based multi-strategy combo when LLM is unavailable.
   * Uses weighted voting with majority-agreement entry signals.
   */
  private generateRuleBasedCombo(
    symbol: string,
    subStrategies: Strategy[],
    config: AgentConfig
  ): any {
    return {
      name: `Weighted Combo ${symbol}`,
      type: 'multi_strategy_combo',
      description: `Weighted voting combo: Trend 40%, Momentum 35%, Volume 25%. Requires 2+ strategy agreement for entry.`,
      weights: { trend: 0.4, momentum: 0.35, volume: 0.25 },
      entryConditions: [
        'At least 2 of 3 sub-strategies agree on direction',
        'Combined weighted score > 0.6 for long, < -0.6 for short',
        'No circuit breaker active'
      ],
      exitConditions: [
        'Any sub-strategy signals exit',
        'Combined score drops below ±0.3',
        'Trailing stop hit',
        'Max holding period (configurable) exceeded'
      ],
      riskManagement: {
        stopLossPercent: config.stopLossPercentage,
        takeProfitPercent: config.stopLossPercentage * 2,
        trailingStop: true,
        trailingStopPercent: config.stopLossPercentage * 0.6,
        maxPositionSize: config.positionSize,
        maxDrawdown: config.maxDrawdown,
        maxHoldingPeriodHours: config.tradingStyle === 'scalping' ? 2 : config.tradingStyle === 'day_trading' ? 24 : 168
      },
      subStrategies: subStrategies.map((s, i) => {
        // Default weights distributed evenly if more than 3 strategies
        const defaultWeights = [0.4, 0.35, 0.25];
        const weight = i < defaultWeights.length
          ? defaultWeights[i]
          : 1 / subStrategies.length;
        return { id: s.id, name: s.name, weight };
      }),
      confidence: 0.7,
      reasoning: `Rule-based multi-strategy combo for ${symbol} with weighted majority voting.`
    };
  }

  /**
   * Create multi-strategy combination
   * Falls back to rule-based combo if LLM is unavailable
   */
  private async createMultiStrategyCombo(
    session: AgentSession,
    symbol: string,
    subStrategies: Strategy[]
  ): Promise<Strategy> {
    const llmGenerator = getLLMStrategyGenerator();
    
    let comboCode = '';
    let comboName = `Multi-Combo: ${symbol}`;

    if (llmGenerator.isAvailable()) {
      try {
        // Generate combination logic using AI
        const comboPrompt = `
Create a multi-strategy combination that combines these strategies:

1. Trend Strategy: ${subStrategies[0].description}
2. Momentum Strategy: ${subStrategies[1].description}
3. Volume Strategy: ${subStrategies[2].description}

The combination should:
- Use weighted voting (Trend: 40%, Momentum: 35%, Volume: 25%)
- Only enter trades when at least 2 strategies agree
- Exit when any strategy signals exit
- Include proper risk management with ${session.config.stopLossPercentage}% stop loss

Generate the combination logic as executable JavaScript code.
`;

        const aiCombo = await llmGenerator.generateStrategy({
          symbol,
          timeframe: session.config.preferredTimeframes[0],
          strategyType: 'multi_strategy_combo',
          riskTolerance: 'moderate',
          indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Volume', 'OBV'],
          description: `Multi-strategy combination for ${symbol}`,
          customPrompt: comboPrompt
        } as any);

        comboCode = (aiCombo as any).code || JSON.stringify(aiCombo);
        comboName = (aiCombo as any).name || comboName;
      } catch (err: any) {
        logger.warn(`[Agent] LLM combo generation failed, using rule-based combo: ${err.message}`);
        comboCode = JSON.stringify(this.generateRuleBasedCombo(symbol, subStrategies, session.config));
      }
    } else {
      logger.info(`[Agent] Claude API not available — using rule-based combo for ${symbol}`);
      comboCode = JSON.stringify(this.generateRuleBasedCombo(symbol, subStrategies, session.config));
    }
    
    const comboStrategy: Strategy = {
      id: `combo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId: session.id,
      name: comboName,
      type: 'combo',
      symbol,
      timeframe: session.config.preferredTimeframes[0],
      indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Volume', 'OBV'],
      code: comboCode,
      description: `Multi-strategy combination for ${symbol}`,
      status: 'generated',
      performance: {
        winRate: 0,
        profitFactor: 0,
        totalTrades: 0,
        totalReturn: 0
      },
      subStrategies: subStrategies.map((s, i) => ({
        strategyId: s.id,
        weight: [0.4, 0.35, 0.25][i]
      })),
      createdAt: new Date()
    };
    
    this.strategies.set(comboStrategy.id, comboStrategy);
    await this.saveStrategy(comboStrategy);
    
    return comboStrategy;
  }

  /**
   * Run strategy lifecycle: backtest → paper → live
   * Integrates circuit breaker checks at each promotion gate.
   */
  private async runStrategyLifecycle(session: AgentSession, strategy: Strategy): Promise<void> {
    try {
      // Check circuit breaker before starting lifecycle
      const cbCheck = this.checkCircuitBreaker(session.id);
      if (!cbCheck.allowed) {
        logger.info(`[Lifecycle] Skipping ${strategy.name} — circuit breaker: ${cbCheck.reason}`);
        return;
      }

      // 1. Backtest
      logger.info(`Starting backtest for strategy ${strategy.name}`);
      
      // Parse the strategy code to extract type and parameters for the backtesting engine
      let engineType = 'momentum'; // safe default that the engine supports
      let engineParams: Record<string, any> = {};
      try {
        const parsed = JSON.parse(strategy.code);
        // Map rule-based strategy types to engine-supported signal generators
        const typeMap: Record<string, string> = {
          'trend_following': 'trend_following',
          'momentum': 'momentum',
          'breakout': 'breakout',
          'mean_reversion': 'mean_reversion',
          'scalping': 'momentum', // scalping uses momentum signals with tighter params
          'multi_strategy_combo': 'momentum'
        };
        engineType = typeMap[parsed.type] || typeMap[strategy.type] || 'momentum';
        engineParams = parsed.parameters || {};
      } catch {
        // LLM-generated code may not be valid JSON; fall back to momentum
        logger.warn(`[Lifecycle] Could not parse strategy code for ${strategy.name}, using momentum defaults`);
      }

      // Register strategy with the correct type and parameters for signal generation
      backtestingEngine.registerStrategy(strategy.id, {
        id: strategy.id,
        name: strategy.name,
        type: engineType,
        parameters: engineParams,
        code: strategy.code
      });
      
      const backtestResult = await backtestingEngine.runBacktest(strategy.id, {
        symbol: strategy.symbol,
        timeframe: strategy.timeframe || session.config.preferredTimeframes[0] || '1h',
        startDate: new Date(Date.now() - session.config.backtestPeriodDays * 24 * 60 * 60 * 1000),
        endDate: new Date(),
        initialCapital: 10000
      });
      
      // Backtest engine stores results in metrics sub-object; winRate is a percentage (0-100)
      const metrics = (backtestResult?.metrics || backtestResult || {}) as Record<string, any>;
      strategy.performance = {
        winRate: (metrics.winRate != null ? metrics.winRate / 100 : 0),
        profitFactor: metrics.profitFactor || 0,
        totalTrades: metrics.totalTrades || 0,
        totalReturn: metrics.totalReturn || 0
      };
      strategy.status = 'backtested';
      
      await this.saveStrategy(strategy);
      session.backtestsCompleted++;
      await this.saveSession(session);
      
      logger.info(`Backtest completed for ${strategy.name}:`, strategy.performance);
      this.broadcastEvent('strategy_backtested', {
        strategyId: strategy.id,
        name: strategy.name,
        performance: strategy.performance
      });
      this.emit('strategy:backtested', { strategyId: strategy.id, performance: strategy.performance });
      
      // 2. Promote to paper trading if backtest passes
      // Dynamic thresholds based on trading style
      const winRateThreshold = session.config.tradingStyle === 'scalping' ? 0.52 : 0.55;
      const profitFactorThreshold = session.config.tradingStyle === 'scalping' ? 1.3 : 1.5;

      if (strategy.performance.winRate > winRateThreshold && strategy.performance.profitFactor > profitFactorThreshold) {
        await this.promoteToPaperTrading(session, strategy);
      } else {
        logger.info(`Strategy ${strategy.name} failed backtest (WR: ${strategy.performance.winRate}, PF: ${strategy.performance.profitFactor}), retiring`);
        await this.retireStrategy(strategy, 'failed_backtest');
      }
      
    } catch (error) {
      logger.error(`Error in strategy lifecycle for ${strategy.name}:`, error);
      await this.retireStrategy(strategy, 'error');
    }
  }

  /**
   * Promote strategy to paper trading
   */
  private async promoteToPaperTrading(session: AgentSession, strategy: Strategy): Promise<void> {
    logger.info(`Promoting ${strategy.name} to paper trading`);
    
    strategy.status = 'paper_trading';
    strategy.promotedAt = new Date();
    await this.saveStrategy(strategy);
    
    // Fetch real account balance to use as paper trading capital
    let initialCapital = 10000; // fallback
    try {
      const credentials = await apiCredentialsService.getCredentials(session.userId);
      if (credentials) {
        const balance = await poloniexFuturesService.getAccountBalance(credentials);
        const accountEquity = parseFloat(balance?.accountEquity ?? balance?.eq ?? '0');
        if (accountEquity > 0) {
          initialCapital = accountEquity;
          logger.info(`Using real account balance $${initialCapital.toFixed(2)} for paper trading`);
        }
      }
    } catch (err) {
      logger.warn(`Could not fetch account balance for paper trading, using default $${initialCapital}:`, err);
    }
    
    // Start paper trading session
    // First create the session, then start it with strategy config
    let parsedStrategyCode: any = null;
    try { parsedStrategyCode = JSON.parse(strategy.code); } catch { /* LLM code may not be JSON */ }

    const paperSession = await paperTradingService.createSession({
      name: `Paper: ${strategy.name}`,
      strategyName: strategy.name,
      symbol: strategy.symbol,
      timeframe: strategy.timeframe || session.config.preferredTimeframes[0] || '1h',
      initialCapital,
      strategy: parsedStrategyCode
    });
    
    // Track mapping from strategy ID → paper session ID for later result lookup
    this.paperSessionIds.set(strategy.id, paperSession.id);
    
    await paperTradingService.startSession(paperSession.id, parsedStrategyCode);
    
    this.emit('strategy:paper_trading', { strategyId: strategy.id });
    
    // Schedule check for promotion to live trading
    setTimeout(async () => {
      await this.checkPaperTradingResults(session, strategy);
    }, session.config.paperTradingDurationHours * 60 * 60 * 1000);
  }

  /**
   * Check paper trading results and promote to live if successful.
   * Uses dynamic thresholds based on trading style.
   */
  private async checkPaperTradingResults(session: AgentSession, strategy: Strategy): Promise<void> {
    try {
      // Check circuit breaker before promoting to live
      const cbCheck = this.checkCircuitBreaker(session.id);
      if (!cbCheck.allowed) {
        logger.info(`[Lifecycle] Not promoting ${strategy.name} to live — circuit breaker: ${cbCheck.reason}`);
        return;
      }

      const paperSessionId = this.paperSessionIds.get(strategy.id);
      const paperSession = paperSessionId ? paperTradingService.getSession(paperSessionId) : null;
      const paperResults = paperSession ? {
        winRate: paperSession.winRate || 0,
        profitFactor: (paperSession.losingTrades > 0 && paperSession.winningTrades > 0)
          ? paperSession.winningTrades / paperSession.losingTrades : 0,
        totalTrades: paperSession.totalTrades || 0
      } : null;
      
      // Dynamic thresholds: scalping strategies need fewer trades but similar ratios
      const minWinRate = session.config.tradingStyle === 'scalping' ? 0.55 : 0.58;
      const minProfitFactor = session.config.tradingStyle === 'scalping' ? 1.5 : 1.8;
      const minTrades = session.config.tradingStyle === 'scalping' ? 10 : 5;

      if (paperResults && 
          paperResults.winRate > minWinRate && 
          paperResults.profitFactor > minProfitFactor &&
          paperResults.totalTrades >= minTrades) {
        await this.promoteToLiveTrading(session, strategy);
      } else {
        const reason = paperResults 
          ? `WR: ${(paperResults.winRate * 100).toFixed(1)}% (need >${(minWinRate * 100).toFixed(0)}%), PF: ${paperResults.profitFactor.toFixed(2)} (need >${minProfitFactor}), Trades: ${paperResults.totalTrades} (need >=${minTrades})`
          : 'no paper trading data';
        logger.info(`Strategy ${strategy.name} failed paper trading (${reason}), retiring`);
        await this.retireStrategy(strategy, 'failed_paper_trading');
      }
    } catch (error) {
      logger.error(`Error checking paper trading results for ${strategy.name}:`, error);
    }
  }

  /**
   * Promote strategy to live trading.
   * Applies drawdown-adjusted position sizing for safety.
   */
  private async promoteToLiveTrading(session: AgentSession, strategy: Strategy): Promise<void> {
    logger.info(`Promoting ${strategy.name} to LIVE trading`);
    
    strategy.status = 'live';
    strategy.promotedAt = new Date();
    await this.saveStrategy(strategy);
    
    // Calculate drawdown-adjusted position size
    const maxDrawdown = await this.calculateMaxDrawdown(strategy.id);
    const basePositionSize = session.config.positionSize / 100;
    const adjustedPositionSize = this.getDrawdownAdjustedPositionSize(basePositionSize, maxDrawdown);

    // Register strategy for live trading with adjusted sizing
    await automatedTradingService.registerStrategy(session.userId, {
      id: strategy.id,
      strategyId: strategy.id,
      symbol: strategy.symbol,
      positionSize: adjustedPositionSize,
      maxPositions: 1
    });
    
    this.broadcastEvent('strategy_promoted_live', {
      strategyId: strategy.id,
      name: strategy.name,
      positionSize: adjustedPositionSize,
      drawdownAdjusted: adjustedPositionSize < basePositionSize
    });
    this.emit('strategy:live', { strategyId: strategy.id });
  }

  /**
   * Retire a strategy
   */
  private async retireStrategy(strategy: Strategy, reason: string): Promise<void> {
    strategy.status = 'retired';
    strategy.retiredAt = new Date();
    await this.saveStrategy(strategy);
    
    logger.info(`Strategy ${strategy.name} retired: ${reason}`);
    this.emit('strategy:retired', { strategyId: strategy.id, reason });
  }

  /**
   * Stop the agent
   */
  async stopAgent(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.status = 'stopped';
    session.stoppedAt = new Date();
    await this.saveSession(session);

    // Clear interval
    const interval = this.runningIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.runningIntervals.delete(sessionId);
    }

    logger.info(`Agent stopped for session ${sessionId}`);
    this.emit('agent:stopped', { sessionId });
  }

  /**
   * Pause the agent
   */
  async pauseAgent(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const interval = this.runningIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.runningIntervals.delete(sessionId);
    }

    session.status = 'paused';
    await this.saveSession(session);

    logger.info(`Agent paused for session ${sessionId}`);
    this.emit('agent:paused', { sessionId });
  }

  /**
   * Get agent status
   */
  async getAgentStatus(userId: string): Promise<AgentSession | null> {
    const session = Array.from(this.sessions.values()).find(
      s => s.userId === userId && (s.status === 'running' || s.status === 'paused')
    );
    return session || null;
  }

  /**
   * Get all strategies for a session
   */
  async getStrategies(sessionId: string): Promise<Strategy[]> {
    return Array.from(this.strategies.values()).filter(
      s => s.sessionId === sessionId
    );
  }

  /**
   * Get all strategies for a user
   */
  async getUserStrategies(userId: string): Promise<Strategy[]> {
    const userSessions = Array.from(this.sessions.values()).filter(
      s => s.userId === userId
    );
    const sessionIds = userSessions.map(s => s.id);
    
    return Array.from(this.strategies.values()).filter(
      s => sessionIds.includes(s.sessionId)
    );
  }

  /**
   * Get capability profiles for all strategies in a session.
   */
  async getSessionCapabilityProfiles(sessionId: string): Promise<StrategyCapabilityProfile[]> {
    const strategies = await this.getStrategies(sessionId);
    const profiles = await Promise.all(
      strategies.map(async (strategy) => {
        const recentPerformance = await this.getStrategyRecentPerformance(strategy.id);
        const metrics = {
          winRate: strategy.performance.winRate || recentPerformance.winRate || 0,
          profitFactor: strategy.performance.profitFactor || recentPerformance.profitFactor || 0,
          totalTrades: strategy.performance.totalTrades || recentPerformance.totalTrades || 0,
          totalReturn: strategy.performance.totalReturn || recentPerformance.returnRate || 0,
          sharpeRatio: recentPerformance.sharpeRatio || 0,
          maxDrawdown: recentPerformance.maxDrawdown || 0
        };
        const compositeScore = calculateCompositeCapabilityScore(metrics);
        return {
          strategyId: strategy.id,
          strategyName: strategy.name,
          status: strategy.status,
          symbol: strategy.symbol,
          compositeScore,
          capabilityClass: getStrategyCapabilityClass(compositeScore),
          metrics,
          hints: generateCapabilityHints(metrics)
        };
      })
    );

    return profiles.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  /**
   * Save session to database
   */
  private async saveSession(session: AgentSession): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO agent_sessions (id, user_id, status, started_at, stopped_at, strategies_generated, backtests_completed, paper_trades_executed, live_trades_executed, total_pnl, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           stopped_at = EXCLUDED.stopped_at,
           strategies_generated = EXCLUDED.strategies_generated,
           backtests_completed = EXCLUDED.backtests_completed,
           paper_trades_executed = EXCLUDED.paper_trades_executed,
           live_trades_executed = EXCLUDED.live_trades_executed,
           total_pnl = EXCLUDED.total_pnl,
           config = EXCLUDED.config`,
        [
          session.id,
          session.userId,
          session.status,
          session.startedAt,
          session.stoppedAt,
          session.strategiesGenerated,
          session.backtestsCompleted,
          session.paperTradesExecuted,
          session.liveTradesExecuted,
          session.totalPnl,
          JSON.stringify(session.config)
        ]
      );
    } catch (error) {
      logger.error('Error saving session:', error);
    }
  }

  /**
   * Save strategy to database
   */
  private async saveStrategy(strategy: Strategy): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO agent_strategies (id, session_id, name, type, symbol, timeframe, indicators, code, description, status, performance, sub_strategies, created_at, promoted_at, retired_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           performance = EXCLUDED.performance,
           promoted_at = EXCLUDED.promoted_at,
           retired_at = EXCLUDED.retired_at`,
        [
          strategy.id,
          strategy.sessionId,
          strategy.name,
          strategy.type,
          strategy.symbol,
          strategy.timeframe,
          JSON.stringify(strategy.indicators),
          strategy.code,
          strategy.description,
          strategy.status,
          JSON.stringify(strategy.performance),
          JSON.stringify(strategy.subStrategies || []),
          strategy.createdAt,
          strategy.promotedAt,
          strategy.retiredAt
        ]
      );
    } catch (error) {
      logger.error('Error saving strategy:', error);
    }
  }

  /**
   * PROFIT MAXIMIZATION: Optimize strategy allocation based on real-time performance
   * Dynamically adjusts position sizes to maximize returns while managing risk
   */
  private async optimizeStrategyAllocation(session: AgentSession): Promise<void> {
    try {
      // Get all live strategies for this session
      const liveStrategies = Array.from(this.strategies.values()).filter(
        s => s.sessionId === session.id && s.status === 'live'
      );

      if (liveStrategies.length === 0) {
        return;
      }

      logger.info(`Optimizing allocation for ${liveStrategies.length} live strategies`);

      // Calculate performance metrics for each strategy
      const strategyMetrics = await Promise.all(
        liveStrategies.map(async (strategy) => {
          const recentPerformance = await this.getStrategyRecentPerformance(strategy.id);
          const compositeScore = calculateCompositeCapabilityScore({
            winRate: recentPerformance.winRate,
            profitFactor: recentPerformance.profitFactor,
            totalTrades: recentPerformance.totalTrades,
            totalReturn: recentPerformance.returnRate,
            sharpeRatio: recentPerformance.sharpeRatio,
            maxDrawdown: recentPerformance.maxDrawdown
          });
          return {
            strategy,
            sharpeRatio: recentPerformance.sharpeRatio,
            returnRate: recentPerformance.returnRate,
            winRate: recentPerformance.winRate,
            profitFactor: recentPerformance.profitFactor,
            maxDrawdown: recentPerformance.maxDrawdown,
            compositeScore
          };
        })
      );

      // Sort strategies by capability score first, then by Sharpe ratio
      const rankedStrategies = strategyMetrics
        .filter(m => m.sharpeRatio > 0.5 || m.compositeScore >= 50)
        .sort((a, b) => {
          if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
          return b.sharpeRatio - a.sharpeRatio;
        });

      // Calculate optimal allocation using Kelly Criterion for top performers
      // totalCapital is the total capital available for allocation across all strategies
      // positionSize is stored as a decimal (e.g., 0.1 = 10%), multiply by 1000 for dollar amount
      const totalCapital = session.config.positionSize * 1000; // e.g., 0.1 * 1000 = $100
      const allocations = this.calculateKellyAllocations(rankedStrategies, totalCapital);

      // Update strategy position sizes in automated trading service
      for (const allocation of allocations) {
        await automatedTradingService.updateStrategyAllocation(
          session.userId,
          allocation.strategyId,
          allocation.positionSize
        );
        
        logger.info(
          `Optimized allocation for ${allocation.strategyName}: ` +
          `${(allocation.positionSize * 100).toFixed(2)}% ` +
          `(Sharpe: ${allocation.sharpeRatio.toFixed(2)}, Capability: ${allocation.compositeScore})`
        );
      }

      this.emit('allocation:optimized', { 
        sessionId: session.id, 
        allocations,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error optimizing strategy allocation:', error);
    }
  }

  /**
   * Calculate optimal position sizes using Kelly Criterion
   * Maximizes long-term growth rate while managing risk
   */
  private calculateKellyAllocations(
    strategies: Array<any>,
    totalCapital: number
  ): Array<any> {
    const allocations: Array<any> = [];
    let remainingCapital = totalCapital;

    for (const metric of strategies) {
      // Kelly Criterion: f* = (p * b - q) / b
      // where p = win probability, q = loss probability, b = win/loss ratio
      const p = metric.winRate;
      const q = 1 - p;
      const b = metric.profitFactor; // Average win / average loss

      // Calculate Kelly fraction (cap at 25% for safety)
      // Guard against division by zero when profit factor is 0
      const kellyFraction = b > 0 
        ? Math.max(0, Math.min(0.25, (p * b - q) / b))
        : 0;
      
      // Apply fractional Kelly (50% of full Kelly for more conservative sizing)
      const fractionalKelly = kellyFraction * 0.5;
      
      // Calculate position size with remaining capital
      const positionSize = fractionalKelly * remainingCapital;
      
      if (positionSize > 0 && remainingCapital > 0) {
        allocations.push({
          strategyId: metric.strategy.id,
          strategyName: metric.strategy.name,
          positionSize: positionSize / totalCapital, // As fraction of total
          kellyFraction: fractionalKelly,
          sharpeRatio: metric.sharpeRatio,
          expectedReturn: metric.returnRate,
          compositeScore: metric.compositeScore || 0
        });
        
        remainingCapital -= positionSize;
      }
    }

    return allocations;
  }

  /**
   * Get recent performance metrics for a strategy
   */
  private async getStrategyRecentPerformance(strategyId: string): Promise<any> {
    try {
      // Query recent trades for this strategy (last 30 days)
      const result = await pool.query(
        `SELECT 
          COUNT(*) as total_trades,
          SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
          AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END) as avg_win,
          AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END) as avg_loss,
          SUM(realized_pnl) as total_pnl,
          STDDEV(realized_pnl) as pnl_stddev
         FROM trades
         WHERE strategy_id = $1 
           AND created_at > NOW() - INTERVAL '30 days'
           AND status = 'closed'`,
        [strategyId]
      );

      const row = result.rows[0];
      const totalTrades = parseInt(row.total_trades) || 0;
      const winningTrades = parseInt(row.winning_trades) || 0;
      const avgWin = parseFloat(row.avg_win) || 0;
      const avgLoss = Math.abs(parseFloat(row.avg_loss)) || 0; // Don't default to 1
      const totalPnl = parseFloat(row.total_pnl) || 0;
      const pnlStddev = parseFloat(row.pnl_stddev) || 1;

      const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
      // Calculate profit factor, handling edge cases properly
      const profitFactor = (avgLoss > 0 && avgWin > 0) ? avgWin / avgLoss : 
                          (avgWin > 0 ? 2.0 : 0.5); // Assume 2:1 if only wins, 0.5 if only losses
      const returnRate = totalPnl; // Absolute return in last 30 days
      
      // Calculate Sharpe ratio: (average return per trade) / (standard deviation of returns)
      // Fixed: properly calculate average return before dividing by stddev
      const avgReturnPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
      const sharpeRatio = (pnlStddev > 0 && totalTrades > 0) ? avgReturnPerTrade / pnlStddev : 0;

      // Calculate max drawdown (simplified)
      const maxDrawdown = await this.calculateMaxDrawdown(strategyId);

      return {
        winRate,
        profitFactor,
        returnRate,
        sharpeRatio,
        maxDrawdown,
        totalTrades
      };
    } catch (error) {
      logger.error(`Error getting performance for strategy ${strategyId}:`, error);
      return {
        winRate: 0.5,
        profitFactor: 1.0,
        returnRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        totalTrades: 0
      };
    }
  }

  /**
   * Calculate maximum drawdown for a strategy
   */
  private async calculateMaxDrawdown(strategyId: string): Promise<number> {
    try {
      // Get cumulative PnL over time
      const result = await pool.query(
        `SELECT 
          created_at,
          SUM(realized_pnl) OVER (ORDER BY created_at) as cumulative_pnl
         FROM trades
         WHERE strategy_id = $1 
           AND created_at > NOW() - INTERVAL '30 days'
           AND status = 'closed'
         ORDER BY created_at`,
        [strategyId]
      );

      if (result.rows.length === 0) return 0;

      let maxPnl = 0;
      let maxDrawdown = 0;

      for (const row of result.rows) {
        const cumulativePnl = parseFloat(row.cumulative_pnl);
        maxPnl = Math.max(maxPnl, cumulativePnl);
        const drawdown = maxPnl - cumulativePnl;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }

      return maxDrawdown;
    } catch (error) {
      logger.error(`Error calculating max drawdown for strategy ${strategyId}:`, error);
      return 0;
    }
  }

  /**
   * Start periodic allocation optimization
   * Runs every hour to rebalance strategy allocations based on performance
   */
  private startAllocationOptimization(session: AgentSession): void {
    const optimizationInterval = setInterval(async () => {
      try {
        if (session.status === 'running') {
          await this.optimizeStrategyAllocation(session);
        }
      } catch (error) {
        logger.error('Error in allocation optimization loop:', error);
      }
    }, 60 * 60 * 1000); // Run every hour

    // Store interval for cleanup with a unique key
    // Use a separate tracking map or consistent naming to avoid conflicts
    this.runningIntervals.set(`${session.id}_optimization`, optimizationInterval);

    logger.info(`Started allocation optimization for session ${session.id}`);
  }
}

export const enhancedAutonomousAgent = new EnhancedAutonomousAgent();
export default enhancedAutonomousAgent;
