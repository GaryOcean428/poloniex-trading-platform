import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import futuresWebSocket from '../websocket/futuresWebSocket.js';
import backtestingEngine from './backtestingEngine.js';

/**
 * Determine whether a paper-trading session result is censored.
 *
 * A session is censored (QIG term: τ_decoherence == t_max) when the
 * observed P&L doesn't represent the true value because an external
 * limit cut the measurement short:
 *   1. Max-drawdown limit hit  → true loss could be worse.
 *   2. Session time limit hit  → strategy didn't reach natural end-of-life.
 *   3. Position-size limit hit → true return is undefined (capped).
 *
 * Callers should fit performance metrics with and without censored sessions
 * and flag a reliability warning when the fits diverge significantly.
 *
 * @param {object} session - A paper trading session object.
 * @returns {{ isCensored: boolean, reason: string|null }}
 */
export function isCensored(session) {
  if (!session) return { isCensored: false, reason: null };

  // Max-drawdown limit was breached
  if (session.censoringReason === 'max_drawdown') {
    return { isCensored: true, reason: 'max_drawdown' };
  }

  // Check current drawdown against configured limit
  const drawdown = (session.initialCapital - session.currentValue) / session.initialCapital;
  const maxDrawdownLimit = session.riskParameters?.maxDailyLoss ?? 0.05;
  if (drawdown >= maxDrawdownLimit) {
    return { isCensored: true, reason: 'max_drawdown' };
  }

  // Time limit hit (session ran for longer than its intended window)
  if (session.maxDurationMs && session.startedAt) {
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    if (elapsed >= session.maxDurationMs) {
      return { isCensored: true, reason: 'time_limit' };
    }
  }

  return { isCensored: false, reason: null };
}

/**
 * Paper Trading Service
 * Real-time market simulation without actual capital risk
 * Provides a bridge between backtesting and live trading
 */
class PaperTradingService extends EventEmitter {
  constructor() {
    super();
    this.activeSessions = new Map();
    this.strategies = new Map();
    this.marketData = new Map();
    this.strategyIntervals = new Map();
    this.isInitialized = false;
    
    // Market simulation parameters
    this.marketSimulation = {
      slippage: 0.001, // 0.1% slippage
      latency: 50, // 50ms execution delay
      marketImpact: 0.0005, // 0.05% market impact
      executionProbability: 0.98 // 98% execution success rate
    };
  }

  /**
   * Initialize the paper trading service
   */
  async initialize() {
    try {
      if (this.isInitialized) return;

      logger.info('📝 Initializing Paper Trading Service...');

      // Load existing active sessions
      await this.loadActiveSessions();

      // Subscribe to market data updates
      this.subscribeToMarketData();

      // Set up periodic updates
      this.setupPeriodicUpdates();

      this.isInitialized = true;
      logger.info('✅ Paper Trading Service initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Paper Trading Service:', error);
      throw error;
    }
  }

  /**
   * Load active sessions from database
   */
  async loadActiveSessions() {
    try {
      const result = await query(`
        SELECT * FROM paper_trading_sessions 
        WHERE status = 'active'
        ORDER BY started_at DESC
      `);

      for (const sessionData of result.rows) {
        const session = this.createSessionFromData(sessionData);
        this.activeSessions.set(session.id, session);
        
        // Load positions for this session
        await this.loadSessionPositions(session.id);
      }

      logger.info(`📊 Loaded ${result.rows.length} active paper trading sessions`);
    } catch (error) {
      logger.error('Error loading active sessions:', error);
    }
  }

