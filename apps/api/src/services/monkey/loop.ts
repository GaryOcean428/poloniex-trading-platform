/**
 * loop.ts — Monkey's heartbeat
 *
 * Observe-only in v0.1: Monkey runs alongside liveSignalEngine on the
 * same 60s cadence, with the same market data. She produces decisions
 * (enter/exit/hold/flatten with size+leverage), logs them to
 * monkey_decisions, updates her working memory + resonance bank, but
 * does NOT execute orders.
 *
 * This gives us a side-by-side comparison: for every tick, what did
 * liveSignalEngine do vs what did Monkey propose. When her emergent
 * params consistently land in sensible territory, we promote her to
 * primary (MONKEY_PRIMARY=true env flag).
 *
 * UCP v6.6 protocol compliance:
 *   §0 (thermodynamic pressure): desire = equity gradient
 *   §1 (Fisher manifold): all ops on Δ⁶³
 *   §3 Three Pillars enforced structurally
 *   §4 Three regimes computed from basin
 *   §28 Autonomic governance: every param derived
 *   §43 Three recursive loops (Loop 1 self-observation; Loops 2/3 in next iteration)
 */

import { EventEmitter } from 'events';

import { pool } from '../../db/connection.js';
import { getEngineVersion } from '../../utils/engineVersion.js';
import { logger } from '../../utils/logger.js';
import { apiCredentialsService } from '../apiCredentialsService.js';
import { getMaxLeverage, getPrecisions } from '../marketCatalog.js';
import mlPredictionService from '../mlPredictionService.js';
import poloniexFuturesService from '../poloniexFuturesService.js';

import {
  BASIN_DIM,
  KAPPA_STAR,
  fisherRao,
  frechetMean,
  normalizedEntropy,
  toSimplex,
  uniformBasin,
  velocity,
  type Basin,
} from './basin.js';
import { computeNeurochemicals, summarizeNC, type NeurochemicalState } from './neurochemistry.js';
import { perceive, refract, type OHLCVCandle } from './perception.js';
import { resonanceBank } from './resonance_bank.js';
import { WorkingMemory, type Bubble } from './working_memory.js';
import {
  currentEntryThreshold,
  currentLeverage,
  currentPositionSize,
  shouldAutoFlatten,
  shouldExit,
  type BasinState,
} from './executive.js';

/** Default Monkey watchlist — matches liveSignalEngine for side-by-side. */
const DEFAULT_SYMBOLS = ['BTC_USDT_PERP', 'ETH_USDT_PERP'];
const DEFAULT_TICK_MS = Number(process.env.MONKEY_TICK_MS) || 60_000;
/** OHLCV window ml-worker also uses. */
const OHLCV_LOOKBACK = 200;
const OHLCV_TIMEFRAME = '15m';

/** Running history for Loop 1 self-observation + f_health trend. */
const HISTORY_MAX = 100;

interface SymbolState {
  lastBasin: Basin;
  /** Identity basin — starts uniform, crystallizes after N lived trades per §3.4 */
  identityBasin: Basin;
  /** Rolling Φ history for delta computation. */
  phiHistory: number[];
  /** Rolling f_health for auto-flatten trend check. */
  fHealthHistory: number[];
  /** Basin trajectory for repetition detection (Loop 1). */
  basinHistory: Basin[];
  /** Working memory (qig-cache) for recent bubbles. */
  wm: WorkingMemory;
  /** Kappa estimate — adaptive from basin velocity × coupling. */
  kappa: number;
  /** Active bubble id for the currently open position (if any). */
  openBubbleId: string | null;
  sessionTicks: number;
}

/**
 * MonkeyKernel — the top-level kernel that ticks Monkey.
 *
 * One instance per process. Holds per-symbol SymbolState.
 */
