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
 *
 * QIG Frozen Laws Integration (2026-03-31):
 *  - Law 1 (Constitutive): fitness = sharpe × regimeWeight(κ)
 *  - Law 4 (Anderson): binary regime switching when κ crosses thresholds
 *  - Law 5 (Bridge): convergence budget scales backtest window
 *  - Law 6 (Convergence): fixed compute above coupling threshold
 *  - EXP-013: geometric fragility (fidelity-R² decoupling) as leading indicator
 *  - C3 Figure-8: dual-framing (forward + backward) genome evaluation
 *  - Anderson early exit: 40% fewer evaluations at same accuracy
 */

import { EventEmitter } from 'events';
import { pool, query } from '../db/connection.js';
import { getEngineVersion } from '../utils/engineVersion.js';
import { logger } from '../utils/logger.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import backtestingEngine from './backtestingEngine.js';
import confidenceScoringService from './confidenceScoringService.js';
import { monitoringService } from './monitoringService.js';
import parallelStrategyRunner from './parallelStrategyRunner.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import {
  computeQIGFitness,
  detectRegimeTransition,
  type QIGFitnessResult,
} from './qig/qigFitnessFunction.js';
import {
  classifyRegime,
  constitutiveR2,
  estimateKappa,
  geometricFragility,
  priceAutocorrelation,
  shouldResetStrategies,
  type QIGRegime,
} from './qig/qigFrozenLaws.js';
import {
  SignalGenome,
  crossoverGenomes,
  generateRandomGenome,
  inferStrategyType,
  mutateGenome,
} from './signalGenome.js';
import {
  ALL_STRATEGY_CLASSES,
  DEFAULT_BANDIT_COUNTER,
  sampleBestClass,
  type BanditCounter,
  type StrategyClass,
} from './thompsonBandit.js';
import {
  evaluateBacktestGate,
  evaluatePaperGate,
  type BacktestMetrics as BacktestGateMetrics,
  type PaperStats,
} from './promotionGates.js';
import {
  evaluateRollingDrawdownDemotion,
  type TradeOutcome,
} from './demotionPolicy.js';
import {
  ANCHOR_STRATEGIES,
  getAnchorsForRegime,
  type AnchorStrategyDef,
} from './anchorStrategies.js';

export type StrategyStatusTransitionReason =
  | 'created'
  | 'backtest_passed'
  | 'backtest_failed'
  | 'promoted_paper'
  | 'promoted_live'
  | 'demoted_recalibrating'
  | 'retired_oscillation'
  | 'retired_recalibration_limit'
  | 'killed_phase_clock'
  | 'killed_drawdown'
  | 'killed_fitness_divergent'
  | 'killed_anderson_reset'
  | string;

export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'unknown';
export type StrategyType = 'momentum' | 'mean_reversion' | 'breakout' | 'trend_following' | 'scalping';
export type StrategyStatus =
  | 'backtesting'
  | 'paper_trading'
  | 'recalibrating'
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
  avgSharpeRatio: number;
  equityCurve?: number[];
  lastEquitySlope?: number;
  phaseClock?: number;
}

const BRIDGE_LAW_EXPONENT = 0.74;
const DEFAULT_STRATEGY_LOOKBACK = 50;
const SUPPORTED_TF_MINUTES: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
// BACKTEST_THRESHOLDS — DELETED. Backtest promotion now runs through
// evaluateBacktestGate in promotionGates.ts with multi-metric cross-
// checking (Sharpe, Sortino, Calmar, PF, DD) + OOS window.
/** Minimum capital floor for drawdown calculations — prevents tiny balances from false-killing strategies */
const MIN_CAPITAL_FLOOR = 27;
// PAPER_THRESHOLDS — DELETED. Paper → live promotion now runs through
// evaluatePaperGate in promotionGates.ts. Confidence score is retained
// as a secondary gate below (PAPER_MIN_CONFIDENCE).
const PAPER_MIN_CONFIDENCE = 60;
const FITNESS_DIVERGENCE_THRESHOLD = 0.20;
const QIG_FRAGILITY_WARNING_THRESHOLD = 0.6;
const PHASE_CLOCK_KILL_CYCLES = 5;
// Dropped from 30 min → 5 min per user directive ("why so infrequent").
// The SLE is now secondary (sandbox for genome experimentation); live
// trading runs through liveSignalEngine at 60s cadence. Keep a 5-min
// backstop here so genome exploration still advances between live-
// signal ticks if the user wants to switch back.
const LOOP_INTERVAL_MS = 5 * 60 * 1000;

