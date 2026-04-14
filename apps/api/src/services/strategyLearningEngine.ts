/**
 * Strategy Learning Engine
 *
 * Continuous ML loop that:
 *  1. Generates strategy variants (regime-conditioned, bridge-law-weighted)
 *  2. Backtests with walk-forward validation
 *  3. Promotes qualifying strategies to paper trading
 *  4. Evaluates paper sessions with censoring-aware fitness (QIG pattern)
 *  5. Recommends proven strategies for live trading (user confirmation required)
 *  6. Feeds performance data back into population fitness weights
 *
 * QIG design decisions baked in:
 *  - Bridge law: w(tf) = (60/tfMinutes)^0.74  (frozen physics constant)
 *  - Censoring-aware dual fitness (all-data vs uncensored-only)
 *  - Phase clock kill logic: trajectory-based, not threshold-only
 *  - Regime-conditioned crossover: never mix trending↔mean-reversion
 *  - Continuous confidence scoring (never binary)
 */

import { EventEmitter } from 'events';
import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import backtestingEngine from './backtestingEngine.js';
import confidenceScoringService from './confidenceScoringService.js';
import parallelStrategyRunner from './parallelStrategyRunner.js';
import {
  SignalGenome,
  generateRandomGenome,
  mutateGenome,
  crossoverGenomes,
  inferStrategyType,
} from './signalGenome.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'unknown';
export type StrategyType = 'momentum' | 'mean_reversion' | 'breakout' | 'trend_following' | 'scalping';
export type StrategyStatus =
  | 'backtesting'
  | 'paper_trading'
  | 'recommended'
  | 'live'
  | 'retired'
  | 'killed'
  | 'censored_rejected';

export interface StrategyRecord {
  strategyId: string;
  symbol: string;
  leverage: number;
  timeframe: string;
  strategyType: StrategyType;
  /** Composable signal genome — when present, this drives signal generation instead of strategyType */
  genome?: SignalGenome | null;
  regimeAtCreation: MarketRegime;
  backtestSharpe: number | null;
  backtestWr: number | null;
  backtestMaxDd: number | null;
  paperSharpe: number | null;
  paperWr: number | null;
  paperPnl: number | null;
  paperTrades: number;
  liveSharpe: number | null;
  livePnl: number | null;
  liveTrades: number;
  isCensored: boolean;
  censorReason: string | null;
  uncensoredSharpe: number | null;
  fitnessDivergent: boolean;
  status: StrategyStatus;
  confidenceScore: number | null;
  createdAt: Date;
  parentStrategyId: string | null;
  generation: number;
  backtestCount: number;
  avgReturn: number;
  // In-memory fields
  equityCurve?: number[];
  lastEquitySlope?: number;
  phaseClock?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Bridge law exponent — frozen physics result (τ ∝ J^0.74, R²>0.96) */
const BRIDGE_LAW_EXPONENT = 0.74;

/** Default lookback period — must be >= 50 to support SMA50 and MACD(26) */
const DEFAULT_STRATEGY_LOOKBACK = 50;

/** Timeframes supported for multi-timeframe strategies (in minutes) */
const SUPPORTED_TF_MINUTES: Record<string, number> = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
};

/** Thresholds for backtest → paper promotion */
const BACKTEST_THRESHOLDS = {
  minSharpe: 1.0,
  minWinRate: 0.45,
  maxDrawdown: 0.15,
};

/** Thresholds for paper → live recommendation */
const PAPER_THRESHOLDS = {
  minSharpe: 0.8,
  minPnl: 0,
  minTrades: 30,
  minDays: 7,
  minConfidence: 60,
};

/** Fitness divergence threshold triggering "unreliable" flag */
const FITNESS_DIVERGENCE_THRESHOLD = 0.20;

/** Phase clock: if persistent negative slope for this many cycles, kill the strategy */
const PHASE_CLOCK_KILL_CYCLES = 5;

