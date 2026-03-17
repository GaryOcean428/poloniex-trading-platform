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

class EnhancedAutonomousAgent extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map();
  private runningIntervals: Map<string, NodeJS.Timeout> = new Map();
  private strategies: Map<string, Strategy> = new Map();
  private io: SocketIOServer | null = null;

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
        riskManagement: { stopLossPercent: config.stopLossPercentage, takeProfitPercent: config.stopLossPercentage * 2, maxPositionSize: config.positionSize, maxDrawdown: config.maxDrawdown }
      },
      momentum: {
        name: `RSI Momentum ${symbol}`,
        type: 'momentum',
        description: 'Buys oversold RSI conditions (<30) and sells overbought (>70).',
        parameters: { rsiPeriod: 14, oversoldLevel: 30, overboughtLevel: 70 },
        entryConditions: ['RSI(14) < 30 for long', 'RSI(14) > 70 for short'],
        exitConditions: ['RSI returns to neutral zone (40-60)', 'Fixed take-profit hit'],
        riskManagement: { stopLossPercent: config.stopLossPercentage, takeProfitPercent: config.stopLossPercentage * 1.5, maxPositionSize: config.positionSize, maxDrawdown: config.maxDrawdown }
      },
      volume_analysis: {
        name: `Volume Breakout ${symbol}`,
        type: 'breakout',
        description: 'Trades breakouts above/below Bollinger Bands with volume confirmation.',
        parameters: { bbPeriod: 20, bbStdDev: 2.0, volumeThreshold: 1.5 },
        entryConditions: ['Price closes above upper BB with 1.5x avg volume for long', 'Price closes below lower BB for short'],
        exitConditions: ['Price returns to middle band', 'Trailing stop at opposite band'],
        riskManagement: { stopLossPercent: config.stopLossPercentage, takeProfitPercent: config.stopLossPercentage * 2.5, maxPositionSize: config.positionSize, maxDrawdown: config.maxDrawdown }
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
   * Create multi-strategy combination
   */
  private async createMultiStrategyCombo(
    session: AgentSession,
    symbol: string,
    subStrategies: Strategy[]
  ): Promise<Strategy> {
    const llmGenerator = getLLMStrategyGenerator();
    
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
    
    const comboStrategy: Strategy = {
      id: `combo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId: session.id,
      name: `Multi-Combo: ${symbol}`,
      type: 'combo',
      symbol,
      timeframe: session.config.preferredTimeframes[0],
      indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Volume', 'OBV'],
      code: (aiCombo as any).code || JSON.stringify(aiCombo),
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
   */
  private async runStrategyLifecycle(session: AgentSession, strategy: Strategy): Promise<void> {
    try {
      // 1. Backtest
      logger.info(`Starting backtest for strategy ${strategy.name}`);
      
      // Register strategy first
      backtestingEngine.registerStrategy(strategy.id, {
        id: strategy.id,
        name: strategy.name,
        type: 'custom',
        parameters: {},
        code: strategy.code
      });
      
      const backtestResult = await backtestingEngine.runBacktest(strategy.id, {
        symbol: strategy.symbol,
        startDate: new Date(Date.now() - session.config.backtestPeriodDays * 24 * 60 * 60 * 1000),
        endDate: new Date(),
        initialCapital: 10000
      });
      
      strategy.performance = {
        winRate: backtestResult.winRate || 0,
        profitFactor: backtestResult.profitFactor || 0,
        totalTrades: backtestResult.totalTrades || 0,
        totalReturn: backtestResult.totalReturn || 0
      };
      strategy.status = 'backtested';
      
      await this.saveStrategy(strategy);
      session.backtestsCompleted++;
      await this.saveSession(session);
      
      logger.info(`Backtest completed for ${strategy.name}:`, strategy.performance);
      this.emit('strategy:backtested', { strategyId: strategy.id, performance: strategy.performance });
      
      // 2. Promote to paper trading if backtest passes
      if (strategy.performance.winRate > 0.55 && strategy.performance.profitFactor > 1.5) {
        await this.promoteToPaperTrading(session, strategy);
      } else {
        logger.info(`Strategy ${strategy.name} failed backtest, retiring`);
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
    await paperTradingService.startSession({
      userId: session.userId,
      strategyId: strategy.id,
      symbol: strategy.symbol,
      initialCapital,
      duration: session.config.paperTradingDurationHours * 60 * 60 * 1000
    });
    
    this.emit('strategy:paper_trading', { strategyId: strategy.id });
    
    // Schedule check for promotion to live trading
    setTimeout(async () => {
      await this.checkPaperTradingResults(session, strategy);
    }, session.config.paperTradingDurationHours * 60 * 60 * 1000);
  }

  /**
   * Check paper trading results and promote to live if successful
   */
  private async checkPaperTradingResults(session: AgentSession, strategy: Strategy): Promise<void> {
    try {
      const paperSession = paperTradingService.getSession(strategy.id);
      const paperResults = paperSession ? {
        winRate: paperSession.totalTrades > 0 ? (paperSession.winningTrades / paperSession.totalTrades) : 0,
        profitFactor: paperSession.losingTrades > 0 ? 
          Math.abs(paperSession.winningTrades / paperSession.losingTrades) : 0
      } : null;
      
      if (paperResults && paperResults.winRate > 0.60 && paperResults.profitFactor > 2.0) {
        await this.promoteToLiveTrading(session, strategy);
      } else {
        logger.info(`Strategy ${strategy.name} failed paper trading, retiring`);
        await this.retireStrategy(strategy, 'failed_paper_trading');
      }
    } catch (error) {
      logger.error(`Error checking paper trading results for ${strategy.name}:`, error);
    }
  }

  /**
   * Promote strategy to live trading
   */
  private async promoteToLiveTrading(session: AgentSession, strategy: Strategy): Promise<void> {
    logger.info(`Promoting ${strategy.name} to LIVE trading`);
    
    strategy.status = 'live';
    strategy.promotedAt = new Date();
    await this.saveStrategy(strategy);
    
    // Register strategy for live trading
    await automatedTradingService.registerStrategy(session.userId, {
      id: strategy.id,
      strategyId: strategy.id,
      symbol: strategy.symbol,
      positionSize: session.config.positionSize / 100,
      maxPositions: 1
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
          return {
            strategy,
            sharpeRatio: recentPerformance.sharpeRatio,
            returnRate: recentPerformance.returnRate,
            winRate: recentPerformance.winRate,
            profitFactor: recentPerformance.profitFactor,
            maxDrawdown: recentPerformance.maxDrawdown
          };
        })
      );

      // Sort strategies by risk-adjusted returns (Sharpe ratio)
      const rankedStrategies = strategyMetrics
        .filter(m => m.sharpeRatio > 0.5) // Only keep strategies with positive risk-adjusted returns
        .sort((a, b) => b.sharpeRatio - a.sharpeRatio);

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
          `(Sharpe: ${allocation.sharpeRatio.toFixed(2)})`
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
          expectedReturn: metric.returnRate
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