export function bridgeLawWeight(tfMinutes: number): number {
  return Math.pow(60 / tfMinutes, BRIDGE_LAW_EXPONENT);
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumeric64(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(-99.9999, Math.min(99.9999, v));
}

class StrategyLearningEngine extends EventEmitter {
  private isRunning = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private generationCount = 0;
  private lastKnownRegime: MarketRegime = 'unknown';
  private strategies: Map<string, StrategyRecord> = new Map();
  private previousKappa = 0;
  private lastQIGRegime: QIGRegime = 'geometric';
  private cachedBalance: number = 0;
  private lastBalanceFetchTime = 0;

  constructor() { super(); }

  async start(): Promise<void> {
    if (this.isRunning) { logger.warn('[SLE] Already running'); return; }
    this.isRunning = true;
    logger.info('[SLE] Starting strategy learning engine');
    // Schema defaults are now handled by migration 023_sle_schema_defaults.sql
    await this.loadActiveStrategies();
    this.scheduleNextCycle(0);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    logger.info('[SLE] Strategy learning engine stopped');
  }

  private scheduleNextCycle(delayMs: number): void {
    if (!this.isRunning) return;
    this.loopTimer = setTimeout(async () => {
      try { await this.runOneCycle(); } catch (err) { logger.error('[SLE] Cycle error:', err); }
      finally { this.scheduleNextCycle(LOOP_INTERVAL_MS); }
    }, delayMs);
  }

  private async fetchActualBalance(): Promise<number> {
    const now = Date.now();
    if (this.cachedBalance > 0 && now - this.lastBalanceFetchTime < 10 * 60 * 1000) {
      return this.cachedBalance;
    }
    try {
      const result = await pool.query(
        `SELECT user_id FROM api_credentials WHERE is_active = true LIMIT 1`
      );
      if (result.rows.length === 0) return this.cachedBalance || MIN_CAPITAL_FLOOR;
      const userId = result.rows[0].user_id;
      const credentials = await apiCredentialsService.getCredentials(userId);
      if (!credentials) return this.cachedBalance || MIN_CAPITAL_FLOOR;
      const balance = await poloniexFuturesService.getAccountBalance(credentials);
      const avail = parseFloat(balance?.availMgn ?? balance?.eq ?? '0');
      if (avail > 0) {
        this.cachedBalance = avail;
        this.lastBalanceFetchTime = now;
        logger.info(`[SLE] Fetched actual balance: $${avail.toFixed(2)} USDT`);
      }
      return this.cachedBalance || MIN_CAPITAL_FLOOR;
    } catch (err) {
      logger.warn('[SLE] Failed to fetch balance, using cached:', err instanceof Error ? err.message : String(err));
      return this.cachedBalance || MIN_CAPITAL_FLOOR;
    }
  }

  private async runOneCycle(): Promise<void> {
    this.generationCount++;
    logger.info(`[SLE] === Generation ${this.generationCount} ===`);
    monitoringService.recordPipelineHeartbeat('generator');
    await this.fetchActualBalance();
    parallelStrategyRunner.setBaseCapital(this.cachedBalance);
    const regime = await this.detectCurrentRegime();
    await this.checkQIGRegimeTransition();
    const newStrategies = await this.generateVariants(regime);
    monitoringService.recordPipelineHeartbeat('backtest');
    const backtestPassed = await this.backtestVariants(newStrategies);
    // Record generation outcome for the backtest-stall alert. Closes
    // the Option-C blind spot: consecutive zero-pass generations must
    // page even when no paper strategies exist yet.
    monitoringService.recordGenerationOutcome(backtestPassed.length, newStrategies.length);
    for (const s of backtestPassed) { await this.promoteToParallelPaper(s); }
    await this.evaluatePaperSessions();
    await this.killUnderperformers();
    await this.promotePaperToRecommended();
    await this.updateGenerationWeights();
    const paperCount = Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading').length;
    const recCount = Array.from(this.strategies.values()).filter(s => s.status === 'recommended').length;
    this.emit('cycleComplete', { generation: this.generationCount, regime });
    logger.info(`[SLE] Generation ${this.generationCount} complete — regime=${regime}, generated=${newStrategies.length}, backtest_pass=${backtestPassed.length}, paper=${paperCount}, recommended=${recCount}`);
  }

  private async checkQIGRegimeTransition(): Promise<void> {
    try {
      const result = await query(`SELECT sharpe_ratio FROM backtest_results WHERE created_at > NOW() - INTERVAL '48 hours' AND sharpe_ratio IS NOT NULL ORDER BY created_at DESC LIMIT 100`);
      if (!result.rows || result.rows.length < 20) return;
      const returns = result.rows.map((r: any) => safeNum(r.sharpe_ratio));
      const currentKappa = estimateKappa(returns);
      const currentRegime = classifyRegime(currentKappa);
      const systemSize = this.strategies.size;
      const transition = detectRegimeTransition(this.previousKappa, currentKappa, systemSize);
      if (transition.transitioned) {
        logger.info(`[SLE] QIG regime transition: ${transition.fromRegime} \u2192 ${transition.toRegime} (\u03ba: ${this.previousKappa.toFixed(3)} \u2192 ${currentKappa.toFixed(3)}, overlap: ${(transition.overlap * 100).toFixed(1)}%)`);
        if (shouldResetStrategies(systemSize)) {
          logger.info(`[SLE] Anderson orthogonality: overlap=${(transition.overlap * 100).toFixed(1)}% < 10% threshold \u2014 killing all active strategies and regenerating`);
          await this.andersonResetStrategies(currentRegime);
        }
        this.emit('regimeTransition', { from: transition.fromRegime, to: transition.toRegime, kappa: currentKappa, overlap: transition.overlap });
      }
      const r2 = constitutiveR2(returns);
      const fidelity = priceAutocorrelation(returns);
      const fragility = geometricFragility(fidelity, r2);
      if (fragility > QIG_FRAGILITY_WARNING_THRESHOLD) {
        logger.warn(`[SLE] QIG geometric fragility HIGH: ${fragility.toFixed(3)} (fidelity=${fidelity.toFixed(3)}, R\u00b2=${r2.toFixed(3)}) \u2014 regime change imminent`);
      }
      this.previousKappa = currentKappa;
      this.lastQIGRegime = currentRegime;
    } catch (err) { logger.debug('[SLE] QIG regime transition check skipped:', err); }
  }

  private async andersonResetStrategies(newRegime: QIGRegime): Promise<void> {
    const active = Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading' || s.status === 'backtesting');
    for (const s of active) {
      const fromStatus = s.status;
      s.status = 'killed'; s.censorReason = `anderson_regime_reset_${newRegime}`;
      try {
        await parallelStrategyRunner.removeStrategy(s.strategyId, s.censorReason);
        await this.upsertStrategyPerformance(s);
        await this.recordStrategyStateEvent(
          s.strategyId,
          fromStatus,
          'killed',
          'killed_anderson_reset',
          { newRegime, previousRegime: s.regimeAtCreation },
          `anderson_regime_reset_${newRegime}`,
        );
      } catch (err) { logger.debug(`[SLE] Anderson reset: failed to kill ${s.strategyId}:`, err); }
    }
    logger.info(`[SLE] Anderson reset complete: killed ${active.length} strategies, new regime: ${newRegime}`);
  }

  async detectCurrentRegime(): Promise<MarketRegime> {
    try {
      const result = await query(`SELECT AVG(sharpe_ratio) AS avg_sharpe, STDDEV(sharpe_ratio) AS std_sharpe, AVG(max_drawdown_percent) AS avg_dd, COUNT(*) AS cnt FROM backtest_results WHERE created_at > NOW() - INTERVAL '24 hours' AND sharpe_ratio IS NOT NULL`);
      if (!result.rows.length) return this.lastKnownRegime;
      const row0 = result.rows[0] as any;
      if (safeNum(row0.cnt) < 3) return this.lastKnownRegime;
      const avgSharpe = safeNum(row0.avg_sharpe), stdSharpe = safeNum(row0.std_sharpe), avgDd = safeNum(row0.avg_dd);
      let detected: MarketRegime;
      if (avgSharpe > 1.2 && avgDd < 0.08) detected = 'trending';
      else if (stdSharpe > 1.5 || avgDd > 0.15) detected = 'volatile';
      else detected = 'ranging';
      this.lastKnownRegime = detected;
      return detected;
    } catch (err) { logger.warn('[SLE] Regime detection failed:', err); return this.lastKnownRegime; }
  }

  /**
   * Hard-cut variant generation: Thompson bandit picks the preferred
   * strategy class for this regime; parents for crossover/mutate are
   * drawn from loadBestPerformers filtered to that class when possible.
   * Cold start (Beta(1,1) uniform prior with zero history) naturally
   * collapses to uniform class sampling — the generator still produces
   * 6 variants per cycle so there's no dead zone.
   *
   * Additionally, ANCHOR STRATEGIES (hand-crafted seeds in
   * anchorStrategies.ts) are always injected when their affine regime
   * matches and they're not already active. Anchors solve the cold-
   * start problem: without real winners the bandit has nothing to
   * bias toward, and the random-genome generator produces Sharpe ≈ 0
   * strategies. Anchors are tuned classical patterns that should
   * produce > 10 trades with positive expectancy on crypto 15m/1h
   * data, giving the bandit a real winning distribution to warp
   * toward.
   *
   * Old elitism-on-paper_sharpe-DESC is gone. No 30% fallback — the
   * bandit is the whole story.
   */
  private async generateVariants(regime: MarketRegime): Promise<StrategyRecord[]> {
    const symbols = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP', 'XRP_USDT_PERP'];
    const banditCounters = await this.loadBanditCountersForRegime(regime);
    const allParents = await this.loadBestPerformers(regime, 20);
    const variants: StrategyRecord[] = [];

    // Inject anchor strategies first — they're the cold-start cure.
    // An anchor is re-queued whenever it's NOT currently already
    // somewhere in the pipeline. The "active" filter includes
    // recalibrating too: those are being re-tested by their own
    // recalibration path, so re-injecting them would cause a double-
    // backtest in the same cycle. We only re-queue anchors whose
    // lifecycle has ended (killed / retired / absent).
    const activeStatuses: StrategyStatus[] = [
      'backtesting',
      'paper_trading',
      'recalibrating',
      'recommended',
      'live',
    ];
    const activeIds = new Set(
      Array.from(this.strategies.values())
        .filter((s) => activeStatuses.includes(s.status))
        .map((s) => s.strategyId),
    );
    // Cap anchors at the total batch size (6). If the anchor list ever
    // grows beyond 6, the generator stops being a "6 variants per cycle"
    // system, which would break the budgeting assumptions in
    // parallelStrategyRunner and in the backtest-stall alert math.
    const ANCHORS_PER_CYCLE_CAP = 6;
    const anchorsToInject = getAnchorsForRegime(regime)
      .filter((a) => !activeIds.has(a.id))
      .slice(0, ANCHORS_PER_CYCLE_CAP);
    for (const anchor of anchorsToInject) {
      variants.push(this.anchorToStrategyRecord(anchor, regime));
    }

    // Top-up the cycle with evolved variants so total is 6.
    const evolvedCount = Math.max(0, 6 - variants.length);
    for (let i = 0; i < evolvedCount; i++) {
      // Sample the preferred class for this variant (Thompson draw —
      // independent draws across the 6 variants give natural diversity
      // while still biasing toward winning classes).
      const preferredClass = sampleBestClass(banditCounters);
      const classParents = allParents.filter(
        (p) => (p.strategyType as StrategyClass) === preferredClass,
      );

      let s: StrategyRecord;
      if (classParents.length >= 2 && Math.random() < 0.6) {
        const p1 = classParents[Math.floor(Math.random() * classParents.length)];
        const others = classParents.filter((p) => p.strategyId !== p1.strategyId);
        s = others.length > 0
          ? this.crossoverStrategies(p1, others[Math.floor(Math.random() * others.length)], regime)
          : this.mutateStrategy(p1, regime);
      } else if (classParents.length > 0 && Math.random() < 0.5) {
        s = this.mutateStrategy(
          classParents[Math.floor(Math.random() * classParents.length)],
          regime,
        );
      } else {
        // Cold start for this class, or chosen not to mutate: generate
        // a fresh genome nudged toward the preferred class.
        s = this.generateRandom(symbols, regime, preferredClass);
      }
      variants.push(s);
    }
    logger.info(`[SLE] Generated ${variants.length} variants for regime '${regime}'`);
    return variants;
  }

  /**
   * Convert an AnchorStrategyDef into a StrategyRecord that the
   * backtest pipeline can consume. Uses the anchor's stable ID (not
   * a generated one) so the same anchor can be re-tested each cycle
   * without creating duplicate DB rows.
   */
  private anchorToStrategyRecord(
    anchor: AnchorStrategyDef,
    regime: MarketRegime,
  ): StrategyRecord {
    return {
      strategyId: anchor.id,
      symbol: anchor.symbol,
      leverage: anchor.leverage,
      timeframe: anchor.timeframe,
      strategyType: anchor.strategyType,
      genome: anchor.genome,
      regimeAtCreation: regime,
      backtestSharpe: null, backtestWr: null, backtestMaxDd: null,
      paperSharpe: null, paperWr: null, paperPnl: null, paperTrades: 0,
      liveSharpe: null, livePnl: null, liveTrades: 0,
      isCensored: false, censorReason: null, uncensoredSharpe: null, fitnessDivergent: false,
      status: 'backtesting', confidenceScore: null, createdAt: new Date(),
      parentStrategyId: null, generation: this.generationCount,
      backtestCount: 0, avgReturn: 0, avgSharpeRatio: 0,
      equityCurve: [], lastEquitySlope: 0, phaseClock: 0,
    };
  }

  /**
   * Generate a new-from-scratch strategy. When `preferredClass` is
   * provided (from the Thompson bandit), the genome is regenerated
   * until inferStrategyType matches — up to 5 attempts before we
   * accept whatever class the random genome suggests. This avoids
   * biasing too hard when the bandit's pick is unachievable on
   * current indicators.
   */
  private generateRandom(
    symbols: string[],
    regime: MarketRegime,
    preferredClass?: StrategyClass,
  ): StrategyRecord {
    const id = `sle_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const tfKeys = Object.keys(SUPPORTED_TF_MINUTES);

    let genome = generateRandomGenome();
    if (preferredClass) {
      for (let attempt = 0; attempt < 5; attempt++) {
        if ((inferStrategyType(genome) as StrategyClass) === preferredClass) break;
        genome = generateRandomGenome();
      }
    }

    return {
      strategyId: id, symbol,
      // Leverage is chosen by strategy; the risk kernel enforces the
      // per-symbol exchange maximum at order-submit time.
      leverage: [1, 2, 3, 5, 10][Math.floor(Math.random() * 5)],
      timeframe: tfKeys[Math.floor(Math.random() * tfKeys.length)],
      strategyType: inferStrategyType(genome) as StrategyType, genome, regimeAtCreation: regime,
      backtestSharpe: null, backtestWr: null, backtestMaxDd: null,
      paperSharpe: null, paperWr: null, paperPnl: null, paperTrades: 0,
      liveSharpe: null, livePnl: null, liveTrades: 0,
      isCensored: false, censorReason: null, uncensoredSharpe: null, fitnessDivergent: false,
      status: 'backtesting', confidenceScore: null, createdAt: new Date(),
      parentStrategyId: null, generation: this.generationCount, backtestCount: 0, avgReturn: 0, avgSharpeRatio: 0,
      equityCurve: [], lastEquitySlope: 0, phaseClock: 0,
    };
  }

  private crossoverStrategies(p1: StrategyRecord, p2: StrategyRecord, regime: MarketRegime): StrategyRecord {
    const id = `cross_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const g1 = p1.genome ?? generateRandomGenome();
    const g2 = p2.genome ?? generateRandomGenome();
    const childGenome = crossoverGenomes(g1, g2);
    return { ...this.generateRandom([p1.symbol, p2.symbol], regime), strategyId: id, symbol: Math.random() < 0.5 ? p1.symbol : p2.symbol, strategyType: inferStrategyType(childGenome) as StrategyType, genome: childGenome, timeframe: Math.random() < 0.5 ? p1.timeframe : p2.timeframe, leverage: Math.round((p1.leverage + p2.leverage) / 2), parentStrategyId: p1.strategyId, regimeAtCreation: regime };
  }

  private mutateStrategy(parent: StrategyRecord, regime: MarketRegime): StrategyRecord {
    const id = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const tfKeys = Object.keys(SUPPORTED_TF_MINUTES);
    const childGenome = mutateGenome(parent.genome ?? generateRandomGenome());
    return { ...parent, strategyId: id, parentStrategyId: parent.strategyId, regimeAtCreation: regime, createdAt: new Date(), generation: this.generationCount, status: 'backtesting', backtestSharpe: null, backtestWr: null, backtestMaxDd: null, paperSharpe: null, paperWr: null, paperPnl: null, paperTrades: 0, liveSharpe: null, livePnl: null, liveTrades: 0, isCensored: false, censorReason: null, uncensoredSharpe: null, fitnessDivergent: false, confidenceScore: null, backtestCount: 0, avgReturn: 0, avgSharpeRatio: 0, equityCurve: [], lastEquitySlope: 0, phaseClock: 0, genome: childGenome, strategyType: inferStrategyType(childGenome) as StrategyType, timeframe: Math.random() < 0.15 ? tfKeys[Math.floor(Math.random() * tfKeys.length)] : parent.timeframe, leverage: Math.max(1, parent.leverage + (Math.random() < 0.3 ? (Math.random() < 0.5 ? 1 : -1) : 0)) };
  }

  computeMultiTimeframeWeight(timeframes: string[]): Record<string, number> {
    const weights: Record<string, number> = {}; let total = 0;
    for (const tf of timeframes) { const m = SUPPORTED_TF_MINUTES[tf] ?? 60; weights[tf] = bridgeLawWeight(m); total += weights[tf]; }
    for (const tf of timeframes) { weights[tf] /= total; }
    return weights;
  }

  private async backtestVariants(strategies: StrategyRecord[]): Promise<StrategyRecord[]> {
    const passed: StrategyRecord[] = [];
    for (const s of strategies) {
      try {
        const { inSample, outOfSample } = await this.runBacktestWithWalkForward(s);
        s.backtestCount = (s.backtestCount ?? 0) + 1;
        // Persist OOS metrics to strategy_performance (they're the more
        // honest signal — IS is what we tuned on, OOS is what we'll face).
        s.backtestSharpe = outOfSample.sharpe;
        s.backtestWr = 0; // winRate not exposed through gate; kept as 0 for back-compat
        s.backtestMaxDd = outOfSample.maxDrawdown;

        // Hard-cut: multi-metric gate + QIG dual-framing. Old
        // BACKTEST_THRESHOLDS constants are gone.
        const gate = evaluateBacktestGate(inSample, { profitFactor: outOfSample.profitFactor });
        const qigResult = this.evaluateWithQIGFitness({
          sharpe: inSample.sharpe,
          winRate: 0.5,
          maxDrawdown: inSample.maxDrawdown,
        });
        const qigPass = qigResult ? qigResult.dualFramingPass : true;
        const passes = gate.allowed && qigPass;

        if (passes) {
          s.status = 'paper_trading';
          passed.push(s);
          logger.info(
            `[SLE] Backtest PASS: ${s.strategyId} sharpe=${inSample.sharpe.toFixed(2)} pf=${inSample.profitFactor.toFixed(2)} trades=${inSample.totalTrades}`,
          );
          await this.recordStrategyStateEvent(
            s.strategyId,
            'backtesting',
            'paper_trading',
            'backtest_passed',
            {
              inSample: { sharpe: inSample.sharpe, sortino: inSample.sortino, calmar: inSample.calmar, profitFactor: inSample.profitFactor, trades: inSample.totalTrades, maxDD: inSample.maxDrawdown },
              outOfSample: { profitFactor: outOfSample.profitFactor, trades: outOfSample.totalTrades },
            },
          );
        } else {
          s.status = 'retired';
          logger.info(
            `[SLE] Backtest FAIL: ${s.strategyId} — ${gate.reason ?? (qigPass ? 'unknown' : 'qig_framing')}`,
          );
          await this.recordStrategyStateEvent(
            s.strategyId,
            'backtesting',
            'retired',
            'backtest_failed',
            {
              failingMetrics: gate.failingMetrics ?? [],
              qigDualFramingPass: qigPass,
            },
          );
        }
        await this.upsertStrategyPerformance(s);
      } catch (err) {
        logger.warn(`[SLE] Backtest error for ${s.strategyId}:`, err);
      }
    }
    return passed;
  }

  private evaluateWithQIGFitness(metrics: { sharpe: number; winRate: number; maxDrawdown: number }): QIGFitnessResult | null {
    try {
      const recent = Array.from(this.strategies.values()).filter(s => s.backtestSharpe != null).map(s => safeNum(s.backtestSharpe));
      if (recent.length < 20) return null;
      return computeQIGFitness({ sharpe: metrics.sharpe, winRate: metrics.winRate, maxDrawdown: metrics.maxDrawdown }, recent);
    } catch { return null; }
  }

  /**
   * Runs the strategy on two disjoint windows — in-sample (first 70%)
   * and out-of-sample (last 30%) — and returns the full metric set
   * needed by evaluateBacktestGate. This is the hard-cut replacement
   * for the old single-window backtest: the multi-metric gate requires
   * an untouched OOS holdout to guard against overfit / survivorship.
   */
  private async runBacktestWithWalkForward(strategy: StrategyRecord): Promise<{
    inSample: BacktestGateMetrics;
    outOfSample: BacktestGateMetrics;
  }> {
    const tfMinutes = SUPPORTED_TF_MINUTES[strategy.timeframe] ?? 60;
    const minOOSDays = Math.max(9, Math.ceil((100 * tfMinutes) / (24 * 60)));
    const cappedTotalDays = Math.min(Math.ceil(minOOSDays / 0.3), 90);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - cappedTotalDays * 24 * 60 * 60 * 1000);
    const splitDate = new Date(startDate.getTime() + cappedTotalDays * 0.7 * 24 * 60 * 60 * 1000);

    const runWindow = async (from: Date, to: Date): Promise<BacktestGateMetrics> => {
      const strategyDef: Record<string, any> = {
        type: strategy.strategyType,
        parameters: {},
        lookback: DEFAULT_STRATEGY_LOOKBACK,
      };
      if (strategy.genome) strategyDef.genome = strategy.genome;
      (backtestingEngine as any).registerStrategy(strategy.strategyId, strategyDef);
      const r = await (backtestingEngine as any).runBacktest(strategy.strategyId, {
        symbol: strategy.symbol,
        timeframe: strategy.timeframe,
        startDate: from,
        endDate: to,
        leverage: strategy.leverage,
        initialCapital: this.cachedBalance || MIN_CAPITAL_FLOOR,
      });
      const m = r?.metrics ?? r ?? {};
      return {
        totalTrades: safeNum(m.totalTrades),
        sharpe: safeNum(m.sharpeRatio ?? r?.sharpeRatio),
        sortino: safeNum(m.sortinoRatio),
        calmar: safeNum(m.calmarRatio),
        profitFactor: safeNum(m.profitFactor),
        maxDrawdown: safeNum(m.maxDrawdownPercent ?? r?.maxDrawdown) / 100,
      };
    };

    try {
      // Sequential, not Promise.all — the backtesting engine keeps
      // mutable per-strategy state keyed by strategyId
      // (currentBacktest, _prevIndicatorMaps, etc.). Concurrent windows
      // on the same ID would race and cross-contaminate the metrics.
      const inSample = await runWindow(startDate, splitDate);
      const outOfSample = await runWindow(splitDate, endDate);
      return { inSample, outOfSample };
    } catch (err) {
      logger.warn(
        `[SLE] Backtest failed for ${strategy.strategyId}:`,
        err instanceof Error ? err.message : String(err),
      );
      const failed: BacktestGateMetrics = {
        totalTrades: 0, sharpe: -1, sortino: -1, calmar: -1, profitFactor: 0, maxDrawdown: 1,
      };
      return { inSample: failed, outOfSample: failed };
    }
  }

  private async promoteToParallelPaper(strategy: StrategyRecord): Promise<void> {
    try { await parallelStrategyRunner.addStrategy(strategy); await this.upsertStrategyPerformance(strategy); logger.info(`[SLE] Promoted to parallel paper: ${strategy.strategyId}`); }
    catch (err) { logger.error(`[SLE] Failed to promote ${strategy.strategyId} to paper:`, err); }
  }

  private async evaluatePaperSessions(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading');
    for (const s of paperStrategies) {
      try {
        const metrics = await parallelStrategyRunner.getStrategyMetrics(s.strategyId);
        if (!metrics) continue;
        s.paperSharpe = safeNum(metrics.sharpe); s.paperWr = safeNum(metrics.winRate); s.paperPnl = safeNum(metrics.pnl); s.paperTrades = safeNum(metrics.trades);
        s.isCensored = metrics.isCensored ?? false; s.censorReason = metrics.censorReason ?? null;
        const allDataSharpe = s.paperSharpe;
        const uncensoredSharpe = metrics.uncensoredSharpe ?? s.paperSharpe;
        s.uncensoredSharpe = uncensoredSharpe;
        if (allDataSharpe !== 0) { const divergence = Math.abs(allDataSharpe - uncensoredSharpe) / Math.abs(allDataSharpe); s.fitnessDivergent = divergence > FITNESS_DIVERGENCE_THRESHOLD; }
        if (Array.isArray(metrics.equityCurve)) { s.equityCurve = metrics.equityCurve; s.lastEquitySlope = this.computeEquitySlope(metrics.equityCurve); s.phaseClock = this.advancePhaseClock(s); }
        await this.upsertStrategyPerformance(s);
      } catch (err) { logger.warn(`[SLE] Error evaluating paper session ${s.strategyId}:`, err); }
    }
  }

  private advancePhaseClock(s: StrategyRecord): number { return (s.lastEquitySlope ?? 0) < 0 ? (s.phaseClock ?? 0) + 1 : 0; }

  private computeEquitySlope(curve: number[]): number {
    if (curve.length < 2) return 0;
    const n = Math.min(curve.length, 10); const recent = curve.slice(-n);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) { sumX += i; sumY += recent[i]; sumXY += i * recent[i]; sumX2 += i * i; }
    const denom = n * sumX2 - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  }

  /**
   * Per-cycle sweep that either demotes a strategy to `recalibrating`
   * (recoverable — keeps the genome, re-enters backtest next cycle)
   * or kills it outright (phase-clock runaway, fitness-divergence).
   *
   * Hard-cut from the old "if paperPnl/capital < -10% → kill" branch:
   * drawdown no longer kills, it demotes. User spec: "in 5 or less
   * trades loses 10% → reverts back down." The rolling window is
   * evaluated via demotionPolicy.evaluateRollingDrawdownDemotion.
   */
  private async killUnderperformers(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(
      (s) => s.status === 'paper_trading',
    );
    for (const s of paperStrategies) {
      // 1. Hard-kill criteria (phase-clock runaway, fitness-divergence).
      //    These indicate the strategy is fundamentally broken, not just
      //    temporarily underperforming — recalibration won't help.
      let killReason: string | null = null;
      if ((s.phaseClock ?? 0) >= PHASE_CLOCK_KILL_CYCLES) {
        killReason = `phase_clock_${s.phaseClock}_negative_cycles`;
      }
      if (s.fitnessDivergent && s.isCensored) {
        killReason = 'fitness_divergent_and_censored';
        s.status = 'censored_rejected';
      } else if (s.fitnessDivergent) {
        killReason = 'fitness_divergent_unreliable_estimate';
      }

      if (killReason) {
        const fromStatus = 'paper_trading';
        s.status = s.status === 'censored_rejected' ? 'censored_rejected' : 'killed';
        await parallelStrategyRunner.removeStrategy(s.strategyId, killReason);
        await this.upsertStrategyPerformance(s);
        await this.recordStrategyStateEvent(
          s.strategyId,
          fromStatus,
          s.status,
          killReason.startsWith('phase_clock') ? 'killed_phase_clock' : 'killed_fitness_divergent',
          {
            phaseClock: s.phaseClock,
            paperPnl: s.paperPnl,
            paperTrades: s.paperTrades,
            isCensored: s.isCensored,
            fitnessDivergent: s.fitnessDivergent,
          },
          killReason,
        );
        logger.info(`[SLE] Killed strategy ${s.strategyId}: ${killReason}`);
        continue;
      }

      // 2. Rolling-drawdown demotion to 'recalibrating'. Preserves genome
      //    so the next cycle's backtest can re-evaluate. Strategies that
      //    recover bounce back to paper; strategies that bounce and lose
      //    repeatedly hit the 3-demotions-in-30-days retirement.
      const recentTrades = await this.loadRecentTradeOutcomes(s.strategyId);
      const demotion = evaluateRollingDrawdownDemotion(recentTrades);
      if (demotion.demote) {
        const fromStatus = 'paper_trading';
        s.status = 'recalibrating';
        await parallelStrategyRunner.removeStrategy(s.strategyId, demotion.reason ?? 'demoted');
        await this.upsertStrategyPerformance(s);
        await this.recordStrategyStateEvent(
          s.strategyId,
          fromStatus,
          'recalibrating',
          'demoted_recalibrating',
          {
            triggeringDrawdownPct: demotion.triggeringDrawdownPct,
            recentTradeCount: recentTrades.length,
          },
          demotion.reason,
        );
        logger.info(
          `[SLE] Demoted strategy ${s.strategyId} → recalibrating: ${demotion.reason}`,
        );
      }
    }
  }

  /**
   * Fetch the strategy's most-recent trade outcomes for the rolling-
   * drawdown check. Returns an empty array if unavailable — the
   * demotion policy treats "not enough data" as "don't demote."
   */
  private async loadRecentTradeOutcomes(
    strategyId: string,
    limit = 10,
  ): Promise<TradeOutcome[]> {
    try {
      const result = await query(
        `SELECT realised_pnl, margin_committed
           FROM paper_trading_positions
          WHERE strategy_name = $1 AND status = 'closed'
          ORDER BY closed_at DESC
          LIMIT $2`,
        [strategyId, limit],
      );
      return ((result.rows as any[]) ?? []).map((r) => ({
        realisedPnl: safeNum(r.realised_pnl),
        marginCommitted: Math.max(0.0001, safeNum(r.margin_committed, 1)),
      })).reverse(); // oldest first so rolling window sees trailing trades
    } catch (err) {
      logger.debug('[SLE] loadRecentTradeOutcomes failed (fail-soft):', err);
      return [];
    }
  }

  private async cloneTopPerformer(regime: MarketRegime): Promise<void> {
    try { const top = await this.loadBestPerformers(regime, 3); if (top.length === 0) return; const parent = top[Math.floor(Math.random() * top.length)]; const clone = this.mutateStrategy(parent, regime); await this.upsertStrategyPerformance(clone); await parallelStrategyRunner.addStrategy(clone); logger.info(`[SLE] Cloned top performer ${parent.strategyId} \u2192 ${clone.strategyId}`); }
    catch (err) { logger.warn('[SLE] Clone top performer failed:', err); }
  }

  /**
   * Paper → recommended (live-candidate) promotion via multi-metric
   * evaluatePaperGate + confidence score. The old numeric
   * PAPER_THRESHOLDS (minSharpe, minDays, minPnl) are gone — the
   * gate module is the single source of truth.
   *
   * User spec hardcoded at the module level: ≥10 paper trades,
   * positive cumulative PnL, no single loss >5%, rolling-20-trade DD
   * ≤10%. Confidence score ≥ 60 layered on top as an orthogonal check.
   */
  private async promotePaperToRecommended(): Promise<void> {
    const candidates = Array.from(this.strategies.values()).filter(
      (s) => s.status === 'paper_trading' && !s.isCensored && !s.fitnessDivergent,
    );
    for (const s of candidates) {
      const paperStats = await this.buildPaperStats(s);
      const gate = evaluatePaperGate(paperStats);
      if (!gate.allowed) continue;

      try {
        const score = await (confidenceScoringService as any).calculateConfidenceScore(
          s.strategyId,
          s.symbol,
          s.timeframe,
        );
        s.confidenceScore = safeNum(score?.confidenceScore ?? score?.score ?? score);
        if (s.confidenceScore < PAPER_MIN_CONFIDENCE) continue;

        const fromStatus = 'paper_trading';
        s.status = 'recommended';
        await this.upsertStrategyPerformance(s);
        await this.recordStrategyStateEvent(
          s.strategyId,
          fromStatus,
          'recommended',
          'promoted_paper',
          {
            paperSharpe: s.paperSharpe,
            paperTrades: s.paperTrades,
            paperPnl: s.paperPnl,
            confidence: s.confidenceScore,
            largestSingleLossPct: paperStats.largestSingleLossPct,
            rolling20DD: paperStats.rolling20TradeMaxDrawdown,
          },
        );
        this.emit('liveRecommendation', s);
        logger.info(
          `[SLE] 🎯 Strategy ${s.strategyId} RECOMMENDED for live: confidence=${s.confidenceScore.toFixed(1)}`,
        );
      } catch (err) {
        logger.warn(`[SLE] Confidence scoring failed for ${s.strategyId}:`, err);
      }
    }
  }

  /**
   * Build the PaperStats input expected by evaluatePaperGate.
   *
   * rolling20TradeMaxDrawdown is a true peak-to-trough drawdown over
   * the cumulative-PnL curve of the last 20 trades, normalised by the
   * sum of margin committed across those trades. The previous
   * implementation computed net-return-over-margin, which is a
   * different metric — Sourcery flagged the semantic mismatch.
   */
  private async buildPaperStats(s: StrategyRecord): Promise<PaperStats> {
    const recent = await this.loadRecentTradeOutcomes(s.strategyId, 20);

    const largestSingleLossPct = recent.reduce((worst, t) => {
      if (t.realisedPnl >= 0 || t.marginCommitted <= 0) return worst;
      const lossPct = Math.abs(t.realisedPnl) / t.marginCommitted;
      return Math.max(worst, lossPct);
    }, 0);

    // Peak-to-trough drawdown along the cumulative equity curve.
    let equity = 0;
    let peak = 0;
    let maxDrawdownAbs = 0;
    let totalMargin = 0;
    for (const t of recent) {
      equity += t.realisedPnl;
      totalMargin += Math.abs(t.marginCommitted);
      if (equity > peak) peak = equity;
      const drawdown = peak - equity;
      if (drawdown > maxDrawdownAbs) maxDrawdownAbs = drawdown;
    }
    const rolling20TradeMaxDrawdown =
      totalMargin > 0 ? maxDrawdownAbs / totalMargin : 0;

    return {
      totalTrades: s.paperTrades ?? 0,
      cumulativePnl: safeNum(s.paperPnl),
      largestSingleLossPct,
      rolling20TradeMaxDrawdown,
      profitablePaperTrades: recent.filter((t) => t.realisedPnl > 0).length,
    };
  }

  async confirmLivePromotion(strategyId: string): Promise<StrategyRecord> {
    const s = this.strategies.get(strategyId);
    if (!s) throw new Error(`Strategy ${strategyId} not found`);
    if (s.status !== 'recommended') throw new Error(`Strategy ${strategyId} is not recommended (current: ${s.status})`);
    const fromStatus = s.status;
    s.status = 'live';
    await this.upsertStrategyPerformance(s);
    await this.recordStrategyStateEvent(
      strategyId,
      fromStatus,
      'live',
      'promoted_live',
      {
        liveSharpe: s.liveSharpe,
        confidence: s.confidenceScore,
        symbol: s.symbol,
        leverage: s.leverage,
      },
    );
    this.emit('liveConfirmed', s);
    logger.info(`[SLE] User confirmed live promotion for ${strategyId}`); return s;
  }

  private async updateGenerationWeights(): Promise<void> { await this.loadActiveStrategies(); }

  /**
   * Append an immutable event to strategy_state_events. Every status
   * transition — promotion, demotion, kill, reactivation — should go
   * through this so the audit log is complete. Fail-soft: logs but
   * doesn't throw, since event-log failures must never block trading.
   */
  async recordStrategyStateEvent(
    strategyId: string,
    fromStatus: string | null,
    toStatus: string,
    reason: StrategyStatusTransitionReason,
    metadata: Record<string, unknown> | null = null,
    detail: string | null = null,
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO strategy_state_events
           (strategy_id, from_status, to_status, reason, detail, metadata, engine_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          strategyId,
          fromStatus,
          toStatus,
          reason,
          detail,
          metadata ? JSON.stringify(metadata) : null,
          getEngineVersion(),
        ],
      );
    } catch (err) {
      logger.warn('[SLE] recordStrategyStateEvent failed (fail-soft)', {
        strategyId,
        fromStatus,
        toStatus,
        reason,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Load Thompson-bandit class counters for the given regime. Missing
   * (class, regime) pairs default to the Beta(1,1) uniform prior.
   * Used by the generator to bias new-from-scratch strategies toward
   * classes that are currently winning.
   */
  async loadBanditCountersForRegime(regime: MarketRegime): Promise<Map<StrategyClass, BanditCounter>> {
    const out = new Map<StrategyClass, BanditCounter>();
    try {
      const result = await query(
        `SELECT strategy_class, wins, losses
           FROM bandit_class_counters
          WHERE regime = $1`,
        [regime],
      );
      for (const row of (result.rows as any[]) as Array<Record<string, unknown>>) {
        out.set(String(row.strategy_class) as StrategyClass, {
          wins: Number(row.wins),
          losses: Number(row.losses),
        });
      }
    } catch (err) {
      logger.debug('[SLE] loadBanditCountersForRegime failed — falling back to uniform prior', {
        regime,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    for (const klass of ALL_STRATEGY_CLASSES) {
      if (!out.has(klass)) out.set(klass, DEFAULT_BANDIT_COUNTER);
    }
    return out;
  }

  /**
   * Update a Thompson-bandit counter after a terminal trade outcome.
   * Upserts into bandit_class_counters so the posterior persists
   * across restarts. Fail-soft.
   */
  async updateBanditCounter(
    strategyClass: StrategyClass,
    regime: MarketRegime,
    winIncrement: number,
    lossIncrement: number,
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO bandit_class_counters (strategy_class, regime, wins, losses)
         VALUES ($1, $2, 1 + $3, 1 + $4)
         ON CONFLICT (strategy_class, regime) DO UPDATE SET
           wins = bandit_class_counters.wins + $3,
           losses = bandit_class_counters.losses + $4,
           last_updated_at = NOW()`,
        [strategyClass, regime, winIncrement, lossIncrement],
      );
    } catch (err) {
      logger.warn('[SLE] updateBanditCounter failed (fail-soft)', {
        strategyClass,
        regime,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Sample a class via Thompson posterior for the given regime.
   * Used by generateRandom to bias new-from-scratch generation toward
   * classes that are currently winning. Returns null when the bandit
   * cannot be consulted (DB down, etc.) so callers can fall back to
   * uniform random.
   */
  async sampleBanditClassForRegime(regime: MarketRegime): Promise<StrategyClass | null> {
    try {
      const counters = await this.loadBanditCountersForRegime(regime);
      return sampleBestClass(counters);
    } catch (err) {
      logger.debug('[SLE] sampleBanditClassForRegime failed', {
        regime,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async upsertStrategyPerformance(s: StrategyRecord): Promise<void> {
    try {
      this.strategies.set(s.strategyId, s);
      const avgSharpeRatio = s.liveSharpe ?? s.paperSharpe ?? s.backtestSharpe ?? 0.0;
      await query(
        `INSERT INTO strategy_performance (
          strategy_id, strategy_name, symbol, leverage, timeframe, strategy_type, regime_at_creation,
          backtest_sharpe, backtest_wr, backtest_max_dd,
          paper_sharpe, paper_wr, paper_pnl, paper_trades,
          live_sharpe, live_pnl, live_trades,
          is_censored, censor_reason, uncensored_sharpe, fitness_divergent,
          status, confidence_score, created_at, parent_strategy_id, generation, backtest_count, avg_return, avg_sharpe_ratio,
          signal_genome, engine_version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31
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
          avg_sharpe_ratio    = EXCLUDED.avg_sharpe_ratio,
          signal_genome       = EXCLUDED.signal_genome,
          engine_version      = EXCLUDED.engine_version`,
        [
          s.strategyId, s.strategyId, s.symbol, s.leverage, s.timeframe, s.strategyType, s.regimeAtCreation,
          s.backtestSharpe, s.backtestWr, s.backtestMaxDd,
          s.paperSharpe, s.paperWr, s.paperPnl, s.paperTrades,
          s.liveSharpe, s.livePnl, s.liveTrades,
          s.isCensored, s.censorReason, s.uncensoredSharpe, s.fitnessDivergent,
          s.status, s.confidenceScore, s.createdAt, s.parentStrategyId, s.generation, s.backtestCount ?? 0, clampNumeric64(s.avgReturn ?? 0), clampNumeric64(avgSharpeRatio),
          s.genome ? JSON.stringify(s.genome) : null, getEngineVersion(),
        ]
      );
    } catch (err) { logger.error(`[SLE] DB upsert failed for ${s.strategyId}:`, err); }
  }

  private async loadActiveStrategies(): Promise<void> {
    try {
      const result = await query(`SELECT * FROM strategy_performance WHERE status IN ('paper_trading', 'recommended', 'live') ORDER BY created_at DESC LIMIT 100`);
      for (const row of result.rows) { const s = this.rowToRecord(row as any); this.strategies.set(s.strategyId, s); }
      logger.info(`[SLE] Loaded ${result.rows.length} active strategies from DB`);
    } catch (err) { logger.warn('[SLE] Failed to load active strategies:', err); }
  }

  private async loadBestPerformers(regime: MarketRegime, limit = 10): Promise<StrategyRecord[]> {
    try {
      const result = await query(`SELECT * FROM strategy_performance WHERE is_censored = FALSE AND fitness_divergent = FALSE AND (regime_at_creation = $1 OR regime_at_creation = 'unknown') AND status NOT IN ('killed', 'retired', 'censored_rejected') AND paper_sharpe IS NOT NULL ORDER BY paper_sharpe DESC NULLS LAST LIMIT $2`, [regime, limit]);
      return result.rows.map(r => this.rowToRecord(r));
    } catch { return []; }
  }

  private rowToRecord(row: any): StrategyRecord {
    let genome: SignalGenome | null = null;
    if (row.signal_genome) { try { genome = typeof row.signal_genome === 'string' ? JSON.parse(row.signal_genome) : row.signal_genome; } catch { genome = null; } }
    return {
      strategyId: String(row.strategy_id), symbol: String(row.symbol), leverage: safeNum(row.leverage, 1), timeframe: String(row.timeframe),
      strategyType: String(row.strategy_type) as StrategyType, genome,
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
      isCensored: Boolean(row.is_censored), censorReason: row.censor_reason != null ? String(row.censor_reason) : null,
      uncensoredSharpe: row.uncensored_sharpe != null ? safeNum(row.uncensored_sharpe) : null,
      fitnessDivergent: Boolean(row.fitness_divergent),
      status: String(row.status) as StrategyStatus,
      confidenceScore: row.confidence_score != null ? safeNum(row.confidence_score) : null,
      createdAt: new Date(String(row.created_at)),
      parentStrategyId: row.parent_strategy_id != null ? String(row.parent_strategy_id) : null,
      generation: safeNum(row.generation, 0), backtestCount: safeNum(row.backtest_count, 0),
      avgReturn: safeNum(row.avg_return, 0), avgSharpeRatio: safeNum(row.avg_sharpe_ratio, 0),
      equityCurve: [], lastEquitySlope: 0, phaseClock: 0,
    };
  }

  async getLiveRecommendations(): Promise<StrategyRecord[]> {
    try { const result = await query(`SELECT * FROM strategy_performance WHERE status = 'recommended' ORDER BY confidence_score DESC NULLS LAST`); return result.rows.map(r => this.rowToRecord(r)); }
    catch { return []; }
  }

  async getTopPerformers(limit = 20): Promise<StrategyRecord[]> {
    try { const result = await query(`SELECT * FROM strategy_performance WHERE status NOT IN ('killed', 'retired', 'censored_rejected') AND is_censored = FALSE AND fitness_divergent = FALSE ORDER BY COALESCE(paper_sharpe, backtest_sharpe, -999) DESC LIMIT $1`, [limit]); return result.rows.map(r => this.rowToRecord(r)); }
    catch { return []; }
  }

  async getEngineStatus() {
    return {
      isRunning: this.isRunning, generationCount: this.generationCount, activeStrategies: this.strategies.size,
      paperTrading: Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading').length,
      recommended: Array.from(this.strategies.values()).filter(s => s.status === 'recommended').length,
      live: Array.from(this.strategies.values()).filter(s => s.status === 'live').length,
    };
  }
}

export const strategyLearningEngine = new StrategyLearningEngine();
export default strategyLearningEngine;