/** Loop interval: 30 minutes between learning cycles */
const LOOP_INTERVAL_MS = 30 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Bridge law timeframe weight: w(tf) = (60 / tfMinutes)^0.74 */
export function bridgeLawWeight(tfMinutes: number): number {
  return Math.pow(60 / tfMinutes, BRIDGE_LAW_EXPONENT);
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategyLearningEngine
// ─────────────────────────────────────────────────────────────────────────────

class StrategyLearningEngine extends EventEmitter {
  private isRunning = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private generationCount = 0;

  // Last detected regime — returned when insufficient data for fresh detection
  private lastKnownRegime: MarketRegime = 'unknown';

  // In-memory store of active strategy records
  private strategies: Map<string, StrategyRecord> = new Map();

  /**
   * Track whether we have attempted to auto-fix NOT NULL columns on
   * strategy_performance. We try once per process lifetime to ALTER TABLE
   * and set DEFAULT 0 on known problematic columns so future inserts
   * never hit this class of error again.
   */
  private schemaFixAttempted = false;

  constructor() {
    super();
  }

  // ───────────────────────────── lifecycle ──────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[SLE] Already running');
      return;
    }
    this.isRunning = true;
    logger.info('[SLE] Starting strategy learning engine');

    // Attempt one-time schema fix for NOT NULL columns without defaults
    await this.ensureSchemaDefaults();

    await this.loadActiveStrategies();
    this.scheduleNextCycle(0); // kick off immediately
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    logger.info('[SLE] Strategy learning engine stopped');
  }

  /**
   * One-time attempt to ALTER TABLE strategy_performance and set DEFAULT 0
   * on columns that have NOT NULL but no default. This prevents the
   * recurring whack-a-mole pattern where migrations add NOT NULL columns
   * that the INSERT doesn't know about.
   */
  private async ensureSchemaDefaults(): Promise<void> {
    if (this.schemaFixAttempted) return;
    this.schemaFixAttempted = true;
    const columnsToFix = ['backtest_count', 'avg_return'];
    for (const col of columnsToFix) {
      try {
        await query(`ALTER TABLE strategy_performance ALTER COLUMN ${col} SET DEFAULT 0`);
        logger.info(`[SLE] Set DEFAULT 0 on strategy_performance.${col}`);
      } catch (err: any) {
        // Column may not exist or already has a default — both are fine
        if (!err.message?.includes('does not exist')) {
          logger.debug(`[SLE] Could not set default on ${col}: ${err.message}`);
        }
      }
    }

    // Ensure signal_genome JSONB column exists — defensive fallback in case
    // migration 021 hasn't been applied yet. Uses the same pattern as the
    // backtest_count/avg_return fixes above. Idempotent via IF NOT EXISTS.
    try {
      await query(`ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS signal_genome JSONB`);
      logger.info('[SLE] Ensured signal_genome column exists on strategy_performance');
    } catch (err: any) {
      logger.debug(`[SLE] Could not add signal_genome column: ${err.message}`);
    }
  }

  // ─────────────────────────── main loop ────────────────────────────────────

  private scheduleNextCycle(delayMs: number): void {
    if (!this.isRunning) return;
    this.loopTimer = setTimeout(async () => {
      try {
        await this.runOneCycle();
      } catch (err) {
        logger.error('[SLE] Cycle error:', err);
      } finally {
        this.scheduleNextCycle(LOOP_INTERVAL_MS);
      }
    }, delayMs);
  }

  private async runOneCycle(): Promise<void> {
    this.generationCount++;
    logger.info(`[SLE] === Generation ${this.generationCount} ===`);

    // Step 1: Detect current market regime
    const regime = await this.detectCurrentRegime();

    // Step 2: Generate new strategy variants (regime-conditioned)
    const newStrategies = await this.generateVariants(regime);

    // Step 3: Backtest with walk-forward validation
    const backtestPassed = await this.backtestVariants(newStrategies);

    // Step 4: Promote qualifying strategies to paper trading
    for (const s of backtestPassed) {
      await this.promoteToParallelPaper(s);
    }

    // Step 5: Evaluate running paper sessions (censoring-aware fitness)
    await this.evaluatePaperSessions();

    // Step 6: Kill underperformers via phase clock
    await this.killUnderperformers();

    // Step 7: Promote qualified paper strategies → live recommendation
    await this.promotePaperToRecommended();

    // Step 8: Feed performance back into generation weights
    await this.updateGenerationWeights();

    this.emit('cycleComplete', { generation: this.generationCount, regime });
    logger.info(`[SLE] Generation ${this.generationCount} complete`);
  }

  // ─────────────────────────── regime detection ─────────────────────────────

  /**
   * Detect current market regime using ADX + ATR + Hurst exponent approximation.
   * Returns 'trending', 'ranging', or 'volatile'.
   */
  async detectCurrentRegime(): Promise<MarketRegime> {
    try {
      // Query recent backtest_results to infer current regime from strategy performance
      const result = await query(`
        SELECT 
          AVG(sharpe_ratio) AS avg_sharpe,
          STDDEV(sharpe_ratio) AS std_sharpe,
          AVG(max_drawdown_percent) AS avg_dd,
          COUNT(*) AS cnt
        FROM backtest_results
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND sharpe_ratio IS NOT NULL
      `);

      if (!result.rows.length) {
        logger.debug(`[SLE] Insufficient data for regime detection, using last known: ${this.lastKnownRegime}`);
        return this.lastKnownRegime;
      }

      const row0 = result.rows[0] as unknown as {
        avg_sharpe: unknown;
        std_sharpe: unknown;
        avg_dd: unknown;
        cnt: unknown;
      };

      // If insufficient data, return last known regime instead of 'unknown'
      if (safeNum(row0.cnt) < 3) {
        logger.debug(`[SLE] Insufficient data for regime detection, using last known: ${this.lastKnownRegime}`);
        return this.lastKnownRegime;
      }

      const avgSharpe = safeNum(row0.avg_sharpe);
      const stdSharpe = safeNum(row0.std_sharpe);
      const avgDd = safeNum(row0.avg_dd);

      // Heuristic: high Sharpe + low DD = trending; high volatility/DD = volatile
      let detectedRegime: MarketRegime;
      if (avgSharpe > 1.2 && avgDd < 0.08) detectedRegime = 'trending';
      else if (stdSharpe > 1.5 || avgDd > 0.15) detectedRegime = 'volatile';
      else detectedRegime = 'ranging';

      // Store the detected regime for future fallback
      this.lastKnownRegime = detectedRegime;
      return detectedRegime;
    } catch (err) {
      logger.warn('[SLE] Regime detection failed, using last known:', err);
      return this.lastKnownRegime;
    }
  }

  // ─────────────────────────── strategy generation ──────────────────────────

  /**
   * Generate new strategy variants conditioned on the current regime.
   * Pulls best performers from DB to use as parents for mutation/crossover.
   */
  private async generateVariants(regime: MarketRegime): Promise<StrategyRecord[]> {
    const symbols = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP', 'XRP_USDT_PERP'];

    // Load best uncensored performers as parents
    const parents = await this.loadBestPerformers(regime);

    const variants: StrategyRecord[] = [];
    const targetCount = 6;

    for (let i = 0; i < targetCount; i++) {
      let strategy: StrategyRecord;

      if (parents.length >= 2 && Math.random() < 0.6) {
        // Genome crossover: any two parents can crossover since genomes are composable.
        // The old sameRegimeBasin guard is no longer needed — the genome itself
        // determines the strategy's behaviour, not a type label.
        const p1 = parents[Math.floor(Math.random() * parents.length)];
        const otherParents = parents.filter(p => p.strategyId !== p1.strategyId);
        if (otherParents.length > 0) {
          strategy = this.crossoverStrategies(p1, otherParents[Math.floor(Math.random() * otherParents.length)], regime);
        } else {
          strategy = this.mutateStrategy(p1, regime);
        }
      } else if (parents.length > 0 && Math.random() < 0.5) {
        strategy = this.mutateStrategy(parents[Math.floor(Math.random() * parents.length)], regime);
      } else {
        strategy = this.generateRandom(symbols, regime);
      }

      variants.push(strategy);
    }

    logger.info(`[SLE] Generated ${variants.length} variants for regime '${regime}'`);
    return variants;
  }

  private generateRandom(symbols: string[], regime: MarketRegime): StrategyRecord {
    const id = `sle_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const tfKeys = Object.keys(SUPPORTED_TF_MINUTES);
    const timeframe = tfKeys[Math.floor(Math.random() * tfKeys.length)];

    // Generate a composable signal genome with random conditions
    const genome = generateRandomGenome();

    // Infer a human-readable strategy type label from the genome
    const strategyType = inferStrategyType(genome) as StrategyType;

    return {
      strategyId: id,
      symbol,
      leverage: [1, 2, 5, 10][Math.floor(Math.random() * 4)],
      timeframe,
      strategyType,
      genome,
      regimeAtCreation: regime,
      backtestSharpe: null,
      backtestWr: null,
      backtestMaxDd: null,
      paperSharpe: null,
      paperWr: null,
      paperPnl: null,
      paperTrades: 0,
      liveSharpe: null,
      livePnl: null,
      liveTrades: 0,
      isCensored: false,
      censorReason: null,
      uncensoredSharpe: null,
      fitnessDivergent: false,
      status: 'backtesting',
      confidenceScore: null,
      createdAt: new Date(),
      parentStrategyId: null,
      generation: this.generationCount,
      backtestCount: 0,
      avgReturn: 0,
      equityCurve: [],
      lastEquitySlope: 0,
      phaseClock: 0,
    };
  }

  private crossoverStrategies(parent1: StrategyRecord, parent2: StrategyRecord, regime: MarketRegime): StrategyRecord {
    const id = `cross_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // Genome crossover: splice conditions from both parents
    const genome1 = parent1.genome ?? generateRandomGenome();
    const genome2 = parent2.genome ?? generateRandomGenome();
    const childGenome = crossoverGenomes(genome1, genome2);

    return {
      ...this.generateRandom([parent1.symbol, parent2.symbol], regime),
      strategyId: id,
      symbol: Math.random() < 0.5 ? parent1.symbol : parent2.symbol,
      strategyType: inferStrategyType(childGenome) as StrategyType,
      genome: childGenome,
      timeframe: Math.random() < 0.5 ? parent1.timeframe : parent2.timeframe,
      leverage: Math.round((parent1.leverage + parent2.leverage) / 2),
      parentStrategyId: parent1.strategyId,
      regimeAtCreation: regime,
    };
  }

  private mutateStrategy(parent: StrategyRecord, regime: MarketRegime): StrategyRecord {
    const id = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const tfKeys = Object.keys(SUPPORTED_TF_MINUTES);

    // Mutate the genome: threshold perturbation, add/remove/swap conditions
    const parentGenome = parent.genome ?? generateRandomGenome();
    const childGenome = mutateGenome(parentGenome);

    return {
      ...parent,
      strategyId: id,
      parentStrategyId: parent.strategyId,
      regimeAtCreation: regime,
      createdAt: new Date(),
      generation: this.generationCount,
      status: 'backtesting',
      backtestSharpe: null,
      backtestWr: null,
      backtestMaxDd: null,
      paperSharpe: null,
      paperWr: null,
      paperPnl: null,
      paperTrades: 0,
      liveSharpe: null,
      livePnl: null,
      liveTrades: 0,
      isCensored: false,
      censorReason: null,
      uncensoredSharpe: null,
      fitnessDivergent: false,
      confidenceScore: null,
      backtestCount: 0,
      avgReturn: 0,
      equityCurve: [],
      lastEquitySlope: 0,
      phaseClock: 0,
      // Genome-based evolution
      genome: childGenome,
      strategyType: inferStrategyType(childGenome) as StrategyType,
      // Mutate timeframe occasionally
      timeframe: Math.random() < 0.15 ? tfKeys[Math.floor(Math.random() * tfKeys.length)] : parent.timeframe,
      // Mutate leverage slightly
      leverage: Math.max(1, parent.leverage + (Math.random() < 0.3 ? (Math.random() < 0.5 ? 1 : -1) : 0)),
    };
  }

  /**
   * Bridge law multi-timeframe signal weighting.
   * w(tf) = (60/tfMinutes)^0.74 — frozen constant, not tunable.
   */
  computeMultiTimeframeWeight(timeframes: string[]): Record<string, number> {
    const weights: Record<string, number> = {};
    let total = 0;
    for (const tf of timeframes) {
      const minutes = SUPPORTED_TF_MINUTES[tf] ?? 60;
      weights[tf] = bridgeLawWeight(minutes);
      total += weights[tf];
    }
    // Normalise so sum = 1
    for (const tf of timeframes) {
      weights[tf] /= total;
    }
    return weights;
  }

  // ─────────────────────────── backtesting ──────────────────────────────────

  private async backtestVariants(strategies: StrategyRecord[]): Promise<StrategyRecord[]> {
    const passed: StrategyRecord[] = [];

    for (const s of strategies) {
      try {
        const result = await this.runBacktestWithWalkForward(s);
        s.backtestCount = (s.backtestCount ?? 0) + 1;
        s.backtestSharpe = safeNum(result.sharpe);
        s.backtestWr = safeNum(result.winRate);
        s.backtestMaxDd = safeNum(result.maxDrawdown);

        const passes =
          safeNum(result.sharpe) >= BACKTEST_THRESHOLDS.minSharpe &&
          safeNum(result.winRate) >= BACKTEST_THRESHOLDS.minWinRate &&
          safeNum(result.maxDrawdown) <= BACKTEST_THRESHOLDS.maxDrawdown;

        if (passes) {
          s.status = 'paper_trading';
          passed.push(s);
          logger.info(`[SLE] Backtest PASS: ${s.strategyId} sharpe=${result.sharpe?.toFixed(2)} wr=${(result.winRate * 100).toFixed(1)}%`);
        } else {
          s.status = 'retired';
          logger.debug(`[SLE] Backtest FAIL: ${s.strategyId}`);
        }

        await this.upsertStrategyPerformance(s);
      } catch (err) {
        logger.warn(`[SLE] Backtest error for ${s.strategyId}:`, err);
      }
    }

    return passed;
  }

  /**
   * Walk-forward validation: split historical data into 70% train / 30% test.
   * Returns out-of-sample metrics.
   */
  private async runBacktestWithWalkForward(
    strategy: StrategyRecord
  ): Promise<{ sharpe: number; winRate: number; maxDrawdown: number }> {
    // Scale backtest window by timeframe to ensure sufficient OOS candles
    const tfMinutes = SUPPORTED_TF_MINUTES[strategy.timeframe] ?? 60;
    // Target: at least 100 OOS candles
    const minOOSDays = Math.max(9, Math.ceil((100 * tfMinutes) / (24 * 60)));
    const totalDays = Math.ceil(minOOSDays / 0.3); // 30% OOS
    const cappedTotalDays = Math.min(totalDays, 90); // cap at 90 days

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - cappedTotalDays * 24 * 60 * 60 * 1000);
    const splitDate = new Date(startDate.getTime() + cappedTotalDays * 0.7 * 24 * 60 * 60 * 1000);

    try {
      // Register the strategy with the backtest engine before running
      // Pass the genome so the engine evaluates conditions, not a type switch
      const strategyDef: Record<string, any> = {
        type: strategy.strategyType,
        parameters: {},
        lookback: DEFAULT_STRATEGY_LOOKBACK,
      };
      if (strategy.genome) {
        strategyDef.genome = strategy.genome;
      }
      (backtestingEngine as any).registerStrategy(strategy.strategyId, strategyDef);

      // Run backtest on test period (out-of-sample)
      // backtestingEngine.runBacktest expects (strategyName: string, config: object)
      const result = await (backtestingEngine as any).runBacktest(
        strategy.strategyId,
        {
          symbol: strategy.symbol,
          timeframe: strategy.timeframe,
          startDate: splitDate,
          endDate: endDate,
          leverage: strategy.leverage,
        }
      );

      return {
        sharpe: safeNum(result?.sharpeRatio ?? result?.metrics?.sharpeRatio),
        winRate: safeNum(result?.winRate ?? result?.metrics?.winRate),
        maxDrawdown: safeNum(result?.maxDrawdown ?? result?.metrics?.maxDrawdownPercent),
      };
    } catch {
      // Fallback: return disqualifying metrics so strategy is retired
      return { sharpe: -1, winRate: 0, maxDrawdown: 1 };
    }
  }

  // ───────────────────────── parallel paper trading ─────────────────────────

  private async promoteToParallelPaper(strategy: StrategyRecord): Promise<void> {
    try {
      // Let the parallel runner manage the slot allocation
      await parallelStrategyRunner.addStrategy(strategy);
      await this.upsertStrategyPerformance(strategy);
      logger.info(`[SLE] Promoted to parallel paper: ${strategy.strategyId}`);
    } catch (err) {
      logger.error(`[SLE] Failed to promote ${strategy.strategyId} to paper:`, err);
    }
  }

  // ─────────────────────────── paper evaluation ─────────────────────────────

  private async evaluatePaperSessions(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(
      s => s.status === 'paper_trading'
    );

    for (const s of paperStrategies) {
      try {
        const metrics = await parallelStrategyRunner.getStrategyMetrics(s.strategyId);
        if (!metrics) continue;

        s.paperSharpe = safeNum(metrics.sharpe);
        s.paperWr = safeNum(metrics.winRate);
        s.paperPnl = safeNum(metrics.pnl);
        s.paperTrades = safeNum(metrics.trades);
        s.isCensored = metrics.isCensored ?? false;
        s.censorReason = metrics.censorReason ?? null;

        // Compute censoring-aware fitness divergence
        const allDataSharpe = s.paperSharpe;
        const uncensoredSharpe = metrics.uncensoredSharpe ?? s.paperSharpe;
        s.uncensoredSharpe = uncensoredSharpe;

        if (allDataSharpe !== 0) {
          const divergence = Math.abs(allDataSharpe - uncensoredSharpe) / Math.abs(allDataSharpe);
          s.fitnessDivergent = divergence > FITNESS_DIVERGENCE_THRESHOLD;
        }

        // Update equity curve for phase clock
        if (Array.isArray(metrics.equityCurve)) {
          s.equityCurve = metrics.equityCurve;
          s.lastEquitySlope = this.computeEquitySlope(metrics.equityCurve);
          s.phaseClock = this.advancePhaseClock(s);
        }

        await this.upsertStrategyPerformance(s);
      } catch (err) {
        logger.warn(`[SLE] Error evaluating paper session ${s.strategyId}:`, err);
      }
    }
  }

  /**
   * Phase clock: slope × duration.
   * Advances counter when slope is negative; resets when positive.
   */
  private advancePhaseClock(s: StrategyRecord): number {
    const slope = s.lastEquitySlope ?? 0;
    if (slope < 0) {
      return (s.phaseClock ?? 0) + 1;
    }
    return 0; // reset on positive slope
  }

  private computeEquitySlope(curve: number[]): number {
    if (curve.length < 2) return 0;
    const n = Math.min(curve.length, 10); // use last 10 points
    const recent = curve.slice(-n);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += recent[i];
      sumXY += i * recent[i];
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  // ─────────────────────────── kill underperformers ─────────────────────────

  private async killUnderperformers(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(
      s => s.status === 'paper_trading'
    );

    for (const s of paperStrategies) {
      let killReason: string | null = null;

      // Phase clock kill: persistent decay trajectory
      if ((s.phaseClock ?? 0) >= PHASE_CLOCK_KILL_CYCLES) {
        killReason = `phase_clock_${s.phaseClock}_negative_cycles`;
      }

      // Censored + divergent: strongest rejection
      if (s.fitnessDivergent && s.isCensored) {
        killReason = 'fitness_divergent_and_censored';
        s.status = 'censored_rejected';
      }
      // Fitness divergent alone: unreliable estimate, demote to killed
      else if (s.fitnessDivergent) {
        killReason = 'fitness_divergent_unreliable_estimate';
      }

      // Hard drawdown kill
      if (s.paperPnl !== null && s.paperTrades > 5) {
        const initialCapital = 1000; // virtual capital baseline
        const ddPct = Math.abs(Math.min(0, s.paperPnl)) / initialCapital;
        if (ddPct > 0.10) {
          killReason = `drawdown_${(ddPct * 100).toFixed(1)}pct`;
        }
      }

      if (killReason) {
        s.status = s.status === 'censored_rejected' ? 'censored_rejected' : 'killed';
        await parallelStrategyRunner.removeStrategy(s.strategyId, killReason);
        await this.upsertStrategyPerformance(s);
        logger.info(`[SLE] Killed strategy ${s.strategyId}: ${killReason}`);

        // Clone and mutate top performers to fill the empty slot
        await this.cloneTopPerformer(s.regimeAtCreation);
      }
    }
  }

  private async cloneTopPerformer(regime: MarketRegime): Promise<void> {
    try {
      const topParents = await this.loadBestPerformers(regime, 3);
      if (topParents.length === 0) return;
      const parent = topParents[Math.floor(Math.random() * topParents.length)];
      const clone = this.mutateStrategy(parent, regime);
      await this.upsertStrategyPerformance(clone);
      await parallelStrategyRunner.addStrategy(clone);
      logger.info(`[SLE] Cloned top performer ${parent.strategyId} → ${clone.strategyId}`);
    } catch (err) {
      logger.warn('[SLE] Clone top performer failed:', err);
    }
  }

  // ─────────────────────────── live recommendation ──────────────────────────

  private async promotePaperToRecommended(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(
      s => s.status === 'paper_trading' && !s.isCensored && !s.fitnessDivergent
    );

    for (const s of paperStrategies) {
      // Need minimum paper trade data
      if ((s.paperTrades ?? 0) < PAPER_THRESHOLDS.minTrades) continue;

      // Need minimum time in paper trading
      const daysSinceCreation = (Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation < PAPER_THRESHOLDS.minDays) continue;

      const paperSharpeOk = safeNum(s.paperSharpe) >= PAPER_THRESHOLDS.minSharpe;
      const paperPnlOk = safeNum(s.paperPnl) > PAPER_THRESHOLDS.minPnl;

      if (!paperSharpeOk || !paperPnlOk) continue;

      // Score confidence via confidenceScoringService
      try {
        const score = await (confidenceScoringService as any).calculateConfidenceScore(
          s.strategyId,
          s.symbol,
          s.timeframe
        );
        s.confidenceScore = safeNum(score?.score ?? score);

        if (s.confidenceScore >= PAPER_THRESHOLDS.minConfidence) {
          s.status = 'recommended';
          await this.upsertStrategyPerformance(s);
          this.emit('liveRecommendation', s);
          logger.info(
            `[SLE] 🎯 Strategy ${s.strategyId} RECOMMENDED for live: ` +
            `confidence=${s.confidenceScore.toFixed(1)} ` +
            `paperSharpe=${s.paperSharpe?.toFixed(2)} ` +
            `paperPnl=${s.paperPnl?.toFixed(4)}`
          );
        }
      } catch (err) {
        logger.warn(`[SLE] Confidence scoring failed for ${s.strategyId}:`, err);
      }
    }
  }

  /**
   * Confirm live promotion for a recommended strategy.
   * MUST be triggered by user one-click confirmation — never automatic.
   */
  async confirmLivePromotion(strategyId: string): Promise<StrategyRecord> {
    const s = this.strategies.get(strategyId);
    if (!s) {
      throw new Error(`Strategy ${strategyId} not found in active set`);
    }
    if (s.status !== 'recommended') {
      throw new Error(`Strategy ${strategyId} is not in 'recommended' status (current: ${s.status})`);
    }

    s.status = 'live';
    await this.upsertStrategyPerformance(s);
    this.emit('liveConfirmed', s);
    logger.info(`[SLE] User confirmed live promotion for ${strategyId}`);
    return s;
  }

  // ──────────────────────── generation weight update ────────────────────────

  private async updateGenerationWeights(): Promise<void> {
    // Reload top performers from DB to keep in-memory store current
    await this.loadActiveStrategies();
  }

  // ─────────────────────────── database helpers ─────────────────────────────

  async upsertStrategyPerformance(s: StrategyRecord): Promise<void> {
    try {
      // Update in-memory map
      this.strategies.set(s.strategyId, s);

      await query(
        `INSERT INTO strategy_performance (
          strategy_id, strategy_name, symbol, leverage, timeframe, strategy_type, regime_at_creation,
          backtest_sharpe, backtest_wr, backtest_max_dd,
          paper_sharpe, paper_wr, paper_pnl, paper_trades,
          live_sharpe, live_pnl, live_trades,
          is_censored, censor_reason, uncensored_sharpe, fitness_divergent,
          status, confidence_score, created_at, parent_strategy_id, generation, backtest_count, avg_return,
          signal_genome
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27, $28,
          $29
        )
        ON CONFLICT (strategy_id) DO UPDATE SET
          strategy_name       = EXCLUDED.strategy_name,
          symbol              = EXCLUDED.symbol,
          leverage            = EXCLUDED.leverage,
          timeframe           = EXCLUDED.timeframe,
          strategy_type       = EXCLUDED.strategy_type,
          regime_at_creation  = EXCLUDED.regime_at_creation,
          backtest_sharpe     = EXCLUDED.backtest_sharpe,
          backtest_wr         = EXCLUDED.backtest_wr,
          backtest_max_dd     = EXCLUDED.backtest_max_dd,
          paper_sharpe        = EXCLUDED.paper_sharpe,
          paper_wr            = EXCLUDED.paper_wr,
          paper_pnl           = EXCLUDED.paper_pnl,
          paper_trades        = EXCLUDED.paper_trades,
          live_sharpe         = EXCLUDED.live_sharpe,
          live_pnl            = EXCLUDED.live_pnl,
          live_trades         = EXCLUDED.live_trades,
          is_censored         = EXCLUDED.is_censored,
          censor_reason       = EXCLUDED.censor_reason,
          uncensored_sharpe   = EXCLUDED.uncensored_sharpe,
          fitness_divergent   = EXCLUDED.fitness_divergent,
          status              = EXCLUDED.status,
          confidence_score    = EXCLUDED.confidence_score,
          parent_strategy_id  = EXCLUDED.parent_strategy_id,
          generation          = EXCLUDED.generation,
          backtest_count      = EXCLUDED.backtest_count,
          avg_return          = EXCLUDED.avg_return,
          signal_genome       = EXCLUDED.signal_genome`,
        [
          s.strategyId, s.strategyId, s.symbol, s.leverage, s.timeframe, s.strategyType, s.regimeAtCreation,
          s.backtestSharpe, s.backtestWr, s.backtestMaxDd,
          s.paperSharpe, s.paperWr, s.paperPnl, s.paperTrades,
          s.liveSharpe, s.livePnl, s.liveTrades,
          s.isCensored, s.censorReason, s.uncensoredSharpe, s.fitnessDivergent,
          s.status, s.confidenceScore, s.createdAt, s.parentStrategyId, s.generation, s.backtestCount ?? 0, s.avgReturn ?? 0,
          s.genome ? JSON.stringify(s.genome) : null,
        ]
      );
    } catch (err) {
      logger.error(`[SLE] DB upsert failed for ${s.strategyId}:`, err);
    }
  }

  private async loadActiveStrategies(): Promise<void> {
    try {
      const result = await query(`
        SELECT * FROM strategy_performance
        WHERE status IN ('paper_trading', 'recommended', 'live')
        ORDER BY created_at DESC
        LIMIT 100
      `);
      for (const row of result.rows) {
        const s = this.rowToRecord(row as any);
        this.strategies.set(s.strategyId, s);
      }
      logger.info(`[SLE] Loaded ${result.rows.length} active strategies from DB`);
    } catch (err) {
      logger.warn('[SLE] Failed to load active strategies:', err);
    }
  }

  private async loadBestPerformers(regime: MarketRegime, limit = 10): Promise<StrategyRecord[]> {
    try {
      const result = await query(`
        SELECT * FROM strategy_performance
        WHERE is_censored = FALSE
          AND fitness_divergent = FALSE
          AND (regime_at_creation = $1 OR regime_at_creation = 'unknown')
          AND status NOT IN ('killed', 'retired', 'censored_rejected')
          AND paper_sharpe IS NOT NULL
        ORDER BY paper_sharpe DESC NULLS LAST
        LIMIT $2
      `, [regime, limit]);
      return result.rows.map(r => this.rowToRecord(r));
    } catch {
      return [];
    }
  }

  private rowToRecord(row: any): StrategyRecord {
    // Deserialize genome from DB JSONB column
    let genome: SignalGenome | null = null;
    if (row.signal_genome) {
      try {
        genome = typeof row.signal_genome === 'string'
          ? JSON.parse(row.signal_genome)
          : row.signal_genome;
      } catch {
        genome = null;
      }
    }

    return {
      strategyId: String(row.strategy_id),
      symbol: String(row.symbol),
      leverage: safeNum(row.leverage, 1),
      timeframe: String(row.timeframe),
      strategyType: String(row.strategy_type) as StrategyType,
      genome,
      regimeAtCreation: (String(row.regime_at_creation) || 'unknown') as MarketRegime,
      backtestSharpe: row.backtest_sharpe != null ? safeNum(row.backtest_sharpe) : null,
      backtestWr: row.backtest_wr != null ? safeNum(row.backtest_wr) : null,
      backtestMaxDd: row.backtest_max_dd != null ? safeNum(row.backtest_max_dd) : null,
      paperSharpe: row.paper_sharpe != null ? safeNum(row.paper_sharpe) : null,
      paperWr: row.paper_wr != null ? safeNum(row.paper_wr) : null,
      paperPnl: row.paper_pnl != null ? safeNum(row.paper_pnl) : null,
      paperTrades: safeNum(row.paper_trades, 0),
      liveSharpe: row.live_sharpe != null ? safeNum(row.live_sharpe) : null,
      livePnl: row.live_pnl != null ? safeNum(row.live_pnl) : null,
      liveTrades: safeNum(row.live_trades, 0),
      isCensored: Boolean(row.is_censored),
      censorReason: row.censor_reason != null ? String(row.censor_reason) : null,
      uncensoredSharpe: row.uncensored_sharpe != null ? safeNum(row.uncensored_sharpe) : null,
      fitnessDivergent: Boolean(row.fitness_divergent),
      status: String(row.status) as StrategyStatus,
      confidenceScore: row.confidence_score != null ? safeNum(row.confidence_score) : null,
      createdAt: new Date(String(row.created_at)),
      parentStrategyId: row.parent_strategy_id != null ? String(row.parent_strategy_id) : null,
      generation: safeNum(row.generation, 0),
      backtestCount: safeNum(row.backtest_count, 0),
      avgReturn: safeNum(row.avg_return, 0),
      equityCurve: [],
      lastEquitySlope: 0,
      phaseClock: 0,
    };
  }

  // ─────────────────────────── public query API ─────────────────────────────

  async getLiveRecommendations(): Promise<StrategyRecord[]> {
    try {
      const result = await query(`
        SELECT * FROM strategy_performance
        WHERE status = 'recommended'
        ORDER BY confidence_score DESC NULLS LAST
      `);
      return result.rows.map(r => this.rowToRecord(r));
    } catch {
      return [];
    }
  }

  async getTopPerformers(limit = 20): Promise<StrategyRecord[]> {
    try {
      const result = await query(`
        SELECT * FROM strategy_performance
        WHERE status NOT IN ('killed', 'retired', 'censored_rejected')
          AND is_censored = FALSE
          AND fitness_divergent = FALSE
        ORDER BY COALESCE(paper_sharpe, backtest_sharpe, -999) DESC
        LIMIT $1
      `, [limit]);
      return result.rows.map(r => this.rowToRecord(r));
    } catch {
      return [];
    }
  }

  async getEngineStatus() {
    return {
      isRunning: this.isRunning,
      generationCount: this.generationCount,
      activeStrategies: this.strategies.size,
      paperTrading: Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading').length,
      recommended: Array.from(this.strategies.values()).filter(s => s.status === 'recommended').length,
      live: Array.from(this.strategies.values()).filter(s => s.status === 'live').length,
    };
  }
}

// Export singleton
export const strategyLearningEngine = new StrategyLearningEngine();
export default strategyLearningEngine;
