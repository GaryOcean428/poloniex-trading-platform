import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';

/** Coerce a value to a finite number suitable for DB insertion. */
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Determine whether a completed backtest result should be flagged as censored.
 *
 * Borrowed from QIG bridge-law validation: a measurement is censored when it
 * hits the ceiling/floor of the measurement window and therefore doesn't
 * represent the true value.  In backtesting the analogous situations are:
 *   1. An open position was force-closed at backtest_end (window too short).
 *   2. The position size limit was hit (true return is unbounded above).
 *   3. Total trades is zero (no signal, not a real strategy result).
 *
 * @param {object} backtest - The currentBacktest object after simulation.
 * @returns {{ isCensored: boolean, reason: string|null }}
 */
function detectBacktestCensoring(backtest) {
  if (!backtest) return { isCensored: false, reason: null };

  // Position force-closed at window end
  const hasWindowEndClose = backtest.trades && backtest.trades.some(
    t => t.reason === 'backtest_end'
  );
  if (hasWindowEndClose) {
    return { isCensored: true, reason: 'window_end_forced_close' };
  }

  // No trades at all — signal never triggered inside the window
  if (backtest.metrics && backtest.metrics.totalTrades === 0) {
    return { isCensored: true, reason: 'no_trades_in_window' };
  }

  return { isCensored: false, reason: null };
}

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
      slippage: 0.001,
      latency: 50,
      marketImpact: 0.0005
    };
  }

  registerStrategy(strategyName, strategy) {
    this.strategies.set(strategyName, {
      ...strategy,
      id: strategyName,
      createdAt: new Date()
    });
    logger.info(`Strategy registered: ${strategyName}`);
  }

  async loadHistoricalData(symbol, timeframe, startDate, endDate) {
    try {
      logger.info(`Loading historical data for ${symbol} (${timeframe})`);
      const cachedData = await this.getCachedHistoricalData(symbol, timeframe, startDate, endDate);
      if (cachedData.length > 0) {
        logger.info(`Found ${cachedData.length} cached data points for ${symbol}`);
        this.historicalData.set(`${symbol}_${timeframe}`, cachedData);
        return cachedData;
      }
      const freshData = await this.fetchHistoricalDataFromAPI(symbol, timeframe, startDate, endDate);
      if (freshData.length === 0) {
        throw new Error(`No historical data available for ${symbol} (${timeframe})`);
      }
      await this.cacheHistoricalData(symbol, timeframe, freshData);
      this.historicalData.set(`${symbol}_${timeframe}`, freshData);
      logger.info(`Loaded ${freshData.length} historical data points for ${symbol}`);
      return freshData;
    } catch (error) {
      logger.error(`Error loading historical data for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Fetch historical data from Poloniex API.
   * Uses getHistoricalData() which correctly handles:
   *   - Interval format conversion ("15m" → "MINUTE_15")
   *   - Poloniex V3 array response format
   *   - Proper time range params (sTime, eTime)
   *   - Non-array response guarding
   */
  async fetchHistoricalDataFromAPI(symbol, timeframe, startDate, endDate) {
    try {
      // Calculate how many candles we need based on the time range and interval
      const intervalSeconds = {
        '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '1H': 3600, '2h': 7200,
        '4h': 14400, '4H': 14400, '12h': 43200,
        '1d': 86400, '1D': 86400
      };
      const seconds = intervalSeconds[timeframe] || 3600;
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const rangeMs = end.getTime() - start.getTime();
      const limit = Math.min(Math.ceil(rangeMs / (seconds * 1000)), 500);

      // getHistoricalData handles interval format conversion, V3 array parsing,
      // and non-array response guarding internally
      const data = await poloniexFuturesService.getHistoricalData(symbol, timeframe, limit);

      if (!Array.isArray(data) || data.length === 0) {
        logger.warn(`No historical data returned for ${symbol} (${timeframe}), limit=${limit}`);
        return [];
      }

      // getHistoricalData already returns {timestamp, open, high, low, close, volume}
      // Just add symbol and timeframe for caching compatibility
      return data.map(candle => ({
        ...candle,
        timestamp: new Date(candle.timestamp),
        symbol,
        timeframe
      }));
    } catch (error) {
      logger.error(`Error fetching historical data from API for ${symbol}:`, error);
      return [];
    }
  }

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
    } catch (error) {
      logger.error('Error getting cached historical data:', error);
      return [];
    }
  }

  async cacheHistoricalData(symbol, timeframe, data) {
    try {
      const insertQuery = `
        INSERT INTO historical_market_data (symbol, timeframe, timestamp, open, high, low, close, volume)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
        close = EXCLUDED.close, volume = EXCLUDED.volume
      `;
      for (const candle of data) {
        await query(insertQuery, [
          candle.symbol, candle.timeframe, candle.timestamp,
          candle.open, candle.high, candle.low, candle.close, candle.volume
        ]);
      }
      logger.info(`Cached ${data.length} historical data points for ${symbol}`);
    } catch (error) {
      logger.error('Error caching historical data:', error);
    }
  }

  async runBacktest(strategyName, config) {
    try {
      this.isRunning = true;
      const strategy = this.strategies.get(strategyName);
      if (!strategy) throw new Error(`Strategy ${strategyName} not found`);
      logger.info(`Starting backtest for strategy: ${strategyName}`);
      this.currentBacktest = {
        strategyName, config, startTime: new Date(), trades: [], positions: [],
        portfolio: {
          cash: config.initialCapital || 100000, totalValue: config.initialCapital || 100000,
          equity: config.initialCapital || 100000, margin: 0, unrealizedPnl: 0, realizedPnl: 0
        },
        metrics: { totalTrades: 0, winningTrades: 0, losingTrades: 0, maxDrawdown: 0, maxDrawdownPercent: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0 },
        dailyReturns: [], equity_curve: [],
        // is_censored: true when a position was force-closed at window end or hit a hard limit.
        // Censored backtests should be down-weighted in strategy scoring.
        is_censored: false,
      };
      const historicalData = await this.loadHistoricalData(config.symbol, config.timeframe || '1h', config.startDate, config.endDate);
      await this.runBacktestSimulation(strategy, historicalData, config);
      this.calculateBacktestMetrics();
      await this.storeBacktestResults();
      this.isRunning = false;
      logger.info(`Backtest completed for strategy: ${strategyName}`);
      this.emit('backtestComplete', { strategyName, results: this.currentBacktest });
      return this.currentBacktest;
    } catch (error) {
      this.isRunning = false;
      logger.error(`Backtest failed for strategy ${strategyName}:`, error);
      throw error;
    }
  }

  async runBacktestSimulation(strategy, historicalData, config) {
    let currentPosition = null, stopLoss = null, takeProfit = null;
    const leverage = config.leverage ?? 1;
    // Use enough lookback for all indicators: SMA50 needs 50, MACD needs 26,
    // so minimum useful lookback is 50. Never go below what the strategy requests.
    const lookback = Math.max(strategy.lookback || 50, 50);
    for (let i = 0; i < historicalData.length; i++) {
      const currentCandle = historicalData[i];
      const previousCandles = historicalData.slice(Math.max(0, i - lookback), i);
      if (previousCandles.length < lookback) continue;
      const indicators = this.calculateTechnicalIndicators(previousCandles, currentCandle);
      const signals = await this.generateTradingSignals(strategy, indicators, currentCandle);
      if (currentPosition) {
        // Check standard exit conditions
        const exitSignal = this.checkExitConditions(currentPosition, currentCandle, stopLoss, takeProfit);
        // Check leverage-aware liquidation price
        const liquidationHit = leverage > 1
          ? this.checkLiquidation(currentPosition, currentCandle, leverage)
          : false;
        if (liquidationHit) {
          await this.executeExit(currentPosition, currentCandle, 'liquidation');
          this.currentBacktest.is_censored = true;
          currentPosition = null; stopLoss = null; takeProfit = null;
        } else if (exitSignal) {
          await this.executeExit(currentPosition, currentCandle, exitSignal.reason);
          currentPosition = null; stopLoss = null; takeProfit = null;
        }
      }
      if (!currentPosition && signals.entry) {
        const entryResult = await this.executeEntry(signals.entry, currentCandle, config);
        if (entryResult.success) { currentPosition = entryResult.position; stopLoss = entryResult.stopLoss; takeProfit = entryResult.takeProfit; }
      }
      this.updatePortfolioValue(currentCandle, currentPosition);
      this.currentBacktest.equity_curve.push({ timestamp: currentCandle.timestamp, totalValue: this.currentBacktest.portfolio.totalValue, cash: this.currentBacktest.portfolio.cash, unrealizedPnl: this.currentBacktest.portfolio.unrealizedPnl });
      if (i % 1000 === 0) this.emit('backtestProgress', { progress: (i / historicalData.length) * 100, currentDate: currentCandle.timestamp, totalValue: this.currentBacktest.portfolio.totalValue });
    }
    if (currentPosition) {
      const lastCandle = historicalData[historicalData.length - 1];
      await this.executeExit(currentPosition, lastCandle, 'backtest_end');
      // Force-close at window end: mark as censored so result is down-weighted
      this.currentBacktest.is_censored = true;
    }
  }

  /**
   * Check whether a leveraged position has been liquidated.
   * Liquidation occurs when unrealised loss >= initial margin.
   *
   * Liquidation price (long):  entryPrice × (1 − 1/leverage)
   * Liquidation price (short): entryPrice × (1 + 1/leverage)
   *
   * @param {Object} position    Current open position
   * @param {Object} candle      Current OHLCV candle
   * @param {number} leverage    Effective leverage (e.g. 10)
   * @returns {boolean} true if liquidation price was touched this candle
   */
  checkLiquidation(position, candle, leverage) {
    if (!position || leverage <= 1) return false;
    const liqOffset = 1 / leverage;
    if (position.side === 'long') {
      const liqPrice = position.entryPrice * (1 - liqOffset);
      return candle.low <= liqPrice;
    } else {
      const liqPrice = position.entryPrice * (1 + liqOffset);
      return candle.high >= liqPrice;
    }
  }

  /**
   * Calculate the liquidation price for a position.
   */
  calculateLiquidationPrice(entryPrice, side, leverage) {
    if (leverage <= 1) return side === 'long' ? 0 : Infinity;
    const liqOffset = 1 / leverage;
    return side === 'long'
      ? entryPrice * (1 - liqOffset)
      : entryPrice * (1 + liqOffset);
  }

  /**
   * Calculate required margin for a position.
   */
  calculateRequiredMargin(positionSize, leverage) {
    return leverage > 0 ? positionSize / leverage : positionSize;
  }

  /**
   * Estimate periodic funding cost for a leveraged position.
   */
  calculateFundingCost(notionalValue, fundingRate, intervals) {
    return Math.abs(fundingRate) * notionalValue * intervals;
  }

  calculateTechnicalIndicators(historicalData, currentCandle) {
    const closes = historicalData.map(d => d.close);
    const highs = historicalData.map(d => d.high);
    const lows = historicalData.map(d => d.low);
    const volumes = historicalData.map(d => d.volume);
    return {
      sma20: this.calculateSMA(closes, 20), sma50: this.calculateSMA(closes, 50),
      ema9: this.calculateEMA(closes, 9), ema20: this.calculateEMA(closes, 20), ema50: this.calculateEMA(closes, 50),
      rsi: this.calculateRSI(closes, 14), macd: this.calculateMACD(closes),
      bollingerBands: this.calculateBollingerBands(closes, 20, 2),
      atr: this.calculateATR(highs, lows, closes, 14),
      volumeMA: this.calculateSMA(volumes, 20),
      current: { price: currentCandle.close, high: currentCandle.high, low: currentCandle.low, volume: currentCandle.volume }
    };
  }

  async generateTradingSignals(strategy, indicators, currentCandle) {
    const signals = { entry: null, exit: null };
    try {
      switch (strategy.type) {
        case 'trend_following': signals.entry = this.generateTrendFollowingSignals(indicators, strategy.parameters); break;
        case 'momentum': signals.entry = this.generateMomentumSignals(indicators, strategy.parameters); break;
        case 'mean_reversion': signals.entry = this.generateMeanReversionSignals(indicators, strategy.parameters); break;
        case 'breakout': signals.entry = this.generateBreakoutSignals(indicators, strategy.parameters); break;
        case 'scalping': signals.entry = this.generateScalpingSignals(indicators, strategy.parameters); break;
        case 'custom': if (strategy.customLogic) signals.entry = await strategy.customLogic(indicators, currentCandle); break;
      }
      return signals;
    } catch (error) { logger.error('Error generating trading signals:', error); return signals; }
  }

  generateMomentumSignals(indicators, params) {
    const { rsi_oversold = 35, rsi_overbought = 65, macd_threshold = 0 } = params || {};
    if (indicators.rsi == null || indicators.macd == null) return null;
    if (indicators.rsi < rsi_oversold && indicators.macd.histogram > macd_threshold) return { side: 'long', strength: Math.abs(indicators.rsi - 50) / 50, reason: 'momentum_long' };
    if (indicators.rsi > rsi_overbought && indicators.macd.histogram < -macd_threshold) return { side: 'short', strength: Math.abs(indicators.rsi - 50) / 50, reason: 'momentum_short' };
    return null;
  }

  generateMeanReversionSignals(indicators, params) {
    const { rsi_extreme = 30 } = params || {};
    if (!indicators.bollingerBands || indicators.rsi == null) return null;
    const { upper, lower } = indicators.bollingerBands;
    const currentPrice = indicators.current.price;
    if (currentPrice < lower && indicators.rsi < rsi_extreme) return { side: 'long', strength: (lower - currentPrice) / (upper - lower), reason: 'mean_reversion_long' };
    if (currentPrice > upper && indicators.rsi > (100 - rsi_extreme)) return { side: 'short', strength: (currentPrice - upper) / (upper - lower), reason: 'mean_reversion_short' };
    return null;
  }

  generateTrendFollowingSignals(indicators, params) {
    const shortMA = indicators.sma20;
    const longMA = indicators.sma50;
    if (shortMA == null || longMA == null) return null;
    if (shortMA > longMA) return { side: 'long', strength: Math.min(((shortMA - longMA) / longMA) * 20, 1), reason: 'trend_following_long' };
    if (shortMA < longMA) return { side: 'short', strength: Math.min(((longMA - shortMA) / longMA) * 20, 1), reason: 'trend_following_short' };
    return null;
  }

  generateBreakoutSignals(indicators, params) {
    const { volumeThreshold = 1.3 } = params || {};
    if (!indicators.bollingerBands) return null;
    const { upper, lower } = indicators.bollingerBands;
    const currentPrice = indicators.current.price;
    const currentVolume = indicators.current.volume;
    const avgVolume = indicators.volumeMA;
    if (upper == null || lower == null) return null;
    const volumeConfirmed = avgVolume > 0 && (currentVolume / avgVolume) >= volumeThreshold;
    if (currentPrice > upper && volumeConfirmed) return { side: 'long', strength: Math.min((currentPrice - upper) / (upper - lower), 1), reason: 'breakout_long' };
    if (currentPrice < lower && volumeConfirmed) return { side: 'short', strength: Math.min((lower - currentPrice) / (upper - lower), 1), reason: 'breakout_short' };
    return null;
  }

  /**
   * Scalping signal generator — fast-paced entries using EMA9/EMA20 crossover
   * with RSI momentum confirmation. Designed for short timeframes (5m, 15m).
   */
  generateScalpingSignals(indicators, params) {
    const { rsi_low = 40, rsi_high = 60 } = params || {};
    const fastEMA = indicators.ema9;
    const slowEMA = indicators.ema20;
    if (fastEMA == null || slowEMA == null || indicators.rsi == null) return null;
    // Long: fast EMA crosses above slow EMA + RSI has room to run (not overbought)
    if (fastEMA > slowEMA && indicators.rsi < rsi_high && indicators.rsi > rsi_low) {
      return { side: 'long', strength: Math.min(((fastEMA - slowEMA) / slowEMA) * 50, 1), reason: 'scalping_long' };
    }
    // Short: fast EMA crosses below slow EMA + RSI has room to fall
    if (fastEMA < slowEMA && indicators.rsi > (100 - rsi_high) && indicators.rsi < (100 - rsi_low)) {
      return { side: 'short', strength: Math.min(((slowEMA - fastEMA) / slowEMA) * 50, 1), reason: 'scalping_short' };
    }
    return null;
  }

  async executeEntry(signal, currentCandle, config) {
    try {
      const positionSize = this.calculatePositionSize(signal, config, currentCandle.close);
      const executionPrice = this.simulateMarketExecution(currentCandle.close, signal.side, positionSize, 'entry');
      const stopLoss = this.calculateStopLoss(executionPrice, signal.side, config);
      const takeProfit = this.calculateTakeProfit(executionPrice, signal.side, config);
      const leverage = config.leverage ?? 1;
      const notional = positionSize * executionPrice;
      const requiredMargin = this.calculateRequiredMargin(notional, leverage);
      const liquidationPrice = this.calculateLiquidationPrice(executionPrice, signal.side, leverage);
      const position = {
        id: `pos_${Date.now()}`,
        symbol: config.symbol,
        side: signal.side,
        size: positionSize,
        entryPrice: executionPrice,
        entryTime: currentCandle.timestamp,
        stopLoss,
        takeProfit,
        leverage,
        requiredMargin,
        liquidationPrice,
        unrealizedPnl: 0,
        status: 'open',
      };
      const trade = { id: `trade_${Date.now()}`, positionId: position.id, symbol: config.symbol, side: signal.side, size: positionSize, price: executionPrice, timestamp: currentCandle.timestamp, type: 'entry', reason: signal.reason, fees: this.calculateTradingFees(positionSize, executionPrice) };
      this.updatePortfolioAfterTrade(trade, 'entry');
      this.currentBacktest.trades.push(trade);
      this.currentBacktest.positions.push(position);
      this.currentBacktest.metrics.totalTrades++;
      return { success: true, position, stopLoss, takeProfit, trade };
    } catch (error) { logger.error('Error executing entry:', error); return { success: false, error: error.message }; }
  }

  simulateMarketExecution(basePrice, side, size, type) {
    let slippage = this.marketSimulation.slippage;
    const marketImpact = this.marketSimulation.marketImpact * Math.log(Math.max(size / 1000, 0.001));
    const totalSlippage = (slippage + Math.max(marketImpact, 0)) * 1.0;
    return side === 'long' ? basePrice * (1 + totalSlippage) : basePrice * (1 - totalSlippage);
  }

  calculatePositionSize(signal, config, currentPrice) {
    const { maxPositionSize = 0.1, minPositionSize = 0.01 } = config;
    const portfolioValue = this.currentBacktest.portfolio.totalValue;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      logger.warn(`Invalid currentPrice (${currentPrice}) in calculatePositionSize, using portfolio fraction`);
      const baseDollar = portfolioValue * minPositionSize;
      const maxDollar = portfolioValue * maxPositionSize;
      const strengthMultiplier = Math.min(signal.strength || 1, 1);
      return Math.min(Math.max(baseDollar * strengthMultiplier, baseDollar), maxDollar);
    }
    const baseDollar = portfolioValue * minPositionSize;
    const maxDollar = portfolioValue * maxPositionSize;
    const strengthMultiplier = Math.min(signal.strength || 1, 1);
    const dollarSize = Math.min(Math.max(baseDollar * strengthMultiplier, baseDollar), maxDollar);
    return dollarSize / currentPrice;
  }

  calculateSMA(values, period) {
    if (values.length < period) return null;
    return values.slice(-period).reduce((acc, val) => acc + val, 0) / period;
  }

  calculateEMA(values, period) {
    if (values.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) ema = (values[i] * multiplier) + (ema * (1 - multiplier));
    return ema;
  }

  calculateRSI(values, period = 14) {
    if (values.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];
      if (change > 0) gains += change; else losses += Math.abs(change);
    }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  calculateMACD(values, fastPeriod = 12, slowPeriod = 26) {
    if (values.length < slowPeriod) return null;
    const fastEMA = this.calculateEMA(values, fastPeriod);
    const slowEMA = this.calculateEMA(values, slowPeriod);
    const macdLine = fastEMA - slowEMA;
    const signalLine = macdLine * 0.9;
    return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
  }

  calculateBollingerBands(values, period = 20, stdDev = 2) {
    if (values.length < period) return null;
    const sma = this.calculateSMA(values, period);
    const recentValues = values.slice(-period);
    const variance = recentValues.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    return { middle: sma, upper: sma + (sd * stdDev), lower: sma - (sd * stdDev) };
  }

  calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) return null;
    const trueRanges = [];
    for (let i = 1; i < highs.length; i++) trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    return this.calculateSMA(trueRanges, period);
  }

  checkExitConditions(position, currentCandle, stopLoss, takeProfit) {
    const p = currentCandle.close;
    if (position.side === 'long' && p <= stopLoss) return { reason: 'stop_loss', price: stopLoss };
    if (position.side === 'short' && p >= stopLoss) return { reason: 'stop_loss', price: stopLoss };
    if (position.side === 'long' && p >= takeProfit) return { reason: 'take_profit', price: takeProfit };
    if (position.side === 'short' && p <= takeProfit) return { reason: 'take_profit', price: takeProfit };
    return null;
  }

  async executeExit(position, currentCandle, reason) {
    try {
      const exitPrice = this.simulateMarketExecution(currentCandle.close, position.side === 'long' ? 'short' : 'long', position.size, 'exit');
      const pnl = this.calculatePnL(position, exitPrice);
      const trade = { id: `trade_${Date.now()}`, positionId: position.id, symbol: position.symbol, side: position.side === 'long' ? 'short' : 'long', size: position.size, price: exitPrice, timestamp: currentCandle.timestamp, type: 'exit', reason, fees: this.calculateTradingFees(position.size, exitPrice), pnl };
      position.exitPrice = exitPrice; position.exitTime = currentCandle.timestamp; position.realizedPnl = pnl; position.status = 'closed';
      this.updatePortfolioAfterTrade(trade, 'exit');
      if (pnl > 0) this.currentBacktest.metrics.winningTrades++; else this.currentBacktest.metrics.losingTrades++;
      this.currentBacktest.trades.push(trade);
      return trade;
    } catch (error) { logger.error('Error executing exit:', error); throw error; }
  }

  calculatePnL(position, exitPrice) {
    const size = Number(position?.size) || 0;
    const entry = Number(position?.entryPrice) || 0;
    const exit = Number(exitPrice) || 0;
    const entryValue = size * entry;
    const exitValue = size * exit;
    return position?.side === 'long' ? exitValue - entryValue : entryValue - exitValue;
  }

  calculateTradingFees(size, price, orderType = 'market') {
    return size * price * (orderType === 'limit' ? 0.0001 : 0.00075);
  }

  updatePortfolioAfterTrade(trade, type) {
    const tradeValue = trade.size * trade.price;
    if (type === 'entry') { this.currentBacktest.portfolio.cash -= tradeValue; this.currentBacktest.portfolio.margin += tradeValue; }
    else if (type === 'exit') { this.currentBacktest.portfolio.cash += tradeValue; this.currentBacktest.portfolio.margin -= tradeValue; this.currentBacktest.portfolio.realizedPnl += trade.pnl; }
    this.currentBacktest.portfolio.cash -= trade.fees;
    this.currentBacktest.portfolio.totalValue = this.currentBacktest.portfolio.cash + this.currentBacktest.portfolio.margin + this.currentBacktest.portfolio.unrealizedPnl;
  }

  updatePortfolioValue(currentCandle, position) {
    let unrealizedPnl = 0;
    if (position && position.status === 'open') unrealizedPnl = this.calculatePnL(position, currentCandle.close);
    this.currentBacktest.portfolio.unrealizedPnl = unrealizedPnl;
    this.currentBacktest.portfolio.totalValue = this.currentBacktest.portfolio.cash + this.currentBacktest.portfolio.margin + unrealizedPnl;
  }

  calculateBacktestMetrics() {
    const { trades, portfolio, equity_curve } = this.currentBacktest;
    const totalTrades = trades.filter(t => t.type === 'exit').length;
    const winningTrades = trades.filter(t => t.type === 'exit' && t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.type === 'exit' && t.pnl <= 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const initialCapital = this.currentBacktest.config.initialCapital || 100000;
    const totalReturn = ((portfolio.totalValue - initialCapital) / initialCapital) * 100;
    let maxValue = portfolio.totalValue, maxDrawdown = 0, maxDrawdownPercent = 0;
    for (const point of equity_curve) {
      if (point.totalValue > maxValue) maxValue = point.totalValue;
      const dd = maxValue - point.totalValue;
      const ddp = (dd / maxValue) * 100;
      if (dd > maxDrawdown) { maxDrawdown = dd; maxDrawdownPercent = ddp; }
    }
    const dailyReturns = this.calculateDailyReturns(equity_curve);
    this.currentBacktest.metrics = {
      totalTrades, winningTrades, losingTrades, winRate, totalReturn, maxDrawdown, maxDrawdownPercent,
      sharpeRatio: this.calculateSharpeRatio(dailyReturns),
      sortinoRatio: this.calculateSortinoRatio(dailyReturns),
      calmarRatio: maxDrawdownPercent > 0 ? totalReturn / maxDrawdownPercent : 0,
      averageWin: winningTrades > 0 ? trades.filter(t => t.type === 'exit' && t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / winningTrades : 0,
      averageLoss: losingTrades > 0 ? trades.filter(t => t.type === 'exit' && t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losingTrades : 0,
      profitFactor: this.calculateProfitFactor(trades),
      expectancy: this.calculateExpectancy(trades)
    };
  }

  calculateDailyReturns(equityCurve) {
    const r = [];
    for (let i = 1; i < equityCurve.length; i++) r.push((equityCurve[i].totalValue - equityCurve[i - 1].totalValue) / equityCurve[i - 1].totalValue);
    return r;
  }
  calculateSharpeRatio(dailyReturns) {
    if (dailyReturns.length === 0) return 0;
    const avg = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const std = Math.sqrt(dailyReturns.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / dailyReturns.length);
    return std > 0 ? (avg / std) * Math.sqrt(365) : 0;
  }
  calculateSortinoRatio(dailyReturns) {
    if (dailyReturns.length === 0) return 0;
    const avg = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const neg = dailyReturns.filter(r => r < 0);
    if (neg.length === 0) return avg * Math.sqrt(365);
    const dd = Math.sqrt(neg.reduce((s, r) => s + Math.pow(r, 2), 0) / neg.length);
    return dd > 0 ? (avg / dd) * Math.sqrt(365) : 0;
  }
  calculateProfitFactor(trades) {
    const exits = trades.filter(t => t.type === 'exit');
    const gp = exits.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(exits.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
    return gl > 0 ? gp / gl : gp > 0 ? 9999.99 : 0;
  }
  calculateExpectancy(trades) {
    const exits = trades.filter(t => t.type === 'exit');
    return exits.length === 0 ? 0 : exits.reduce((s, t) => s + t.pnl, 0) / exits.length;
  }

  calculateStopLoss(entryPrice, side, config) {
    const slp = config.stopLossPercent || 0.02;
    return side === 'long' ? entryPrice * (1 - slp) : entryPrice * (1 + slp);
  }
  calculateTakeProfit(entryPrice, side, config) {
    const tpp = config.takeProfitPercent || 0.04;
    return side === 'long' ? entryPrice * (1 + tpp) : entryPrice * (1 - tpp);
  }

  async storeBacktestResults() {
    try {
      const backtestId = `backtest_${Date.now()}`;
      const { isCensored, reason: censoringReason } = detectBacktestCensoring(this.currentBacktest);
      await query(`
        INSERT INTO backtest_results (
          id, strategy_name, symbol, timeframe, start_date, end_date,
          initial_capital, final_value, total_return, max_drawdown,
          max_drawdown_percent, sharpe_ratio, sortino_ratio, calmar_ratio,
          total_trades, winning_trades, losing_trades, win_rate,
          profit_factor, expectancy, average_win, average_loss,
          created_at, config, metrics,
          is_censored, censoring_reason
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      `, [
        backtestId, this.currentBacktest.strategyName, this.currentBacktest.config.symbol,
        this.currentBacktest.config.timeframe, this.currentBacktest.config.startDate,
        this.currentBacktest.config.endDate, this.currentBacktest.config.initialCapital || 100000,
        this.currentBacktest.portfolio.totalValue, this.currentBacktest.metrics.totalReturn,
        this.currentBacktest.metrics.maxDrawdown,
        safeNum(this.currentBacktest.metrics.maxDrawdownPercent),
        safeNum(this.currentBacktest.metrics.sharpeRatio),
        safeNum(this.currentBacktest.metrics.sortinoRatio),
        safeNum(this.currentBacktest.metrics.calmarRatio),
        safeNum(this.currentBacktest.metrics.totalTrades),
        safeNum(this.currentBacktest.metrics.winningTrades),
        safeNum(this.currentBacktest.metrics.losingTrades),
        safeNum(this.currentBacktest.metrics.winRate),
        safeNum(this.currentBacktest.metrics.profitFactor),
        safeNum(this.currentBacktest.metrics.expectancy),
        safeNum(this.currentBacktest.metrics.averageWin),
        safeNum(this.currentBacktest.metrics.averageLoss),
        new Date(), JSON.stringify(this.currentBacktest.config), JSON.stringify(this.currentBacktest.metrics),
        isCensored, censoringReason
      ]);
      this.currentBacktest.id = backtestId;
      this.currentBacktest.isCensored = isCensored;
      this.currentBacktest.censoringReason = censoringReason;
      if (isCensored) {
        logger.warn(`Backtest ${backtestId} flagged as censored: ${censoringReason}`);
      }
    } catch (error) { logger.error('Error storing backtest results:', error); }
  }

  async getBacktestResults(limit = 10) {
    try { return (await query('SELECT * FROM backtest_results ORDER BY created_at DESC LIMIT $1', [limit])).rows; }
    catch (error) { logger.error('Error fetching backtest results:', error); return []; }
  }
  async getBacktestDetails(backtestId) {
    try {
      const [br, tr, ec] = await Promise.all([
        query('SELECT * FROM backtest_results WHERE id = $1', [backtestId]),
        query('SELECT * FROM backtest_trades WHERE backtest_id = $1 ORDER BY timestamp', [backtestId]),
        query('SELECT * FROM backtest_equity_curve WHERE backtest_id = $1 ORDER BY timestamp', [backtestId])
      ]);
      return br.rows.length === 0 ? null : { backtest: br.rows[0], trades: tr.rows, equityCurve: ec.rows };
    } catch (error) { logger.error('Error fetching backtest details:', error); return null; }
  }
  stopBacktest() { this.isRunning = false; logger.info('Backtest stopped by user'); }
  getBacktestStatus() { return { isRunning: this.isRunning, currentBacktest: this.currentBacktest, strategies: Array.from(this.strategies.keys()) }; }

  /**
   * Walk-forward validation: splits historical data into train (70%) + test (30%).
   * Runs backtest simulation on out-of-sample test period only.
   * Returns out-of-sample metrics to prevent overfitting.
   */
  async runWalkForwardValidation(strategyName, config, trainFraction = 0.7) {
    try {
      const strategy = this.strategies.get(strategyName);
      if (!strategy) throw new Error(`Strategy ${strategyName} not found for walk-forward validation`);

      const allData = await this.loadHistoricalData(
        config.symbol, config.timeframe || '1h', config.startDate, config.endDate
      );
      if (allData.length < 20) {
        throw new Error(`Insufficient data for walk-forward validation: ${allData.length} bars`);
      }

      const splitIndex = Math.floor(allData.length * trainFraction);
      const testData = allData.slice(splitIndex); // out-of-sample period

      if (testData.length < 5) {
        throw new Error('Test period too short for walk-forward validation');
      }

      // Run simulation on test (out-of-sample) data only
      const testBacktest = {
        strategyName, config, startTime: new Date(), trades: [], positions: [],
        portfolio: {
          cash: config.initialCapital || 100000, totalValue: config.initialCapital || 100000,
          equity: config.initialCapital || 100000, margin: 0, unrealizedPnl: 0, realizedPnl: 0
        },
        metrics: { totalTrades: 0, winningTrades: 0, losingTrades: 0, maxDrawdown: 0, maxDrawdownPercent: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0 },
        dailyReturns: [], equity_curve: []
      };

      const savedBacktest = this.currentBacktest;
      this.currentBacktest = testBacktest;

      await this.runBacktestSimulation(strategy, testData, config);
      this.calculateBacktestMetrics();

      const outOfSampleMetrics = { ...this.currentBacktest.metrics, isWalkForward: true, testBars: testData.length, trainBars: splitIndex };
      this.currentBacktest = savedBacktest;

      logger.info(
        `[WF] Walk-forward validation for ${strategyName}: ` +
        `OOS sharpe=${safeNum(outOfSampleMetrics.sharpeRatio).toFixed(2)} ` +
        `WR=${(safeNum(outOfSampleMetrics.winRate) * 100).toFixed(1)}%`
      );

      return outOfSampleMetrics;
    } catch (error) {
      logger.error(`Walk-forward validation failed for ${strategyName}:`, error);
      throw error;
    }
  }
}

export default new BacktestingEngine();
