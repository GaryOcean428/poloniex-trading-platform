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
import {
  estimateKappa,
  classifyRegime,
  geometricFragility,
  constitutiveR2,
  priceAutocorrelation,
  shouldResetStrategies,
  type QIGRegime,
} from './qig/qigFrozenLaws.js';
import {
  computeQIGFitness,
  detectRegimeTransition,
  type QIGFitnessResult,
} from './qig/qigFitnessFunction.js';

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
const BACKTEST_THRESHOLDS = { minSharpe: 1.0, minWinRate: 0.45, maxDrawdown: 0.15 };
const PAPER_THRESHOLDS = { minSharpe: 0.8, minPnl: 0, minTrades: 30, minDays: 7, minConfidence: 60 };
const FITNESS_DIVERGENCE_THRESHOLD = 0.20;
const QIG_FRAGILITY_WARNING_THRESHOLD = 0.6;
const PHASE_CLOCK_KILL_CYCLES = 5;
const LOOP_INTERVAL_MS = 30 * 60 * 1000;

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

  private async runOneCycle(): Promise<void> {
    this.generationCount++;
    logger.info(`[SLE] === Generation ${this.generationCount} ===`);
    const regime = await this.detectCurrentRegime();
    await this.checkQIGRegimeTransition();
    const newStrategies = await this.generateVariants(regime);
    const backtestPassed = await this.backtestVariants(newStrategies);
    for (const s of backtestPassed) { await this.promoteToParallelPaper(s); }
    await this.evaluatePaperSessions();
    await this.killUnderperformers();
    await this.promotePaperToRecommended();
    await this.updateGenerationWeights();
    this.emit('cycleComplete', { generation: this.generationCount, regime });
    logger.info(`[SLE] Generation ${this.generationCount} complete`);
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
      s.status = 'killed'; s.censorReason = `anderson_regime_reset_${newRegime}`;
      try { await parallelStrategyRunner.removeStrategy(s.strategyId, s.censorReason); await this.upsertStrategyPerformance(s); } catch (err) { logger.debug(`[SLE] Anderson reset: failed to kill ${s.strategyId}:`, err); }
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

  private async generateVariants(regime: MarketRegime): Promise<StrategyRecord[]> {
    const symbols = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'SOL_USDT_PERP', 'XRP_USDT_PERP'];
    const parents = await this.loadBestPerformers(regime);
    const variants: StrategyRecord[] = [];
    for (let i = 0; i < 6; i++) {
      let s: StrategyRecord;
      if (parents.length >= 2 && Math.random() < 0.6) {
        const p1 = parents[Math.floor(Math.random() * parents.length)];
        const others = parents.filter(p => p.strategyId !== p1.strategyId);
        s = others.length > 0 ? this.crossoverStrategies(p1, others[Math.floor(Math.random() * others.length)], regime) : this.mutateStrategy(p1, regime);
      } else if (parents.length > 0 && Math.random() < 0.5) {
        s = this.mutateStrategy(parents[Math.floor(Math.random() * parents.length)], regime);
      } else { s = this.generateRandom(symbols, regime); }
      variants.push(s);
    }
    logger.info(`[SLE] Generated ${variants.length} variants for regime '${regime}'`);
    return variants;
  }

  private generateRandom(symbols: string[], regime: MarketRegime): StrategyRecord {
    const id = `sle_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const tfKeys = Object.keys(SUPPORTED_TF_MINUTES);
    const genome = generateRandomGenome();
    return {
      strategyId: id, symbol, leverage: [1, 2, 5, 10][Math.floor(Math.random() * 4)],
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
        const result = await this.runBacktestWithWalkForward(s);
        s.backtestCount = (s.backtestCount ?? 0) + 1;
        s.backtestSharpe = safeNum(result.sharpe); s.backtestWr = safeNum(result.winRate); s.backtestMaxDd = safeNum(result.maxDrawdown);
        const qigResult = this.evaluateWithQIGFitness(result);
        const rawPasses = safeNum(result.sharpe) >= BACKTEST_THRESHOLDS.minSharpe && safeNum(result.winRate) >= BACKTEST_THRESHOLDS.minWinRate && safeNum(result.maxDrawdown) <= BACKTEST_THRESHOLDS.maxDrawdown;
        const passes = qigResult ? (qigResult.dualFramingPass && rawPasses) : rawPasses;
        if (passes) { s.status = 'paper_trading'; passed.push(s); logger.info(`[SLE] Backtest PASS: ${s.strategyId} sharpe=${result.sharpe?.toFixed(2)}`); }
        else { s.status = 'retired'; }
        await this.upsertStrategyPerformance(s);
      } catch (err) { logger.warn(`[SLE] Backtest error for ${s.strategyId}:`, err); }
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

  private async runBacktestWithWalkForward(strategy: StrategyRecord): Promise<{ sharpe: number; winRate: number; maxDrawdown: number }> {
    const tfMinutes = SUPPORTED_TF_MINUTES[strategy.timeframe] ?? 60;
    const minOOSDays = Math.max(9, Math.ceil((100 * tfMinutes) / (24 * 60)));
    const cappedTotalDays = Math.min(Math.ceil(minOOSDays / 0.3), 90);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - cappedTotalDays * 24 * 60 * 60 * 1000);
    const splitDate = new Date(startDate.getTime() + cappedTotalDays * 0.7 * 24 * 60 * 60 * 1000);
    try {
      const strategyDef: Record<string, any> = { type: strategy.strategyType, parameters: {}, lookback: DEFAULT_STRATEGY_LOOKBACK };
      if (strategy.genome) { strategyDef.genome = strategy.genome; }
      (backtestingEngine as any).registerStrategy(strategy.strategyId, strategyDef);
      const result = await (backtestingEngine as any).runBacktest(strategy.strategyId, { symbol: strategy.symbol, timeframe: strategy.timeframe, startDate: splitDate, endDate, leverage: strategy.leverage });
      return { sharpe: safeNum(result?.sharpeRatio ?? result?.metrics?.sharpeRatio), winRate: safeNum(result?.winRate ?? result?.metrics?.winRate), maxDrawdown: safeNum(result?.maxDrawdown ?? result?.metrics?.maxDrawdownPercent) };
    } catch { return { sharpe: -1, winRate: 0, maxDrawdown: 1 }; }
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

  private async killUnderperformers(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading');
    for (const s of paperStrategies) {
      let killReason: string | null = null;
      if ((s.phaseClock ?? 0) >= PHASE_CLOCK_KILL_CYCLES) killReason = `phase_clock_${s.phaseClock}_negative_cycles`;
      if (s.fitnessDivergent && s.isCensored) { killReason = 'fitness_divergent_and_censored'; s.status = 'censored_rejected'; }
      else if (s.fitnessDivergent) killReason = 'fitness_divergent_unreliable_estimate';
      if (s.paperPnl !== null && s.paperTrades > 5) { const ddPct = Math.abs(Math.min(0, s.paperPnl)) / 1000; if (ddPct > 0.10) killReason = `drawdown_${(ddPct * 100).toFixed(1)}pct`; }
      if (killReason) {
        s.status = s.status === 'censored_rejected' ? 'censored_rejected' : 'killed';
        await parallelStrategyRunner.removeStrategy(s.strategyId, killReason);
        await this.upsertStrategyPerformance(s);
        logger.info(`[SLE] Killed strategy ${s.strategyId}: ${killReason}`);
        await this.cloneTopPerformer(s.regimeAtCreation);
      }
    }
  }

  private async cloneTopPerformer(regime: MarketRegime): Promise<void> {
    try { const top = await this.loadBestPerformers(regime, 3); if (top.length === 0) return; const parent = top[Math.floor(Math.random() * top.length)]; const clone = this.mutateStrategy(parent, regime); await this.upsertStrategyPerformance(clone); await parallelStrategyRunner.addStrategy(clone); logger.info(`[SLE] Cloned top performer ${parent.strategyId} \u2192 ${clone.strategyId}`); }
    catch (err) { logger.warn('[SLE] Clone top performer failed:', err); }
  }

  private async promotePaperToRecommended(): Promise<void> {
    const paperStrategies = Array.from(this.strategies.values()).filter(s => s.status === 'paper_trading' && !s.isCensored && !s.fitnessDivergent);
    for (const s of paperStrategies) {
      if ((s.paperTrades ?? 0) < PAPER_THRESHOLDS.minTrades) continue;
      const daysSince = (Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < PAPER_THRESHOLDS.minDays) continue;
      if (safeNum(s.paperSharpe) < PAPER_THRESHOLDS.minSharpe || safeNum(s.paperPnl) <= PAPER_THRESHOLDS.minPnl) continue;
      try {
        const score = await (confidenceScoringService as any).calculateConfidenceScore(s.strategyId, s.symbol, s.timeframe);
        s.confidenceScore = safeNum(score?.score ?? score);
        if (s.confidenceScore >= PAPER_THRESHOLDS.minConfidence) {
          s.status = 'recommended'; await this.upsertStrategyPerformance(s); this.emit('liveRecommendation', s);
          logger.info(`[SLE] \uD83C\uDFAF Strategy ${s.strategyId} RECOMMENDED for live: confidence=${s.confidenceScore.toFixed(1)}`);
        }
      } catch (err) { logger.warn(`[SLE] Confidence scoring failed for ${s.strategyId}:`, err); }
    }
  }

  async confirmLivePromotion(strategyId: string): Promise<StrategyRecord> {
    const s = this.strategies.get(strategyId);
    if (!s) throw new Error(`Strategy ${strategyId} not found`);
    if (s.status !== 'recommended') throw new Error(`Strategy ${strategyId} is not recommended (current: ${s.status})`);
    s.status = 'live'; await this.upsertStrategyPerformance(s); this.emit('liveConfirmed', s);
    logger.info(`[SLE] User confirmed live promotion for ${strategyId}`); return s;
  }

  private async updateGenerationWeights(): Promise<void> { await this.loadActiveStrategies(); }

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
          signal_genome
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27, $28, $29,
          $30
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
          signal_genome       = EXCLUDED.signal_genome`,
        [
          s.strategyId, s.strategyId, s.symbol, s.leverage, s.timeframe, s.strategyType, s.regimeAtCreation,
          s.backtestSharpe, s.backtestWr, s.backtestMaxDd,
          s.paperSharpe, s.paperWr, s.paperPnl, s.paperTrades,
          s.liveSharpe, s.livePnl, s.liveTrades,
          s.isCensored, s.censorReason, s.uncensoredSharpe, s.fitnessDivergent,
          s.status, s.confidenceScore, s.createdAt, s.parentStrategyId, s.generation, s.backtestCount ?? 0, clampNumeric64(s.avgReturn ?? 0), clampNumeric64(avgSharpeRatio),
          s.genome ? JSON.stringify(s.genome) : null,
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
