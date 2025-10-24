import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import futuresWebSocket from '../websocket/futuresWebSocket.js';
class AutomatedTradingService extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.isInitialized = false;
        this.activeStrategies = new Map();
        this.marketData = new Map();
        this.userCredentials = new Map();
        this.riskManager = null;
        this.executionQueue = [];
        this.processingExecution = false;
        this.config = {
            maxConcurrentOrders: 10,
            orderExecutionTimeout: 30000,
            strategyUpdateInterval: 1000,
            riskCheckInterval: 5000,
            maxDailyLoss: 0.05,
            maxPositionSize: 0.1,
            emergencyStopLoss: 0.15
        };
        this.setupWebSocketHandlers();
    }
    async initialize() {
        try {
            logger.info('Initializing Automated Trading Service...');
            await this.loadActiveStrategies();
            this.startExecutionEngine();
            this.startRiskMonitoring();
            this.isRunning = true;
            this.isInitialized = true;
            logger.info('✅ Automated Trading Service initialized successfully');
        }
        catch (error) {
            logger.error('Failed to initialize Automated Trading Service:', error);
            throw error;
        }
    }
    setupWebSocketHandlers() {
        futuresWebSocket.on('ticker', (data) => {
            this.updateMarketData(data);
        });
        futuresWebSocket.on('position', (data) => {
            this.handlePositionUpdate(data);
        });
        futuresWebSocket.on('order', (data) => {
            this.handleOrderUpdate(data);
        });
        futuresWebSocket.on('tradeExecution', (data) => {
            this.handleTradeExecution(data);
        });
    }
    async loadActiveStrategies() {
        try {
            const result = await query(`
        SELECT DISTINCT s.*, u.id as user_id, fa.id as account_id
        FROM strategy_execution_logs s
        JOIN users u ON s.user_id = u.id
        JOIN futures_accounts fa ON s.account_id = fa.id
        WHERE s.execution_result = 'SUCCESS'
        AND s.executed_at >= NOW() - INTERVAL '24 hours'
        ORDER BY s.executed_at DESC
      `);
            const strategies = new Map();
            for (const row of result.rows) {
                const key = `${row.user_id}_${row.strategy_type}_${row.symbol}`;
                if (!strategies.has(key)) {
                    strategies.set(key, {
                        userId: row.user_id,
                        accountId: row.account_id,
                        strategyId: row.strategy_id,
                        strategyName: row.strategy_name,
                        strategyType: row.strategy_type,
                        symbol: row.symbol,
                        parameters: row.parameters,
                        isActive: true,
                        lastExecution: row.executed_at,
                        performance: {
                            totalPnl: 0,
                            winRate: 0,
                            tradeCount: 0
                        }
                    });
                }
            }
            this.activeStrategies = strategies;
            logger.info(`Loaded ${strategies.size} active strategies`);
        }
        catch (error) {
            logger.error('Failed to load active strategies:', error);
        }
    }
    async registerStrategy(userId, strategyConfig) {
        try {
            const key = `${userId}_${strategyConfig.type}_${strategyConfig.symbol}`;
            this.validateStrategyConfig(strategyConfig);
            const credentials = await this.loadUserCredentials(userId);
            if (!credentials) {
                throw new Error('User credentials not found');
            }
            const strategy = {
                userId,
                accountId: strategyConfig.accountId,
                strategyId: strategyConfig.id,
                strategyName: strategyConfig.name,
                strategyType: strategyConfig.type,
                symbol: strategyConfig.symbol,
                parameters: strategyConfig.parameters,
                isActive: true,
                lastExecution: new Date(),
                performance: {
                    totalPnl: 0,
                    winRate: 0,
                    tradeCount: 0
                }
            };
            this.activeStrategies.set(key, strategy);
            this.userCredentials.set(userId, credentials);
            logger.info(`Registered strategy: ${strategyConfig.name} for user ${userId}`);
            return { success: true, strategyKey: key };
        }
        catch (error) {
            logger.error('Failed to register strategy:', error);
            throw error;
        }
    }
    deactivateStrategy(userId, strategyType, symbol) {
        const key = `${userId}_${strategyType}_${symbol}`;
        const strategy = this.activeStrategies.get(key);
        if (strategy) {
            strategy.isActive = false;
            logger.info(`Deactivated strategy: ${key}`);
            return true;
        }
        return false;
    }
    startExecutionEngine() {
        setInterval(() => {
            this.evaluateStrategies();
        }, this.config.strategyUpdateInterval);
        setInterval(() => {
            this.processExecutionQueue();
        }, 100);
    }
    async evaluateStrategies() {
        if (!this.isRunning)
            return;
        for (const [key, strategy] of this.activeStrategies) {
            if (!strategy.isActive)
                continue;
            try {
                await this.evaluateStrategy(strategy);
            }
            catch (error) {
                logger.error(`Failed to evaluate strategy ${key}:`, error);
            }
        }
    }
    async evaluateStrategy(strategy) {
        const marketData = this.marketData.get(strategy.symbol);
        if (!marketData)
            return;
        const positions = await this.getCurrentPositions(strategy.userId, strategy.symbol);
        const signal = await this.executeStrategyLogic(strategy, marketData, positions);
        if (signal && signal.action !== 'HOLD') {
            await this.queueExecution(strategy, signal);
        }
    }
    async executeStrategyLogic(strategy, marketData, positions) {
        const { strategyType, parameters } = strategy;
        switch (strategyType) {
            case 'MOMENTUM':
                return this.executeMomentumStrategy(strategy, marketData, positions);
            case 'MEAN_REVERSION':
                return this.executeMeanReversionStrategy(strategy, marketData, positions);
            case 'GRID':
                return this.executeGridStrategy(strategy, marketData, positions);
            case 'DCA':
                return this.executeDCAStrategy(strategy, marketData, positions);
            case 'ARBITRAGE':
                return this.executeArbitrageStrategy(strategy, marketData, positions);
            default:
                logger.warn(`Unknown strategy type: ${strategyType}`);
                return null;
        }
    }
    executeMomentumStrategy(strategy, marketData, positions) {
        const { parameters } = strategy;
        const { lookback = 20, threshold = 0.02, stopLoss = 0.05 } = parameters;
        const priceChange = (marketData.last_price - marketData.prev_price) / marketData.prev_price;
        const volume = marketData.volume_24h;
        const currentPosition = positions.find(p => p.symbol === strategy.symbol);
        const positionSize = currentPosition ? currentPosition.size : 0;
        if (Math.abs(positionSize) < parameters.maxPositionSize) {
            if (priceChange > threshold && volume > parameters.minVolume) {
                return {
                    action: 'BUY',
                    size: parameters.orderSize,
                    price: marketData.last_price * 1.001,
                    stopLoss: marketData.last_price * (1 - stopLoss),
                    takeProfit: marketData.last_price * (1 + parameters.takeProfit || 0.1)
                };
            }
            if (priceChange < -threshold && volume > parameters.minVolume) {
                return {
                    action: 'SELL',
                    size: parameters.orderSize,
                    price: marketData.last_price * 0.999,
                    stopLoss: marketData.last_price * (1 + stopLoss),
                    takeProfit: marketData.last_price * (1 - parameters.takeProfit || 0.1)
                };
            }
        }
        if (currentPosition) {
            const unrealizedPnl = currentPosition.unrealized_pnl;
            const positionValue = Math.abs(positionSize) * marketData.last_price;
            const pnlPercent = unrealizedPnl / positionValue;
            if (pnlPercent < -stopLoss || pnlPercent > (parameters.takeProfit || 0.1)) {
                return {
                    action: 'CLOSE',
                    size: Math.abs(positionSize),
                    price: marketData.last_price
                };
            }
        }
        return { action: 'HOLD' };
    }
    executeMeanReversionStrategy(strategy, marketData, positions) {
        const { parameters } = strategy;
        const { periods = 20, stdDev = 2 } = parameters;
        const upperBand = marketData.sma_20 + (stdDev * marketData.std_20);
        const lowerBand = marketData.sma_20 - (stdDev * marketData.std_20);
        const currentPrice = marketData.last_price;
        const currentPosition = positions.find(p => p.symbol === strategy.symbol);
        const positionSize = currentPosition ? currentPosition.size : 0;
        if (Math.abs(positionSize) < parameters.maxPositionSize) {
            if (currentPrice < lowerBand) {
                return {
                    action: 'BUY',
                    size: parameters.orderSize,
                    price: currentPrice,
                    takeProfit: marketData.sma_20
                };
            }
            if (currentPrice > upperBand) {
                return {
                    action: 'SELL',
                    size: parameters.orderSize,
                    price: currentPrice,
                    takeProfit: marketData.sma_20
                };
            }
        }
        if (currentPosition) {
            const isLong = positionSize > 0;
            const isShort = positionSize < 0;
            if ((isLong && currentPrice >= marketData.sma_20) ||
                (isShort && currentPrice <= marketData.sma_20)) {
                return {
                    action: 'CLOSE',
                    size: Math.abs(positionSize),
                    price: currentPrice
                };
            }
        }
        return { action: 'HOLD' };
    }
    executeGridStrategy(strategy, marketData, positions) {
        const { parameters } = strategy;
        const { gridSize = 0.01, levels = 10, orderSize } = parameters;
        const currentPrice = marketData.last_price;
        const basePrice = parameters.basePrice || currentPrice;
        const gridLevels = [];
        for (let i = -levels; i <= levels; i++) {
            if (i === 0)
                continue;
            gridLevels.push({
                level: i,
                price: basePrice * (1 + (i * gridSize)),
                side: i > 0 ? 'SELL' : 'BUY'
            });
        }
        const nearestLevel = gridLevels.reduce((prev, curr) => {
            return Math.abs(curr.price - currentPrice) < Math.abs(prev.price - currentPrice) ? curr : prev;
        });
        const priceDistance = Math.abs(currentPrice - nearestLevel.price) / currentPrice;
        if (priceDistance < gridSize * 0.5) {
            return {
                action: nearestLevel.side,
                size: orderSize,
                price: nearestLevel.price,
                type: 'LIMIT'
            };
        }
        return { action: 'HOLD' };
    }
    executeDCAStrategy(strategy, marketData, positions) {
        const { parameters } = strategy;
        const { interval = 3600000, orderSize, priceDropThreshold = 0.02 } = parameters;
        const currentPrice = marketData.last_price;
        const lastExecution = strategy.lastExecution;
        const timeSinceLastExecution = Date.now() - lastExecution.getTime();
        if (timeSinceLastExecution > interval) {
            return {
                action: 'BUY',
                size: orderSize,
                price: currentPrice,
                type: 'MARKET'
            };
        }
        if (parameters.lastPrice && (parameters.lastPrice - currentPrice) / parameters.lastPrice > priceDropThreshold) {
            return {
                action: 'BUY',
                size: orderSize * 1.5,
                price: currentPrice,
                type: 'MARKET'
            };
        }
        return { action: 'HOLD' };
    }
    executeArbitrageStrategy(strategy, marketData, positions) {
        const { parameters } = strategy;
        const { minSpread = 0.005, orderSize } = parameters;
        const futuresPrice = marketData.last_price;
        const spotPrice = marketData.spot_price || futuresPrice;
        const spread = (futuresPrice - spotPrice) / spotPrice;
        if (Math.abs(spread) > minSpread) {
            if (spread > 0) {
                return {
                    action: 'SELL',
                    size: orderSize,
                    price: futuresPrice,
                    type: 'MARKET'
                };
            }
            else {
                return {
                    action: 'BUY',
                    size: orderSize,
                    price: futuresPrice,
                    type: 'MARKET'
                };
            }
        }
        return { action: 'HOLD' };
    }
    async queueExecution(strategy, signal) {
        const riskApproved = await this.checkRiskLimits(strategy, signal);
        if (!riskApproved) {
            logger.warn(`Risk check failed for strategy ${strategy.strategyId}`);
            return;
        }
        const execution = {
            id: Date.now() + Math.random(),
            strategy,
            signal,
            timestamp: new Date(),
            status: 'QUEUED',
            retries: 0
        };
        this.executionQueue.push(execution);
        logger.info(`Queued execution for ${strategy.strategyName}: ${signal.action}`);
    }
    async processExecutionQueue() {
        if (this.processingExecution || this.executionQueue.length === 0)
            return;
        this.processingExecution = true;
        try {
            const execution = this.executionQueue.shift();
            await this.executeSignal(execution);
        }
        catch (error) {
            logger.error('Failed to process execution queue:', error);
        }
        finally {
            this.processingExecution = false;
        }
    }
    async executeSignal(execution) {
        const { strategy, signal } = execution;
        try {
            execution.status = 'EXECUTING';
            const credentials = this.userCredentials.get(strategy.userId);
            if (!credentials) {
                throw new Error('User credentials not found');
            }
            let result;
            switch (signal.action) {
                case 'BUY':
                case 'SELL':
                    result = await this.executeBuySellOrder(credentials, strategy, signal);
                    break;
                case 'CLOSE':
                    result = await this.executeClosePosition(credentials, strategy, signal);
                    break;
                default:
                    throw new Error(`Unknown signal action: ${signal.action}`);
            }
            execution.status = 'COMPLETED';
            execution.result = result;
            await this.logStrategyExecution(strategy, signal, 'SUCCESS', result);
            logger.info(`Executed signal for ${strategy.strategyName}: ${signal.action}`);
        }
        catch (error) {
            execution.status = 'FAILED';
            execution.error = error.message;
            execution.retries++;
            if (execution.retries < 3) {
                this.executionQueue.push(execution);
                logger.warn(`Retrying execution for ${strategy.strategyName} (attempt ${execution.retries + 1})`);
            }
            else {
                logger.error(`Failed to execute signal for ${strategy.strategyName}:`, error);
                await this.logStrategyExecution(strategy, signal, 'FAILED', { error: error.message });
            }
        }
    }
    async executeBuySellOrder(credentials, strategy, signal) {
        const orderData = {
            symbol: strategy.symbol,
            side: signal.action.toLowerCase(),
            type: signal.type || 'MARKET',
            size: signal.size,
            price: signal.price,
            leverage: strategy.parameters.leverage || 1,
            marginMode: strategy.parameters.marginMode || 'CROSS',
            reduceOnly: false
        };
        const result = await poloniexFuturesService.placeOrder(credentials, orderData);
        await poloniexFuturesService.storeOrderInDatabase(strategy.userId, orderData, result);
        return result;
    }
    async executeClosePosition(credentials, strategy, signal) {
        const orderData = {
            symbol: strategy.symbol,
            side: signal.side || 'SELL',
            type: 'MARKET',
            size: signal.size,
            reduceOnly: true
        };
        const result = await poloniexFuturesService.placeOrder(credentials, orderData);
        await poloniexFuturesService.storeOrderInDatabase(strategy.userId, orderData, result);
        return result;
    }
    startRiskMonitoring() {
        setInterval(() => {
            this.performRiskChecks();
        }, this.config.riskCheckInterval);
    }
    async performRiskChecks() {
        if (!this.isRunning || !this.isInitialized)
            return;
        try {
            if (!await this.isDatabaseAvailable()) {
                return;
            }
            await this.checkDailyLossLimits();
            await this.checkPositionSizeLimits();
            await this.checkMarginRequirements();
            await this.checkEmergencyConditions();
        }
        catch (error) {
            logger.error('Risk check failed:', error);
        }
    }
    async isDatabaseAvailable() {
        try {
            const result = await query('SELECT 1 as test');
            return result.rows.length > 0;
        }
        catch (error) {
            logger.debug('Database not available for risk checks:', error.message);
            return false;
        }
    }
    async checkRiskLimits(strategy, signal) {
        try {
            const dailyPnl = await this.getDailyPnL(strategy.userId);
            if (dailyPnl < -this.config.maxDailyLoss) {
                logger.warn(`Daily loss limit exceeded for user ${strategy.userId}`);
                return false;
            }
            const currentPositions = await this.getCurrentPositions(strategy.userId);
            const totalPositionValue = currentPositions.reduce((sum, pos) => sum + Math.abs(pos.size * pos.mark_price), 0);
            const accountEquity = await this.getAccountEquity(strategy.userId);
            if (totalPositionValue / accountEquity > this.config.maxPositionSize) {
                logger.warn(`Position size limit exceeded for user ${strategy.userId}`);
                return false;
            }
            return true;
        }
        catch (error) {
            logger.error('Risk limit check failed:', error);
            return false;
        }
    }
    async checkDailyLossLimits() {
        const result = await query(`
      SELECT user_id, SUM(realized_pnl) as daily_pnl
      FROM futures_trades
      WHERE trade_time >= CURRENT_DATE
      GROUP BY user_id
      HAVING SUM(realized_pnl) < -1000 -- $1000 daily loss limit
    `);
        for (const row of result.rows) {
            logger.warn(`Daily loss limit exceeded for user ${row.user_id}: ${row.daily_pnl}`);
            await this.deactivateUserStrategies(row.user_id);
        }
    }
    async checkPositionSizeLimits() {
        const result = await query(`
      SELECT fp.user_id, fp.symbol, fp.size, fp.mark_price, fa.total_equity
      FROM futures_positions fp
      JOIN futures_accounts fa ON fp.account_id = fa.id
      WHERE fp.size != 0
      AND ABS(fp.size * fp.mark_price) > fa.total_equity * 0.5
    `);
        for (const row of result.rows) {
            logger.warn(`Position size limit exceeded for user ${row.user_id} on ${row.symbol}`);
        }
    }
    async checkMarginRequirements() {
        const result = await query(`
      SELECT user_id, margin_ratio, total_equity
      FROM futures_accounts
      WHERE margin_ratio > 0.8 -- 80% margin utilization
    `);
        for (const row of result.rows) {
            logger.warn(`High margin utilization for user ${row.user_id}: ${row.margin_ratio}`);
        }
    }
    async checkEmergencyConditions() {
        const systemRisk = await this.assessSystemRisk();
        if (systemRisk.level === 'HIGH') {
            logger.error('High system risk detected, implementing emergency measures');
            await this.implementEmergencyMeasures();
        }
    }
    updateMarketData(data) {
        const existing = this.marketData.get(data.symbol) || {};
        existing.prev_price = existing.last_price || data.last_price;
        this.marketData.set(data.symbol, {
            ...existing,
            ...data,
            timestamp: new Date()
        });
    }
    async loadUserCredentials(userId) {
        const result = await query(`
      SELECT api_key_encrypted, api_secret_encrypted, passphrase_encrypted
      FROM user_api_credentials
      WHERE user_id = $1 AND exchange = 'poloniex' AND is_active = true
      LIMIT 1
    `, [userId]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            apiKey: row.api_key_encrypted,
            apiSecret: row.api_secret_encrypted,
            passphrase: row.passphrase_encrypted
        };
    }
    async getCurrentPositions(userId, symbol = null) {
        const params = [userId];
        let query_text = 'SELECT * FROM futures_positions WHERE user_id = $1 AND size != 0';
        if (symbol) {
            query_text += ' AND symbol = $2';
            params.push(symbol);
        }
        const result = await query(query_text, params);
        return result.rows;
    }
    async getDailyPnL(userId) {
        const result = await query(`
      SELECT SUM(realized_pnl) as daily_pnl
      FROM futures_trades
      WHERE user_id = $1 AND trade_time >= CURRENT_DATE
    `, [userId]);
        return result.rows[0]?.daily_pnl || 0;
    }
    async getAccountEquity(userId) {
        const result = await query(`
      SELECT total_equity
      FROM futures_accounts
      WHERE user_id = $1 AND is_active = true
      LIMIT 1
    `, [userId]);
        return result.rows[0]?.total_equity || 0;
    }
    async logStrategyExecution(strategy, signal, result, data) {
        await query(`
      INSERT INTO strategy_execution_logs (
        user_id, account_id, strategy_id, strategy_name, strategy_type,
        symbol, action, execution_result, parameters, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
            strategy.userId,
            strategy.accountId,
            strategy.strategyId,
            strategy.strategyName,
            strategy.strategyType,
            strategy.symbol,
            signal.action,
            result,
            JSON.stringify({ signal, result: data }),
            new Date()
        ]);
    }
    validateStrategyConfig(config) {
        const required = ['type', 'symbol', 'parameters'];
        const missing = required.filter(field => !config[field]);
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
        if (!config.parameters.orderSize || config.parameters.orderSize <= 0) {
            throw new Error('Order size must be greater than 0');
        }
        return true;
    }
    async deactivateUserStrategies(userId) {
        for (const [key, strategy] of this.activeStrategies) {
            if (strategy.userId === userId) {
                strategy.isActive = false;
                logger.info(`Deactivated strategy ${key} due to risk limits`);
            }
        }
    }
    async assessSystemRisk() {
        const activeStrategies = Array.from(this.activeStrategies.values()).filter(s => s.isActive);
        const marketVolatility = this.calculateMarketVolatility();
        let riskLevel = 'LOW';
        if (activeStrategies.length > 100 || marketVolatility > 0.1) {
            riskLevel = 'HIGH';
        }
        else if (activeStrategies.length > 50 || marketVolatility > 0.05) {
            riskLevel = 'MEDIUM';
        }
        return { level: riskLevel, details: { activeStrategies: activeStrategies.length, marketVolatility } };
    }
    calculateMarketVolatility() {
        const prices = Array.from(this.marketData.values()).map(data => data.last_price);
        if (prices.length < 2)
            return 0;
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        return Math.sqrt(variance) / mean;
    }
    async implementEmergencyMeasures() {
        logger.error('Implementing emergency measures - stopping all strategies');
        for (const [key, strategy] of this.activeStrategies) {
            strategy.isActive = false;
        }
    }
    handlePositionUpdate(data) {
        this.emit('positionUpdate', data);
    }
    handleOrderUpdate(data) {
        this.emit('orderUpdate', data);
    }
    handleTradeExecution(data) {
        this.emit('tradeExecution', data);
    }
    async shutdown() {
        logger.info('Shutting down Automated Trading Service...');
        this.isRunning = false;
        logger.info('Automated Trading Service shutdown complete');
    }
    getStatus() {
        return {
            isRunning: this.isRunning,
            activeStrategies: this.activeStrategies.size,
            executionQueueSize: this.executionQueue.length,
            marketDataSymbols: this.marketData.size,
            connectedUsers: this.userCredentials.size
        };
    }
}
const automatedTradingService = new AutomatedTradingService();
export { AutomatedTradingService };
export default automatedTradingService;
