import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';
/**
 * Enhanced Backtesting Engine
 * Sophisticated backtesting with historical data, realistic market simulation,
 * and comprehensive performance analytics
 */
class BacktestingEngine extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.currentBacktest = null;
        this.results = new Map();
        this.strategies = new Map();
        this.historicalData = new Map();
        this.marketSimulation = {
            slippage: 0.001, // 0.1% default slippage
            latency: 50, // 50ms execution delay
            marketImpact: 0.0005 // 0.05% market impact
        };
    }
    /**
     * Register a strategy for backtesting
     * @param {string} strategyName - Unique strategy identifier
     * @param {Object} strategy - Strategy configuration
     */
    registerStrategy(strategyName, strategy) {
        this.strategies.set(strategyName, {
            ...strategy,
            id: strategyName,
            createdAt: new Date()
        });
        logger.info(`Strategy registered: ${strategyName}`);
    }
    /**
     * Load historical data for backtesting
     * @param {string} symbol - Trading symbol
     * @param {string} timeframe - Data timeframe (1m, 5m, 1h, 1d)
     * @param {Date} startDate - Start date for historical data
     * @param {Date} endDate - End date for historical data
     */
    async loadHistoricalData(symbol, timeframe, startDate, endDate) {
        try {
            logger.info(`Loading historical data for ${symbol} (${timeframe})`);
            // First, try to load from database
            const cachedData = await this.getCachedHistoricalData(symbol, timeframe, startDate, endDate);
            if (cachedData.length > 0) {
                logger.info(`Found ${cachedData.length} cached data points for ${symbol}`);
                this.historicalData.set(`${symbol}_${timeframe}`, cachedData);
                return cachedData;
            }
            // If no cached data, fetch from Poloniex API
            const freshData = await this.fetchHistoricalDataFromAPI(symbol, timeframe, startDate, endDate);
            // Cache the data for future use
            await this.cacheHistoricalData(symbol, timeframe, freshData);
            this.historicalData.set(`${symbol}_${timeframe}`, freshData);
            logger.info(`Loaded ${freshData.length} historical data points for ${symbol}`);
            return freshData;
        }
        catch (error) {
            logger.error(`Error loading historical data for ${symbol}:`, error);
            throw error;
        }
    }
    /**
     * Fetch historical data from Poloniex API
     */
    async fetchHistoricalDataFromAPI(symbol, timeframe, startDate, endDate) {
        try {
            const klineData = await poloniexFuturesService.getKlines(symbol, timeframe, Math.floor(startDate.getTime() / 1000), Math.floor(endDate.getTime() / 1000));
            return klineData.map(candle => ({
                timestamp: new Date(candle.time * 1000),
                open: parseFloat(candle.open),
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close),
                volume: parseFloat(candle.volume),
                symbol,
                timeframe
            }));
        }
        catch (error) {
            logger.error(`Error fetching historical data from API:`, error);
            throw error;
        }
    }
    /**
     * Get cached historical data from database
     */
    async getCachedHistoricalData(symbol, timeframe, startDate, endDate) {
        try {
            const result = await query(`
        SELECT timestamp, open, high, low, close, volume, symbol, timeframe
        FROM historical_market_data
        WHERE symbol = $1 AND timeframe = $2
        AND timestamp >= $3 AND timestamp <= $4
        ORDER BY timestamp ASC
      `, [symbol, timeframe, startDate, endDate]);
            return result.rows.map(row => ({
                timestamp: new Date(row.timestamp),
                open: parseFloat(row.open),
                high: parseFloat(row.high),
                low: parseFloat(row.low),
                close: parseFloat(row.close),
                volume: parseFloat(row.volume),
                symbol: row.symbol,
                timeframe: row.timeframe
            }));
        }
        catch (error) {
            logger.error('Error getting cached historical data:', error);
            return [];
        }
    }
    /**
     * Cache historical data in database
     */
    async cacheHistoricalData(symbol, timeframe, data) {
        try {
            const insertQuery = `
        INSERT INTO historical_market_data (symbol, timeframe, timestamp, open, high, low, close, volume)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume
      `;
            for (const candle of data) {
                await query(insertQuery, [
                    candle.symbol,
                    candle.timeframe,
                    candle.timestamp,
                    candle.open,
                    candle.high,
                    candle.low,
                    candle.close,
                    candle.volume
                ]);
            }
            logger.info(`Cached ${data.length} historical data points for ${symbol}`);
        }
        catch (error) {
            logger.error('Error caching historical data:', error);
        }
    }
    /**
     * Run backtest for a specific strategy
     * @param {string} strategyName - Strategy to backtest
     * @param {Object} config - Backtest configuration
     */
    async runBacktest(strategyName, config) {
        try {
            this.isRunning = true;
            const strategy = this.strategies.get(strategyName);
            if (!strategy) {
                throw new Error(`Strategy ${strategyName} not found`);
            }
            logger.info(`Starting backtest for strategy: ${strategyName}`);
            this.currentBacktest = {
                strategyName,
                config,
                startTime: new Date(),
                trades: [],
                positions: [],
                portfolio: {
                    cash: config.initialCapital || 100000,
                    totalValue: config.initialCapital || 100000,
                    equity: config.initialCapital || 100000,
                    margin: 0,
                    unrealizedPnl: 0,
                    realizedPnl: 0
                },
                metrics: {
                    totalTrades: 0,
                    winningTrades: 0,
                    losingTrades: 0,
                    maxDrawdown: 0,
                    maxDrawdownPercent: 0,
                    sharpeRatio: 0,
                    sortinoRatio: 0,
                    calmarRatio: 0
                },
                dailyReturns: [],
                equity_curve: []
            };
            // Load historical data
            const historicalData = await this.loadHistoricalData(config.symbol, config.timeframe, config.startDate, config.endDate);
            // Run the backtest simulation
            await this.runBacktestSimulation(strategy, historicalData, config);
            // Calculate final metrics
            this.calculateBacktestMetrics();
            // Store results
            await this.storeBacktestResults();
            this.isRunning = false;
            logger.info(`Backtest completed for strategy: ${strategyName}`);
            this.emit('backtestComplete', {
                strategyName,
                results: this.currentBacktest
            });
            return this.currentBacktest;
        }
        catch (error) {
            this.isRunning = false;
            logger.error(`Backtest failed for strategy ${strategyName}:`, error);
            throw error;
        }
    }
    /**
     * Run the actual backtest simulation
     */
    async runBacktestSimulation(strategy, historicalData, config) {
        let currentPosition = null;
        let stopLoss = null;
        let takeProfit = null;
        for (let i = 0; i < historicalData.length; i++) {
            const currentCandle = historicalData[i];
            const previousCandles = historicalData.slice(Math.max(0, i - strategy.lookback || 20), i);
            // Skip if not enough historical data
            if (previousCandles.length < (strategy.lookback || 20)) {
                continue;
            }
            // Calculate technical indicators
            const indicators = this.calculateTechnicalIndicators(previousCandles, currentCandle);
            // Generate trading signals
            const signals = await this.generateTradingSignals(strategy, indicators, currentCandle);
            // Process existing position (check stop loss, take profit)
            if (currentPosition) {
                const exitSignal = this.checkExitConditions(currentPosition, currentCandle, stopLoss, takeProfit);
                if (exitSignal) {
                    await this.executeExit(currentPosition, currentCandle, exitSignal.reason);
                    currentPosition = null;
                    stopLoss = null;
                    takeProfit = null;
                }
            }
            // Process new entry signals
            if (!currentPosition && signals.entry) {
                const entryResult = await this.executeEntry(signals.entry, currentCandle, config);
                if (entryResult.success) {
                    currentPosition = entryResult.position;
                    stopLoss = entryResult.stopLoss;
                    takeProfit = entryResult.takeProfit;
                }
            }
            // Update portfolio value
            this.updatePortfolioValue(currentCandle, currentPosition);
            // Record equity curve
            this.currentBacktest.equity_curve.push({
                timestamp: currentCandle.timestamp,
                totalValue: this.currentBacktest.portfolio.totalValue,
                cash: this.currentBacktest.portfolio.cash,
                unrealizedPnl: this.currentBacktest.portfolio.unrealizedPnl
            });
            // Emit progress updates
            if (i % 1000 === 0) {
                this.emit('backtestProgress', {
                    progress: (i / historicalData.length) * 100,
                    currentDate: currentCandle.timestamp,
                    totalValue: this.currentBacktest.portfolio.totalValue
                });
            }
        }
        // Close any remaining position
        if (currentPosition) {
            const lastCandle = historicalData[historicalData.length - 1];
            await this.executeExit(currentPosition, lastCandle, 'backtest_end');
        }
    }
    /**
     * Calculate technical indicators for strategy evaluation
     */
    calculateTechnicalIndicators(historicalData, currentCandle) {
        const closes = historicalData.map(d => d.close);
        const highs = historicalData.map(d => d.high);
        const lows = historicalData.map(d => d.low);
        const volumes = historicalData.map(d => d.volume);
        return {
            // Moving Averages
            sma20: this.calculateSMA(closes, 20),
            sma50: this.calculateSMA(closes, 50),
            ema20: this.calculateEMA(closes, 20),
            ema50: this.calculateEMA(closes, 50),
            // Momentum Indicators
            rsi: this.calculateRSI(closes, 14),
            macd: this.calculateMACD(closes),
            // Volatility Indicators
            bollingerBands: this.calculateBollingerBands(closes, 20, 2),
            atr: this.calculateATR(highs, lows, closes, 14),
            // Volume Indicators
            volumeMA: this.calculateSMA(volumes, 20),
            // Current price data
            current: {
                price: currentCandle.close,
                high: currentCandle.high,
                low: currentCandle.low,
                volume: currentCandle.volume
            }
        };
    }
    /**
     * Generate trading signals based on strategy
     */
    async generateTradingSignals(strategy, indicators, currentCandle) {
        const signals = { entry: null, exit: null };
        try {
            // Execute strategy logic
            switch (strategy.type) {
                case 'momentum':
                    signals.entry = this.generateMomentumSignals(indicators, strategy.parameters);
                    break;
                case 'mean_reversion':
                    signals.entry = this.generateMeanReversionSignals(indicators, strategy.parameters);
                    break;
                case 'breakout':
                    signals.entry = this.generateBreakoutSignals(indicators, strategy.parameters);
                    break;
                case 'custom':
                    if (strategy.customLogic) {
                        signals.entry = await strategy.customLogic(indicators, currentCandle);
                    }
                    break;
            }
            return signals;
        }
        catch (error) {
            logger.error('Error generating trading signals:', error);
            return signals;
        }
    }
    /**
     * Generate momentum-based trading signals
     */
    generateMomentumSignals(indicators, params) {
        const { rsi_oversold = 30, rsi_overbought = 70, macd_threshold = 0 } = params;
        // Long signal: RSI oversold and MACD positive
        if (indicators.rsi < rsi_oversold && indicators.macd.histogram > macd_threshold) {
            return {
                side: 'long',
                strength: Math.abs(indicators.rsi - 50) / 50,
                reason: 'momentum_long'
            };
        }
        // Short signal: RSI overbought and MACD negative
        if (indicators.rsi > rsi_overbought && indicators.macd.histogram < -macd_threshold) {
            return {
                side: 'short',
                strength: Math.abs(indicators.rsi - 50) / 50,
                reason: 'momentum_short'
            };
        }
        return null;
    }
    /**
     * Generate mean reversion signals
     */
    generateMeanReversionSignals(indicators, params) {
        const { bb_std_dev = 2, rsi_extreme = 20 } = params;
        const { upper, lower, middle } = indicators.bollingerBands;
        const currentPrice = indicators.current.price;
        // Long signal: Price below lower Bollinger Band and RSI oversold
        if (currentPrice < lower && indicators.rsi < rsi_extreme) {
            return {
                side: 'long',
                strength: (lower - currentPrice) / (upper - lower),
                reason: 'mean_reversion_long'
            };
        }
        // Short signal: Price above upper Bollinger Band and RSI overbought
        if (currentPrice > upper && indicators.rsi > (100 - rsi_extreme)) {
            return {
                side: 'short',
                strength: (currentPrice - upper) / (upper - lower),
                reason: 'mean_reversion_short'
            };
        }
        return null;
    }
    /**
     * Execute entry order with realistic market simulation
     */
    async executeEntry(signal, currentCandle, config) {
        try {
            // Calculate position size based on risk management
            const positionSize = this.calculatePositionSize(signal, config);
            // Simulate market conditions
            const executionPrice = this.simulateMarketExecution(currentCandle.close, signal.side, positionSize, 'entry');
            // Calculate stop loss and take profit
            const stopLoss = this.calculateStopLoss(executionPrice, signal.side, config);
            const takeProfit = this.calculateTakeProfit(executionPrice, signal.side, config);
            // Create position
            const position = {
                id: `pos_${Date.now()}`,
                symbol: config.symbol,
                side: signal.side,
                size: positionSize,
                entryPrice: executionPrice,
                entryTime: currentCandle.timestamp,
                stopLoss,
                takeProfit,
                unrealizedPnl: 0,
                status: 'open'
            };
            // Record trade
            const trade = {
                id: `trade_${Date.now()}`,
                positionId: position.id,
                symbol: config.symbol,
                side: signal.side,
                size: positionSize,
                price: executionPrice,
                timestamp: currentCandle.timestamp,
                type: 'entry',
                reason: signal.reason,
                fees: this.calculateTradingFees(positionSize, executionPrice)
            };
            // Update portfolio
            this.updatePortfolioAfterTrade(trade, 'entry');
            // Store trade and position
            this.currentBacktest.trades.push(trade);
            this.currentBacktest.positions.push(position);
            this.currentBacktest.metrics.totalTrades++;
            logger.debug(`Entry executed: ${signal.side} ${positionSize} at ${executionPrice}`);
            return {
                success: true,
                position,
                stopLoss,
                takeProfit,
                trade
            };
        }
        catch (error) {
            logger.error('Error executing entry:', error);
            return { success: false, error: error.message };
        }
    }
    /**
     * Simulate realistic market execution with slippage and latency
     */
    simulateMarketExecution(basePrice, side, size, type) {
        // Base slippage
        let slippage = this.marketSimulation.slippage;
        // Market impact based on position size
        const marketImpact = this.marketSimulation.marketImpact * Math.log(size / 1000);
        // Adjust for market conditions (higher slippage during volatile periods)
        const volatilityMultiplier = 1.0; // Could be calculated from ATR
        const totalSlippage = (slippage + marketImpact) * volatilityMultiplier;
        // Apply slippage in the direction unfavorable to the trader
        if (side === 'long') {
            return basePrice * (1 + totalSlippage);
        }
        else {
            return basePrice * (1 - totalSlippage);
        }
    }
    /**
     * Calculate position size based on risk management
     */
    calculatePositionSize(signal, config) {
        const { riskPerTrade = 0.02, // 2% risk per trade
        maxPositionSize = 0.1, // 10% of portfolio
        minPositionSize = 0.01 // 1% of portfolio
         } = config;
        const portfolioValue = this.currentBacktest.portfolio.totalValue;
        const riskAmount = portfolioValue * riskPerTrade;
        // Calculate position size based on signal strength
        const baseSize = portfolioValue * minPositionSize;
        const maxSize = portfolioValue * maxPositionSize;
        // Adjust size based on signal strength
        const strengthMultiplier = Math.min(signal.strength || 1, 1);
        const positionSize = baseSize * strengthMultiplier;
        return Math.min(Math.max(positionSize, baseSize), maxSize);
    }
    /**
     * Calculate various technical indicators
     */
    calculateSMA(values, period) {
        if (values.length < period)
            return null;
        const sum = values.slice(-period).reduce((acc, val) => acc + val, 0);
        return sum / period;
    }
    calculateEMA(values, period) {
        if (values.length < period)
            return null;
        const multiplier = 2 / (period + 1);
        let ema = values[0];
        for (let i = 1; i < values.length; i++) {
            ema = (values[i] * multiplier) + (ema * (1 - multiplier));
        }
        return ema;
    }
    calculateRSI(values, period = 14) {
        if (values.length < period + 1)
            return null;
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const change = values[i] - values[i - 1];
            if (change > 0) {
                gains += change;
            }
            else {
                losses += Math.abs(change);
            }
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0)
            return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    calculateMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (values.length < slowPeriod)
            return null;
        const fastEMA = this.calculateEMA(values, fastPeriod);
        const slowEMA = this.calculateEMA(values, slowPeriod);
        const macdLine = fastEMA - slowEMA;
        // For simplicity, using a basic signal line calculation
        const signalLine = macdLine * 0.9; // Simplified
        const histogram = macdLine - signalLine;
        return {
            macd: macdLine,
            signal: signalLine,
            histogram
        };
    }
    calculateBollingerBands(values, period = 20, stdDev = 2) {
        if (values.length < period)
            return null;
        const sma = this.calculateSMA(values, period);
        const recentValues = values.slice(-period);
        // Calculate standard deviation
        const squaredDiffs = recentValues.map(val => Math.pow(val - sma, 2));
        const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
        const standardDeviation = Math.sqrt(variance);
        return {
            middle: sma,
            upper: sma + (standardDeviation * stdDev),
            lower: sma - (standardDeviation * stdDev)
        };
    }
    calculateATR(highs, lows, closes, period = 14) {
        if (highs.length < period + 1)
            return null;
        const trueRanges = [];
        for (let i = 1; i < highs.length; i++) {
            const tr1 = highs[i] - lows[i];
            const tr2 = Math.abs(highs[i] - closes[i - 1]);
            const tr3 = Math.abs(lows[i] - closes[i - 1]);
            trueRanges.push(Math.max(tr1, tr2, tr3));
        }
        return this.calculateSMA(trueRanges, period);
    }
    /**
     * Check exit conditions for existing positions
     */
    checkExitConditions(position, currentCandle, stopLoss, takeProfit) {
        const currentPrice = currentCandle.close;
        // Check stop loss
        if (position.side === 'long' && currentPrice <= stopLoss) {
            return { reason: 'stop_loss', price: stopLoss };
        }
        if (position.side === 'short' && currentPrice >= stopLoss) {
            return { reason: 'stop_loss', price: stopLoss };
        }
        // Check take profit
        if (position.side === 'long' && currentPrice >= takeProfit) {
            return { reason: 'take_profit', price: takeProfit };
        }
        if (position.side === 'short' && currentPrice <= takeProfit) {
            return { reason: 'take_profit', price: takeProfit };
        }
        return null;
    }
    /**
     * Execute exit order
     */
    async executeExit(position, currentCandle, reason) {
        try {
            const exitPrice = this.simulateMarketExecution(currentCandle.close, position.side === 'long' ? 'short' : 'long', position.size, 'exit');
            // Calculate P&L
            const pnl = this.calculatePnL(position, exitPrice);
            // Create exit trade
            const trade = {
                id: `trade_${Date.now()}`,
                positionId: position.id,
                symbol: position.symbol,
                side: position.side === 'long' ? 'short' : 'long',
                size: position.size,
                price: exitPrice,
                timestamp: currentCandle.timestamp,
                type: 'exit',
                reason,
                fees: this.calculateTradingFees(position.size, exitPrice),
                pnl
            };
            // Update position
            position.exitPrice = exitPrice;
            position.exitTime = currentCandle.timestamp;
            position.realizedPnl = pnl;
            position.status = 'closed';
            // Update portfolio
            this.updatePortfolioAfterTrade(trade, 'exit');
            // Update metrics
            if (pnl > 0) {
                this.currentBacktest.metrics.winningTrades++;
            }
            else {
                this.currentBacktest.metrics.losingTrades++;
            }
            // Store trade
            this.currentBacktest.trades.push(trade);
            logger.debug(`Exit executed: ${reason} at ${exitPrice}, P&L: ${pnl.toFixed(2)}`);
            return trade;
        }
        catch (error) {
            logger.error('Error executing exit:', error);
            throw error;
        }
    }
    /**
     * Calculate P&L for a position
     */
    calculatePnL(position, exitPrice) {
        const entryValue = position.size * position.entryPrice;
        const exitValue = position.size * exitPrice;
        if (position.side === 'long') {
            return exitValue - entryValue;
        }
        else {
            return entryValue - exitValue;
        }
    }
    /**
     * Calculate trading fees based on order type
     * Poloniex Futures fees: 0.01% maker / 0.075% taker
     */
    calculateTradingFees(size, price, orderType = 'market') {
        // Maker fee: 0.01% for limit orders that add liquidity
        // Taker fee: 0.075% for market orders that remove liquidity
        const makerFeeRate = 0.0001; // 0.01%
        const takerFeeRate = 0.00075; // 0.075%
        const feeRate = orderType === 'limit' ? makerFeeRate : takerFeeRate;
        return size * price * feeRate;
    }
    /**
     * Update portfolio after trade execution
     */
    updatePortfolioAfterTrade(trade, type) {
        const tradeValue = trade.size * trade.price;
        if (type === 'entry') {
            this.currentBacktest.portfolio.cash -= tradeValue;
            this.currentBacktest.portfolio.margin += tradeValue;
        }
        else if (type === 'exit') {
            this.currentBacktest.portfolio.cash += tradeValue;
            this.currentBacktest.portfolio.margin -= tradeValue;
            this.currentBacktest.portfolio.realizedPnl += trade.pnl;
        }
        // Subtract fees
        this.currentBacktest.portfolio.cash -= trade.fees;
        // Update total value
        this.currentBacktest.portfolio.totalValue =
            this.currentBacktest.portfolio.cash +
                this.currentBacktest.portfolio.margin +
                this.currentBacktest.portfolio.unrealizedPnl;
    }
    /**
     * Update portfolio value with current market prices
     */
    updatePortfolioValue(currentCandle, position) {
        let unrealizedPnl = 0;
        if (position && position.status === 'open') {
            unrealizedPnl = this.calculatePnL(position, currentCandle.close);
        }
        this.currentBacktest.portfolio.unrealizedPnl = unrealizedPnl;
        this.currentBacktest.portfolio.totalValue =
            this.currentBacktest.portfolio.cash +
                this.currentBacktest.portfolio.margin +
                unrealizedPnl;
    }
    /**
     * Calculate comprehensive backtest metrics
     */
    calculateBacktestMetrics() {
        const { trades, portfolio, equity_curve } = this.currentBacktest;
        // Basic metrics
        const totalTrades = trades.filter(t => t.type === 'exit').length;
        const winningTrades = trades.filter(t => t.type === 'exit' && t.pnl > 0).length;
        const losingTrades = trades.filter(t => t.type === 'exit' && t.pnl <= 0).length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const totalReturn = ((portfolio.totalValue - (this.currentBacktest.config.initialCapital || 100000)) / (this.currentBacktest.config.initialCapital || 100000)) * 100;
        // Calculate drawdown
        let maxValue = portfolio.totalValue;
        let maxDrawdown = 0;
        let maxDrawdownPercent = 0;
        for (const point of equity_curve) {
            if (point.totalValue > maxValue) {
                maxValue = point.totalValue;
            }
            const drawdown = maxValue - point.totalValue;
            const drawdownPercent = (drawdown / maxValue) * 100;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
                maxDrawdownPercent = drawdownPercent;
            }
        }
        // Calculate daily returns for Sharpe ratio
        const dailyReturns = this.calculateDailyReturns(equity_curve);
        const sharpeRatio = this.calculateSharpeRatio(dailyReturns);
        const sortinoRatio = this.calculateSortinoRatio(dailyReturns);
        // Update metrics
        this.currentBacktest.metrics = {
            totalTrades,
            winningTrades,
            losingTrades,
            winRate,
            totalReturn,
            maxDrawdown,
            maxDrawdownPercent,
            sharpeRatio,
            sortinoRatio,
            calmarRatio: totalReturn / maxDrawdownPercent,
            averageWin: winningTrades > 0 ? trades.filter(t => t.type === 'exit' && t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / winningTrades : 0,
            averageLoss: losingTrades > 0 ? trades.filter(t => t.type === 'exit' && t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0) / losingTrades : 0,
            profitFactor: this.calculateProfitFactor(trades),
            expectancy: this.calculateExpectancy(trades)
        };
    }
    /**
     * Calculate daily returns from equity curve
     */
    calculateDailyReturns(equityCurve) {
        const dailyReturns = [];
        for (let i = 1; i < equityCurve.length; i++) {
            const returnPct = (equityCurve[i].totalValue - equityCurve[i - 1].totalValue) / equityCurve[i - 1].totalValue;
            dailyReturns.push(returnPct);
        }
        return dailyReturns;
    }
    /**
     * Calculate Sharpe ratio
     */
    calculateSharpeRatio(dailyReturns) {
        if (dailyReturns.length === 0)
            return 0;
        const avgReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
        const stdDev = Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length);
        return stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;
    }
    /**
     * Calculate Sortino ratio
     */
    calculateSortinoRatio(dailyReturns) {
        if (dailyReturns.length === 0)
            return 0;
        const avgReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
        const negativeReturns = dailyReturns.filter(r => r < 0);
        if (negativeReturns.length === 0)
            return avgReturn * Math.sqrt(365);
        const downwardDeviation = Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length);
        return downwardDeviation > 0 ? (avgReturn / downwardDeviation) * Math.sqrt(365) : 0;
    }
    /**
     * Calculate profit factor
     */
    calculateProfitFactor(trades) {
        const exitTrades = trades.filter(t => t.type === 'exit');
        const grossProfit = exitTrades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(exitTrades.filter(t => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0));
        return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    }
    /**
     * Calculate expectancy
     */
    calculateExpectancy(trades) {
        const exitTrades = trades.filter(t => t.type === 'exit');
        if (exitTrades.length === 0)
            return 0;
        const totalPnl = exitTrades.reduce((sum, t) => sum + t.pnl, 0);
        return totalPnl / exitTrades.length;
    }
    /**
     * Calculate stop loss and take profit levels
     */
    calculateStopLoss(entryPrice, side, config) {
        const stopLossPercent = config.stopLossPercent || 0.02; // 2% default
        if (side === 'long') {
            return entryPrice * (1 - stopLossPercent);
        }
        else {
            return entryPrice * (1 + stopLossPercent);
        }
    }
    calculateTakeProfit(entryPrice, side, config) {
        const takeProfitPercent = config.takeProfitPercent || 0.04; // 4% default
        if (side === 'long') {
            return entryPrice * (1 + takeProfitPercent);
        }
        else {
            return entryPrice * (1 - takeProfitPercent);
        }
    }
    /**
     * Store backtest results in database
     */
    async storeBacktestResults() {
        try {
            const backtestId = `backtest_${Date.now()}`;
            // Store main backtest record
            await query(`
        INSERT INTO backtest_results (
          id, strategy_name, symbol, timeframe, start_date, end_date,
          initial_capital, final_value, total_return, max_drawdown,
          sharpe_ratio, total_trades, win_rate, created_at, config, metrics
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
                backtestId,
                this.currentBacktest.strategyName,
                this.currentBacktest.config.symbol,
                this.currentBacktest.config.timeframe,
                this.currentBacktest.config.startDate,
                this.currentBacktest.config.endDate,
                this.currentBacktest.config.initialCapital || 100000,
                this.currentBacktest.portfolio.totalValue,
                this.currentBacktest.metrics.totalReturn,
                this.currentBacktest.metrics.maxDrawdown,
                this.currentBacktest.metrics.sharpeRatio,
                this.currentBacktest.metrics.totalTrades,
                this.currentBacktest.metrics.winRate,
                new Date(),
                JSON.stringify(this.currentBacktest.config),
                JSON.stringify(this.currentBacktest.metrics)
            ]);
            // Store trades
            for (const trade of this.currentBacktest.trades) {
                await query(`
          INSERT INTO backtest_trades (
            backtest_id, trade_id, symbol, side, size, price, timestamp, type, reason, fees, pnl
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
                    backtestId,
                    trade.id,
                    trade.symbol,
                    trade.side,
                    trade.size,
                    trade.price,
                    trade.timestamp,
                    trade.type,
                    trade.reason,
                    trade.fees,
                    trade.pnl || 0
                ]);
            }
            // Store equity curve
            for (const point of this.currentBacktest.equity_curve) {
                await query(`
          INSERT INTO backtest_equity_curve (
            backtest_id, timestamp, total_value, cash, unrealized_pnl
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
                    backtestId,
                    point.timestamp,
                    point.totalValue,
                    point.cash,
                    point.unrealizedPnl
                ]);
            }
            logger.info(`Backtest results stored with ID: ${backtestId}`);
            this.currentBacktest.id = backtestId;
        }
        catch (error) {
            logger.error('Error storing backtest results:', error);
        }
    }
    /**
     * Get backtest results
     */
    async getBacktestResults(limit = 10) {
        try {
            const results = await query(`
        SELECT * FROM backtest_results 
        ORDER BY created_at DESC 
        LIMIT $1
      `, [limit]);
            return results.rows;
        }
        catch (error) {
            logger.error('Error fetching backtest results:', error);
            return [];
        }
    }
    /**
     * Get detailed backtest data
     */
    async getBacktestDetails(backtestId) {
        try {
            const [backtestResult, tradesResult, equityCurveResult] = await Promise.all([
                query('SELECT * FROM backtest_results WHERE id = $1', [backtestId]),
                query('SELECT * FROM backtest_trades WHERE backtest_id = $1 ORDER BY timestamp', [backtestId]),
                query('SELECT * FROM backtest_equity_curve WHERE backtest_id = $1 ORDER BY timestamp', [backtestId])
            ]);
            if (backtestResult.rows.length === 0) {
                return null;
            }
            return {
                backtest: backtestResult.rows[0],
                trades: tradesResult.rows,
                equityCurve: equityCurveResult.rows
            };
        }
        catch (error) {
            logger.error('Error fetching backtest details:', error);
            return null;
        }
    }
    /**
     * Stop running backtest
     */
    stopBacktest() {
        this.isRunning = false;
        logger.info('Backtest stopped by user');
    }
    /**
     * Get current backtest status
     */
    getBacktestStatus() {
        return {
            isRunning: this.isRunning,
            currentBacktest: this.currentBacktest,
            strategies: Array.from(this.strategies.keys())
        };
    }
}
export default new BacktestingEngine();
