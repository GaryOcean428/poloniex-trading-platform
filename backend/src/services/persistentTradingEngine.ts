/**
 * Persistent Autonomous Trading Engine
 * Runs independently of user sessions, survives server restarts
 * Executes trading strategies for all users with stored credentials
 */

import { EventEmitter } from 'events';
import { apiCredentialsService } from './apiCredentialsService.js';
import { PoloniexFuturesService } from './poloniexFuturesService.js';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import automatedTradingService from './automatedTradingService.js';

export interface TradingSession {
  id: string;
  userId: string;
  sessionName: string | null;
  isActive: boolean;
  strategyConfig: any;
  riskConfig: any;
  positionState: any;
  performanceMetrics: any;
  startedAt: Date;
  stoppedAt: Date | null;
  lastHeartbeatAt: Date;
}

export interface StrategyExecutionContext {
  userId: string;
  session: TradingSession;
  poloniexService: PoloniexFuturesService;
  credentials: {
    apiKey: string;
    apiSecret: string;
  };
}

export class PersistentTradingEngine extends EventEmitter {
  private isRunning: boolean = false;
  private executionIntervalMs: number = 5000; // Check every 5 seconds
  private intervalId: NodeJS.Timeout | null = null;
  private activeContexts: Map<string, StrategyExecutionContext> = new Map();

  constructor() {
    super();
    logger.info('Persistent Trading Engine initialized');
  }

  /**
   * Start the trading engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Trading engine is already running');
      return;
    }

    logger.info('Starting Persistent Trading Engine...');
    this.isRunning = true;

    // Load all active trading sessions
    await this.loadActiveSessions();

    // Start execution loop
    this.intervalId = setInterval(() => {
      this.executeTradingCycle().catch(error => {
        logger.error('Error in trading cycle:', error);
      });
    }, this.executionIntervalMs);

    // Initial execution
    await this.executeTradingCycle();

    logger.info('✅ Persistent Trading Engine started');
    this.emit('started');
  }

  /**
   * Stop the trading engine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping Persistent Trading Engine...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Save all session states before stopping
    await this.saveAllSessionStates();

    this.activeContexts.clear();

    logger.info('✅ Persistent Trading Engine stopped');
    this.emit('stopped');
  }

  /**
   * Load all active trading sessions from database
   */
  private async loadActiveSessions(): Promise<void> {
    try {
      const result = await pool.query<TradingSession>(
        `SELECT * FROM trading_sessions WHERE is_active = true`
      );

      logger.info(`Loading ${result.rows.length} active trading sessions`);

      for (const session of result.rows) {
        await this.initializeSessionContext(session);
      }
    } catch (error) {
      logger.error('Error loading active sessions:', error);
    }
  }

  /**
   * Initialize execution context for a trading session
   */
  private async initializeSessionContext(session: TradingSession): Promise<void> {
    try {
      // Get user's API credentials
      const credentials = await apiCredentialsService.getCredentials(session.userId);
      
      if (!credentials) {
        logger.warn(`No credentials found for user ${session.userId}, skipping session ${session.id}`);
        return;
      }

      // Create Poloniex service instance
      const poloniexService = new PoloniexFuturesService();

      // Store context
      const context: StrategyExecutionContext = {
        userId: session.userId,
        session,
        poloniexService,
        credentials: {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret
        }
      };

      this.activeContexts.set(session.id, context);
      
      logger.info(`✅ Initialized trading context for session ${session.id} (user: ${session.userId})`);
    } catch (error) {
      logger.error(`Error initializing session ${session.id}:`, error);
    }
  }

  /**
   * Main trading execution cycle
   */
  private async executeTradingCycle(): Promise<void> {
    if (!this.isRunning || this.activeContexts.size === 0) {
      return;
    }

    logger.debug(`Executing trading cycle for ${this.activeContexts.size} sessions`);

    for (const [sessionId, context] of this.activeContexts.entries()) {
      try {
        await this.executeSessionStrategy(context);
        await this.updateSessionHeartbeat(sessionId);
      } catch (error) {
        logger.error(`Error executing strategy for session ${sessionId}:`, error);
        this.emit('error', { sessionId, error });
      }
    }
  }