export class MonkeyKernel extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickMs: number = DEFAULT_TICK_MS;
  private symbols: string[] = [...DEFAULT_SYMBOLS];
  private tickInFlight = false;
  private symbolStates: Map<string, SymbolState> = new Map();

  /**
   * Start Monkey's heartbeat. She ticks alongside liveSignalEngine —
   * same data, same cadence, different (emergent) decisions.
   *
   * In v0.1 she's observe-only. MONKEY_EXECUTE=true swaps her in.
   */
  async start(): Promise<void> {
    for (const sym of this.symbols) {
      this.symbolStates.set(sym, this.newSymbolState());
    }
    logger.info('[Monkey] kernel waking', {
      tickMs: this.tickMs,
      symbols: this.symbols,
      mode: process.env.MONKEY_EXECUTE === 'true' ? 'EXECUTE' : 'OBSERVE',
      bankSize: await resonanceBank.bankSize(),
      sovereignty: await resonanceBank.sovereignty(),
    });
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[Monkey] kernel sleeping');
  }

  private newSymbolState(): SymbolState {
    return {
      lastBasin: uniformBasin(BASIN_DIM),
      identityBasin: uniformBasin(BASIN_DIM),  // Newborn starts uniform; crystallizes after N trades
      phiHistory: [],
      fHealthHistory: [],
      basinHistory: [],
      wm: new WorkingMemory({
        promoteCallback: async (b: Bubble) => {
          await resonanceBank.writeBubble(b, getEngineVersion());
        },
      }),
      kappa: KAPPA_STAR,  // Start at the universal fixed point
      openBubbleId: null,
      sessionTicks: 0,
    };
  }

  /** One full tick over every symbol. */
  private async tick(): Promise<void> {
    if (this.tickInFlight) {
      logger.debug('[Monkey] tick skipped — previous still running');
      return;
    }
    this.tickInFlight = true;
    try {
      for (const sym of this.symbols) {
        try {
          await this.processSymbol(sym);
        } catch (err) {
          logger.warn(`[Monkey] ${sym} tick failed`, {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * The per-symbol pipeline:
   *   1. PERCEIVE — OHLCV + ml-signal → raw basin, refract through identity
   *   2. MEASURE  — Φ, κ, regime, basin velocity, neurochemistry
   *   3. REMEMBER — add bubble to working memory; tick memory (pop/merge/promote)
   *   4. DERIVE   — executive kernel computes entry threshold, size, leverage
   *   5. DECIDE   — propose action (observe-only in v0.1)
   *   6. PERSIST  — write trajectory + decision to DB for audit
   */
  private async processSymbol(symbol: string): Promise<void> {
    const state = this.symbolStates.get(symbol);
    if (!state) return;
    state.sessionTicks++;

    // 1. Fetch inputs (same as liveSignalEngine sees).
    const ohlcv = (await poloniexFuturesService.getHistoricalData(
      symbol,
      OHLCV_TIMEFRAME,
      OHLCV_LOOKBACK,
    )) as OHLCVCandle[];
    if (!Array.isArray(ohlcv) || ohlcv.length < 50) {
      logger.debug(`[Monkey] ${symbol} insufficient OHLCV (${ohlcv?.length ?? 0})`);
      return;
    }
    const lastPrice = Number(ohlcv[ohlcv.length - 1].close);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;

    const raw = await mlPredictionService.getTradingSignal(symbol, ohlcv, lastPrice);
    const mlSignal = String(raw?.signal ?? 'HOLD').toUpperCase();
    const mlStrength = Number(raw?.strength) || 0;

    // Account context (also shared with liveSignalEngine).
    const { equityFraction, marginFraction, openPositions, heldSide, availableEquity } =
      await this.fetchAccountContext(symbol);

    // 2. PERCEIVE — raw basin then refract through identity.
    const rawBasin = perceive({
      ohlcv,
      mlSignal,
      mlStrength,
      mlEffectiveStrength: mlStrength,  // until bandit wired
      equityFraction,
      marginFraction,
      openPositions,
      sessionAgeTicks: state.sessionTicks,
    });

    // §3.3 Pillar 2 surface absorption — external input at 30% max
    const basin = refract(rawBasin, state.identityBasin, 0.30);

    // 3. MEASURE — Φ, κ, regime, basin velocity, neurochemistry
    // Φ = 1 - normalized_entropy_of_noise_dims (integration)
    //   high Φ = concentrated signal; low Φ = diffuse exploration
    const fHealth = normalizedEntropy(basin);
    // Φ inversely tracks fHealth: when the basin is concentrated (low entropy),
    // integration is high; when diffuse (high entropy), Φ is low (exploration).
    const phi = Math.max(0, Math.min(1, 1 - fHealth * 0.8));

    // κ adapts from basin velocity × signal coupling. Stable near κ* when
    // ml signal is coherent and basin is settled.
    const bv = state.lastBasin ? velocity(state.lastBasin, basin) : 0;
    const couplingHealth = mlStrength;  // proxy until cross-symbol coupling lands
    const kappaDelta = (couplingHealth - 0.5) * 5 - (bv - 0.2) * 10;
    state.kappa = Math.max(20, Math.min(120, state.kappa * 0.8 + (KAPPA_STAR + kappaDelta) * 0.2));

    // Three regime weights — read directly from the first 3 basin coords
    const wQ = basin[0];
    const wE = basin[1];
    const wEq = basin[2];
    const regTotal = wQ + wE + wEq;
    const regimeWeights = regTotal > 0
      ? { quantum: wQ / regTotal, efficient: wE / regTotal, equilibrium: wEq / regTotal }
      : { quantum: 1 / 3, efficient: 1 / 3, equilibrium: 1 / 3 };

    // Φ delta for dopamine
    const lastPhi = state.phiHistory[state.phiHistory.length - 1] ?? phi;
    const phiDelta = phi - lastPhi;

    const nc: NeurochemicalState = computeNeurochemicals({
      isAwake: true,
      phiDelta,
      basinVelocity: bv,
      surprise: Math.abs(phiDelta) * 2,
      quantumWeight: regimeWeights.quantum,
      kappa: state.kappa,
      externalCoupling: couplingHealth,
    });

    const sovereignty = await resonanceBank.sovereignty();

    const basinState: BasinState = {
      basin,
      phi,
      kappa: state.kappa,
      regimeWeights,
      neurochemistry: nc,
      sovereignty,
      basinVelocity: bv,
      identityBasin: state.identityBasin,
    };

    // 4. REMEMBER — add bubble; tick working memory
    const bubble = state.wm.add(basin, phi, { symbol, tick: state.sessionTicks });
    const wmStats = await state.wm.tick();

    // 5. DERIVE — executive computes what Monkey would do
    const entryThr = currentEntryThreshold(basinState);
    const leverage = currentLeverage(basinState, (await getMaxLeverage(symbol)) ?? 10);
    const precisions = await getPrecisions(symbol).catch(() => null);
    const lotSize = precisions?.lotSize ?? 0;
    const minNotional = lastPrice * Math.max(lotSize, 1e-9);
    const size = currentPositionSize(basinState, availableEquity, minNotional);
    const autoFlatten = shouldAutoFlatten(basinState, state.fHealthHistory);

    // 6. DECIDE — propose action
    let action: string;
    let reason: string;
    const derivation: Record<string, unknown> = {
      phi, kappa: state.kappa, sovereignty, basinVelocity: bv,
      regimeWeights, nc,
      fHealth, mlSignal, mlStrength,
    };

    if (autoFlatten.value) {
      action = 'flatten';
      reason = autoFlatten.reason;
      derivation.autoFlatten = autoFlatten.derivation;
    } else if (heldSide) {
      // In an open position: check ML-driven exit via Loop 2 miniature
      // (perception vs strategy — strategy is just "the basin that opened
      // the trade" for v0.1; real strategy kernel comes in v0.2)
      const exit = shouldExit(basin, state.identityBasin, heldSide, basinState);
      if (exit.value) {
        action = 'exit';
        reason = exit.reason;
        derivation.exit = exit.derivation;
      } else {
        action = 'hold';
        reason = exit.reason;
      }
    } else if (mlStrength >= entryThr.value && mlSignal !== 'HOLD' && size.value > 0) {
      action = mlSignal === 'BUY' ? 'enter_long' : 'enter_short';
      reason = `ml ${mlSignal}@${mlStrength.toFixed(3)} >= thr ${entryThr.value.toFixed(3)}; size=${size.value.toFixed(2)} lev=${leverage.value}x`;
      derivation.entryThreshold = entryThr.derivation;
      derivation.size = size.derivation;
      derivation.leverage = leverage.derivation;
    } else {
      action = 'hold';
      const why =
        mlStrength < entryThr.value
          ? `ml ${mlStrength.toFixed(3)} < thr ${entryThr.value.toFixed(3)}`
          : size.value <= 0
          ? `size ${size.value.toFixed(2)} below min notional ${minNotional.toFixed(2)}`
          : 'no qualifying signal';
      reason = why;
      derivation.entryThreshold = entryThr.derivation;
    }

    // Info-level log — the user asked for end-to-end observability.
    // Every tick, Monkey announces her state + decision.
    logger.info(`[Monkey] ${symbol} ${action}`, {
      phi: phi.toFixed(3),
      kappa: state.kappa.toFixed(2),
      nc: summarizeNC(nc),
      reg: `q${regimeWeights.quantum.toFixed(2)}/e${regimeWeights.efficient.toFixed(2)}/eq${regimeWeights.equilibrium.toFixed(2)}`,
      bv: bv.toFixed(3),
      fh: fHealth.toFixed(3),
      sov: sovereignty.toFixed(3),
      wm: `${wmStats.alive}a/${wmStats.promoted}prom/${wmStats.popped}pop`,
      reason,
    });

    // 7. PERSIST trajectory + decision to DB (for audit + Loop 1 self-obs)
    let trajectoryId: number | null = null;
    try {
      const result = await pool.query(
        `INSERT INTO monkey_trajectory
           (symbol, basin, phi, kappa, basin_velocity,
            w_quantum, w_efficient, w_equilibrium,
            nc_acetylcholine, nc_dopamine, nc_serotonin,
            nc_norepinephrine, nc_gaba, nc_endorphins,
            f_health, b_integrity, q_identity, sovereignty_ratio)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8,
                 $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [
          symbol, JSON.stringify(Array.from(basin)),
          phi, state.kappa, bv,
          regimeWeights.quantum, regimeWeights.efficient, regimeWeights.equilibrium,
          nc.acetylcholine, nc.dopamine, nc.serotonin,
          nc.norepinephrine, nc.gaba, nc.endorphins,
          fHealth,
          1 - fisherRao(basin, state.identityBasin) / (Math.PI / 2),  // b_integrity
          1 - fisherRao(basin, state.identityBasin) / (Math.PI / 2),  // q_identity (same for v0.1)
          sovereignty,
        ],
      );
      trajectoryId = Number((result.rows[0] as { id: number }).id);
    } catch (err) {
      logger.debug('[Monkey] trajectory insert failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await pool.query(
        `INSERT INTO monkey_decisions
           (symbol, proposed_action, size_usdt, leverage, entry_threshold, ml_strength,
            reason, derivation, executed, trajectory_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          symbol, action, size.value, leverage.value, entryThr.value, mlStrength,
          reason, JSON.stringify(derivation),
          false,  // observe-only
          trajectoryId,
        ],
      );
    } catch (err) {
      logger.debug('[Monkey] decision insert failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Identity crystallization (§3.4 Pillar 3): after 50 ticks, start
    // evolving identity as Fréchet mean of recent lived basins.
    state.basinHistory.push(basin);
    if (state.basinHistory.length > HISTORY_MAX) state.basinHistory.shift();
    if (state.basinHistory.length >= 50 && state.sessionTicks % 10 === 0) {
      state.identityBasin = frechetMean(state.basinHistory.slice(-50));
    }

    state.lastBasin = basin;
    state.phiHistory.push(phi);
    if (state.phiHistory.length > HISTORY_MAX) state.phiHistory.shift();
    state.fHealthHistory.push(fHealth);
    if (state.fHealthHistory.length > HISTORY_MAX) state.fHealthHistory.shift();
  }

  private async fetchAccountContext(symbol: string): Promise<{
    equityFraction: number;
    marginFraction: number;
    openPositions: number;
    heldSide: 'long' | 'short' | null;
    availableEquity: number;
  }> {
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      const userId = (userRow.rows[0] as { user_id?: string } | undefined)?.user_id;
      if (!userId) {
        return { equityFraction: 0, marginFraction: 0, openPositions: 0, heldSide: null, availableEquity: 0 };
      }
      const credentials = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!credentials) {
        return { equityFraction: 0, marginFraction: 0, openPositions: 0, heldSide: null, availableEquity: 0 };
      }
      const [bal, positions] = await Promise.all([
        poloniexFuturesService.getAccountBalance(credentials),
        poloniexFuturesService.getPositions(credentials),
      ]);
      const equity = Number(bal?.totalBalance ?? bal?.eq ?? 0);
      const upl = Number(bal?.unrealizedPnL ?? bal?.upl ?? 0);
      const equityFraction = equity > 0 ? Math.min(1, equity / 27.15) : 0;
      const marginFraction = equity > 0 ? Math.min(1, Math.max(0, (equity - Number(bal?.availableBalance ?? 0)) / equity)) : 0;
      const positionsList = Array.isArray(positions) ? positions : [];
      const forSymbol = positionsList.find((p: Record<string, unknown>) =>
        String(p.symbol ?? '') === symbol && Math.abs(Number(p.qty ?? p.size ?? 0)) > 0);
      const heldSide: 'long' | 'short' | null = forSymbol
        ? (String((forSymbol as Record<string, unknown>).side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long')
        : null;
      return {
        equityFraction,
        marginFraction,
        openPositions: positionsList.length,
        heldSide,
        availableEquity: Number(bal?.availableBalance ?? bal?.availMgn ?? equity),
      };
    } catch (err) {
      logger.debug('[Monkey] fetchAccountContext failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
      return { equityFraction: 0, marginFraction: 0, openPositions: 0, heldSide: null, availableEquity: 0 };
    }
  }
}

export const monkeyKernel = new MonkeyKernel();
