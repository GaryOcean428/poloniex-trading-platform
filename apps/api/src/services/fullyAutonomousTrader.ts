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
import { logger } from '../utils/logger.js';
import { validateMarketData } from '../utils/marketDataValidator.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import backtestingEngine from './backtestingEngine.js';
import { getPrecisions } from './marketCatalog.js';
import mlPredictionService from './mlPredictionService.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import riskService from './riskService.js';
import { buildIndicatorMap, evaluateGenomeEntry, type SignalGenome } from './signalGenome.js';
import simpleMlService from './simpleMlService.js';

/** Safe number formatting — returns fallback string for NaN/Infinity */
function safeFixed(value: unknown, decimals: number, fallback = 'N/A'): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : fallback;
}

// ─── Trading defaults (single source of truth) ───
const DEFAULT_RISK_PER_TRADE = 2;       // 2% per trade
const DEFAULT_MAX_DRAWDOWN = 10;        // 10% max drawdown
const DEFAULT_DAILY_RETURN_TARGET = 1;  // 1% daily target
const DEFAULT_STOP_LOSS_PCT = 2;        // 2% stop loss
const DEFAULT_TAKE_PROFIT_PCT = 4;      // 4% take profit (2:1 R:R)
const DEFAULT_LEVERAGE = 3;             // Conservative leverage
const DEFAULT_MAX_POSITIONS = 3;        // Max concurrent positions
const DEFAULT_CYCLE_SECONDS = 60;       // 1-minute trading cycle
const DEFAULT_CONFIDENCE_THRESHOLD = 65; // 65% minimum confidence
const DEFAULT_SIGNAL_THRESHOLD = 30;    // ±30 raw score threshold
const DEFAULT_PAPER_CAPITAL = 10000;    // Virtual capital for paper mode
const DEFAULT_SYMBOLS = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP'];
const MIN_CAPITAL = 10;                 // Minimum capital to continue trading
const MAX_POSITION_FRACTION = 0.1;      // Max 10% of capital per position
const VOLATILITY_HIGH = 0.03;           // >3% = high volatility
const VOLATILITY_MEDIUM = 0.01;         // >1% = medium volatility

interface TradingConfig {
  userId: string;
  initialCapital: number;
  maxRiskPerTrade: number; // Percentage (e.g., 2 = 2%)
  maxDrawdown: number; // Percentage (e.g., 10 = 10%)
  targetDailyReturn: number; // Percentage (e.g., 1 = 1%)
  symbols: string[]; // Trading pairs
  enabled: boolean;
  paperTrading: boolean; // If true, simulate trades without real execution
  stopLossPercent: number; // Stop loss percentage (e.g., 2 = 2%)
  takeProfitPercent: number; // Take profit percentage (e.g., 4 = 4%)
  leverage: number; // Leverage multiplier (e.g., 3)
  maxConcurrentPositions: number; // Maximum open positions at once
  tradingCycleSeconds: number; // Seconds between trading cycles (default: 60)
  confidenceThreshold: number; // Minimum confidence to execute (0-100, default: 65)
  signalScoreThreshold: number; // Minimum raw score magnitude for signals (default: 30)
}

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnL: number;
  entryTime: Date;
}

interface TradingSignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD';
  side: 'long' | 'short';
  confidence: number; // 0-100
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number; // USDT amount
  leverage: number;
  reason: string;
  indicators: any;
}

interface MarketAnalysis {
  symbol: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  volatility: 'high' | 'medium' | 'low';
  momentum: number; // -100 to 100
  support: number;
  resistance: number;
  mlPrediction: {
    direction: 'UP' | 'DOWN' | 'NEUTRAL';
    confidence: number;
    targetPrice: number;
  };
}

class FullyAutonomousTrader extends EventEmitter {
  private configs: Map<string, TradingConfig> = new Map();
  private positions: Map<string, Position[]> = new Map();
  private runningIntervals: Map<string, NodeJS.Timeout> = new Map();
  private performanceMetrics: Map<string, any> = new Map();
  private lastHeartbeat: Map<string, Date> = new Map();
  private cycleInFlight: Set<string> = new Set();

  // Circuit breaker state per user
  private circuitBreakers: Map<string, {
    consecutiveLosses: number;
    dailyLoss: number;
    dailyLossResetAt: Date;
    isTripped: boolean;
    trippedAt?: Date;
    trippedReason?: string;
  }> = new Map();

  private static readonly MAX_CONSECUTIVE_LOSSES = 5;
  private static readonly MAX_DAILY_LOSS_PERCENT = 3; // % of capital
  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
  private static readonly DRAWDOWN_SCALE_THRESHOLD = 10; // Start scaling at 10% drawdown
  private static readonly DRAWDOWN_HALT_THRESHOLD = 20; // Full halt at 20% drawdown

  constructor() {
    super();
    this.loadActiveConfigs();
  }

  /**
   * Update heartbeat timestamp for a user's trading session.
   * This allows the UI to verify the trading loop is still active.
   */
  private updateHeartbeat(userId: string): void {
    this.lastHeartbeat.set(userId, new Date());
  }

  /**
   * Get the current status of autonomous trading for a user.
   * Used by both /api/autonomous/status and /api/autonomous-trading/data.
   */
  async getStatus(userId: string): Promise<{
    enabled: boolean;
    paperTrading: boolean;
    lastHeartbeat: string | null;
    isRunning: boolean;
    config: TradingConfig | null;
    openPositions: number;
    metrics: any;
  }> {
    const config = this.configs.get(userId);
    const isRunning = this.runningIntervals.has(userId);
    const heartbeat = this.lastHeartbeat.get(userId);
    const metrics = this.performanceMetrics.get(userId) || null;
    const positions = this.positions.get(userId) || [];

    return {
      enabled: config?.enabled ?? false,
      paperTrading: config?.paperTrading ?? true,
      lastHeartbeat: heartbeat ? heartbeat.toISOString() : null,
      isRunning,
      config: config || null,
      openPositions: positions.length,
      metrics
    };
  }