  /**
   * Execute trading strategy for a session
   */
  private async executeSessionStrategy(context: StrategyExecutionContext): Promise<void> {
    const { session, poloniexService } = context;
    const { strategyConfig, positionState } = session;

    logger.debug(`Executing strategy for session ${session.id}: ${session.sessionName || 'Unnamed'}`);

    try {
      // 1. Get current account balance and positions
      const accountInfo = await poloniexService.getAccountBalance({
        apiKey: context.credentials.apiKey,
        apiSecret: context.credentials.apiSecret
      });

      const positions = await poloniexService.getPositions(
        { apiKey: context.credentials.apiKey, apiSecret: context.credentials.apiSecret },
        strategyConfig.symbol
      );

      // 2. Analyze market conditions (get current market data)
      const marketData = await this.getMarketData(strategyConfig.symbol);
      if (!marketData) {
        logger.debug(`No market data available for ${strategyConfig.symbol}`);
        return;
      }

      // 3. Generate trading signals based on strategy type
      const signal = await this.generateTradingSignal(
        strategyConfig,
        marketData,
        positions,
        positionState
      );

      // 4. Execute trades if signal is valid
      if (signal && signal.action !== 'HOLD') {
        await this.executeTrade(context, signal, marketData);
      }

      // 5. Update performance metrics
      const updatedMetrics = {
        ...session.performanceMetrics,
        lastBalance: accountInfo.data?.accountEquity || 0,
        lastCheckTime: new Date().toISOString(),
        lastSignal: signal?.action || 'HOLD',
        lastPrice: marketData.price
      };

      await this.updateSessionMetrics(session.id, updatedMetrics);
      
    } catch (error) {
      logger.error(`Error executing strategy for session ${session.id}:`, error);
      this.emit('error', { sessionId: session.id, error });
    }
  }

  /**
   * Get current market data for a symbol
   */
  private async getMarketData(symbol: string): Promise<any> {
    try {
      // Get historical candles to provide current market data with context
      const poloniexService = new PoloniexFuturesService();
      const candles = await poloniexService.getHistoricalData(symbol, '1h', 24);
      
      if (!candles || candles.length === 0) {
        logger.warn(`No market data available for ${symbol}`);
        return null;
      }
      
      const lastCandle = candles[candles.length - 1];
      return {
        symbol,
        price: parseFloat(lastCandle.close),
        open: parseFloat(lastCandle.open),
        high: parseFloat(lastCandle.high),
        low: parseFloat(lastCandle.low),
        volume: parseFloat(lastCandle.volume),
        timestamp: new Date(lastCandle.timestamp),
        candles // Include recent candles for strategy analysis
      };
    } catch (error) {
      logger.error(`Error getting market data for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Generate trading signal based on strategy configuration
   */
  private async generateTradingSignal(
    strategyConfig: any,
    marketData: any,
    positions: any,
    positionState: any
  ): Promise<any> {
    try {
      if (!marketData || !marketData.price || marketData.price === 0) {
        return { action: 'HOLD' };
      }
      
      // Create a strategy object compatible with automatedTradingService
      const strategy = {
        strategyType: strategyConfig.type || 'MOMENTUM',
        parameters: strategyConfig.parameters || {},
        symbol: strategyConfig.symbol
      };
      
      // Delegate to automatedTradingService for actual strategy execution
      const signal = await automatedTradingService.executeStrategyLogic(
        strategy,
        marketData,
        positions
      );
      
      return signal || { action: 'HOLD' };
    } catch (error) {
      logger.error('Error generating trading signal:', error);
      return { action: 'HOLD' };
    }
  }

  /**
   * Execute a trade based on signal
   */
  private async executeTrade(
    context: StrategyExecutionContext,
    signal: any,
    marketData: any
  ): Promise<void> {
    const { poloniexService, credentials, session } = context;
    
    try {
      logger.info(`Executing trade for session ${session.id}: ${signal.action}`);
      
      // Place order through Poloniex API
      const orderData = {
        symbol: session.strategyConfig.symbol,
        side: signal.action === 'BUY' ? 'buy' : 'sell',
        type: 'market',
        size: signal.size || session.strategyConfig.defaultSize,
        leverage: session.strategyConfig.leverage || 1
      };

      const result = await poloniexService.placeOrder(credentials, orderData);
      
      logger.info(`Trade executed successfully for session ${session.id}:`, result);
      this.emit('trade-executed', { sessionId: session.id, signal, result });
      
    } catch (error) {
      logger.error(`Error executing trade for session ${session.id}:`, error);
      throw error;
    }
  }

  /**
   * Update session heartbeat
   */
  private async updateSessionHeartbeat(sessionId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE trading_sessions 
         SET last_heartbeat_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [sessionId]
      );
    } catch (error) {
      logger.error(`Error updating heartbeat for session ${sessionId}:`, error);
    }
  }

  /**
   * Update session performance metrics
   */
  private async updateSessionMetrics(sessionId: string, metrics: any): Promise<void> {
    try {
      await pool.query(
        `UPDATE trading_sessions 
         SET performance_metrics = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [JSON.stringify(metrics), sessionId]
      );
    } catch (error) {
      logger.error(`Error updating metrics for session ${sessionId}:`, error);
    }
  }

