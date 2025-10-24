import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import futuresWebSocket from '../websocket/futuresWebSocket.js';
import backtestingEngine from './backtestingEngine.js';
class PaperTradingService extends EventEmitter {
    constructor() {
        super();
        this.activeSessions = new Map();
        this.strategies = new Map();
        this.marketData = new Map();
        this.isInitialized = false;
        this.marketSimulation = {
            slippage: 0.001,
            latency: 50,
            marketImpact: 0.0005,
            executionProbability: 0.98
        };
    }
    async initialize() {
        try {
            if (this.isInitialized)
                return;
            logger.info('📝 Initializing Paper Trading Service...');
            await this.loadActiveSessions();
            this.subscribeToMarketData();
            this.setupPeriodicUpdates();
            this.isInitialized = true;
            logger.info('✅ Paper Trading Service initialized successfully');
        }
        catch (error) {
            logger.error('❌ Failed to initialize Paper Trading Service:', error);
            throw error;
        }
    }
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
                await this.loadSessionPositions(session.id);
            }
            logger.info(`📊 Loaded ${result.rows.length} active paper trading sessions`);
        }
        catch (error) {
            logger.error('Error loading active sessions:', error);
        }
    }
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
                riskParameters: config.riskParameters || {
                    maxDailyLoss: 0.05,
                    maxPositionSize: 0.1,
                    stopLossPercent: 0.02,
                    takeProfitPercent: 0.04
                }
            };
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
            this.activeSessions.set(sessionId, session);
            logger.info(`📝 Created paper trading session: ${session.name} (${sessionId})`);
            this.emit('sessionCreated', session);
            return session;
        }
        catch (error) {
            logger.error('Error creating paper trading session:', error);
            throw error;
        }
    }
    async startSession(sessionId, strategyConfig) {
        try {
            const session = this.activeSessions.get(sessionId);
            if (!session) {
                throw new Error(`Session ${sessionId} not found`);
            }
            if (strategyConfig) {
                backtestingEngine.registerStrategy(`paper_${sessionId}`, strategyConfig);
                session.strategy = strategyConfig;
            }
            await this.subscribeToSymbolData(session.symbol);
            this.startStrategyExecution(sessionId);
            logger.info(`🚀 Started paper trading session: ${sessionId}`);
            this.emit('sessionStarted', session);
            return session;
        }
        catch (error) {
            logger.error('Error starting paper trading session:', error);
            throw error;
        }
    }
    subscribeToMarketData() {
        try {
            futuresWebSocket.on('marketData', (data) => {
                this.processMarketData(data);
            });
            futuresWebSocket.on('orderBook', (data) => {
                this.processOrderBookData(data);
            });
            futuresWebSocket.on('trade', (data) => {
                this.processTradeData(data);
            });
            logger.info('📡 Subscribed to real-time market data');
        }
        catch (error) {
            logger.error('Error subscribing to market data:', error);
        }
    }
    processMarketData(data) {
        try {
            this.marketData.set(data.symbol, {
                ...data,
                timestamp: new Date(),
                lastUpdate: Date.now()
            });
            for (const [sessionId, session] of this.activeSessions) {
                if (session.symbol === data.symbol) {
                    this.updateSessionWithMarketData(session, data);
                }
            }
        }
        catch (error) {
            logger.error('Error processing market data:', error);
        }
    }
    updateSessionWithMarketData(session, marketData) {
        try {
            const currentPrice = marketData.price || marketData.close;
            let totalUnrealizedPnl = 0;
            for (const [positionId, position] of session.positions) {
                if (position.status === 'open') {
                    const pnl = this.calculateUnrealizedPnl(position, currentPrice);
                    position.unrealizedPnl = pnl;
                    position.currentPrice = currentPrice;
                    totalUnrealizedPnl += pnl;
                }
            }
            session.unrealizedPnl = totalUnrealizedPnl;
            session.currentValue = session.cash + session.margin + totalUnrealizedPnl;
            session.lastUpdateAt = new Date();
            this.checkStopLossTakeProfit(session, currentPrice);
            if (session.strategy) {
                this.generateTradingSignals(session, marketData);
            }
            this.emit('sessionUpdate', {
                sessionId: session.id,
                currentValue: session.currentValue,
                unrealizedPnl: session.unrealizedPnl,
                positions: Array.from(session.positions.values())
            });
        }
        catch (error) {
            logger.error('Error updating session with market data:', error);
        }
    }
    async generateTradingSignals(session, marketData) {
        try {
            if (!session.strategy)
                return;
            const historicalData = await this.getHistoricalDataForSignal(session.symbol, session.timeframe);
            if (historicalData.length < 20)
                return;
            const indicators = backtestingEngine.calculateTechnicalIndicators(historicalData, {
                timestamp: new Date(),
                open: marketData.open,
                high: marketData.high,
                low: marketData.low,
                close: marketData.price || marketData.close,
                volume: marketData.volume || 0
            });
            const signals = await backtestingEngine.generateTradingSignals(session.strategy, indicators, marketData);
            if (signals.entry && !this.hasOpenPosition(session)) {
                await this.executeEntrySignal(session, signals.entry, marketData);
            }
        }
        catch (error) {
            logger.error('Error generating trading signals:', error);
        }
    }
    async executeEntrySignal(session, signal, marketData) {
        try {
            const riskCheck = this.performRiskCheck(session, signal, marketData);
            if (!riskCheck.allowed) {
                logger.warn(`Risk check failed for session ${session.id}: ${riskCheck.reason}`);
                return;
            }
            const positionSize = this.calculatePositionSize(session, signal, marketData);
            const executionResult = await this.simulateOrderExecution(session, {
                side: signal.side,
                size: positionSize,
                price: marketData.price || marketData.close,
                type: 'market'
            });
            if (executionResult.success) {
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
        }
        catch (error) {
            logger.error('Error executing entry signal:', error);
        }
    }
    async simulateOrderExecution(session, order) {
        try {
            await new Promise(resolve => setTimeout(resolve, this.marketSimulation.latency));
            if (Math.random() > this.marketSimulation.executionProbability) {
                return {
                    success: false,
                    reason: 'execution_failed',
                    message: 'Order execution failed due to market conditions'
                };
            }
            const executionPrice = this.calculateExecutionPrice(order.price, order.side, order.size);
            const fees = this.calculateTradingFees(order.size, executionPrice);
            return {
                success: true,
                executionPrice,
                fees,
                executionTime: new Date(),
                slippage: Math.abs(executionPrice - order.price) / order.price
            };
        }
        catch (error) {
            logger.error('Error simulating order execution:', error);
            return {
                success: false,
                reason: 'simulation_error',
                message: error.message
            };
        }
    }
    calculateExecutionPrice(basePrice, side, size) {
        let slippage = this.marketSimulation.slippage;
        const marketImpact = this.marketSimulation.marketImpact * Math.log(size / 1000);
        const randomFactor = 0.8 + (Math.random() * 0.4);
        const totalSlippage = (slippage + marketImpact) * randomFactor;
        if (side === 'long') {
            return basePrice * (1 + totalSlippage);
        }
        else {
            return basePrice * (1 - totalSlippage);
        }
    }
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
                status: 'open',
                entryTime: new Date(),
                reason: positionData.reason || 'manual'
            };
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
            session.positions.set(positionId, position);
            session.margin += position.size * position.entryPrice;
            session.cash -= position.size * position.entryPrice;
            await this.createTradeRecord(session, position, 'entry');
            return position;
        }
        catch (error) {
            logger.error('Error creating position:', error);
            throw error;
        }
    }
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
            const currentMarketData = this.marketData.get(session.symbol);
            const finalExitPrice = exitPrice || currentMarketData?.price || position.currentPrice;
            const executionResult = await this.simulateOrderExecution(session, {
                side: position.side === 'long' ? 'short' : 'long',
                size: position.size,
                price: finalExitPrice,
                type: 'market'
            });
            if (!executionResult.success) {
                throw new Error(`Failed to execute exit order: ${executionResult.message}`);
            }
            const realizedPnl = this.calculateRealizedPnl(position, executionResult.executionPrice);
            position.exitPrice = executionResult.executionPrice;
            position.exitTime = new Date();
            position.realizedPnl = realizedPnl;
            position.unrealizedPnl = 0;
            position.status = 'closed';
            session.realizedPnl += realizedPnl;
            session.cash += position.size * executionResult.executionPrice;
            session.margin -= position.size * position.entryPrice;
            session.totalTrades++;
            if (realizedPnl > 0) {
                session.winningTrades++;
            }
            else {
                session.losingTrades++;
            }
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
            await this.createTradeRecord(session, position, 'exit', realizedPnl);
            await this.updateSessionInDatabase(session);
            logger.info(`📉 Closed position ${positionId} for session ${sessionId}: P&L = ${realizedPnl.toFixed(2)}`);
            this.emit('positionClosed', {
                sessionId,
                position,
                reason,
                realizedPnl
            });
            return position;
        }
        catch (error) {
            logger.error('Error closing position:', error);
            throw error;
        }
    }
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
            session.trades.push(trade);
            return trade;
        }
        catch (error) {
            logger.error('Error creating trade record:', error);
            throw error;
        }
    }
    calculateUnrealizedPnl(position, currentPrice) {
        const entryValue = position.size * position.entryPrice;
        const currentValue = position.size * currentPrice;
        if (position.side === 'long') {
            return currentValue - entryValue;
        }
        else {
            return entryValue - currentValue;
        }
    }
    calculateRealizedPnl(position, exitPrice) {
        const entryValue = position.size * position.entryPrice;
        const exitValue = position.size * exitPrice;
        if (position.side === 'long') {
            return exitValue - entryValue;
        }
        else {
            return entryValue - exitValue;
        }
    }
    performRiskCheck(session, signal, marketData) {
        try {
            const dailyLoss = (session.initialCapital - session.currentValue) / session.initialCapital;
            if (dailyLoss > session.riskParameters.maxDailyLoss) {
                return {
                    allowed: false,
                    reason: 'daily_loss_limit_exceeded',
                    details: `Daily loss ${(dailyLoss * 100).toFixed(2)}% exceeds limit ${(session.riskParameters.maxDailyLoss * 100).toFixed(2)}%`
                };
            }
            const positionSize = this.calculatePositionSize(session, signal, marketData);
            const positionValue = positionSize * marketData.price;
            const positionPercent = positionValue / session.currentValue;
            if (positionPercent > session.riskParameters.maxPositionSize) {
                return {
                    allowed: false,
                    reason: 'position_size_limit_exceeded',
                    details: `Position size ${(positionPercent * 100).toFixed(2)}% exceeds limit ${(session.riskParameters.maxPositionSize * 100).toFixed(2)}%`
                };
            }
            if (positionValue > session.cash) {
                return {
                    allowed: false,
                    reason: 'insufficient_cash',
                    details: `Required ${positionValue.toFixed(2)}, available ${session.cash.toFixed(2)}`
                };
            }
            return { allowed: true };
        }
        catch (error) {
            logger.error('Error performing risk check:', error);
            return {
                allowed: false,
                reason: 'risk_check_error',
                details: error.message
            };
        }
    }
    calculatePositionSize(session, signal, marketData) {
        const riskAmount = session.currentValue * (session.riskParameters.riskPerTrade || 0.02);
        const stopLossDistance = session.riskParameters.stopLossPercent || 0.02;
        const price = marketData.price || marketData.close;
        const maxPositionValue = riskAmount / stopLossDistance;
        const maxPositionSize = maxPositionValue / price;
        const maxAllowedValue = session.currentValue * session.riskParameters.maxPositionSize;
        const maxAllowedSize = maxAllowedValue / price;
        return Math.min(maxPositionSize, maxAllowedSize);
    }
    calculateStopLoss(entryPrice, side, riskParams) {
        const stopLossPercent = riskParams.stopLossPercent || 0.02;
        if (side === 'long') {
            return entryPrice * (1 - stopLossPercent);
        }
        else {
            return entryPrice * (1 + stopLossPercent);
        }
    }
    calculateTakeProfit(entryPrice, side, riskParams) {
        const takeProfitPercent = riskParams.takeProfitPercent || 0.04;
        if (side === 'long') {
            return entryPrice * (1 + takeProfitPercent);
        }
        else {
            return entryPrice * (1 - takeProfitPercent);
        }
    }
    checkStopLossTakeProfit(session, currentPrice) {
        for (const [positionId, position] of session.positions) {
            if (position.status !== 'open')
                continue;
            let shouldClose = false;
            let reason = '';
            if (position.side === 'long' && currentPrice <= position.stopLoss) {
                shouldClose = true;
                reason = 'stop_loss';
            }
            else if (position.side === 'short' && currentPrice >= position.stopLoss) {
                shouldClose = true;
                reason = 'stop_loss';
            }
            if (position.side === 'long' && currentPrice >= position.takeProfit) {
                shouldClose = true;
                reason = 'take_profit';
            }
            else if (position.side === 'short' && currentPrice <= position.takeProfit) {
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
    hasOpenPosition(session) {
        for (const [_, position] of session.positions) {
            if (position.status === 'open')
                return true;
        }
        return false;
    }
    calculateTradingFees(size, price) {
        const tradingFeeRate = 0.001;
        return size * price * tradingFeeRate;
    }
    getSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session)
            return null;
        return {
            ...session,
            positions: Array.from(session.positions.values()),
            trades: session.trades.slice(-50)
        };
    }
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
    async stopSession(sessionId) {
        try {
            const session = this.activeSessions.get(sessionId);
            if (!session) {
                throw new Error(`Session ${sessionId} not found`);
            }
            for (const [positionId, position] of session.positions) {
                if (position.status === 'open') {
                    await this.closePosition(sessionId, positionId, 'session_stopped');
                }
            }
            session.status = 'stopped';
            session.endedAt = new Date();
            await query(`
        UPDATE paper_trading_sessions 
        SET status = 'stopped', ended_at = $1, updated_at = NOW()
        WHERE id = $2
      `, [session.endedAt, sessionId]);
            this.activeSessions.delete(sessionId);
            logger.info(`⏹️ Stopped paper trading session: ${sessionId}`);
            this.emit('sessionStopped', session);
            return session;
        }
        catch (error) {
            logger.error('Error stopping session:', error);
            throw error;
        }
    }
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
        }
        catch (error) {
            logger.error('Error updating session in database:', error);
        }
    }
    setupPeriodicUpdates() {
        setInterval(() => {
            this.updateAllSessions();
        }, 5000);
        setInterval(() => {
            this.saveAllSessionsToDatabase();
        }, 30000);
    }
    updateAllSessions() {
        for (const [sessionId, session] of this.activeSessions) {
            const marketData = this.marketData.get(session.symbol);
            if (marketData) {
                this.updateSessionWithMarketData(session, marketData);
            }
        }
    }
    async saveAllSessionsToDatabase() {
        for (const [sessionId, session] of this.activeSessions) {
            await this.updateSessionInDatabase(session);
        }
    }
    createSessionFromData(sessionData) {
        return {
            id: sessionData.id,
            name: sessionData.session_name,
            strategyName: sessionData.strategy_name,
            symbol: sessionData.symbol,
            timeframe: sessionData.timeframe,
            initialCapital: parseFloat(sessionData.initial_capital),
            currentValue: parseFloat(sessionData.current_value),
            cash: parseFloat(sessionData.current_value),
            margin: 0,
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
            if (!session)
                return;
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
            }
        }
        catch (error) {
            logger.error('Error loading session positions:', error);
        }
    }
    async subscribeToSymbolData(symbol) {
        logger.info(`📡 Subscribed to market data for ${symbol}`);
    }
    async getHistoricalDataForSignal(symbol, timeframe) {
        return [];
    }
    startStrategyExecution(sessionId) {
        logger.info(`🚀 Started strategy execution for session ${sessionId}`);
    }
}
export default new PaperTradingService();