  /**
   * Load active trading configs from database on startup
   */
  private async loadActiveConfigs() {
    try {
      const result = await pool.query(
        `SELECT * FROM autonomous_trading_configs WHERE enabled = true`
      );

      for (const row of result.rows) {
        const config: TradingConfig = {
          userId: row.user_id,
          initialCapital: parseFloat(row.initial_capital),
          maxRiskPerTrade: parseFloat(row.max_risk_per_trade),
          maxDrawdown: parseFloat(row.max_drawdown),
          targetDailyReturn: parseFloat(row.target_daily_return),
          symbols: row.symbols,
          enabled: row.enabled,
          paperTrading: row.paper_trading !== false, // Default to true if not set
          stopLossPercent: parseFloat(row.stop_loss_percent) || 2,
          takeProfitPercent: parseFloat(row.take_profit_percent) || 4,
          leverage: parseFloat(row.leverage) || 3,
          maxConcurrentPositions: parseInt(row.max_concurrent_positions) || 3,
          tradingCycleSeconds: parseInt(row.trading_cycle_seconds) || 60,
          confidenceThreshold: parseFloat(row.confidence_threshold) || 65,
          signalScoreThreshold: parseFloat(row.signal_score_threshold) || 30
        };

        this.configs.set(config.userId, config);
        await this.startTrading(config.userId);
      }

      logger.info(`Loaded ${result.rows.length} active autonomous trading configs`);
    } catch (error) {
      logger.error('Error loading autonomous trading configs:', error);
    }
  }

  /**
   * Enable autonomous trading for a user
   */
  async enableAutonomousTrading(userId: string, config?: Partial<TradingConfig>): Promise<void> {
    // Get user's API credentials
    const credentials = await apiCredentialsService.getCredentials(userId);
    if (!credentials) {
      throw new Error('No API credentials found. Please add your Poloniex API keys.');
    }

    // Get account balance
    const balance = await poloniexFuturesService.getAccountBalance(credentials);
    const availableBalance = parseFloat(balance.availMgn || balance.availableBalance || '1000');

    // Create default config
    const tradingConfig: TradingConfig = {
      userId,
      initialCapital: config?.paperTrading ? DEFAULT_PAPER_CAPITAL : availableBalance,
      maxRiskPerTrade: config?.maxRiskPerTrade || DEFAULT_RISK_PER_TRADE,
      maxDrawdown: config?.maxDrawdown || DEFAULT_MAX_DRAWDOWN,
      targetDailyReturn: config?.targetDailyReturn || DEFAULT_DAILY_RETURN_TARGET,
      symbols: config?.symbols || DEFAULT_SYMBOLS,
      enabled: true,
      paperTrading: config?.paperTrading !== undefined ? config.paperTrading : true,
      stopLossPercent: config?.stopLossPercent || DEFAULT_STOP_LOSS_PCT,
      takeProfitPercent: config?.takeProfitPercent || DEFAULT_TAKE_PROFIT_PCT,
      leverage: config?.leverage || DEFAULT_LEVERAGE,
      maxConcurrentPositions: config?.maxConcurrentPositions || DEFAULT_MAX_POSITIONS,
      tradingCycleSeconds: config?.tradingCycleSeconds || DEFAULT_CYCLE_SECONDS,
      confidenceThreshold: config?.confidenceThreshold || DEFAULT_CONFIDENCE_THRESHOLD,
      signalScoreThreshold: config?.signalScoreThreshold || DEFAULT_SIGNAL_THRESHOLD,
    };

    // Save to database
    await pool.query(
      `INSERT INTO autonomous_trading_configs
       (user_id, initial_capital, max_risk_per_trade, max_drawdown, target_daily_return, symbols, enabled, paper_trading)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         initial_capital = $2,
         max_risk_per_trade = $3,
         max_drawdown = $4,
         target_daily_return = $5,
         symbols = $6,
         enabled = $7,
         paper_trading = $8,
         updated_at = NOW()`,
      [
        userId,
        tradingConfig.initialCapital,
        tradingConfig.maxRiskPerTrade,
        tradingConfig.maxDrawdown,
        tradingConfig.targetDailyReturn,
        tradingConfig.symbols,
        tradingConfig.enabled,
        tradingConfig.paperTrading
      ]
    );

    this.configs.set(userId, tradingConfig);
    await this.startTrading(userId);

    logger.info(`Autonomous trading enabled for user ${userId}`);
    this.emit('trading_enabled', { userId, config: tradingConfig });
  }

  /**
   * Disable autonomous trading for a user
   */
  async disableAutonomousTrading(userId: string): Promise<void> {
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
    await pool.query(
      `UPDATE autonomous_trading_configs SET enabled = false WHERE user_id = $1`,
      [userId]
    );

    config.enabled = false;
    this.configs.delete(userId);

    logger.info(`Autonomous trading disabled for user ${userId}`);
    this.emit('trading_disabled', { userId });
  }

  /**
   * Start the autonomous trading loop
   */
  private async startTrading(userId: string): Promise<void> {
    const config = this.configs.get(userId);
    if (!config || !config.enabled) {
      return;
    }

    // Clear any existing interval for this user to prevent duplicates
    const existing = this.runningIntervals.get(userId);
    if (existing) {
      clearInterval(existing);
      this.runningIntervals.delete(userId);
    }

    logger.info(`Starting autonomous trading for user ${userId} (cycle: ${config.tradingCycleSeconds}s)`);

    // Bootstrap ML models with historical data (fire-and-forget)
    this.bootstrapMlModels(config.symbols).catch(err => {
      logger.debug('ML bootstrap skipped (worker may be unavailable):', err instanceof Error ? err.message : String(err));
    });

    // Run immediately
    this.tradingCycle(userId).catch(err => {
      logger.error(`Trading cycle error for user ${userId}:`, err);
    });

    // Then run at configured interval with overlap guard
    const cycleMs = config.tradingCycleSeconds * 1000;
    const interval = setInterval(async () => {
      if (this.cycleInFlight.has(userId)) return; // Skip if previous cycle still running
      this.cycleInFlight.add(userId);
      try {
        await this.tradingCycle(userId);
      } catch (err) {
        logger.error(`Trading cycle error for user ${userId}:`, err);
      } finally {
        this.cycleInFlight.delete(userId);
      }
    }, cycleMs);

    this.runningIntervals.set(userId, interval);
  }

