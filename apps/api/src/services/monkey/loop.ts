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
import { getCurrentExecutionMode } from '../executionModeService.js';
import { getMaxLeverage, getPrecisions } from '../marketCatalog.js';
import mlPredictionService from '../mlPredictionService.js';
import poloniexFuturesService from '../poloniexFuturesService.js';
import {
  evaluatePreTradeVetoes,
  type KernelAccountState,
  type KernelContext,
  type KernelOrder,
} from '../riskKernel.js';

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
    const bankSize = await resonanceBank.bankSize();
    const size = currentPositionSize(basinState, availableEquity, minNotional, leverage.value, bankSize);
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
      reason = `ml ${mlSignal}@${mlStrength.toFixed(3)} >= thr ${entryThr.value.toFixed(3)}; margin=${size.value.toFixed(2)} lev=${leverage.value}x notional=${(size.value * leverage.value).toFixed(2)}`;
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

    // 6b. EXECUTE — gated by MONKEY_EXECUTE=true. Observe-only otherwise.
    let executed = false;
    let monkeyOrderId: string | null = null;
    if (
      process.env.MONKEY_EXECUTE === 'true' &&
      (action === 'enter_long' || action === 'enter_short') &&
      size.value > 0
    ) {
      const execResult = await this.executeEntry({
        symbol,
        side: action === 'enter_long' ? 'long' : 'short',
        marginUsdt: size.value,
        leverage: leverage.value,
        entryPrice: lastPrice,
        minNotional,
        phi,
        kappa: state.kappa,
        sovereignty,
        trajectoryId: null,
      });
      executed = execResult.executed;
      monkeyOrderId = execResult.orderId;
      if (!executed) {
        // Reclassify: she tried but something vetoed. Log reason but keep action labeled.
        reason += ` | execute: ${execResult.reason}`;
      }
    }

    // Info-level log — the user asked for end-to-end observability.
    // Every tick, Monkey announces her state + decision.
    logger.info(`[Monkey] ${symbol} ${action}${executed ? ' EXECUTED' : ''}`, {
      phi: phi.toFixed(3),
      kappa: state.kappa.toFixed(2),
      nc: summarizeNC(nc),
      reg: `q${regimeWeights.quantum.toFixed(2)}/e${regimeWeights.efficient.toFixed(2)}/eq${regimeWeights.equilibrium.toFixed(2)}`,
      bv: bv.toFixed(3),
      fh: fHealth.toFixed(3),
      sov: sovereignty.toFixed(3),
      wm: `${wmStats.alive}a/${wmStats.promoted}prom/${wmStats.popped}pop`,
      orderId: monkeyOrderId ?? undefined,
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
          executed,
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

  /**
   * Execution path (v0.3): route Monkey's proposed entry through the
   * shared risk kernel, submit to Poloniex v3 futures, and persist the
   * row to autonomous_trades with reason prefix `monkey|...` so the
   * reconciler + dashboard attribute it to her (not liveSignalEngine).
   *
   * Returns { executed, orderId, reason }. Callers should not throw on
   * veto — treat veto as the expected "she decided but kernel blocked"
   * outcome, log it, and continue the tick.
   *
   * This is gated by process.env.MONKEY_EXECUTE='true' in loop.ts.
   * v0.3 order surface: market IOC, no SL/TP (managed loop covers those
   * the same way liveSignalEngine relies on it).
   */
  private async executeEntry(req: {
    symbol: string;
    side: 'long' | 'short';
    marginUsdt: number;
    leverage: number;
    entryPrice: number;
    minNotional: number;
    phi: number;
    kappa: number;
    sovereignty: number;
    trajectoryId: number | null;
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, side, marginUsdt, leverage, entryPrice, minNotional } = req;
    const notionalUsdt = marginUsdt * leverage;
    const quantity = notionalUsdt / entryPrice;
    const exchangeSide: 'buy' | 'sell' = side === 'long' ? 'buy' : 'sell';

    // Load account + credentials like liveSignalEngine.loadAccountContext.
    let userId: string;
    let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
    let kernelState: KernelAccountState;
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
      if (!userId) return { executed: false, orderId: null, reason: 'no_credentials' };
      const c = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!c) return { executed: false, orderId: null, reason: 'credentials_missing' };
      credentials = c;
      const [balance, positions] = await Promise.all([
        poloniexFuturesService.getAccountBalance(credentials),
        poloniexFuturesService.getPositions(credentials),
      ]);
      const equityUsdt = Number(balance?.totalBalance ?? balance?.eq ?? 0);
      const unrealizedPnlUsdt = Number(balance?.unrealizedPnL ?? balance?.upl ?? 0);
      const openPositions = (Array.isArray(positions) ? positions : []).map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol ?? ''),
        side: (String(p.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long') as 'long' | 'short',
        notional: Math.abs(Number(p.notional ?? p.size ?? 0)),
      })).filter((p) => p.symbol.length > 0);
      kernelState = { equityUsdt, unrealizedPnlUsdt, openPositions, restingOrders: [] };
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `account_load_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Risk kernel — same blast-door liveSignalEngine uses.
    const order: KernelOrder = { symbol, side, notional: notionalUsdt, leverage, price: entryPrice };
    const mode = await getCurrentExecutionMode();
    const symbolMaxLeverage = (await getMaxLeverage(symbol)) ?? leverage;
    const kernelContext: KernelContext = { isLive: mode === 'auto', mode, symbolMaxLeverage };
    const decision = evaluatePreTradeVetoes(order, kernelState, kernelContext);
    if (!decision.allowed) {
      logger.info('[Monkey] kernel veto', {
        symbol, side, notional: notionalUsdt, leverage,
        code: decision.code, reason: decision.reason,
      });
      return { executed: false, orderId: null, reason: `veto:${decision.code}:${decision.reason}` };
    }

    // Round quantity to the symbol's lot step. Same pattern liveSignalEngine
    // follows after the 2026-04-19 `Param error sz` incident.
    let formattedSize = quantity;
    let symbolLotSize = 0;
    try {
      const precisions = await getPrecisions(symbol);
      if (precisions.lotSize && precisions.lotSize > 0) {
        symbolLotSize = precisions.lotSize;
        formattedSize = Math.floor(quantity / precisions.lotSize) * precisions.lotSize;
      }
    } catch { /* use raw */ }
    if (formattedSize <= 0) {
      return {
        executed: false, orderId: null,
        reason: `lot_rounding_zero: qty ${quantity.toFixed(8)} below lot ${symbolLotSize}`,
      };
    }
    if (formattedSize * entryPrice < minNotional) {
      return {
        executed: false, orderId: null,
        reason: `post_round_below_min_notional: ${(formattedSize * entryPrice).toFixed(2)} < ${minNotional.toFixed(2)}`,
      };
    }

    // Set leverage (non-fatal), then place market order.
    try {
      await poloniexFuturesService.setLeverage(credentials, symbol, leverage);
    } catch (levErr) {
      logger.warn('[Monkey] setLeverage failed (non-fatal)', {
        symbol, leverage, err: levErr instanceof Error ? levErr.message : String(levErr),
      });
    }

    let orderId: string | null = null;
    try {
      const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
        symbol, side: exchangeSide, type: 'market', size: formattedSize, lotSize: symbolLotSize,
      });
      orderId =
        exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
        exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
      if (!orderId) {
        logger.warn('[Monkey] exchange placed but no orderId returned', {
          symbol, rawKeys: exchangeOrder ? Object.keys(exchangeOrder) : [],
        });
      }
    } catch (err) {
      logger.error('[Monkey] placeOrder failed', {
        symbol, side, err: err instanceof Error ? err.message : String(err),
      });
      return {
        executed: false, orderId: null,
        reason: `exchange_rejected: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Persist. Encode Monkey's state into reason so the close-hook +
    // reconciler can recover attribution cheaply (no schema change).
    // Format: monkey|phi=...|kappa=...|sov=...|src=witness
    try {
      const reasonEncoded =
        `monkey|phi=${req.phi.toFixed(3)}|kappa=${req.kappa.toFixed(2)}|sov=${req.sovereignty.toFixed(3)}|src=v0.3`;
      await pool.query(
        `INSERT INTO autonomous_trades
           (user_id, symbol, side, entry_price, quantity, leverage,
            confidence, reason, order_id, paper_trade, engine_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId, symbol, exchangeSide, entryPrice, formattedSize, leverage,
          req.phi, reasonEncoded, orderId, false, getEngineVersion(),
        ],
      );
    } catch (err) {
      logger.error('[Monkey] DB insert failed after exchange placement — ORPHAN RISK', {
        orderId, err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('[Monkey] ORDER PLACED', {
      symbol, side, orderId,
      margin: marginUsdt.toFixed(2),
      notional: notionalUsdt.toFixed(2),
      leverage,
      formattedSize,
      phi: req.phi.toFixed(3),
      sov: req.sovereignty.toFixed(3),
    });

    return { executed: true, orderId, reason: 'placed' };
  }

  /**
   * Bootstrap hook (v0.2): when liveSignalEngine closes a trade,
   * attribute the outcome to the perception basin Monkey held at
   * the moment of entry. This grows her resonance bank from the
   * trading already happening — no new capital risk, sovereignty
   * accrues, and the chicken-and-egg (size = Φ × sovereignty = 0)
   * unsticks within hours instead of never.
   *
   * Restart-safe: reads the entry basin from monkey_trajectory, so
   * a process restart between entry and exit is transparent.
   *
   * Called fire-and-forget from liveSignalEngine.reconcileClosedTrades.
   */
  async witnessExit(
    symbol: string,
    entryTime: Date,
    realizedPnl: number,
    orderId: string | null,
    side: 'long' | 'short',
  ): Promise<void> {
    try {
      const row = await pool.query(
        `SELECT basin, phi
           FROM monkey_trajectory
          WHERE symbol = $1 AND at <= $2
          ORDER BY at DESC LIMIT 1`,
        [symbol, entryTime],
      );
      const rec = row.rows[0] as { basin: number[] | string; phi: number } | undefined;
      if (!rec) {
        logger.debug('[Monkey] witnessExit: no trajectory found for entry', {
          symbol, entryTime: entryTime.toISOString(),
        });
        return;
      }
      const basinArr = typeof rec.basin === 'string' ? JSON.parse(rec.basin) : rec.basin;
      const entryBasin: Basin = Float64Array.from(basinArr);
      const phi = Number(rec.phi) || 0.5;

      // Synthesize a bubble that looks like it was promoted from WM
      // with the outcome attached. Bypass working memory — the bubble
      // is already resolved.
      const bubble: Bubble = {
        id: `witness-${orderId ?? Date.now()}`,
        center: entryBasin,
        phi,
        createdAt: entryTime.getTime(),
        lifetimeMs: 0,
        status: 'promoted',
        metadata: { source: 'live_signal_witness', orderId },
        payload: {
          symbol,
          signal: side === 'long' ? 'BUY' : 'SELL',
          realizedPnl,
          entryBasin,
          orderId: orderId ?? undefined,
        },
      };
      const written = await resonanceBank.writeBubble(bubble, getEngineVersion());
      if (written) {
        logger.info('[Monkey] witnessExit → bank', {
          symbol, orderId, side, pnl: realizedPnl.toFixed(4),
          entryTime: entryTime.toISOString(),
        });
      }
    } catch (err) {
      logger.debug('[Monkey] witnessExit failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
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