  /**
   * Create a new paper trading session
   */
  async createSession(config) {
    try {
      const sessionId = `pts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const session = {
        id: sessionId,
        name: config.name || `Paper Session ${new Date().toISOString().split('T')[0]}`,
        strategyName: config.strategyName,
        symbol: config.symbol,
        timeframe: config.timeframe,
        initialCapital: config.initialCapital || 100000,
        currentValue: config.initialCapital || 100000,
        cash: config.initialCapital || 100000,
        margin: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        positions: new Map(),
        trades: [],
        status: 'active',
        startedAt: new Date(),
        lastUpdateAt: new Date(),
        strategy: config.strategy || null,
        leverage: config.leverage || 1, // Futures leverage (1 = no leverage)
        marginMode: config.marginMode || 'CROSS',
        marketType: 'futures',
        riskParameters: config.riskParameters || {
          maxDailyLoss: 0.05, // 5% max daily loss
          maxPositionSize: 0.1, // 10% max position size
          stopLossPercent: 0.02, // 2% stop loss
          takeProfitPercent: 0.04 // 4% take profit
        }
      };

      // Store session in database
      await query(`
        INSERT INTO paper_trading_sessions (
          id, session_name, strategy_name, symbol, timeframe,
          initial_capital, current_value, unrealized_pnl, realized_pnl,
          total_trades, winning_trades, status, started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        session.id,
        session.name,
        session.strategyName,
        session.symbol,
        session.timeframe,
        session.initialCapital,
        session.currentValue,
        session.unrealizedPnl,
        session.realizedPnl,
        session.totalTrades,
        session.winningTrades,
        session.status,
        session.startedAt
      ]);

      // Add to active sessions
      this.activeSessions.set(sessionId, session);

      logger.info(`📝 Created paper trading session: ${session.name} (${sessionId})`);
      
      this.emit('sessionCreated', session);
      return session;
    } catch (error) {
      logger.error('Error creating paper trading session:', error);
      throw error;
    }
  }

  /**
   * Start a paper trading session with strategy
   */
  async startSession(sessionId, strategyConfig) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Register strategy with backtesting engine for signal generation
      if (strategyConfig) {
        backtestingEngine.registerStrategy(`paper_${sessionId}`, strategyConfig);
        session.strategy = strategyConfig;
      }

      // Subscribe to real-time market data
      await this.subscribeToSymbolData(session.symbol);

      // Start strategy execution loop
      this.startStrategyExecution(sessionId);

      logger.info(`🚀 Started paper trading session: ${sessionId}`);
      this.emit('sessionStarted', session);
      
      return session;
    } catch (error) {
      logger.error('Error starting paper trading session:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time market data
   */
  subscribeToMarketData() {
    try {
      // Listen for market data updates from futures WebSocket
      futuresWebSocket.on('marketData', (data) => {
        this.processMarketData(data);
      });

      // Listen for order book updates
      futuresWebSocket.on('orderBook', (data) => {
        this.processOrderBookData(data);
      });

      // Listen for trade updates
      futuresWebSocket.on('trade', (data) => {
        this.processTradeData(data);
      });

      logger.info('📡 Subscribed to real-time market data');
    } catch (error) {
      logger.error('Error subscribing to market data:', error);
    }
  }

  /**
   * Process incoming market data
   */
  processMarketData(data) {
    try {
      this.marketData.set(data.symbol, {
        ...data,
        timestamp: new Date(),
        lastUpdate: Date.now()
      });

      // Update all sessions with this symbol
      for (const [sessionId, session] of this.activeSessions) {
        if (session.symbol === data.symbol) {
          this.updateSessionWithMarketData(session, data);
        }
      }
    } catch (error) {
      logger.error('Error processing market data:', error);
    }
  }

  /**
   * Update session with new market data
   */
  updateSessionWithMarketData(session, marketData) {
    try {
      const currentPrice = marketData.price || marketData.close;
      
      // Update unrealized P&L for open positions
      let totalUnrealizedPnl = 0;
      
      for (const [positionId, position] of session.positions) {
        if (position.status === 'open') {
          const pnl = this.calculateUnrealizedPnl(position, currentPrice);
          position.unrealizedPnl = pnl;
          position.currentPrice = currentPrice;
          totalUnrealizedPnl += pnl;
        }
      }

      // Update session totals
      session.unrealizedPnl = totalUnrealizedPnl;
      session.currentValue = session.cash + session.margin + totalUnrealizedPnl;
      session.lastUpdateAt = new Date();

      // Check for stop loss / take profit triggers
      this.checkStopLossTakeProfit(session, currentPrice);

      // Generate trading signals if strategy is active
      if (session.strategy) {
        this.generateTradingSignals(session, marketData);
      }

      // Emit session update
      this.emit('sessionUpdate', {
        sessionId: session.id,
        currentValue: session.currentValue,
        unrealizedPnl: session.unrealizedPnl,
        positions: Array.from(session.positions.values())
      });

    } catch (error) {
      logger.error('Error updating session with market data:', error);
    }
  }

  /**
   * Generate trading signals for session
   */
  async generateTradingSignals(session, marketData) {
    try {
      if (!session.strategy) return;

      // Get historical data for technical analysis
      const historicalData = await this.getHistoricalDataForSignal(session.symbol, session.timeframe);
      
      if (historicalData.length < 20) return; // Need enough data for indicators

      // Calculate technical indicators
      const indicators = backtestingEngine.calculateTechnicalIndicators(
        historicalData,
        {
          timestamp: new Date(),
          open: marketData.open,
          high: marketData.high,
          low: marketData.low,
          close: marketData.price || marketData.close,
          volume: marketData.volume || 0
        }
      );

      // Generate signals using the strategy
      const signals = await backtestingEngine.generateTradingSignals(
        session.strategy,
        indicators,
        marketData
      );

      // Process entry signals
      if (signals.entry && !this.hasOpenPosition(session)) {
        await this.executeEntrySignal(session, signals.entry, marketData);
      }

    } catch (error) {
      logger.error('Error generating trading signals:', error);
    }
  }

  /**
   * Execute entry signal
   */
  async executeEntrySignal(session, signal, marketData) {
    try {
      // Risk management checks
      const riskCheck = this.performRiskCheck(session, signal, marketData);
      if (!riskCheck.allowed) {
        logger.warn(`Risk check failed for session ${session.id}: ${riskCheck.reason}`);
        return;
      }

      // Calculate position size
      const positionSize = this.calculatePositionSize(session, signal, marketData);
      
      // Simulate order execution
      const executionResult = await this.simulateOrderExecution(
        session,
        {
          side: signal.side,
          size: positionSize,
          price: marketData.price || marketData.close,
          type: 'market'
        }
      );

      if (executionResult.success) {
        // Create position
        const position = await this.createPosition(session, {
          side: signal.side,
          size: positionSize,
          entryPrice: executionResult.executionPrice,
          stopLoss: this.calculateStopLoss(executionResult.executionPrice, signal.side, session.riskParameters),
          takeProfit: this.calculateTakeProfit(executionResult.executionPrice, signal.side, session.riskParameters),
          reason: signal.reason
        });

        logger.info(`📈 Executed entry signal for ${session.id}: ${signal.side} ${positionSize} at ${executionResult.executionPrice}`);
        
        this.emit('positionOpened', {
          sessionId: session.id,
          position,
          signal
        });
      }

    } catch (error) {
      logger.error('Error executing entry signal:', error);
    }
  }

  /**
   * Simulate order execution with realistic delays and slippage
   */
  async simulateOrderExecution(session, order) {
    try {
      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, this.marketSimulation.latency));

      // Simulate execution probability
      if (Math.random() > this.marketSimulation.executionProbability) {
        return {
          success: false,
          reason: 'execution_failed',
          message: 'Order execution failed due to market conditions'
        };
      }

      // Calculate execution price with slippage
      const executionPrice = this.calculateExecutionPrice(order.price, order.side, order.size);

      // Calculate fees
      const fees = this.calculateTradingFees(order.size, executionPrice);

      return {
        success: true,
        executionPrice,
        fees,
        executionTime: new Date(),
        slippage: Math.abs(executionPrice - order.price) / order.price
      };

    } catch (error) {
      logger.error('Error simulating order execution:', error);
      return {
        success: false,
        reason: 'simulation_error',
        message: error.message
      };
    }
  }

  /**
   * Calculate execution price with slippage
   */
  calculateExecutionPrice(basePrice, side, size) {
    // Base slippage
    let slippage = this.marketSimulation.slippage;
    
    // Market impact based on position size
    const marketImpact = this.marketSimulation.marketImpact * Math.log(size / 1000);
    
    // Random slippage variation (±20%)
    const randomFactor = 0.8 + (Math.random() * 0.4);
    
    const totalSlippage = (slippage + marketImpact) * randomFactor;
    
    // Apply slippage against the trader
    if (side === 'long') {
      return basePrice * (1 + totalSlippage);
    } else {
      return basePrice * (1 - totalSlippage);
    }
  }

  /**
   * Create a new position
   */
  async createPosition(session, positionData) {
    try {
      const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const position = {
        id: positionId,
        sessionId: session.id,
        symbol: session.symbol,
        side: positionData.side,
        size: positionData.size,
        entryPrice: positionData.entryPrice,
        currentPrice: positionData.entryPrice,
        stopLoss: positionData.stopLoss,
        takeProfit: positionData.takeProfit,
        unrealizedPnl: 0,
        realizedPnl: 0,
        entryFees: this.calculateTradingFees(positionData.size, positionData.entryPrice),
        fees: 0,
        status: 'open',
        entryTime: new Date(),
        reason: positionData.reason || 'manual'
      };

      // Store position in database
      await query(`
        INSERT INTO paper_trading_positions (
          id, session_id, position_id, symbol, side, size,
          entry_price, current_price, stop_loss, take_profit,
          unrealized_pnl, status, entry_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        positionId,
        session.id,
        positionId,
        position.symbol,
        position.side,
        position.size,
        position.entryPrice,
        position.currentPrice,
        position.stopLoss,
        position.takeProfit,
        position.unrealizedPnl,
        position.status,
        position.entryTime
      ]);

      // Add to session positions
      session.positions.set(positionId, position);

      // Update session margin and deduct entry fees from cash
      // With leverage, margin required = notional / leverage
      const leverage = session.leverage || 1;
      const notional = position.size * position.entryPrice;
      const marginRequired = notional / leverage;
      position.leverage = leverage;
      session.margin += marginRequired;
      session.cash -= marginRequired + position.entryFees;

      // Create trade record
      await this.createTradeRecord(session, position, 'entry');

      return position;
    } catch (error) {
      logger.error('Error creating position:', error);
      throw error;
    }
  }

  /**
   * Close a position
   */
  async closePosition(sessionId, positionId, reason = 'manual', exitPrice = null) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const position = session.positions.get(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      if (position.status !== 'open') {
        throw new Error(`Position ${positionId} is already closed`);
      }

      // Use current market price if no exit price provided
      const currentMarketData = this.marketData.get(session.symbol);
      const finalExitPrice = exitPrice || currentMarketData?.price || position.currentPrice;

      // Simulate exit execution
      const executionResult = await this.simulateOrderExecution(session, {
        side: position.side === 'long' ? 'short' : 'long',
        size: position.size,
        price: finalExitPrice,
        type: 'market'
      });

      if (!executionResult.success) {
        throw new Error(`Failed to execute exit order: ${executionResult.message}`);
      }

      // Calculate realized P&L including fees from entry and exit
      const rawPnl = this.calculateRealizedPnl(position, executionResult.executionPrice);
      const entryFees = position.entryFees || this.calculateTradingFees(position.size, position.entryPrice);
      const exitFees = executionResult.fees || this.calculateTradingFees(position.size, executionResult.executionPrice);
      const realizedPnl = rawPnl - entryFees - exitFees;

      // Update position
      position.exitPrice = executionResult.executionPrice;
      position.exitTime = new Date();
      position.realizedPnl = realizedPnl;
      position.fees = entryFees + exitFees;
      position.unrealizedPnl = 0;
      position.status = 'closed';

      // Update session totals
      session.realizedPnl += realizedPnl;
      // Return margin collateral plus P&L minus exit fees
      const closeLeverage = position.leverage || session.leverage || 1;
      const entryMarginUsed = (position.size * position.entryPrice) / closeLeverage;
      session.cash += entryMarginUsed + rawPnl - exitFees;
      session.margin -= entryMarginUsed;
      session.totalTrades++;
      
      if (realizedPnl > 0) {
        session.winningTrades++;
      } else {
        session.losingTrades++;
      }

      // Update position in database
      await query(`
        UPDATE paper_trading_positions 
        SET exit_price = $1, exit_time = $2, realized_pnl = $3, 
            unrealized_pnl = 0, status = 'closed', updated_at = NOW()
        WHERE id = $4
      `, [
        executionResult.executionPrice,
        position.exitTime,
        realizedPnl,
        positionId
      ]);

      // Create exit trade record
      await this.createTradeRecord(session, position, 'exit', realizedPnl);

      // Update session in database
      await this.updateSessionInDatabase(session);

      logger.info(`📉 Closed position ${positionId} for session ${sessionId}: P&L = ${realizedPnl.toFixed(2)}`);
      
      this.emit('positionClosed', {
        sessionId,
        position,
        reason,
        realizedPnl
      });

      return position;
    } catch (error) {
      logger.error('Error closing position:', error);
      throw error;
    }
  }

  /**
   * Create trade record
   */
  async createTradeRecord(session, position, type, pnl = 0) {
    try {
      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const trade = {
        id: tradeId,
        sessionId: session.id,
        positionId: position.id,
        symbol: position.symbol,
        side: type === 'entry' ? position.side : (position.side === 'long' ? 'short' : 'long'),
        size: position.size,
        price: type === 'entry' ? position.entryPrice : position.exitPrice,
        timestamp: new Date(),
        type,
        reason: position.reason || 'manual',
        fees: this.calculateTradingFees(position.size, type === 'entry' ? position.entryPrice : position.exitPrice),
        pnl
      };

      // Store trade in database
      await query(`
        INSERT INTO paper_trading_trades (
          id, session_id, position_id, trade_id, symbol, side, size,
          price, timestamp, type, reason, fees, pnl
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        tradeId,
        session.id,
        position.id,
        tradeId,
        trade.symbol,
        trade.side,
        trade.size,
        trade.price,
        trade.timestamp,
        trade.type,
        trade.reason,
        trade.fees,
        trade.pnl
      ]);

      // Add to session trades
      session.trades.push(trade);

      return trade;
    } catch (error) {
      logger.error('Error creating trade record:', error);
      throw error;
    }
  }

  /**
   * Calculate various P&L metrics
   */
  calculateUnrealizedPnl(position, currentPrice) {
    const entryValue = position.size * position.entryPrice;
    const currentValue = position.size * currentPrice;
    
    if (position.side === 'long') {
      return currentValue - entryValue;
    } else {
      return entryValue - currentValue;
    }
  }

  calculateRealizedPnl(position, exitPrice) {
    const entryValue = position.size * position.entryPrice;
    const exitValue = position.size * exitPrice;
    
    if (position.side === 'long') {
      return exitValue - entryValue;
    } else {
      return entryValue - exitValue;
    }
  }

  /**
   * Risk management functions
   */
  performRiskCheck(session, signal, marketData) {
    try {
      // Check daily loss limit
      const dailyLoss = (session.initialCapital - session.currentValue) / session.initialCapital;
      if (dailyLoss > session.riskParameters.maxDailyLoss) {
        // Mark session as censored: P&L is bounded by the drawdown limit, not by
        // the strategy's natural behaviour.
        session.isCensored = true;
        session.censoringReason = 'max_drawdown';
        return {
          allowed: false,
          reason: 'daily_loss_limit_exceeded',
          details: `Daily loss ${(dailyLoss * 100).toFixed(2)}% exceeds limit ${(session.riskParameters.maxDailyLoss * 100).toFixed(2)}%`
        };
      }

      // Check maximum position size
      const positionSize = this.calculatePositionSize(session, signal, marketData);
      const positionValue = positionSize * marketData.price;
      const positionPercent = positionValue / session.currentValue;
      
      if (positionPercent > session.riskParameters.maxPositionSize) {
        // Mark session as censored: return is bounded by the position-size cap.
        session.isCensored = true;
        session.censoringReason = 'position_size_limit';
        return {
          allowed: false,
          reason: 'position_size_limit_exceeded',
          details: `Position size ${(positionPercent * 100).toFixed(2)}% exceeds limit ${(session.riskParameters.maxPositionSize * 100).toFixed(2)}%`
        };
      }

      // Check available cash
      if (positionValue > session.cash) {
        return {
          allowed: false,
          reason: 'insufficient_cash',
          details: `Required ${positionValue.toFixed(2)}, available ${session.cash.toFixed(2)}`
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Error performing risk check:', error);
      return {
        allowed: false,
        reason: 'risk_check_error',
        details: error.message
      };
    }
  }

  /**
   * Calculate position size based on risk parameters
   */
  calculatePositionSize(session, signal, marketData) {
    const riskAmount = session.currentValue * (session.riskParameters.riskPerTrade || 0.02);
    const stopLossDistance = session.riskParameters.stopLossPercent || 0.02;
    const price = marketData.price || marketData.close;
    
    // Position size based on risk amount and stop loss
    const maxPositionValue = riskAmount / stopLossDistance;
    const maxPositionSize = maxPositionValue / price;
    
    // Apply position size limits
    const maxAllowedValue = session.currentValue * session.riskParameters.maxPositionSize;
    const maxAllowedSize = maxAllowedValue / price;
    
    return Math.min(maxPositionSize, maxAllowedSize);
  }

  /**
   * Calculate stop loss and take profit levels
   */
  calculateStopLoss(entryPrice, side, riskParams) {
    const stopLossPercent = riskParams.stopLossPercent || 0.02;
    
    if (side === 'long') {
      return entryPrice * (1 - stopLossPercent);
    } else {
      return entryPrice * (1 + stopLossPercent);
    }
  }

  calculateTakeProfit(entryPrice, side, riskParams) {
    const takeProfitPercent = riskParams.takeProfitPercent || 0.04;
    
    if (side === 'long') {
      return entryPrice * (1 + takeProfitPercent);
    } else {
      return entryPrice * (1 - takeProfitPercent);
    }
  }

  /**
   * Check stop loss and take profit triggers
   */
  checkStopLossTakeProfit(session, currentPrice) {
    for (const [positionId, position] of session.positions) {
      if (position.status !== 'open') continue;

      let shouldClose = false;
      let reason = '';

      // Check stop loss
      if (position.side === 'long' && currentPrice <= position.stopLoss) {
        shouldClose = true;
        reason = 'stop_loss';
      } else if (position.side === 'short' && currentPrice >= position.stopLoss) {
        shouldClose = true;
        reason = 'stop_loss';
      }

      // Check take profit
      if (position.side === 'long' && currentPrice >= position.takeProfit) {
        shouldClose = true;
        reason = 'take_profit';
      } else if (position.side === 'short' && currentPrice <= position.takeProfit) {
        shouldClose = true;
        reason = 'take_profit';
      }

      if (shouldClose) {
        setTimeout(() => {
          this.closePosition(session.id, positionId, reason, currentPrice);
        }, 0);
      }
    }
  }

  /**
   * Utility functions
   */
  hasOpenPosition(session) {
    for (const [_, position] of session.positions) {
      if (position.status === 'open') return true;
    }
    return false;
  }

  calculateTradingFees(size, price, orderType = 'market') {
    // Poloniex Futures fees: 0.01% maker / 0.075% taker
    const makerFeeRate = 0.0001; // 0.01%
    const takerFeeRate = 0.00075; // 0.075%
    
    const feeRate = orderType === 'limit' ? makerFeeRate : takerFeeRate;
    return size * price * feeRate;
  }

  /**
   * Get session details
   */
  getSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const winRate = session.totalTrades > 0
      ? session.winningTrades / session.totalTrades
      : 0;
    const totalPnl = session.realizedPnl + session.unrealizedPnl;

    return {
      ...session,
      totalPnl,
      winRate,
      currentCapital: session.currentValue,
      positions: Array.from(session.positions.values()),
      trades: session.trades.slice(-50) // Last 50 trades
    };
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.values()).map(session => ({
      id: session.id,
      name: session.name,
      strategyName: session.strategyName,
      symbol: session.symbol,
      timeframe: session.timeframe,
      initialCapital: session.initialCapital,
      currentValue: session.currentValue,
      unrealizedPnl: session.unrealizedPnl,
      realizedPnl: session.realizedPnl,
      totalTrades: session.totalTrades,
      winningTrades: session.winningTrades,
      losingTrades: session.losingTrades,
      winRate: session.totalTrades > 0 ? (session.winningTrades / session.totalTrades) * 100 : 0,
      status: session.status,
      startedAt: session.startedAt,
      lastUpdateAt: session.lastUpdateAt
    }));
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Clear strategy execution interval
      const intervalId = this.strategyIntervals.get(sessionId);
      if (intervalId) {
        clearInterval(intervalId);
        this.strategyIntervals.delete(sessionId);
      }

      // Close all open positions
      for (const [positionId, position] of session.positions) {
        if (position.status === 'open') {
          await this.closePosition(sessionId, positionId, 'session_stopped');
        }
      }

      // Update session status
      session.status = 'stopped';
      session.endedAt = new Date();

      // Detect censoring before persisting
      const { isCensored: censored, reason: censoringReason } = isCensored(session);
      session.isCensored = censored;
      session.censoringReason = censoringReason;

      if (censored) {
        logger.warn(`Paper trading session ${sessionId} flagged as censored: ${censoringReason}`);
      }

      // Update database
      await query(`
        UPDATE paper_trading_sessions 
        SET status = 'stopped', ended_at = $1, updated_at = NOW(),
            is_censored = $3, censoring_reason = $4
        WHERE id = $2
      `, [session.endedAt, sessionId, censored, censoringReason]);

      // Remove from active sessions
      this.activeSessions.delete(sessionId);

      logger.info(`⏹️ Stopped paper trading session: ${sessionId}`);
      
      this.emit('sessionStopped', session);
      return session;
    } catch (error) {
      logger.error('Error stopping session:', error);
      throw error;
    }
  }

  /**
   * Update session in database
   */
  async updateSessionInDatabase(session) {
    try {
      await query(`
        UPDATE paper_trading_sessions 
        SET current_value = $1, unrealized_pnl = $2, realized_pnl = $3,
            total_trades = $4, winning_trades = $5, updated_at = NOW()
        WHERE id = $6
      `, [
        session.currentValue,
        session.unrealizedPnl,
        session.realizedPnl,
        session.totalTrades,
        session.winningTrades,
        session.id
      ]);
    } catch (error) {
      logger.error('Error updating session in database:', error);
    }
  }

  /**
   * Set up periodic updates
   */
  setupPeriodicUpdates() {
    // Update sessions every 5 seconds
    setInterval(() => {
      this.updateAllSessions();
    }, 5000);

    // Save sessions to database every 30 seconds
    setInterval(() => {
      this.saveAllSessionsToDatabase();
    }, 30000);
  }

  /**
   * Update all active sessions
   */
  updateAllSessions() {
    for (const [sessionId, session] of this.activeSessions) {
      const marketData = this.marketData.get(session.symbol);
      if (marketData) {
        this.updateSessionWithMarketData(session, marketData);
      }
    }
  }

  /**
   * Save all sessions to database
   */
  async saveAllSessionsToDatabase() {
    for (const [sessionId, session] of this.activeSessions) {
      await this.updateSessionInDatabase(session);
    }
  }

  /**
   * Helper functions
   */
  createSessionFromData(sessionData) {
    return {
      id: sessionData.id,
      name: sessionData.session_name,
      strategyName: sessionData.strategy_name,
      symbol: sessionData.symbol,
      timeframe: sessionData.timeframe,
      initialCapital: parseFloat(sessionData.initial_capital),
      currentValue: parseFloat(sessionData.current_value),
      cash: parseFloat(sessionData.current_value), // Will be adjusted after positions load
      margin: 0, // Will be recalculated after positions load
      unrealizedPnl: parseFloat(sessionData.unrealized_pnl),
      realizedPnl: parseFloat(sessionData.realized_pnl),
      totalTrades: parseInt(sessionData.total_trades),
      winningTrades: parseInt(sessionData.winning_trades),
      losingTrades: parseInt(sessionData.total_trades) - parseInt(sessionData.winning_trades),
      positions: new Map(),
      trades: [],
      status: sessionData.status,
      startedAt: sessionData.started_at,
      lastUpdateAt: sessionData.updated_at || sessionData.started_at
    };
  }

  async loadSessionPositions(sessionId) {
    try {
      const result = await query(`
        SELECT * FROM paper_trading_positions 
        WHERE session_id = $1
        ORDER BY entry_time DESC
      `, [sessionId]);

      const session = this.activeSessions.get(sessionId);
      if (!session) return;

      let openMargin = 0;

      for (const positionData of result.rows) {
        const position = {
          id: positionData.id,
          sessionId: positionData.session_id,
          symbol: positionData.symbol,
          side: positionData.side,
          size: parseFloat(positionData.size),
          entryPrice: parseFloat(positionData.entry_price),
          currentPrice: parseFloat(positionData.current_price),
          exitPrice: positionData.exit_price ? parseFloat(positionData.exit_price) : null,
          stopLoss: parseFloat(positionData.stop_loss),
          takeProfit: parseFloat(positionData.take_profit),
          unrealizedPnl: parseFloat(positionData.unrealized_pnl),
          realizedPnl: parseFloat(positionData.realized_pnl || 0),
          status: positionData.status,
          entryTime: positionData.entry_time,
          exitTime: positionData.exit_time
        };

        session.positions.set(position.id, position);

        // Track margin for open positions (leverage-adjusted)
        if (position.status === 'open') {
          const posLeverage = position.leverage || session.leverage || 1;
          openMargin += (position.size * position.entryPrice) / posLeverage;
        }
      }

      // Recalculate margin and cash from open positions
      session.margin = openMargin;
      session.cash = session.currentValue - session.unrealizedPnl - openMargin;
    } catch (error) {
      logger.error('Error loading session positions:', error);
    }
  }

  async subscribeToSymbolData(symbol) {
    try {
      if (futuresWebSocket.subscribeToSymbol) {
        await futuresWebSocket.subscribeToSymbol(symbol);
      }
      logger.info(`Subscribed to market data for ${symbol}`);
    } catch (error) {
      logger.error(`Error subscribing to symbol data for ${symbol}:`, error);
    }
  }

  async getHistoricalDataForSignal(symbol, timeframe) {
    try {
      const tf = timeframe || '1h';
      const intervalSeconds = {
        '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '2h': 7200, '4h': 14400, '12h': 43200, '1d': 86400
      };
      const seconds = intervalSeconds[tf] || 3600;
      // Fetch 50 candles of history (enough for SMA50 and other indicators)
      const startDate = new Date(Date.now() - seconds * 50 * 1000);
      const endDate = new Date();

      const data = await backtestingEngine.loadHistoricalData(symbol, tf, startDate, endDate);
      return data;
    } catch (error) {
      logger.error(`Error fetching historical data for ${symbol}:`, error);
      return [];
    }
  }

  startStrategyExecution(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      logger.error(`Cannot start strategy execution: session ${sessionId} not found`);
      return;
    }

    // Run first cycle immediately, then every 60 seconds
    this._runStrategyCycle(sessionId);

    const intervalId = setInterval(() => {
      this._runStrategyCycle(sessionId);
    }, 60000);

    this.strategyIntervals.set(sessionId, intervalId);
    logger.info(`Started strategy execution for session ${sessionId} (60s cycle)`);
  }

  async _runStrategyCycle(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session || session.status !== 'active') {
        const intervalId = this.strategyIntervals.get(sessionId);
        if (intervalId) {
          clearInterval(intervalId);
          this.strategyIntervals.delete(sessionId);
        }
        return;
      }

      // Get latest market data from WebSocket cache or fetch fresh
      let marketData = this.marketData.get(session.symbol);
      if (!marketData) {
        try {
          const tickers = await poloniexFuturesService.getTickers(session.symbol);
          if (tickers && tickers[0]) {
            const t = tickers[0];
            marketData = {
              symbol: session.symbol,
              price: parseFloat(t.markPx || t.markPrice || t.lastPx || '0'),
              open: parseFloat(t.open || t.markPx || '0'),
              high: parseFloat(t.high || t.markPx || '0'),
              low: parseFloat(t.low || t.markPx || '0'),
              volume: parseFloat(t.qty24h || t.vol || '0'),
              timestamp: Date.now()
            };
          }
        } catch (err) {
          logger.warn(`Could not fetch ticker for ${session.symbol}: ${err.message}`);
          return;
        }
      }

      if (!marketData || !marketData.price) return;

      await this.generateTradingSignals(session, marketData);
    } catch (error) {
      logger.error(`Strategy execution error for session ${sessionId}:`, error);
    }
  }
}

export default new PaperTradingService();