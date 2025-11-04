/**
 * Persistent Autonomous Trading Engine
 * Runs independently of user sessions, survives server restarts
 * Executes trading strategies for all users with stored credentials
 */

import { EventEmitter } from 'events';
import { apiCredentialsService } from './apiCredentialsService';
import { PoloniexFuturesService } from './poloniexFuturesService';
import { pool } from '../db/connection';
import { logger } from '../utils/logger';

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

    // This is where strategy logic would be executed
    // For now, we'll just log and update heartbeat
    
    logger.debug(`Executing strategy for session ${session.id}: ${session.sessionName || 'Unnamed'}`);

    // Example: Check account balance
    try {
      const accountInfo = await poloniexService.getAccountBalance({
        apiKey: context.credentials.apiKey,
        apiSecret: context.credentials.apiSecret
      });
      
      // Update performance metrics
      const updatedMetrics = {
        ...session.performanceMetrics,
        lastBalance: accountInfo.data.accountEquity,
        lastCheckTime: new Date().toISOString()
      };

      // Save updated metrics
      await this.updateSessionMetrics(session.id, updatedMetrics);
      
    } catch (error) {
      logger.error(`Error checking account for session ${session.id}:`, error);
    }

    // TODO: Implement actual strategy execution logic
    // - Analyze market conditions
    // - Check strategy signals
    // - Execute trades if conditions met
    // - Update positions
    // - Calculate P&L
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