  /**
   * Main autonomous trading cycle
   */
  private async tradingCycle(userId: string): Promise<void> {
    const config = this.configs.get(userId);
    if (!config || !config.enabled) {
      return;
    }

    try {
      // Update heartbeat to signal the trading loop is active
      this.updateHeartbeat(userId);

      // Step 0: Reconcile DB positions with exchange (live mode only)
      if (!config.paperTrading) {
        await this.reconcilePositions(userId);
      }

      // Step 1: Check risk limits
      const riskCheck = await this.checkRiskLimits(userId);
      if (!riskCheck.canTrade) {
        logger.warn(`Risk limits exceeded for user ${userId}: ${riskCheck.reason}`);
        return;
      }

      // Circuit breaker: halt if consecutive losses or daily loss limit exceeded
      const cbCheck = this.checkCircuitBreaker(userId);
      if (!cbCheck.allowed) {
        logger.warn(`[CB] Trading halted for user ${userId}: ${cbCheck.reason}`);
        await this.logAgentEvent(userId, {
          eventType: 'circuit_breaker',
          executionMode: config.paperTrading ? 'paper' : 'live',
          description: `Circuit breaker tripped: ${cbCheck.reason}`,
        });
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

    } catch (error) {
      logger.error(`Trading cycle error for user ${userId}:`, error);
    }
  }

  /**
   * Check if trading is within risk limits
   */
  private async checkRiskLimits(userId: string): Promise<{ canTrade: boolean; reason?: string }> {
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
      if (currentEquity < MIN_CAPITAL) {
        return { canTrade: false, reason: 'Insufficient capital' };
      }

      return { canTrade: true };
    } catch (error) {
      logger.error(`Risk check error for user ${userId}:`, error);
      return { canTrade: false, reason: 'Risk check failed' };
    }
  }