  /**
   * Save all session states before shutdown
   */
  private async saveAllSessionStates(): Promise<void> {
    logger.info('Saving all trading session states...');

    for (const [sessionId, context] of this.activeContexts.entries()) {
      try {
        await this.updateSessionMetrics(sessionId, context.session.performanceMetrics);
      } catch (error) {
        logger.error(`Error saving state for session ${sessionId}:`, error);
      }
    }

    logger.info('✅ All session states saved');
  }

  /**
   * Start a new trading session for a user
   */
  async startSession(
    userId: string,
    strategyConfig: any,
    riskConfig?: any,
    sessionName?: string
  ): Promise<string> {
    try {
      // Create new session in database
      const result = await pool.query(
        `INSERT INTO trading_sessions (
          user_id, session_name, is_active, strategy_config, risk_config, 
          position_state, performance_metrics
        ) VALUES ($1, $2, true, $3, $4, $5, $6)
        RETURNING id`,
        [
          userId,
          sessionName || null,
          JSON.stringify(strategyConfig),
          JSON.stringify(riskConfig || {}),
          JSON.stringify({}),
          JSON.stringify({})
        ]
      );

      const sessionId = result.rows[0].id;

      // Load the new session
      const sessionResult = await pool.query<TradingSession>(
        `SELECT * FROM trading_sessions WHERE id = $1`,
        [sessionId]
      );

      await this.initializeSessionContext(sessionResult.rows[0]);

      logger.info(`✅ Started new trading session ${sessionId} for user ${userId}`);
      this.emit('session-started', { sessionId, userId });

      return sessionId;
    } catch (error) {
      logger.error('Error starting trading session:', error);
      throw error;
    }
  }

  /**
   * Stop a trading session
   */
  async stopSession(sessionId: string): Promise<void> {
    try {
      // Update database
      await pool.query(
        `UPDATE trading_sessions 
         SET is_active = false, stopped_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [sessionId]
      );

      // Remove from active contexts
      this.activeContexts.delete(sessionId);

      logger.info(`✅ Stopped trading session ${sessionId}`);
      this.emit('session-stopped', { sessionId });
    } catch (error) {
      logger.error(`Error stopping session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get status of all active sessions
   */
  getActiveSessionsStatus(): Array<{
    sessionId: string;
    userId: string;
    sessionName: string | null;
    startedAt: Date;
    lastHeartbeat: Date;
  }> {
    return Array.from(this.activeContexts.entries()).map(([sessionId, context]) => ({
      sessionId,
      userId: context.userId,
      sessionName: context.session.sessionName,
      startedAt: context.session.startedAt,
      lastHeartbeat: context.session.lastHeartbeatAt
    }));
  }

  /**
   * Check if engine is running
   */
  isEngineRunning(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const persistentTradingEngine = new PersistentTradingEngine();
