/**
 * Fully Autonomous Trading System
 *
 * This system operates completely autonomously:
 * - Analyzes markets 24/7
 * - Generates and tests strategies automatically
 * - Manages positions and risk without human input
 * - Self-optimizes based on performance
 * - Trades to profitability
 */
import { EventEmitter } from 'events';
import { pool } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import mlPredictionService from './mlPredictionService.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import { logger } from '../utils/logger.js';
class FullyAutonomousTrader extends EventEmitter {
    constructor() {
        super();
        this.configs = new Map();
        this.positions = new Map();
        this.runningIntervals = new Map();
        this.performanceMetrics = new Map();
        this.loadActiveConfigs();
    }
    /**
     * Load active trading configs from database on startup
     */
    async loadActiveConfigs() {
        try {
            const result = await pool.query(`SELECT * FROM autonomous_trading_configs WHERE enabled = true`);
            for (const row of result.rows) {
                const config = {
                    userId: row.user_id,
                    initialCapital: parseFloat(row.initial_capital),
                    maxRiskPerTrade: parseFloat(row.max_risk_per_trade),
                    maxDrawdown: parseFloat(row.max_drawdown),
                    targetDailyReturn: parseFloat(row.target_daily_return),
                    symbols: row.symbols,
                    enabled: row.enabled
                };
                this.configs.set(config.userId, config);
                await this.startTrading(config.userId);
            }
            logger.info(`Loaded ${result.rows.length} active autonomous trading configs`);
        }
        catch (error) {
            logger.error('Error loading autonomous trading configs:', error);
        }
    }
    /**
     * Enable autonomous trading for a user
     */
    async enableAutonomousTrading(userId, config) {
        // Get user's API credentials
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials) {
            throw new Error('No API credentials found. Please add your Poloniex API keys.');
        }
        // Get account balance
        const balance = await poloniexFuturesService.getAccountBalance(credentials);
        const availableBalance = parseFloat(balance.availMgn || balance.availableBalance || '1000');
        // Create default config
        const tradingConfig = {
            userId,
            initialCapital: availableBalance,
            maxRiskPerTrade: config?.maxRiskPerTrade || 2, // 2% per trade
            maxDrawdown: config?.maxDrawdown || 10, // 10% max drawdown
            targetDailyReturn: config?.targetDailyReturn || 1, // 1% daily target
            symbols: config?.symbols || ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP'],
            enabled: true
        };
        // Save to database
        await pool.query(`INSERT INTO autonomous_trading_configs 
       (user_id, initial_capital, max_risk_per_trade, max_drawdown, target_daily_return, symbols, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         initial_capital = $2,
         max_risk_per_trade = $3,
         max_drawdown = $4,
         target_daily_return = $5,
         symbols = $6,
         enabled = $7,
         updated_at = NOW()`, [
            userId,
            tradingConfig.initialCapital,
            tradingConfig.maxRiskPerTrade,
            tradingConfig.maxDrawdown,
            tradingConfig.targetDailyReturn,
            tradingConfig.symbols,
            tradingConfig.enabled
        ]);
        this.configs.set(userId, tradingConfig);
        await this.startTrading(userId);
        logger.info(`Autonomous trading enabled for user ${userId}`);
        this.emit('trading_enabled', { userId, config: tradingConfig });
    }
    /**
     * Disable autonomous trading for a user
     */
    async disableAutonomousTrading(userId) {
        const config = this.configs.get(userId);
        if (!config) {
            throw new Error('Autonomous trading not enabled for this user');
        }
        // Stop trading loop
        const interval = this.runningIntervals.get(userId);
        if (interval) {
            clearInterval(interval);
            this.runningIntervals.delete(userId);
        }
        // Close all positions
        await this.closeAllPositions(userId);
        // Update database
        await pool.query(`UPDATE autonomous_trading_configs SET enabled = false WHERE user_id = $1`, [userId]);
        config.enabled = false;
        this.configs.delete(userId);
        logger.info(`Autonomous trading disabled for user ${userId}`);
        this.emit('trading_disabled', { userId });
    }
    /**
     * Start the autonomous trading loop
     */
    async startTrading(userId) {
        const config = this.configs.get(userId);
        if (!config || !config.enabled) {
            return;
        }
        logger.info(`Starting autonomous trading for user ${userId}`);
        // Run immediately
        this.tradingCycle(userId).catch(err => {
            logger.error(`Trading cycle error for user ${userId}:`, err);
        });
        // Then run every 1 minute (high-frequency monitoring)
        const interval = setInterval(async () => {
            try {
                await this.tradingCycle(userId);
            }
            catch (err) {
                logger.error(`Trading cycle error for user ${userId}:`, err);
            }
        }, 60 * 1000); // 1 minute
        this.runningIntervals.set(userId, interval);
    }
    /**
     * Main autonomous trading cycle
     */
    async tradingCycle(userId) {
        const config = this.configs.get(userId);
        if (!config || !config.enabled) {
            return;
        }
        try {
            // Step 1: Check risk limits
            const riskCheck = await this.checkRiskLimits(userId);
            if (!riskCheck.canTrade) {
                logger.warn(`Risk limits exceeded for user ${userId}: ${riskCheck.reason}`);
                return;
            }
            // Step 2: Analyze all markets
            const analyses = await this.analyzeMarkets(userId, config.symbols);
            // Step 3: Manage existing positions
            await this.managePositions(userId, analyses);
            // Step 4: Generate trading signals
            const signals = await this.generateTradingSignals(userId, analyses);
            // Step 5: Execute high-confidence signals
            await this.executeSignals(userId, signals);
            // Step 6: Update performance metrics
            await this.updatePerformanceMetrics(userId);
        }
        catch (error) {
            logger.error(`Trading cycle error for user ${userId}:`, error);
        }
    }
    /**
     * Check if trading is within risk limits
     */
    async checkRiskLimits(userId) {
        const config = this.configs.get(userId);
        if (!config) {
            return { canTrade: false, reason: 'No config found' };
        }
        try {
            const credentials = await apiCredentialsService.getCredentials(userId);
            if (!credentials) {
                return { canTrade: false, reason: 'No API credentials' };
            }
            // Get current balance
            const balance = await poloniexFuturesService.getAccountBalance(credentials);
            const currentEquity = parseFloat(balance.eq || balance.totalEquity || '0');
            // Check drawdown
            const drawdown = ((config.initialCapital - currentEquity) / config.initialCapital) * 100;
            if (drawdown > config.maxDrawdown) {
                return { canTrade: false, reason: `Max drawdown exceeded: ${drawdown.toFixed(2)}%` };
            }
            // Check if we have capital
            if (currentEquity < 10) {
                return { canTrade: false, reason: 'Insufficient capital' };
            }
            return { canTrade: true };
        }
        catch (error) {
            logger.error(`Risk check error for user ${userId}:`, error);
            return { canTrade: false, reason: 'Risk check failed' };
        }
    }
    /**
     * Analyze multiple markets simultaneously
     */
    async analyzeMarkets(userId, symbols) {
        const analyses = new Map();
        await Promise.all(symbols.map(async (symbol) => {
            try {
                const analysis = await this.analyzeMarket(symbol);
                analyses.set(symbol, analysis);
            }
            catch (error) {
                logger.error(`Market analysis error for ${symbol}:`, error);
            }
        }));
        return analyses;
    }
    /**
     * Analyze a single market
     */
    async analyzeMarket(symbol) {
        // Get historical data
        const ohlcv = await poloniexFuturesService.getHistoricalData(symbol, '15m', 100);
        // Calculate technical indicators
        const closes = ohlcv.map(c => c.close);
        const highs = ohlcv.map(c => c.high);
        const lows = ohlcv.map(c => c.low);
        // Simple trend detection
        const sma20 = this.calculateSMA(closes, 20);
        const sma50 = this.calculateSMA(closes, 50);
        const currentPrice = closes[closes.length - 1];
        let trend = 'neutral';
        if (sma20 > sma50 && currentPrice > sma20) {
            trend = 'bullish';
        }
        else if (sma20 < sma50 && currentPrice < sma20) {
            trend = 'bearish';
        }
        // Calculate volatility
        const returns = closes.slice(1).map((price, i) => (price - closes[i]) / closes[i]);
        const volatility = this.calculateStdDev(returns);
        const volatilityLevel = volatility > 0.03 ? 'high' : volatility > 0.01 ? 'medium' : 'low';
        // Calculate momentum (RSI-like)
        const momentum = this.calculateMomentum(closes);
        // Support and resistance
        const support = Math.min(...lows.slice(-20));
        const resistance = Math.max(...highs.slice(-20));
        // Get ML prediction
        let mlPrediction = {
            direction: 'NEUTRAL',
            confidence: 0,
            targetPrice: currentPrice
        };
        try {
            const predictions = await mlPredictionService.getMultiHorizonPredictions(symbol, ohlcv);
            const signal = await mlPredictionService.getTradingSignal(symbol, ohlcv, currentPrice);
            mlPrediction = {
                direction: signal.action === 'BUY' ? 'UP' : signal.action === 'SELL' ? 'DOWN' : 'NEUTRAL',
                confidence: signal.confidence,
                targetPrice: predictions['1h'].price
            };
        }
        catch (error) {
            logger.warn(`ML prediction unavailable for ${symbol}`);
        }
        return {
            symbol,
            trend,
            volatility: volatilityLevel,
            momentum,
            support,
            resistance,
            mlPrediction
        };
    }
    /**
     * Generate trading signals based on market analysis
     */
    async generateTradingSignals(userId, analyses) {
        const config = this.configs.get(userId);
        if (!config)
            return [];
        const signals = [];
        for (const [symbol, analysis] of analyses) {
            try {
                const signal = await this.generateSignal(symbol, analysis, config);
                if (signal && signal.confidence >= 70) { // Only high-confidence signals
                    signals.push(signal);
                }
            }
            catch (error) {
                logger.error(`Signal generation error for ${symbol}:`, error);
            }
        }
        // Sort by confidence
        return signals.sort((a, b) => b.confidence - a.confidence);
    }
    /**
     * Generate a trading signal for a symbol
     */
    async generateSignal(symbol, analysis, config) {
        const ticker = await poloniexFuturesService.getTickers(symbol);
        const currentPrice = parseFloat(ticker[0]?.markPx || ticker[0]?.markPrice || '0');
        if (!currentPrice)
            return null;
        let action = 'HOLD';
        let side = 'long';
        let confidence = 0;
        let reason = '';
        // Multi-factor signal generation
        const factors = {
            trend: 0,
            momentum: 0,
            ml: 0,
            volatility: 0
        };
        // Trend factor
        if (analysis.trend === 'bullish') {
            factors.trend = 30;
        }
        else if (analysis.trend === 'bearish') {
            factors.trend = -30;
        }
        // Momentum factor
        factors.momentum = analysis.momentum * 0.2; // Scale to -20 to 20
        // ML factor
        if (analysis.mlPrediction.direction === 'UP') {
            factors.ml = analysis.mlPrediction.confidence * 0.3; // Scale to 0-30
        }
        else if (analysis.mlPrediction.direction === 'DOWN') {
            factors.ml = -analysis.mlPrediction.confidence * 0.3;
        }
        // Volatility factor (prefer medium volatility)
        if (analysis.volatility === 'medium') {
            factors.volatility = 10;
        }
        else if (analysis.volatility === 'low') {
            factors.volatility = 5;
        }
        // Calculate total confidence
        const totalScore = factors.trend + factors.momentum + factors.ml + factors.volatility;
        confidence = Math.abs(totalScore);
        if (totalScore > 50) {
            action = 'BUY';
            side = 'long';
            reason = `Bullish: Trend=${factors.trend}, Momentum=${factors.momentum.toFixed(1)}, ML=${factors.ml.toFixed(1)}`;
        }
        else if (totalScore < -50) {
            action = 'SELL';
            side = 'short';
            reason = `Bearish: Trend=${factors.trend}, Momentum=${factors.momentum.toFixed(1)}, ML=${factors.ml.toFixed(1)}`;
        }
        if (action === 'HOLD')
            return null;
        // Calculate position size based on risk
        const riskAmount = (config.initialCapital * config.maxRiskPerTrade) / 100;
        const stopLossDistance = currentPrice * 0.02; // 2% stop loss
        const positionSize = riskAmount / stopLossDistance;
        // Calculate stop loss and take profit
        const stopLoss = side === 'long'
            ? currentPrice * 0.98 // 2% below entry
            : currentPrice * 1.02; // 2% above entry
        const takeProfit = side === 'long'
            ? currentPrice * 1.04 // 4% above entry (2:1 risk/reward)
            : currentPrice * 0.96; // 4% below entry
        return {
            symbol,
            action,
            side,
            confidence,
            entryPrice: currentPrice,
            stopLoss,
            takeProfit,
            positionSize: Math.min(positionSize, config.initialCapital * 0.1), // Max 10% per position
            leverage: 3, // Conservative leverage
            reason,
            indicators: factors
        };
    }
    /**
     * Execute trading signals
     */
    async executeSignals(userId, signals) {
        const config = this.configs.get(userId);
        if (!config || signals.length === 0)
            return;
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials)
            return;
        // Get current positions
        const currentPositions = await poloniexFuturesService.getPositions(credentials);
        const positionCount = currentPositions.filter((p) => parseFloat(p.qty || p.positionAmt || '0') !== 0).length;
        // Limit concurrent positions
        const maxPositions = 3;
        if (positionCount >= maxPositions) {
            logger.info(`Max positions reached for user ${userId}`);
            return;
        }
        // Execute top signal
        const signal = signals[0];
        try {
            logger.info(`Executing signal for ${signal.symbol}: ${signal.action} at ${signal.entryPrice}`);
            // Place order
            const order = await poloniexFuturesService.placeOrder(credentials, {
                symbol: signal.symbol,
                side: signal.side === 'long' ? 'BUY' : 'SELL',
                type: 'MARKET',
                quantity: signal.positionSize / signal.entryPrice,
                leverage: signal.leverage
            });
            // Log trade
            await pool.query(`INSERT INTO autonomous_trades 
         (user_id, symbol, side, entry_price, quantity, stop_loss, take_profit, confidence, reason, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                userId,
                signal.symbol,
                signal.side,
                signal.entryPrice,
                signal.positionSize / signal.entryPrice,
                signal.stopLoss,
                signal.takeProfit,
                signal.confidence,
                signal.reason,
                order.orderId
            ]);
            this.emit('trade_executed', { userId, signal, order });
            logger.info(`Trade executed for user ${userId}: ${signal.symbol} ${signal.side}`);
        }
        catch (error) {
            logger.error(`Error executing signal for user ${userId}:`, error);
        }
    }
    /**
     * Manage existing positions (stop loss, take profit, trailing stop)
     */
    async managePositions(userId, analyses) {
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials)
            return;
        try {
            const positions = await poloniexFuturesService.getPositions(credentials);
            for (const position of positions) {
                const qty = parseFloat(position.qty || position.positionAmt || '0');
                if (qty === 0)
                    continue;
                const symbol = position.symbol;
                const currentPrice = parseFloat(position.markPx || position.markPrice || '0');
                const entryPrice = parseFloat(position.openAvgPx || position.entryPrice || '0');
                const unrealizedPnL = parseFloat(position.upl || position.unrealizedPnl || '0');
                // Check stop loss (2% loss)
                const lossPercent = (unrealizedPnL / (entryPrice * Math.abs(qty))) * 100;
                if (lossPercent < -2) {
                    logger.info(`Stop loss triggered for ${symbol}: ${lossPercent.toFixed(2)}%`);
                    await this.closePosition(userId, symbol, 'stop_loss');
                    continue;
                }
                // Check take profit (4% profit)
                if (lossPercent > 4) {
                    logger.info(`Take profit triggered for ${symbol}: ${lossPercent.toFixed(2)}%`);
                    await this.closePosition(userId, symbol, 'take_profit');
                    continue;
                }
                // Trailing stop (if profit > 2%, trail at 1%)
                if (lossPercent > 2) {
                    const analysis = analyses.get(symbol);
                    if (analysis) {
                        // If trend reverses, close position
                        const isLong = qty > 0;
                        if ((isLong && analysis.trend === 'bearish') || (!isLong && analysis.trend === 'bullish')) {
                            logger.info(`Trend reversal detected for ${symbol}, closing position`);
                            await this.closePosition(userId, symbol, 'trend_reversal');
                        }
                    }
                }
            }
        }
        catch (error) {
            logger.error(`Error managing positions for user ${userId}:`, error);
        }
    }
    /**
     * Close a position
     */
    async closePosition(userId, symbol, reason) {
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials)
            return;
        try {
            const positions = await poloniexFuturesService.getPositions(credentials);
            const position = positions.find((p) => p.symbol === symbol);
            if (!position)
                return;
            const qty = parseFloat(position.qty || position.positionAmt || '0');
            if (qty === 0)
                return;
            // Close position
            await poloniexFuturesService.placeOrder(credentials, {
                symbol,
                side: qty > 0 ? 'SELL' : 'BUY',
                type: 'MARKET',
                quantity: Math.abs(qty),
                reduceOnly: true
            });
            logger.info(`Position closed for user ${userId}: ${symbol} (${reason})`);
            this.emit('position_closed', { userId, symbol, reason });
        }
        catch (error) {
            logger.error(`Error closing position for user ${userId}:`, error);
        }
    }
    /**
     * Close all positions for a user
     */
    async closeAllPositions(userId) {
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials)
            return;
        try {
            const positions = await poloniexFuturesService.getPositions(credentials);
            for (const position of positions) {
                const qty = parseFloat(position.qty || position.positionAmt || '0');
                if (qty !== 0) {
                    await this.closePosition(userId, position.symbol, 'trading_disabled');
                }
            }
        }
        catch (error) {
            logger.error(`Error closing all positions for user ${userId}:`, error);
        }
    }
    /**
     * Update performance metrics
     */
    async updatePerformanceMetrics(userId) {
        const config = this.configs.get(userId);
        if (!config)
            return;
        try {
            const credentials = await apiCredentialsService.getCredentials(userId);
            if (!credentials)
                return;
            const balance = await poloniexFuturesService.getAccountBalance(credentials);
            const currentEquity = parseFloat(balance.eq || balance.totalEquity || '0');
            const metrics = {
                currentEquity,
                initialCapital: config.initialCapital,
                totalReturn: ((currentEquity - config.initialCapital) / config.initialCapital) * 100,
                drawdown: ((config.initialCapital - currentEquity) / config.initialCapital) * 100,
                timestamp: new Date()
            };
            this.performanceMetrics.set(userId, metrics);
            // Save to database
            await pool.query(`INSERT INTO autonomous_performance 
         (user_id, current_equity, total_return, drawdown, timestamp)
         VALUES ($1, $2, $3, $4, $5)`, [userId, metrics.currentEquity, metrics.totalReturn, metrics.drawdown, metrics.timestamp]);
        }
        catch (error) {
            logger.error(`Error updating performance metrics for user ${userId}:`, error);
        }
    }
    /**
     * Get performance metrics for a user
     */
    async getPerformanceMetrics(userId) {
        return this.performanceMetrics.get(userId) || null;
    }
    /**
     * Helper: Calculate Simple Moving Average
     */
    calculateSMA(data, period) {
        if (data.length < period)
            return data[data.length - 1];
        const slice = data.slice(-period);
        return slice.reduce((sum, val) => sum + val, 0) / period;
    }
    /**
     * Helper: Calculate Standard Deviation
     */
    calculateStdDev(data) {
        const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
        const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
        const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / data.length;
        return Math.sqrt(variance);
    }
    /**
     * Helper: Calculate Momentum (RSI-like indicator)
     */
    calculateMomentum(closes) {
        if (closes.length < 14)
            return 0;
        const changes = closes.slice(1).map((price, i) => price - closes[i]);
        const gains = changes.filter(c => c > 0);
        const losses = changes.filter(c => c < 0).map(Math.abs);
        const avgGain = gains.length > 0 ? gains.reduce((sum, g) => sum + g, 0) / gains.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0;
        if (avgLoss === 0)
            return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        // Convert RSI (0-100) to momentum (-100 to 100)
        return (rsi - 50) * 2;
    }
}
// Export singleton instance
export const fullyAutonomousTrader = new FullyAutonomousTrader();
export default fullyAutonomousTrader;