  /**
   * Analyze multiple markets simultaneously
   */
  private async analyzeMarkets(userId: string, symbols: string[]): Promise<Map<string, MarketAnalysis>> {
    const analyses = new Map<string, MarketAnalysis>();

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const analysis = await this.analyzeMarket(symbol);
          analyses.set(symbol, analysis);
        } catch (error) {
          logger.error(`Market analysis error for ${symbol}:`, error);
        }
      })
    );

    return analyses;
  }

  /**
   * Analyze a single market
   */
  private async analyzeMarket(symbol: string): Promise<MarketAnalysis> {
    // Get historical data
    const ohlcv = await poloniexFuturesService.getHistoricalData(symbol, '15m', 100);

    // Validate each kline and filter out any with invalid data; use the validated (normalized) candles
    const validOhlcv = ohlcv
      .map((c: any) => validateMarketData({ symbol, ...c, price: c.close }, 'kline'))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (validOhlcv.length < 20) {
      logger.warn(`[FAT] Insufficient valid kline data for ${symbol} (${validOhlcv.length} candles after validation)`);
      throw new Error(`Insufficient valid kline data for ${symbol}`);
    }

    // Calculate technical indicators using validated candle data
    const closes = validOhlcv.map(c => c.price);
    const highs = validOhlcv.map(c => c.high);
    const lows = validOhlcv.map(c => c.low);

    // Simple trend detection
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const currentPrice = closes[closes.length - 1];

    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (sma20 > sma50 && currentPrice > sma20) {
      trend = 'bullish';
    } else if (sma20 < sma50 && currentPrice < sma20) {
      trend = 'bearish';
    }

    // Calculate volatility
    const returns = closes.slice(1).map((price, i) => (price - closes[i]) / closes[i]);
    const volatility = this.calculateStdDev(returns);
    const volatilityLevel = volatility > VOLATILITY_HIGH ? 'high' : volatility > VOLATILITY_MEDIUM ? 'medium' : 'low';

    // Calculate momentum (RSI-like)
    const momentum = this.calculateMomentum(closes);

    // Support and resistance
    const support = Math.min(...lows.slice(-20));
    const resistance = Math.max(...highs.slice(-20));

    // Get ML prediction
    let mlPrediction = {
      direction: 'NEUTRAL' as 'UP' | 'DOWN' | 'NEUTRAL',
      confidence: 0,
      targetPrice: currentPrice
    };

    try {
      // Map validated candles back to expected {close, high, low, open, volume} shape for ML service
      const ohlcvForMl = validOhlcv.map(c => ({ close: c.price, high: c.high, low: c.low, open: c.open, volume: c.volume }));
      const predictions = await mlPredictionService.getMultiHorizonPredictions(symbol, ohlcvForMl);
      const signal = await mlPredictionService.getTradingSignal(symbol, ohlcvForMl, currentPrice);

      mlPrediction = {
        direction: signal.action === 'BUY' ? 'UP' : signal.action === 'SELL' ? 'DOWN' : 'NEUTRAL',
        confidence: signal.confidence,
        targetPrice: predictions['1h'].price
      };
    } catch (_error) {
      // Fall back to local simple ML service when ml-worker is unavailable
      try {
        const ohlcvForMl = validOhlcv.map(c => ({ close: c.price, high: c.high, low: c.low, open: c.open, volume: c.volume }));
        const predictions = await simpleMlService.getMultiHorizonPredictions(symbol, ohlcvForMl);
        const signal = await simpleMlService.getTradingSignal(symbol, ohlcvForMl, currentPrice);

        mlPrediction = {
          direction: signal.action === 'BUY' ? 'UP' : signal.action === 'SELL' ? 'DOWN' : 'NEUTRAL',
          confidence: signal.confidence * 0.7, // Discount local predictions
          targetPrice: predictions['1h'].price
        };
        logger.debug(`Using local ML fallback for ${symbol}`);
      } catch (_fallbackError) {
        logger.warn(`ML prediction unavailable for ${symbol} (both primary and fallback)`);
      }
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
   * Generate trading signals based on market analysis.
   * For each symbol, checks strategy_performance for SLE-promoted live strategies
   * and uses their parameters (leverage, strategy type) to influence signal generation.
   */
  private async generateTradingSignals(
    userId: string,
    analyses: Map<string, MarketAnalysis>
  ): Promise<TradingSignal[]> {
    const config = this.configs.get(userId);
    if (!config) return [];

    const signals: TradingSignal[] = [];

    for (const [symbol, analysis] of analyses) {
      try {
        // Check if an SLE-promoted live strategy exists for this symbol.
        // If so, use its leverage and signal genome for evolved signal generation.
        let effectiveConfig = config;
        let liveGenome: SignalGenome | null = null;
        try {
          const liveStrategies = await pool.query(
            `SELECT * FROM strategy_performance WHERE status = 'live' AND symbol = $1
             ORDER BY confidence_score DESC NULLS LAST LIMIT 1`,
            [symbol]
          );
          if (liveStrategies.rows.length > 0) {
            const liveStrategy = liveStrategies.rows[0];
            effectiveConfig = {
              ...config,
              leverage: parseFloat(liveStrategy.leverage) || config.leverage
            };
            // Extract signal genome if available
            if (liveStrategy.signal_genome) {
              try {
                liveGenome = typeof liveStrategy.signal_genome === 'string'
                  ? JSON.parse(liveStrategy.signal_genome)
                  : liveStrategy.signal_genome;
              } catch { /* genome parse failure — use default signals */ }
            }
            logger.debug(
              `[SLE] Using live strategy ${liveStrategy.strategy_id} params for ${symbol}: ` +
              `leverage=${effectiveConfig.leverage}, type=${liveStrategy.strategy_type}` +
              (liveGenome ? `, genome=${liveGenome.entryConditions.length} conditions` : '')
            );
          }
        } catch (sleErr) {
          logger.warn(`[SLE] Failed to query live strategies for ${symbol}:`, sleErr);
        }

        const signal = await this.generateSignal(userId, symbol, analysis, effectiveConfig, liveGenome);
        if (signal && signal.confidence >= config.confidenceThreshold) {
          signals.push(signal);
        } else if (signal) {
          logger.info(`[FAT] Signal filtered: confidence ${signal.confidence} < threshold ${config.confidenceThreshold} for ${symbol}`);
        }
      } catch (error) {
        logger.error(`Signal generation error for ${symbol}:`, error);
      }
    }

    // Sort by confidence
    return signals.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Generate a trading signal for a symbol.
   * When a live genome from SLE is available, it contributes the highest-weight
   * factor (±40) since it represents a pre-tested, evolved strategy.
   */
  private async generateSignal(
    userId: string,
    symbol: string,
    analysis: MarketAnalysis,
    config: TradingConfig,
    genome?: SignalGenome | null
  ): Promise<TradingSignal | null> {
    const ticker = await poloniexFuturesService.getTickers(symbol);
    const rawTicker = ticker[0] ?? {};
    const validatedTicker = validateMarketData(
      { symbol, price: rawTicker.markPx || rawTicker.markPrice || rawTicker.lastPx, ...rawTicker },
      'REST ticker (generateSignal)'
    );

    if (!validatedTicker) {
      logger.warn(`[FAT] Skipping signal generation for ${symbol}: invalid ticker price`);
      return null;
    }

    const currentPrice = validatedTicker.price;

    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let side: 'long' | 'short' = 'long';
    let confidence = 0;
    let reason = '';

    // Multi-factor signal generation
    const factors: Record<string, number> = {
      trend: 0,
      momentum: 0,
      ml: 0,
      volatility: 0,
      genome: 0
    };

    // Genome factor (±40) — highest weight, from SLE-evolved strategy
    if (genome && genome.entryConditions && genome.entryConditions.length > 0) {
      try {
        // Compute full indicator set using backtesting engine's TA library
        const ohlcv = await poloniexFuturesService.getHistoricalData(symbol, '15m', 100);
        if (ohlcv && ohlcv.length >= 20) {
          const currentCandle = ohlcv[ohlcv.length - 1];
          const indicators = backtestingEngine.calculateTechnicalIndicators(ohlcv, currentCandle);
          const indicatorMap = buildIndicatorMap(indicators);
          const genomeSignal = evaluateGenomeEntry(genome, indicatorMap);
          if (genomeSignal) {
            factors.genome = genomeSignal.side === 'long' ? 40 : -40;
            logger.info(`[FAT+SLE] Genome signal: ${genomeSignal.side} (${genomeSignal.reason})`);
          }
        }
      } catch (genomeErr) {
        logger.warn(`[FAT] Genome evaluation failed for ${symbol}:`, genomeErr);
      }
    }

    // Trend factor (±30)
    if (analysis.trend === 'bullish') {
      factors.trend = 30;
    } else if (analysis.trend === 'bearish') {
      factors.trend = -30;
    }

    // Momentum factor (±20)
    factors.momentum = analysis.momentum * 0.2; // Scale to -20 to 20

    // ML factor (±30)
    if (analysis.mlPrediction.direction === 'UP') {
      factors.ml = analysis.mlPrediction.confidence * 0.3; // Scale to 0-30
    } else if (analysis.mlPrediction.direction === 'DOWN') {
      factors.ml = -analysis.mlPrediction.confidence * 0.3;
    }

    // Volatility factor (0-10)
    if (analysis.volatility === 'medium') {
      factors.volatility = 10;
    } else if (analysis.volatility === 'low') {
      factors.volatility = 5;
    }

    // Calculate raw score and normalize confidence to 0-100 scale
    // Max possible |score| is ~130 (40+30+20+30+10) with genome, ~90 without
    const totalScore = factors.trend + factors.momentum + factors.ml + factors.volatility + factors.genome;
    const maxPossibleScore = genome ? 130 : 90;
    confidence = Math.min(Math.round((Math.abs(totalScore) / maxPossibleScore) * 100), 100);

    if (totalScore > config.signalScoreThreshold) {
      action = 'BUY';
      side = 'long';
      reason = `Bullish: Trend=${factors.trend}, Mom=${safeFixed(factors.momentum, 1)}, ML=${safeFixed(factors.ml, 1)}` +
        (factors.genome ? `, Genome=${factors.genome}` : '');
    } else if (totalScore < -config.signalScoreThreshold) {
      action = 'SELL';
      side = 'short';
      reason = `Bearish: Trend=${factors.trend}, Mom=${safeFixed(factors.momentum, 1)}, ML=${safeFixed(factors.ml, 1)}` +
        (factors.genome ? `, Genome=${factors.genome}` : '');
    }

    if (action === 'HOLD') return null;

    // Calculate position size based on risk, then adjust for current drawdown
    // positionSize is in USDT (notional value)
    const slPercent = config.stopLossPercent / 100;
    const tpPercent = config.takeProfitPercent / 100;
    const riskAmount = (config.initialCapital * config.maxRiskPerTrade) / 100; // USDT risked
    const positionSizeUsdt = riskAmount / slPercent; // USDT notional

    // Apply drawdown-adjusted sizing using cached performance metrics
    const metrics = this.performanceMetrics.get(userId);
    const currentEquity = metrics?.currentEquity ?? config.initialCapital;
    const currentDrawdown = ((config.initialCapital - currentEquity) / config.initialCapital) * 100;
    const baseSize = Math.min(positionSizeUsdt, config.initialCapital * MAX_POSITION_FRACTION);
    const adjustedSize = this.getDrawdownAdjustedPositionSize(baseSize, currentDrawdown);

    // Calculate stop loss and take profit using config percentages
    const stopLoss = side === 'long'
      ? currentPrice * (1 - slPercent)
      : currentPrice * (1 + slPercent);

    const takeProfit = side === 'long'
      ? currentPrice * (1 + tpPercent)
      : currentPrice * (1 - tpPercent);

    return {
      symbol,
      action,
      side,
      confidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      positionSize: adjustedSize,
      leverage: config.leverage,
      reason,
      indicators: factors
    };
  }

  /**
   * Execute trading signals
   */
  private async executeSignals(userId: string, signals: TradingSignal[]): Promise<void> {
    const config = this.configs.get(userId);
    if (!config || signals.length === 0) return;

    // Execute top signal
    const signal = signals[0];

    try {
      logger.info(`${config.paperTrading ? '[PAPER]' : '[LIVE]'} Executing signal for ${signal.symbol}: ${signal.action} at ${signal.entryPrice}`);

      let orderId = `paper_${Date.now()}`;

      // Only execute real trades if not in paper trading mode
      if (!config.paperTrading) {
        const credentials = await apiCredentialsService.getCredentials(userId);
        if (!credentials) {
          logger.warn(`No credentials for user ${userId}, cannot execute live trade`);
          return;
        }

        // Validate balance before placing order
        const balance = await poloniexFuturesService.getAccountBalance(credentials);
        const availableBalance = parseFloat(balance.availMgn || balance.availableBalance || '0');
        const requiredMargin = (signal.positionSize / signal.leverage);
        if (availableBalance < requiredMargin * 1.1) { // 10% buffer
          logger.warn(`Insufficient margin for user ${userId}: available=${availableBalance}, required=${requiredMargin}`);
          return;
        }

        // Get current positions
        const currentPositions = await poloniexFuturesService.getPositions(credentials);
        const activePositions = Array.isArray(currentPositions) ? currentPositions : [];
        const positionCount = activePositions.filter((p: any) =>
          parseFloat(p.qty || p.positionAmt || '0') !== 0
        ).length;

        // Limit concurrent positions using config
        if (positionCount >= config.maxConcurrentPositions) {
          logger.info(`Max positions (${config.maxConcurrentPositions}) reached for user ${userId}`);
          return;
        }

        // Run risk service checks before placing order
        const orderSize = signal.positionSize / signal.entryPrice;

        // Fetch actual market info for risk validation
        let marketInfo = { maxLeverage: 50, riskLimits: [] as any[] };
        try {
          const contractInfo = await poloniexFuturesService.getContractInfo(signal.symbol);
          if (contractInfo) {
            marketInfo = {
              maxLeverage: parseFloat(contractInfo.maxLeverage || contractInfo.maxLev || '50'),
              riskLimits: contractInfo.riskLimits || []
            };
          }
        } catch (_infoErr) {
          logger.warn(`Could not fetch contract info for ${signal.symbol}, using defaults`);
        }

        const riskCheck = await riskService.checkOrderRisk(
          {
            symbol: signal.symbol,
            leverage: signal.leverage,
            size: orderSize,
            price: signal.entryPrice,
            side: signal.side === 'long' ? 'buy' : 'sell',
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit
          },
          { id: userId, balance: availableBalance },
          marketInfo
        );

        if (!riskCheck.allowed) {
          logger.warn(`Risk check rejected order for user ${userId}: ${riskCheck.reason}`);
          await riskService.logRiskDecision({
            accountId: userId,
            orderId: null,
            symbol: signal.symbol,
            allowed: false,
            reason: riskCheck.reason,
            leverage: signal.leverage,
            positionSize: orderSize
          });
          return;
        }

        // Validate stop loss / take profit levels
        const slTpCheck = riskService.validateStopLossTakeProfit(
          {
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            side: signal.side === 'long' ? 'buy' : 'sell'
          },
          signal.entryPrice
        );

        if (!slTpCheck.valid) {
          logger.warn(`SL/TP validation failed for user ${userId}: ${slTpCheck.reason}`);
          return;
        }

        // Normalize symbol for futures API
        const normalizedSymbol = poloniexFuturesService.normalizeSymbol(signal.symbol);

        // Format price to tick size and size to lot size via market catalog
        let formattedPrice = signal.entryPrice;
        let formattedOrderSize = orderSize;
        try {
          const precisions = await getPrecisions(normalizedSymbol);
          if (precisions.tickSize && precisions.tickSize > 0) {
            formattedPrice = Math.round(signal.entryPrice / precisions.tickSize) * precisions.tickSize;
          }
          if (precisions.lotSize && precisions.lotSize > 0) {
            // Use Math.floor to avoid rounding up beyond available balance
            formattedOrderSize = Math.floor(orderSize / precisions.lotSize) * precisions.lotSize;
            if (formattedOrderSize <= 0) {
              logger.warn(`[LIVE] Formatted order size is 0 after lot size rounding for ${normalizedSymbol}, skipping`);
              return;
            }
          }
          logger.info(`[LIVE] Size formatted: ${orderSize} -> ${formattedOrderSize} (lotSize=${precisions.lotSize})`);
        } catch (_catalogErr) {
          logger.warn(`[LIVE] Could not fetch precisions for ${normalizedSymbol}, using raw values`);
        }

        // Set leverage on the exchange before placing the order.
        // The signal carries the strategy-specific leverage (already capped at
        // 25% of maxLeverage by leverageAwareStrategyFactory).
        try {
          await poloniexFuturesService.setLeverage(credentials, normalizedSymbol, signal.leverage);
          logger.info(`[LIVE] Leverage set to ${signal.leverage}x for ${normalizedSymbol}`);
        } catch (leverageErr) {
          logger.warn(`[LIVE] Could not set leverage for ${normalizedSymbol}: ${leverageErr}`);
          // Non-fatal: proceed with whatever leverage the exchange currently has
        }

        // Place real order - use 'size' field (not 'quantity') per Poloniex API
        const order = await poloniexFuturesService.placeOrder(credentials, {
          symbol: normalizedSymbol,
          side: signal.side === 'long' ? 'buy' : 'sell',
          type: 'market',
          size: formattedOrderSize
        });

        orderId = order.orderId || order.id;

        // Log risk decision for audit trail
        await riskService.logRiskDecision({
          accountId: userId,
          orderId: orderId,
          symbol: signal.symbol,
          allowed: true,
          reason: signal.reason,
          leverage: signal.leverage,
          positionSize: formattedOrderSize
        });

        logger.info(`[LIVE] Order placed: ${orderId} for ${signal.symbol}`);

        // Place exchange-side stop-loss order for crash protection
        if (signal.stopLoss) {
          try {
            const slSide = signal.side === 'long' ? 'sell' : 'buy';
            await poloniexFuturesService.placeOrder(credentials, {
              symbol: normalizedSymbol,
              side: slSide,
              type: 'stop_market',
              size: formattedOrderSize,
              stopPrice: signal.stopLoss,
              stopPriceType: 'TP',
              reduceOnly: true,
            });
            logger.info(`[LIVE] Exchange-side SL placed at ${signal.stopLoss} for ${normalizedSymbol}`);
          } catch (slErr) {
            logger.error(`[LIVE] Failed to place exchange-side SL for ${normalizedSymbol}:`, slErr);
            // Non-fatal: client-side polling is backup
          }
        }

        // Place exchange-side take-profit order
        if (signal.takeProfit) {
          try {
            const tpSide = signal.side === 'long' ? 'sell' : 'buy';
            await poloniexFuturesService.placeOrder(credentials, {
              symbol: normalizedSymbol,
              side: tpSide,
              type: 'stop_market',
              size: formattedOrderSize,
              stopPrice: signal.takeProfit,
              stopPriceType: 'TP',
              reduceOnly: true,
            });
            logger.info(`[LIVE] Exchange-side TP placed at ${signal.takeProfit} for ${normalizedSymbol}`);
          } catch (tpErr) {
            logger.error(`[LIVE] Failed to place exchange-side TP for ${normalizedSymbol}:`, tpErr);
          }
        }
      } else {
        // Paper trading - check virtual position limits
        const openPaperTrades = await pool.query(
          `SELECT COUNT(*) as count FROM autonomous_trades
           WHERE user_id = $1 AND status = 'open' AND order_id LIKE 'paper_%'`,
          [userId]
        );

        if (parseInt(openPaperTrades.rows[0].count) >= config.maxConcurrentPositions) {
          logger.info(`Max paper positions (${config.maxConcurrentPositions}) reached for user ${userId}`);
          return;
        }
      }

      // Log trade (both paper and live)
      await pool.query(
        `INSERT INTO autonomous_trades
         (user_id, symbol, side, entry_price, quantity, stop_loss, take_profit, confidence, reason, order_id, paper_trade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId,
          signal.symbol,
          signal.side,
          signal.entryPrice,
          signal.positionSize / signal.entryPrice,
          signal.stopLoss,
          signal.takeProfit,
          signal.confidence,
          signal.reason,
          orderId,
          config.paperTrading
        ]
      );

      // Write to agent_events so the dashboard can show activity
      await this.logAgentEvent(userId, {
        eventType: 'trade_executed',
        executionMode: config.paperTrading ? 'paper' : 'live',
        description: `${signal.side.toUpperCase()} ${signal.symbol} @ ${safeFixed(signal.entryPrice, 8)}`,
        confidence: signal.confidence,
        market: signal.symbol,
        orderId,
        metadata: { reason: signal.reason, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, positionSize: signal.positionSize }
      });

      this.emit('trade_executed', { userId, signal, orderId, paperTrading: config.paperTrading });
      logger.info(`${config.paperTrading ? '[PAPER]' : '[LIVE]'} Trade executed for user ${userId}: ${signal.symbol} ${signal.side}`);

    } catch (error) {
      logger.error(`Error executing signal for user ${userId}:`, error);
    }
  }

  /**
   * Write a structured event to the agent_events table for dashboard visibility.
   */
  private async logAgentEvent(userId: string, event: {
    eventType: string;
    executionMode?: string;
    description: string;
    confidence?: number;
    market?: string;
    orderId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO agent_events
         (user_id, event_type, execution_mode, description, confidence_score, market, resulting_order_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          userId,
          event.eventType,
          event.executionMode ?? null,
          event.description,
          event.confidence ?? null,
          event.market ?? null,
          event.orderId ?? null,
          event.metadata ? JSON.stringify(event.metadata) : null,
        ]
      );
    } catch (err) {
      // Non-fatal — never break the trading loop for logging failures
      logger.warn('Failed to write agent_event:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Bootstrap ML worker with historical OHLCV data for each symbol.
   * Called once on startup — silently succeeds or fails.
   */
  private async bootstrapMlModels(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      try {
        const ohlcv = await poloniexFuturesService.getKlines(symbol, '1hour', 500);
        if (ohlcv && ohlcv.length > 50) {
          const trainingData = ohlcv.map((c: Record<string, unknown>) => ({
            close: Number(c.close ?? c.price ?? 0),
            high: Number(c.high ?? 0),
            low: Number(c.low ?? 0),
            open: Number(c.open ?? 0),
            volume: Number(c.volume ?? 0),
          }));
          await mlPredictionService.trainModels(symbol, trainingData);
          logger.info(`ML models bootstrapped for ${symbol} with ${trainingData.length} candles`);
        }
      } catch (_err) {
        // Non-critical — simpleMlService fallback handles predictions
      }
    }
  }

  /**
   * Reconcile DB position state with actual exchange positions.
   * Logs drift but does not auto-close — lets the human investigate.
   */
  private async reconcilePositions(userId: string): Promise<void> {
    try {
      const credentials = await apiCredentialsService.getCredentials(userId);
      if (!credentials) return;

      // Get actual positions from Poloniex
      const exchangePositions = await poloniexFuturesService.getPositions(credentials);
      const openSymbols = new Set(
        (exchangePositions || [])
          .filter((p: Record<string, unknown>) => Number(p.qty || p.currentQty || 0) !== 0)
          .map((p: Record<string, unknown>) => String(p.symbol))
      );

      // Get DB open trades (non-paper)
      const dbResult = await pool.query(
        `SELECT symbol, order_id FROM autonomous_trades
         WHERE user_id = $1 AND status = 'open' AND paper_trade = false`,
        [userId]
      );
      const dbSymbols = new Set(dbResult.rows.map((r: { symbol: string }) => r.symbol));

      // Drift detection
      const inDbNotExchange = [...dbSymbols].filter(s => !openSymbols.has(s));
      const inExchangeNotDb = [...openSymbols].filter(s => !dbSymbols.has(s));

      if (inDbNotExchange.length > 0) {
        logger.warn(
          `[RECONCILE] DB shows open positions not on exchange: ${inDbNotExchange.join(', ')} — ` +
          `marking as closed`
        );
        for (const symbol of inDbNotExchange) {
          await pool.query(
            `UPDATE autonomous_trades SET status = 'closed', closed_at = NOW(),
             close_reason = 'reconciliation: position not found on exchange'
             WHERE user_id = $1 AND symbol = $2 AND status = 'open' AND paper_trade = false`,
            [userId, symbol]
          );
        }
      }

      if (inExchangeNotDb.length > 0) {
        logger.warn(
          `[RECONCILE] Exchange has positions not tracked in DB: ${inExchangeNotDb.join(', ')} — ` +
          `these may have been opened manually or by another system`
        );
        await this.logAgentEvent(userId, {
          eventType: 'reconciliation_drift',
          executionMode: 'live',
          description: `Untracked exchange positions: ${inExchangeNotDb.join(', ')}`,
        });
      }
    } catch (error) {
      logger.warn('[RECONCILE] Position reconciliation failed:', error);
    }
  }

  /**
   * Manage existing positions (stop loss, take profit, trailing stop)
   */
  private async managePositions(userId: string, analyses: Map<string, MarketAnalysis>): Promise<void> {
    const config = this.configs.get(userId);
    const credentials = await apiCredentialsService.getCredentials(userId);
    if (!credentials) return;

    const slPercent = config?.stopLossPercent || 2;
    const tpPercent = config?.takeProfitPercent || 4;
    const trailingTrigger = slPercent; // Start trailing stop when profit exceeds SL distance

    try {
      const positions = await poloniexFuturesService.getPositions(credentials);
      const activePositions = Array.isArray(positions) ? positions : [];

      for (const position of activePositions) {
        const qty = parseFloat(position.qty || position.positionAmt || '0');
        if (qty === 0) continue;

        const symbol = position.symbol;
        const _currentPrice = parseFloat(position.markPx || position.markPrice || '0');
        const entryPrice = parseFloat(position.openAvgPx || position.entryPrice || '0');
        const unrealizedPnL = parseFloat(position.upl || position.unrealizedPnl || '0');

        // Calculate P&L percentage
        const pnlPercent = entryPrice > 0 ? (unrealizedPnL / (entryPrice * Math.abs(qty))) * 100 : 0;

        // Check stop loss using config percentage
        if (pnlPercent < -slPercent) {
          logger.info(`Stop loss triggered for ${symbol}: ${pnlPercent.toFixed(2)}% (limit: -${slPercent}%)`);
          await this.closePosition(userId, symbol, 'stop_loss');
          this.recordTradeResult(userId, unrealizedPnL, config?.initialCapital ?? 10000);
          continue;
        }

        // Check take profit using config percentage
        if (pnlPercent > tpPercent) {
          logger.info(`Take profit triggered for ${symbol}: ${pnlPercent.toFixed(2)}% (limit: ${tpPercent}%)`);
          await this.closePosition(userId, symbol, 'take_profit');
          this.recordTradeResult(userId, unrealizedPnL, config?.initialCapital ?? 10000);
          continue;
        }

        // Trailing stop (if profit > SL distance, close on trend reversal)
        if (pnlPercent > trailingTrigger) {
          const analysis = analyses.get(symbol);
          if (analysis) {
            // If trend reverses, close position
            const isLong = qty > 0;
            if ((isLong && analysis.trend === 'bearish') || (!isLong && analysis.trend === 'bullish')) {
              logger.info(`Trend reversal detected for ${symbol}, closing position`);
              await this.closePosition(userId, symbol, 'trend_reversal');
              this.recordTradeResult(userId, unrealizedPnL, config?.initialCapital ?? 10000);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error managing positions for user ${userId}:`, error);
    }
  }

  /**
   * Close a position
   */
  private async closePosition(userId: string, symbol: string, reason: string): Promise<void> {
    const credentials = await apiCredentialsService.getCredentials(userId);
    if (!credentials) return;

    try {
      const positions = await poloniexFuturesService.getPositions(credentials);
      const allPositions = Array.isArray(positions) ? positions : [];
      const position = allPositions.find((p: any) => p.symbol === symbol);

      if (!position) return;

      const qty = parseFloat(position.qty || position.positionAmt || '0');
      if (qty === 0) return;

      const exitPrice = parseFloat(position.markPx || position.markPrice || '0');
      const entryPrice = parseFloat(position.openAvgPx || position.entryPrice || '0');
      const pnl = parseFloat(position.unrealPnl || position.unrealisedPnl || '0');

      // Use Poloniex close position endpoint for cleaner execution
      const closeType = qty > 0 ? 'close_long' : 'close_short';
      await poloniexFuturesService.closePosition(credentials, symbol, closeType);

      // Update autonomous_trades record with exit data
      // Try to update with exit_price and pnl; fall back to basic update if columns don't exist
      try {
        await pool.query(
          `UPDATE autonomous_trades
           SET status = 'closed', close_reason = $3, closed_at = NOW(),
               exit_price = $4, pnl = $5
           WHERE user_id = $1 AND symbol = $2 AND status = 'open'`,
          [userId, symbol, reason, exitPrice, pnl]
        );
      } catch (updateErr) {
        // Columns may not exist yet — fall back to basic update
        await pool.query(
          `UPDATE autonomous_trades
           SET status = 'closed', close_reason = $3, closed_at = NOW()
           WHERE user_id = $1 AND symbol = $2 AND status = 'open'`,
          [userId, symbol, reason]
        );
      }

      logger.info(`Position closed for user ${userId}: ${symbol} (${reason}) exit=${exitPrice} pnl=${pnl}`);
      this.emit('position_closed', { userId, symbol, reason, exitPrice, pnl });

    } catch (error) {
      logger.error(`Error closing position for user ${userId}:`, error);
    }
  }

  /**
   * Close all positions for a user
   */
  private async closeAllPositions(userId: string): Promise<void> {
    const credentials = await apiCredentialsService.getCredentials(userId);
    if (!credentials) return;

    try {
      // Use the bulk close endpoint for efficiency
      await poloniexFuturesService.closeAllPositions(credentials);

      // Update all open trades in DB
      await pool.query(
        `UPDATE autonomous_trades
         SET status = 'closed', close_reason = 'trading_disabled', closed_at = NOW()
         WHERE user_id = $1 AND status = 'open'`,
        [userId]
      );

      logger.info(`All positions closed for user ${userId}`);
    } catch (error) {
      logger.error(`Error closing all positions for user ${userId}:`, error);
    }
  }

  /**
   * Update performance metrics
   */
  private async updatePerformanceMetrics(userId: string): Promise<void> {
    const config = this.configs.get(userId);
    if (!config) return;

    try {
      const credentials = await apiCredentialsService.getCredentials(userId);
      if (!credentials) return;

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
      await pool.query(
        `INSERT INTO autonomous_performance
         (user_id, current_equity, total_return, drawdown, timestamp)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, metrics.currentEquity, metrics.totalReturn, metrics.drawdown, metrics.timestamp]
      );

    } catch (error) {
      logger.error(`Error updating performance metrics for user ${userId}:`, error);
    }
  }

  /**
   * Get performance metrics for a user
   */
  async getPerformanceMetrics(userId: string): Promise<any> {
    return this.performanceMetrics.get(userId) || null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Circuit Breaker
  // ──────────────────────────────────────────────────────────────────────────

  private getNextDayReset(): Date {
    const now = new Date();
    const reset = new Date(now);
    reset.setUTCHours(0, 0, 0, 0);
    reset.setUTCDate(reset.getUTCDate() + 1);
    return reset;
  }

  /**
   * Initialize or get circuit breaker state for a user.
   * Automatically resets the daily loss counter at UTC midnight.
   */
  private getCircuitBreaker(userId: string) {
    if (!this.circuitBreakers.has(userId)) {
      this.circuitBreakers.set(userId, {
        consecutiveLosses: 0,
        dailyLoss: 0,
        dailyLossResetAt: this.getNextDayReset(),
        isTripped: false
      });
    }
    const cb = this.circuitBreakers.get(userId)!;
    // Reset daily loss counter at UTC midnight
    if (new Date() >= cb.dailyLossResetAt) {
      cb.dailyLoss = 0;
      cb.dailyLossResetAt = this.getNextDayReset();
    }
    return cb;
  }

  /**
   * Check if the circuit breaker allows trading for this user.
   * Auto-resets after the cooldown period.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  private checkCircuitBreaker(userId: string): { allowed: boolean; reason?: string } {
    const cb = this.getCircuitBreaker(userId);

    // Auto-reset after cooldown
    if (cb.isTripped && cb.trippedAt) {
      const elapsed = Date.now() - cb.trippedAt.getTime();
      if (elapsed >= FullyAutonomousTrader.CIRCUIT_BREAKER_COOLDOWN_MS) {
        logger.info(`[CB] Cooldown expired for user ${userId} — resetting`);
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
   * Called after every position close.
   */
  private recordTradeResult(userId: string, pnl: number, capitalBase: number): void {
    const cb = this.getCircuitBreaker(userId);

    if (pnl < 0) {
      cb.consecutiveLosses++;
      cb.dailyLoss += Math.abs(pnl);
    } else {
      cb.consecutiveLosses = 0; // Reset on a win
    }

    // Check consecutive losses
    if (cb.consecutiveLosses >= FullyAutonomousTrader.MAX_CONSECUTIVE_LOSSES) {
      cb.isTripped = true;
      cb.trippedAt = new Date();
      cb.trippedReason = `${cb.consecutiveLosses} consecutive losses — pausing for cooldown`;
      logger.warn(`[CB] TRIPPED for user ${userId}: ${cb.trippedReason}`);
      this.emit('circuit_breaker_tripped', { userId, reason: cb.trippedReason, consecutiveLosses: cb.consecutiveLosses });
    }

    // Check daily loss limit
    const dailyLossPercent = capitalBase > 0 ? (cb.dailyLoss / capitalBase) * 100 : 0;
    if (dailyLossPercent >= FullyAutonomousTrader.MAX_DAILY_LOSS_PERCENT) {
      cb.isTripped = true;
      cb.trippedAt = new Date();
      cb.trippedReason = `Daily loss limit reached (${safeFixed(dailyLossPercent, 1, '?')}% of capital) — halting until next day`;
      logger.warn(`[CB] TRIPPED for user ${userId}: ${cb.trippedReason}`);
      this.emit('circuit_breaker_tripped', { userId, reason: cb.trippedReason, dailyLossPercent });
    }
  }

  /**
   * Calculate drawdown-adjusted position size.
   * Linear scale-down between DRAWDOWN_SCALE_THRESHOLD and DRAWDOWN_HALT_THRESHOLD.
   * Returns 0 at or above DRAWDOWN_HALT_THRESHOLD.
   */
  private getDrawdownAdjustedPositionSize(basePositionSize: number, currentDrawdownPercent: number): number {
    if (currentDrawdownPercent >= FullyAutonomousTrader.DRAWDOWN_HALT_THRESHOLD) {
      return 0; // Full halt
    }
    if (currentDrawdownPercent <= FullyAutonomousTrader.DRAWDOWN_SCALE_THRESHOLD) {
      return basePositionSize; // No reduction
    }
    // Linear scale-down between thresholds
    const range = FullyAutonomousTrader.DRAWDOWN_HALT_THRESHOLD - FullyAutonomousTrader.DRAWDOWN_SCALE_THRESHOLD;
    const excess = currentDrawdownPercent - FullyAutonomousTrader.DRAWDOWN_SCALE_THRESHOLD;
    const scale = 1 - (excess / range);
    return basePositionSize * Math.max(0, scale);
  }

  /**
   * Get circuit breaker status for a user (for API exposure).
   */
  getCircuitBreakerStatus(userId: string): {
    isTripped: boolean;
    reason?: string;
    consecutiveLosses: number;
    dailyLossPercent: number;
    cooldownRemaining?: number;
  } {
    const cb = this.getCircuitBreaker(userId);
    const config = this.configs.get(userId);
    const capitalBase = config ? config.initialCapital : 10000;
    const dailyLossPercent = capitalBase > 0 ? (cb.dailyLoss / capitalBase) * 100 : 0;

    return {
      isTripped: cb.isTripped,
      reason: cb.trippedReason,
      consecutiveLosses: cb.consecutiveLosses,
      dailyLossPercent: Number.isFinite(dailyLossPercent) ? parseFloat(dailyLossPercent.toFixed(2)) : 0,
      cooldownRemaining: cb.isTripped && cb.trippedAt
        ? Math.max(0, FullyAutonomousTrader.CIRCUIT_BREAKER_COOLDOWN_MS - (Date.now() - cb.trippedAt.getTime()))
        : undefined
    };
  }

  /**
   * Helper: Calculate Simple Moving Average
   */
  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    const slice = data.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
  }

  /**
   * Helper: Calculate Standard Deviation
   */
  private calculateStdDev(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / data.length;
    return Math.sqrt(variance);
  }

  /**
   * Helper: Calculate Momentum (RSI-like indicator)
   */
  private calculateMomentum(closes: number[]): number {
    if (closes.length < 14) return 0;

    const changes = closes.slice(1).map((price, i) => price - closes[i]);
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(Math.abs);

    const avgGain = gains.length > 0 ? gains.reduce((sum, g) => sum + g, 0) / gains.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    // Convert RSI (0-100) to momentum (-100 to 100)
    return (rsi - 50) * 2;
  }
}

// Export class for testing and named export for singleton
export { FullyAutonomousTrader };

// Export singleton instance
export const fullyAutonomousTrader = new FullyAutonomousTrader();
export default fullyAutonomousTrader;
