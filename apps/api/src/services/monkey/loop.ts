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
import { callAutonomicTick } from './autonomic_client.js';
import { BasinSync } from './basin_sync.js';
import { BusEventType, getKernelBus, type KernelBus } from './kernel_bus.js';
import {
  callTickRun,
  isShadowTickEnabled,
  logParityDiff,
  logTickParityDiffs,
  type TickRunAccount,
  type TickRunOHLCV,
  type TickRunSymbolState,
} from './kernel_client.js';
import { detectMode, MODE_PROFILES, MonkeyMode } from './modes.js';
import { computeNeurochemicals, summarizeNC, type NeurochemicalState } from './neurochemistry.js';
import {
  basinDirection as computeBasinDirection,
  perceive,
  refract,
  trendProxy as computeTrendProxy,
  type OHLCVCandle,
} from './perception.js';
import { resonanceBank } from './resonance_bank.js';
import { computeSelfObservation, type SelfObservation } from './self_observation.js';
import { WorkingMemory, type Bubble } from './working_memory.js';
import {
  currentEntryThreshold,
  currentLeverage,
  currentPositionSize,
  shouldAutoFlatten,
  shouldDCAAdd,
  shouldExit,
  shouldProfitHarvest,
  shouldScalpExit,
  type BasinState,
} from './executive.js';

/** Default Monkey watchlist — matches liveSignalEngine for side-by-side. */
const DEFAULT_SYMBOLS = ['BTC_USDT_PERP', 'ETH_USDT_PERP'];
// v0.4: faster tick so scalp TP/SL exits catch sub-minute wiggles.
// Full perception runs per tick; DB + compute cost is modest.
const DEFAULT_TICK_MS = Number(process.env.MONKEY_TICK_MS) || 30_000;
/** OHLCV window ml-worker also uses. */
const OHLCV_LOOKBACK = 200;

/** Running history for Loop 1 self-observation + f_health trend. */
const HISTORY_MAX = 100;

/**
 * ActivityReward (v0.6.7) — pantheon-chat autonomic pattern port.
 *
 * When a trade closes with realized P&L, the kernel PUSHES one of these
 * onto its pendingRewards queue — it does NOT set dopamine directly.
 * Each tick, the tick loop sums recent rewards with exponential decay
 * and passes the result to computeNeurochemicals as an INPUT. The
 * chemical is still derived, just from a richer state.
 *
 * Preserves P5 Autonomy + P14 Variable Separation: rewards are STATE
 * events; neurotransmitters are derived VIEWS; nothing externally
 * writes the chemical levels.
 */
interface ActivityReward {
  source: string;           // 'trade_close' | 'witnessed_liveSignal' | ...
  symbol?: string;
  dopamineDelta: number;    // reward magnitude for dopamine boost
  serotoninDelta: number;   // mood/stability boost (calm-close reward)
  endorphinDelta: number;   // peak-state reward (win-in-high-coupling regime)
  realizedPnlUsdt: number;  // source P&L (for audit)
  pnlFraction: number;      // P&L / margin, signed
  atMs: number;             // when the event landed
}

/** Half-life for reward decay (ms). Rewards older than ~3 × this are ≈ 0. */
const REWARD_HALF_LIFE_MS = 20 * 60_000;  // 20 min

/** Max rewards retained; FIFO eviction. */
const REWARD_QUEUE_MAX = 50;

/**
 * Per-kernel configuration (v0.6b). Different sub-Monkeys differ in
 * timeframe, cadence, instance identity, and how they size relative to
 * their cap share. All share the underlying basin/executive/NC math.
 */
export interface MonkeyKernelConfig {
  /** Unique kernel identifier — written as `kernel=<id>` in trade reason and to monkey_basin_sync. */
  instanceId: string;
  /** Candle timeframe she perceives on. '5m' | '15m' | '1m' etc. */
  timeframe: string;
  /** Base tick cadence (ms) — mode profiles still adapt within this. */
  tickMs: number;
  /** Optional symbol override; defaults to DEFAULT_SYMBOLS. */
  symbols?: string[];
  /** Human label for logs. */
  label?: string;
  /** Fraction-of-margin cap. Two parallel kernels at 0.5 each stay under
   *  the risk-kernel per-symbol 5× exposure cap when both are open. */
  sizeFraction?: number;
}

interface SymbolState {
  lastBasin: Basin;
  /** Identity basin — starts uniform, crystallizes after N lived trades per §3.4 */
  identityBasin: Basin;
  /** Rolling Φ history for delta computation. */
  phiHistory: number[];
  /** Rolling f_health for auto-flatten trend check. */
  fHealthHistory: number[];
  /** Rolling identity-drift history (Fisher-Rao) for mode detection. */
  driftHistory: number[];
  /** Basin trajectory for repetition detection (Loop 1). */
  basinHistory: Basin[];
  /** Working memory (qig-cache) for recent bubbles. */
  wm: WorkingMemory;
  /** Kappa estimate — adaptive from basin velocity × coupling. */
  kappa: number;
  /** Active bubble id for the currently open position (if any). */
  openBubbleId: string | null;
  sessionTicks: number;
  /** Last mode (for transition logging). */
  lastMode: MonkeyMode | null;
  /** Mode-specific tickMs last applied — used by adaptive-tick governor. */
  currentTickMs: number;
  /** v0.6.1: high-water-mark unrealized PnL on the currently-held trade.
   *  Reset to null on close. Survives kernel restarts? No — will re-peak
   *  as ticks come in, which is safer than over-claiming. */
  peakPnlUsdt: number | null;
  /** Trade id of the position currently being peak-tracked. If the open
   *  trade id changes (new position), peak resets. */
  peakTrackedTradeId: string | null;
  /** v0.6.2: most recent entry time for this position (initial or DCA add).
   *  Used for DCA cooldown gating. Null when flat. */
  lastEntryAtMs: number | null;
  /** v0.6.2: count of DCA adds on current position (0 = only initial entry). */
  dcaAddCount: number;
}

/**
 * MonkeyKernel — the top-level kernel that ticks Monkey.
 *
 * One instance per process. Holds per-symbol SymbolState.
 */
export class MonkeyKernel extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickMs: number;
  private readonly baseTickMs: number;
  private readonly symbols: string[];
  private readonly timeframe: string;
  private readonly instanceId: string;
  private readonly label: string;
  private readonly sizeFraction: number;
  private tickInFlight = false;
  private symbolStates: Map<string, SymbolState> = new Map();
  /** Self-observation summary refreshed every ~60 ticks for entry bias. */
  private selfObs: SelfObservation | null = null;
  private selfObsLastUpdate = 0;
  private static readonly SELF_OBS_REFRESH_MS = 5 * 60_000;  // 5 min
  /** Basin-sync instance — per-kernel, so sub-kernels appear as peers. */
  private readonly basinSync: BasinSync;
  /** Kernel bus — pub/sub for inter-kernel comms (v0.6a). */
  private readonly bus: KernelBus = getKernelBus();
  /** Autonomic reward queue (v0.6.7). Closed trades push ActivityReward
   *  events here; each tick sums these with exponential time-decay and
   *  feeds the result to computeNeurochemicals. Pantheon-style — chem
   *  levels are DERIVED, never SET. */
  private pendingRewards: ActivityReward[] = [];
  /**
   * ML-outage observability counter (v0.8.3.5d). Increments every time
   * mlPredictionService.getTradingSignal returns {error: true}. Used to
   * emit a single warn-level log + bus ANOMALY event when the run goes
   * from reachable → unreachable (and again on recovery), instead of
   * logging on every tick. Existing position exits don't depend on the
   * ML signal (verified in processSymbol lines 585–711: exit gates read
   * basin state + P&L only), so the bot stays in a correct HOLD-safe
   * mode during outages — but without this counter nothing surfaces
   * that the bot is in defensive mode, which previously read as a
   * "freeze" to the user (2026-04-22 incident during Stage 2 cut-over).
   */
  private mlOutageStreak = 0;

  constructor(config?: Partial<MonkeyKernelConfig>) {
    super();
    const cfg: MonkeyKernelConfig = {
      instanceId: config?.instanceId ?? process.env.MONKEY_INSTANCE_ID ?? 'monkey-primary',
      timeframe: config?.timeframe ?? '15m',
      tickMs: config?.tickMs ?? DEFAULT_TICK_MS,
      symbols: config?.symbols ?? [...DEFAULT_SYMBOLS],
      label: config?.label ?? 'Monkey',
      sizeFraction: config?.sizeFraction ?? 1.0,
    };
    this.instanceId = cfg.instanceId;
    this.timeframe = cfg.timeframe;
    this.baseTickMs = cfg.tickMs;
    this.tickMs = cfg.tickMs;
    this.symbols = cfg.symbols!;
    this.label = cfg.label!;
    this.sizeFraction = cfg.sizeFraction!;
    this.basinSync = new BasinSync(this.instanceId);
  }

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
    logger.info(`[${this.label}] kernel waking`, {
      instanceId: this.instanceId,
      timeframe: this.timeframe,
      tickMs: this.tickMs,
      sizeFraction: this.sizeFraction,
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
      driftHistory: [],
      basinHistory: [],
      wm: new WorkingMemory({
        promoteCallback: async (b: Bubble) => {
          await resonanceBank.writeBubble(b, getEngineVersion());
        },
      }),
      kappa: KAPPA_STAR,
      openBubbleId: null,
      sessionTicks: 0,
      lastMode: null,
      currentTickMs: this.tickMs,
      peakPnlUsdt: null,
      peakTrackedTradeId: null,
      lastEntryAtMs: null,
      dcaAddCount: 0,
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

    // v0.8.3b: snapshot serializable state BEFORE any mutation for the
    // Python shadow tick. Captured here so Python sees the same "prior
    // state" the TS pipeline starts from.
    const shadowPrevState: TickRunSymbolState | null = isShadowTickEnabled()
      ? {
          symbol,
          identity_basin: Array.from(state.identityBasin),
          last_basin: state.lastBasin ? Array.from(state.lastBasin) : null,
          kappa: state.kappa,
          session_ticks: state.sessionTicks,
          last_mode: state.lastMode,
          basin_history: state.basinHistory.map((b) => Array.from(b)),
          phi_history: [...state.phiHistory],
          fhealth_history: [...state.fHealthHistory],
          drift_history: [...state.driftHistory],
          dca_add_count: state.dcaAddCount,
          last_entry_at_ms: state.lastEntryAtMs,
          peak_pnl_usdt: state.peakPnlUsdt,
          peak_tracked_trade_id: state.peakTrackedTradeId,
        }
      : null;

    state.sessionTicks++;

    // 1. Fetch inputs (same as liveSignalEngine sees).
    const ohlcv = (await poloniexFuturesService.getHistoricalData(
      symbol,
      this.timeframe,
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

    // ML-unreachable observability (v0.8.3.5d). mlPredictionService already
    // fail-opens to {signal:'HOLD', strength:0, error:true} on transport
    // failure; the Monkey tick correctly holds new entries in that case
    // (entry gate requires mlStrength >= threshold, 0 never clears any
    // positive threshold), and exits keep firing from basin geometry. But
    // the silent HOLD mode previously looked like a freeze from the user's
    // POV (2026-04-22 incident). Fire a WARN + bus ANOMALY on the
    // transition to/from ML-unreachable — edge-triggered, not per-tick,
    // so logs don't flood during a long outage.
    if (raw?.error === true) {
      this.mlOutageStreak += 1;
      if (this.mlOutageStreak === 1) {
        logger.warn('[Monkey] ML unreachable — holding new entries, exits continue', {
          symbol,
          reason: raw?.reason,
        });
        this.bus.publish({
          type: BusEventType.ANOMALY,
          source: this.instanceId,
          symbol,
          payload: {
            kind: 'ml_unreachable',
            reason: raw?.reason ?? 'ml prediction errored',
            entriesHeld: true,
            exitsActive: true,
          },
        });
      }
    } else if (this.mlOutageStreak > 0) {
      // Recovery — log once, publish once, reset counter.
      logger.info('[Monkey] ML reachable again after %d tick outage', this.mlOutageStreak, {
        symbol,
      });
      this.bus.publish({
        type: BusEventType.ANOMALY,
        source: this.instanceId,
        symbol,
        payload: {
          kind: 'ml_recovered',
          outageTicks: this.mlOutageStreak,
        },
      });
      this.mlOutageStreak = 0;
    }

    // Account context (also shared with liveSignalEngine).
    // NOTE: exchangeHeldSide is the SHARED exchange position state —
    // includes positions held by liveSignalEngine and any other engine.
    // Do NOT use it to gate Monkey's entry logic (2026-04-21 bug: she
    // was locked out any time liveSignal held a position). Use it only
    // for perception inputs; her own held-side is derived per-kernel
    // from findOpenMonkeyTrade below.
    const {
      equityFraction,
      marginFraction,
      openPositions,
      heldSide: exchangeHeldSide,
      availableEquity,
    } = await this.fetchAccountContext(symbol);

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

    // v0.6.7: consume the decayed reward queue as a neurochemistry input.
    // Nothing externally writes dopamine — the chemical is derived each
    // tick from (Φ gradient + decayed lived-outcome stream).
    const rewardDeltas = this.decayedRewardSums();
    const nc: NeurochemicalState = computeNeurochemicals({
      isAwake: true,
      phiDelta,
      basinVelocity: bv,
      surprise: Math.abs(phiDelta) * 2,
      quantumWeight: regimeWeights.quantum,
      kappa: state.kappa,
      externalCoupling: couplingHealth,
      rewardDopamineDelta: rewardDeltas.dopamine,
      rewardSerotoninDelta: rewardDeltas.serotonin,
      rewardEndorphinDelta: rewardDeltas.endorphin,
    });

    // v0.7.10 shadow-mode: call the Python autonomic kernel in parallel
    // and log parity diffs. TS path remains authoritative until
    // MONKEY_KERNEL_PY=true flips the default. Fire-and-forget — shadow
    // latency must not block the tick.
    if (process.env.MONKEY_KERNEL_PY_SHADOW === 'true') {
      void callAutonomicTick({
        instanceId: this.instanceId,
        phiDelta,
        basinVelocity: bv,
        surprise: Math.abs(phiDelta) * 2,
        quantumWeight: regimeWeights.quantum,
        kappa: state.kappa,
        externalCoupling: couplingHealth,
        currentMode: state.lastMode ?? 'investigation',
        isFlat: !exchangeHeldSide,
      }).then((pyResult) => {
        logParityDiff('nc.dopamine', nc.dopamine, pyResult.nc.dopamine);
        logParityDiff('nc.serotonin', nc.serotonin, pyResult.nc.serotonin);
        logParityDiff('nc.endorphins', nc.endorphins, pyResult.nc.endorphins);
        logParityDiff('nc.norepinephrine', nc.norepinephrine, pyResult.nc.norepinephrine);
      }).catch((err) => {
        logger.debug('[shadow] autonomic parity fetch failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

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

    // v0.5: DETECT MODE — one of EXPLORATION / INVESTIGATION / INTEGRATION / DRIFT.
    // driftHistory is maintained here so mode detector has the delta.
    const driftNow = fisherRao(basin, state.identityBasin);
    state.driftHistory.push(driftNow);
    if (state.driftHistory.length > HISTORY_MAX) state.driftHistory.shift();
    const modeDecision = detectMode({
      basin,
      identityBasin: state.identityBasin,
      phi,
      kappa: state.kappa,
      basinVelocity: bv,
      neurochemistry: nc,
      phiHistory: state.phiHistory,
      fHealthHistory: state.fHealthHistory,
      driftHistory: state.driftHistory,
    });
    const mode = modeDecision.value;
    if (state.lastMode !== null && state.lastMode !== mode) {
      logger.info('[Monkey] mode transition', {
        symbol,
        from: state.lastMode,
        to: mode,
        reason: modeDecision.reason,
      });
      this.bus.publish({
        type: BusEventType.MODE_TRANSITION,
        source: this.instanceId,
        symbol,
        payload: { from: state.lastMode, to: mode, reason: modeDecision.reason, phi, kappa: state.kappa },
      });
    }
    state.lastMode = mode;

    // Refresh self-observation entry bias every SELF_OBS_REFRESH_MS.
    const now = Date.now();
    if (now - this.selfObsLastUpdate > MonkeyKernel.SELF_OBS_REFRESH_MS) {
      this.selfObs = await computeSelfObservation(24, this.instanceId);
      this.selfObsLastUpdate = now;
    }
    // Side candidate: start from ML signal, then allow Monkey's own
    // direction-reading to override if it strongly disagrees (v0.5.2).
    // ml-worker has been observed 100 % BUY-biased — so her own basin +
    // recent tape have to be able to say "no, short instead" when the
    // evidence is clear. Override fires ONLY when both her basin view
    // AND the tape trend agree against ml-worker (two-signal quorum).
    const basinDir = computeBasinDirection(basin);
    const tapeTrend = computeTrendProxy(ohlcv);
    const mlSide: 'long' | 'short' = mlSignal === 'SELL' ? 'short' : 'long';
    let sideCandidate: 'long' | 'short' = mlSide;
    let sideOverride = false;
    // Agreement: if both basin and tape are strongly negative, short;
    // if both strongly positive, long; else defer to ml.
    const OVERRIDE_THRESHOLD = 0.35;
    if (basinDir < -OVERRIDE_THRESHOLD && tapeTrend < -OVERRIDE_THRESHOLD && mlSide === 'long') {
      sideCandidate = 'short';
      sideOverride = true;
    } else if (basinDir > OVERRIDE_THRESHOLD && tapeTrend > OVERRIDE_THRESHOLD && mlSide === 'short') {
      sideCandidate = 'long';
      sideOverride = true;
    }
    const selfObsBias = this.selfObs?.entryBias[mode]?.[sideCandidate] ?? 1.0;

    // v0.5: Basin sync — publish own state; pull observer-effect influence.
    const syncPublish = this.basinSync.update({
      basin,
      phi,
      kappa: state.kappa,
      mode,
      driftFromIdentity: driftNow,
    }).catch(() => { /* non-fatal */ });
    void syncPublish;

    // 4. REMEMBER — add bubble; tick working memory
    const bubble = state.wm.add(basin, phi, { symbol, tick: state.sessionTicks });
    const wmStats = await state.wm.tick();

    // 5. DERIVE — executive computes what Monkey would do (mode-aware)
    // tapeTrend already computed above for side-override check.
    const entryThr = currentEntryThreshold(basinState, mode, selfObsBias, tapeTrend, sideCandidate);
    const maxLevBoundary = (await getMaxLeverage(symbol)) ?? 10;
    const leverage = currentLeverage(basinState, maxLevBoundary, mode, tapeTrend);
    const precisions = await getPrecisions(symbol).catch(() => null);
    const lotSize = precisions?.lotSize ?? 0;
    const minNotional = lastPrice * Math.max(lotSize, 1e-9);
    const bankSize = await resonanceBank.bankSize();
    // sizeFraction scales her share of equity so parallel sub-kernels
    // stay out of each other's way. (0.5 each = 1.0 combined.) On small
    // accounts this would halve margin below exchange min notional for
    // BOTH kernels — observed 2026-04-21: $19 × 0.5 × 0.09 × 12x = $10
    // notional, below ETH's $23 min. So: effective sizeFraction bumps
    // back to 1.0 when capped equity × explorationFloor × newborn-leverage
    // can't reach min notional. On larger accounts this stays at the
    // configured 0.5 and both kernels share cleanly; the risk-kernel 5×
    // exposure cap still bounds combined concurrency.
    const expFloorApprox = 0.10;               // modes.ts EXPLORATION/INVESTIGATION baseline
    const maxNewbornLev = 20;                  // newborn sovereignCap floor
    const minNeededForMinNotional = minNotional / (expFloorApprox * maxNewbornLev);
    const effectiveSizeFraction = availableEquity * this.sizeFraction < minNeededForMinNotional
      ? 1.0
      : this.sizeFraction;
    const cappedEquity = availableEquity * effectiveSizeFraction;
    const size = currentPositionSize(basinState, cappedEquity, minNotional, leverage.value, bankSize, mode);
    const autoFlatten = shouldAutoFlatten(basinState, state.fHealthHistory);

    // 6. DECIDE — propose action
    let action: string;
    let reason: string;
    const derivation: Record<string, unknown> = {
      phi, kappa: state.kappa, sovereignty, basinVelocity: bv,
      regimeWeights, nc,
      fHealth, mlSignal, mlStrength,
      mode: { value: mode, reason: modeDecision.reason, ...modeDecision.derivation },
      selfObsBias,
      sideCandidate,
      basinDir,
      tapeTrend,
      mlSide,
      sideOverride,
    };

    // v0.6.3: Monkey's "held side" is scoped to HER OWN open rows only.
    // If only liveSignal holds a position on this symbol, Monkey treats
    // herself as flat and her entry logic can still fire (risk kernel's
    // exposure cap is the only thing bounding combined concurrency).
    const ownOpenRow = await this.findOpenMonkeyTrade(symbol);
    // v0.8.7d-8: when exchange says no position but DB has an open Monkey
    // row, prefer the DB row's side over a hardcoded 'long' fallback.
    // Previously: `exchangeHeldSide ?? 'long'` — caused OVERRIDE_REVERSE
    // [long→short] loops whenever LiveSignal just closed a short and the
    // exchange hadn't yet settled into the view Monkey reads, because
    // Monkey's DB row said short but the fallback claimed long. DB row
    // is authoritative for Monkey's own recent trades; reconciler closes
    // stale rows within 60s when exchange disagrees permanently.
    const heldSide: 'long' | 'short' | null = ownOpenRow
      ? (exchangeHeldSide ?? ownOpenRow.side)
      : null;
    derivation.exchangeHeldSide = exchangeHeldSide;
    derivation.monkeyHeldSide = heldSide;

    if (autoFlatten.value) {
      action = 'flatten';
      reason = autoFlatten.reason;
      derivation.autoFlatten = autoFlatten.derivation;
    } else if (heldSide) {
      // Exit-gate order (v0.6.1):
      //   1. profit harvest (trailing + trend-flip, only while green)
      //   2. scalp TP/SL
      //   3. Loop 2 regime-shift (shouldExit)
      let exitFired = false;
      const openRow = ownOpenRow;  // reuse the lookup from above
      if (openRow) {
        const positionNotional = Number(openRow.entry_price) * Number(openRow.quantity);
        const sidesign = heldSide === 'long' ? 1 : -1;
        const unrealizedPnl = (lastPrice - Number(openRow.entry_price)) * Number(openRow.quantity) * sidesign;
        const tradeId = String(openRow.id);

        // Reset peak tracking when we detect a NEW trade vs what we
        // were peak-tracking. (Covers reconciler-replaced rows.)
        if (state.peakTrackedTradeId !== tradeId) {
          state.peakPnlUsdt = unrealizedPnl;
          state.peakTrackedTradeId = tradeId;
        } else {
          state.peakPnlUsdt = Math.max(state.peakPnlUsdt ?? 0, unrealizedPnl);
        }

        // 1. Profit harvest — trailing stop + trend-flip, only while green
        const harvest = shouldProfitHarvest(
          unrealizedPnl,
          state.peakPnlUsdt ?? 0,
          positionNotional,
          tapeTrend,
          heldSide,
          basinState,
        );
        derivation.harvest = { ...harvest.derivation, unrealizedPnl, peakPnl: state.peakPnlUsdt, tradeId };
        if (harvest.value) {
          action = 'scalp_exit';  // executes via same close path
          reason = harvest.reason;
          exitFired = true;
          // Tag the exit type so closeHeldPosition stores the right exit_reason
          derivation.scalp = {
            exitTypeBit: harvest.derivation.exitTypeBit,
            unrealizedPnl,
            markPrice: lastPrice,
            tradeId,
          };
        }

        // 2. Scalp TP/SL (only if harvest didn't fire)
        if (!exitFired) {
          const scalp = shouldScalpExit(unrealizedPnl, positionNotional, basinState, mode);
          derivation.scalp = { ...scalp.derivation, unrealizedPnl, markPrice: lastPrice, tradeId };
          if (scalp.value) {
            action = 'scalp_exit';
            reason = scalp.reason;
            exitFired = true;
          }
        }
      }
      if (!exitFired) {
        // 3. Loop 2 debate — perception vs identity
        const exit = shouldExit(basin, state.identityBasin, heldSide, basinState);
        if (exit.value) {
          action = 'exit';
          reason = exit.reason;
          derivation.exit = exit.derivation;
        } else if (
          // 3b. v0.7.1 — OVERRIDE REVERSAL. When basin + tape quorum
          // flipped sideCandidate AGAINST the currently-held side, she
          // wants to reverse, not add. Poloniex v3 one-way position
          // mode NETS a reverse-direction order against the existing
          // position — so naive "submit SHORT while LONG" just cancels
          // the long and leaves the exchange flat. Fix: flatten-first,
          // then submit new direction. Observed 2026-04-21 09:29 UTC
          // when she attempted a basin-override short while ETH long
          // was open; short vanished via netting.
          sideOverride &&
          sideCandidate !== heldSide &&
          MODE_PROFILES[mode].canEnter &&
          mlStrength >= entryThr.value &&
          size.value > 0
        ) {
          action = sideCandidate === 'long' ? 'reverse_long' : 'reverse_short';
          reason = `OVERRIDE_REVERSE[${heldSide}→${sideCandidate}] basin=${basinDir.toFixed(2)} tape=${tapeTrend.toFixed(2)}; flatten-then-open margin=${size.value.toFixed(2)} lev=${leverage.value}x`;
          derivation.entryThreshold = entryThr.derivation;
          derivation.size = size.derivation;
          derivation.leverage = leverage.derivation;
          derivation.isReverse = true;
        } else {
          // 4. v0.6.2 — DCA add eligibility. Can she add to the position
          //    at a better price while the ML signal still supports the
          //    side? Five guard rails in shouldDCAAdd; plus ML-gate +
          //    mode-entry-allowed + size>0 + matching side here.
          const initialEntryPrice = openRow ? Number(openRow.entry_price) : lastPrice;
          const dca = shouldDCAAdd({
            heldSide,
            sideCandidate,
            currentPrice: lastPrice,
            initialEntryPrice,
            addCount: state.dcaAddCount,
            lastAddAtMs: state.lastEntryAtMs ?? 0,
            nowMs: Date.now(),
            sovereignty,
          });
          derivation.dca = dca.derivation;
          if (
            dca.value &&
            MODE_PROFILES[mode].canEnter &&
            mlStrength >= entryThr.value &&
            mlSignal !== 'HOLD' &&
            size.value > 0
          ) {
            // DCA add — treated as enter_long/short by execute block but
            // tagged via derivation.dca so the persisted row reflects it.
            action = sideCandidate === 'long' ? 'enter_long' : 'enter_short';
            reason = `DCA_ADD[${state.dcaAddCount + 1}/${1}] ${dca.reason} | side=${sideCandidate} margin=${size.value.toFixed(2)} lev=${leverage.value}x`;
            derivation.entryThreshold = entryThr.derivation;
            derivation.size = size.derivation;
            derivation.leverage = leverage.derivation;
            derivation.isDCAAdd = true;
          } else {
            action = 'hold';
            reason = `${exit.reason} | dca: ${dca.reason}`;
          }
        }
      }
    } else if (
      MODE_PROFILES[mode].canEnter &&
      mlStrength >= entryThr.value &&
      mlSignal !== 'HOLD' &&
      size.value > 0
    ) {
      // sideCandidate already reflects any basin+tape override of the ML signal.
      action = sideCandidate === 'long' ? 'enter_long' : 'enter_short';
      const overrideTag = sideOverride ? ` OVERRIDE(basin${basinDir.toFixed(2)}/tape${tapeTrend.toFixed(2)})` : '';
      reason = `[${mode}] ml ${mlSignal}@${mlStrength.toFixed(3)} >= thr ${entryThr.value.toFixed(3)}; side=${sideCandidate}${overrideTag}; margin=${size.value.toFixed(2)} lev=${leverage.value}x notional=${(size.value * leverage.value).toFixed(2)}`;
      derivation.entryThreshold = entryThr.derivation;
      derivation.size = size.derivation;
      derivation.leverage = leverage.derivation;
    } else {
      action = 'hold';
      const why = !MODE_PROFILES[mode].canEnter
        ? `mode=${mode} blocks entry (${MODE_PROFILES[mode].description})`
        : mlStrength < entryThr.value
          ? `[${mode}] ml ${mlStrength.toFixed(3)} < thr ${entryThr.value.toFixed(3)}`
          : size.value <= 0
          ? `[${mode}] size ${size.value.toFixed(2)} below min notional ${minNotional.toFixed(2)}`
          : 'no qualifying signal';
      reason = why;
      derivation.entryThreshold = entryThr.derivation;
    }

    // v0.8.3b — shadow the full Python tick pipeline. Fire-and-forget:
    // Python's decision is NOT authoritative; we only log parity diffs.
    // TS remains the live path. Gated by MONKEY_TICK_PY_SHADOW=true.
    if (shadowPrevState !== null) {
      const shadowOhlcv: TickRunOHLCV[] = ohlcv.map((c) => ({
        timestamp: Number(c.timestamp ?? 0),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }));
      const shadowAccount: TickRunAccount = {
        equity_fraction: equityFraction,
        margin_fraction: marginFraction,
        open_positions: openPositions,
        available_equity: availableEquity,
        exchange_held_side: exchangeHeldSide,
        own_position_entry_price: ownOpenRow ? Number(ownOpenRow.entry_price) : null,
        own_position_quantity: ownOpenRow ? Number(ownOpenRow.quantity) : null,
        own_position_trade_id: ownOpenRow ? String(ownOpenRow.id) : null,
      };
      void callTickRun({
        instance_id: this.instanceId,
        inputs: {
          symbol,
          ohlcv: shadowOhlcv,
          ml_signal: mlSignal,
          ml_strength: mlStrength,
          account: shadowAccount,
          bank_size: bankSize,
          sovereignty,
          max_leverage: maxLevBoundary,
          min_notional: minNotional,
          size_fraction: this.sizeFraction,
          self_obs_bias: this.selfObs?.entryBias ?? null,
        },
        prev_state: shadowPrevState,
      }).then((pyResult) => {
        logTickParityDiffs(symbol, {
          action,
          entry_threshold: entryThr.value,
          leverage: leverage.value,
          size_usdt: size.value,
          mode,
          side_candidate: sideCandidate,
          side_override: sideOverride,
          phi,
          kappa: state.kappa,
        }, pyResult.decision);
      }).catch((err) => {
        logger.debug('[shadow-tick] tick/run parity fetch failed', {
          symbol,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // 6b. EXECUTE — gated by MONKEY_EXECUTE=true. Observe-only otherwise.
    let executed = false;
    let monkeyOrderId: string | null = null;
    if (process.env.MONKEY_EXECUTE === 'true') {
      if ((action === 'enter_long' || action === 'enter_short') && size.value > 0) {
        const isDCA = Boolean(derivation.isDCAAdd);
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
          isDCAAdd: isDCA,
          dcaAddIndex: isDCA ? state.dcaAddCount + 1 : 0,
        });
        executed = execResult.executed;
        monkeyOrderId = execResult.orderId;
        if (!executed) {
          reason += ` | execute: ${execResult.reason}`;
        } else {
          // v0.6.2 bookkeeping
          state.lastEntryAtMs = Date.now();
          if (isDCA) {
            state.dcaAddCount += 1;
          } else {
            state.dcaAddCount = 0;  // fresh position
            state.peakPnlUsdt = null;
            state.peakTrackedTradeId = null;
          }
        }
      } else if (action === 'scalp_exit' && heldSide) {
        const scalpDeriv = derivation.scalp as Record<string, unknown> | undefined;
        const tradeId = scalpDeriv?.tradeId ? String(scalpDeriv.tradeId) : null;
        const exitTypeBit = Number(scalpDeriv?.exitTypeBit ?? 0);
        const exitType =
          exitTypeBit === 1 ? 'take_profit' :
          exitTypeBit === -1 ? 'stop_loss' :
          exitTypeBit === 2 ? 'trailing_harvest' :
          exitTypeBit === 3 ? 'trend_flip_harvest' :
          'scalp_exit';
        const pnlAtDecision = Number(scalpDeriv?.unrealizedPnl ?? 0);
        if (tradeId) {
          const closeResult = await this.closeHeldPosition({
            symbol,
            tradeId,
            heldSide,
            markPrice: lastPrice,
            exitReason: exitType,
            pnlAtDecision,
          });
          executed = closeResult.executed;
          monkeyOrderId = closeResult.orderId;
          if (executed) {
            // Clear trade-level state now the position is closed.
            state.peakPnlUsdt = null;
            state.peakTrackedTradeId = null;
            state.dcaAddCount = 0;
            state.lastEntryAtMs = null;
          }
          if (!executed) {
            reason += ` | close: ${closeResult.reason}`;
          } else {
            reason += ` | closed@${lastPrice.toFixed(2)} pnl=${pnlAtDecision.toFixed(4)}`;
          }
        }
      } else if ((action === 'reverse_long' || action === 'reverse_short') && heldSide) {
        // v0.7.1 — flatten-then-reverse. Two-phase:
        //   1. reduce-only close the existing opposite-side position
        //   2. brief settle delay so the exchange nets cleanly
        //   3. fresh executeEntry in the new direction
        const newSide: 'long' | 'short' = action === 'reverse_long' ? 'long' : 'short';
        const existingRowId = ownOpenRow ? String(ownOpenRow.id) : null;
        // Use current unrealized as pnl estimate for the close row update.
        let pnlAtDecision = 0;
        if (ownOpenRow) {
          const entryP = Number(ownOpenRow.entry_price);
          const qty = Number(ownOpenRow.quantity);
          const sidesign = heldSide === 'long' ? 1 : -1;
          pnlAtDecision = (lastPrice - entryP) * qty * sidesign;
        }
        if (existingRowId) {
          const closeResult = await this.closeHeldPosition({
            symbol,
            tradeId: existingRowId,
            heldSide,
            markPrice: lastPrice,
            exitReason: 'override_reverse',
            pnlAtDecision,
          });
          if (closeResult.executed) {
            state.peakPnlUsdt = null;
            state.peakTrackedTradeId = null;
            state.dcaAddCount = 0;
            state.lastEntryAtMs = null;
            // Settle delay — give the exchange ~500ms to flatten net.
            await new Promise((resolve) => setTimeout(resolve, 500));
            const execResult = await this.executeEntry({
              symbol,
              side: newSide,
              marginUsdt: size.value,
              leverage: leverage.value,
              entryPrice: lastPrice,
              minNotional,
              phi,
              kappa: state.kappa,
              sovereignty,
              trajectoryId: null,
              isDCAAdd: false,
              dcaAddIndex: 0,
            });
            executed = execResult.executed;
            monkeyOrderId = execResult.orderId;
            if (executed) {
              state.lastEntryAtMs = Date.now();
              reason += ` | closed@${lastPrice.toFixed(2)} pnl=${pnlAtDecision.toFixed(4)} | new ${newSide} orderId=${monkeyOrderId}`;
            } else {
              reason += ` | flattened ok, new-entry failed: ${execResult.reason}`;
            }
          } else {
            reason += ` | flatten failed: ${closeResult.reason}; reverse aborted`;
          }
        }
      }
    }

    // Info-level log — the user asked for end-to-end observability.
    logger.info(`[Monkey] ${symbol} [${mode}] ${action}${executed ? ' EXECUTED' : ''}`, {
      mode,
      phi: phi.toFixed(3),
      kappa: state.kappa.toFixed(2),
      nc: summarizeNC(nc),
      reg: `q${regimeWeights.quantum.toFixed(2)}/e${regimeWeights.efficient.toFixed(2)}/eq${regimeWeights.equilibrium.toFixed(2)}`,
      bv: bv.toFixed(3),
      drift: driftNow.toFixed(3),
      fh: fHealth.toFixed(3),
      sov: sovereignty.toFixed(3),
      wm: `${wmStats.alive}a/${wmStats.promoted}prom/${wmStats.popped}pop`,
      selfObsBias: selfObsBias.toFixed(2),
      tape: tapeTrend.toFixed(3),
      basinDir: basinDir.toFixed(3),
      side: sideCandidate,
      override: sideOverride,
      orderId: monkeyOrderId ?? undefined,
      reason,
    });

    // Persist mode observation for later Loop-1 aggregation + UI.
    try {
      await pool.query(
        `INSERT INTO monkey_modes (symbol, mode, phi, kappa, drift, basin_velocity, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [symbol, mode, phi, state.kappa, driftNow, bv, modeDecision.reason],
      );
    } catch (err) {
      logger.debug('[Monkey] monkey_modes insert failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

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

    // v0.5 adaptive cadence: take the minimum tickMs across all symbols so
    // the shortest-cadence mode wins. Kernel-wide tick is rescheduled only
    // when the aggregate target differs from the current interval.
    state.currentTickMs = MODE_PROFILES[mode].tickMs;
    this.maybeRescheduleTick();
  }

  /**
   * If the mode-aggregate target tickMs has shifted from current, restart
   * the interval at the new cadence. Called at the tail of each symbol's
   * processSymbol() so the kernel adapts within a tick or two of a mode
   * transition.
   */
  private maybeRescheduleTick(): void {
    const targets = [...this.symbolStates.values()].map((s) => s.currentTickMs);
    if (targets.length === 0) return;
    const target = Math.min(...targets);
    if (target !== this.tickMs && target > 0) {
      logger.info('[Monkey] rescheduling tick', { from: this.tickMs, to: target });
      this.tickMs = target;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = setInterval(() => void this.tick(), this.tickMs);
        this.timer.unref?.();
      }
    }
  }

  /**
   * Look up Monkey's most recent open trade row for a symbol. Used by
   * the scalp-exit gate (v0.4) to compute unrealized P&L.
   */
  private async findOpenMonkeyTrade(symbol: string): Promise<
    | { id: string; entry_price: string; quantity: string; leverage: number; order_id: string | null; side: 'long' | 'short' }
    | null
  > {
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      const result = await pool.query(
        `SELECT id, entry_price, quantity, leverage, order_id, side
           FROM autonomous_trades
          WHERE reason LIKE $2 AND status = 'open' AND symbol = $1
          ORDER BY entry_time ASC`,
        [symbol, reasonPattern],
      );
      const rows = result.rows as Array<{
        id: string; entry_price: string; quantity: string; leverage: number; order_id: string | null; side: string;
      }>;
      const normSide = (s: string): 'long' | 'short' =>
        s === 'buy' || s === 'long' ? 'long' : 'short';
      if (rows.length === 0) return null;
      if (rows.length === 1) return { ...rows[0], side: normSide(rows[0].side) };
      // v0.6.2: multi-row position (DCA). Return an AGGREGATE pseudo-row:
      //   quantity = sum; entry_price = weighted average by quantity.
      //   id/order_id carry the oldest row so harvest/scalp reference a
      //   stable anchor across ticks. leverage = first row's leverage
      //   (they should match; risk kernel enforces). side = oldest row's
      //   side (DCA rows should share side; entry kernel enforces).
      const totalQty = rows.reduce((s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
      const weightedPrice = rows.reduce(
        (s, r) => s + Number(r.entry_price) * Math.abs(Number(r.quantity) || 0),
        0,
      ) / totalQty;
      return {
        id: rows[0].id,
        entry_price: String(weightedPrice),
        quantity: String(totalQty),
        leverage: rows[0].leverage,
        order_id: rows[0].order_id,
        side: normSide(rows[0].side),
      };
    } catch (err) {
      logger.debug('[Monkey] findOpenMonkeyTrade failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Close a Monkey-owned position (v0.4). Submits opposite-side market
   * order and updates autonomous_trades with exit_price/pnl/exit_reason.
   * The reconciler will then pick up the closed row and fire
   * monkeyKernel.witnessExit → resonance-bank write.
   */
  private async closeHeldPosition(req: {
    symbol: string;
    tradeId: string;
    heldSide: 'long' | 'short';
    markPrice: number;
    exitReason: string;
    pnlAtDecision: number;
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, tradeId, heldSide, markPrice, exitReason, pnlAtDecision } = req;

    // Load credentials + position to know size to close.
    let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      const userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
      if (!userId) return { executed: false, orderId: null, reason: 'no_credentials' };
      const c = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!c) return { executed: false, orderId: null, reason: 'credentials_missing' };
      credentials = c;
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `close_credentials_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Read exchange position size (tradeId's quantity may diverge from
    // actual exchange state if partial fills or reconciler updates).
    let exchangeQty = 0;
    try {
      const positions = await poloniexFuturesService.getPositions(credentials);
      const forSymbol = (Array.isArray(positions) ? positions : []).find(
        (p: Record<string, unknown>) => String(p.symbol ?? '') === symbol,
      );
      exchangeQty = Math.abs(Number(forSymbol?.qty ?? forSymbol?.size ?? 0));
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `position_read_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (exchangeQty <= 0) {
      // Position vanished between decide and close — reconciler will
      // catch the DB row; nothing for us to close on-exchange.
      await pool.query(
        `UPDATE autonomous_trades SET status='closed', exit_price=$1, exit_time=NOW(),
                exit_reason='vanished_before_close', pnl=$2 WHERE id=$3`,
        [markPrice, pnlAtDecision, tradeId],
      ).catch(() => { /* non-fatal */ });
      return { executed: false, orderId: null, reason: 'exchange_position_vanished' };
    }

    // Lot-size round.
    let formattedSize = exchangeQty;
    let symbolLotSize = 0;
    try {
      const precisions = await getPrecisions(symbol);
      if (precisions.lotSize && precisions.lotSize > 0) {
        symbolLotSize = precisions.lotSize;
        formattedSize = Math.floor(exchangeQty / precisions.lotSize) * precisions.lotSize;
      }
    } catch { /* use raw */ }
    if (formattedSize <= 0) {
      return { executed: false, orderId: null, reason: 'lot_rounding_zero_on_close' };
    }

    const closeSide: 'buy' | 'sell' = heldSide === 'long' ? 'sell' : 'buy';

    let orderId: string | null = null;
    try {
      const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
        symbol, side: closeSide, type: 'market', size: formattedSize, lotSize: symbolLotSize,
        reduceOnly: true,
      });
      orderId =
        exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
        exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `close_exchange_rejected: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // v0.6.2: close ALL open monkey rows for this (kernel, symbol). DCA
    // adds created multiple rows for one logical position; the exchange
    // flattened them all in one market close above (size = total exchange
    // qty). Each row shares the realized pnl proportionally by quantity.
    try {
      const openRows = await pool.query(
        `SELECT id, quantity FROM autonomous_trades
          WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
          ORDER BY entry_time ASC`,
        [`monkey|kernel=${this.instanceId}|%`, symbol],
      );
      const rows = openRows.rows as Array<{ id: string; quantity: string }>;
      const totalQty = rows.reduce((s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
      if (rows.length === 0 || totalQty === 0) {
        // Fallback — single-row close (covers edge case of race)
        await pool.query(
          `UPDATE autonomous_trades
              SET status = 'closed', exit_price = $1, exit_time = NOW(),
                  exit_reason = $2, exit_order_id = $3, pnl = $4
            WHERE id = $5`,
          [markPrice, exitReason, orderId, pnlAtDecision, tradeId],
        );
      } else {
        for (const row of rows) {
          const qtyShare = Math.abs(Number(row.quantity) || 0) / totalQty;
          const rowPnl = pnlAtDecision * qtyShare;
          await pool.query(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, pnl = $4
              WHERE id = $5`,
            [markPrice, exitReason, orderId, rowPnl, row.id],
          );
        }
      }
    } catch (err) {
      logger.error('[Monkey] close DB update failed — ORPHAN RISK (reconciler will catch)', {
        tradeId, err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('[Monkey] POSITION CLOSED', {
      symbol, heldSide, markPrice, orderId, tradeId,
      pnl: pnlAtDecision.toFixed(4), exitReason,
    });
    this.bus.publish({
      type: BusEventType.EXIT_TRIGGERED,
      source: this.instanceId,
      symbol,
      payload: { heldSide, markPrice, orderId, tradeId, pnl: pnlAtDecision, exitReason },
    });
    // v0.6.7 autonomic reward event. Margin ≈ markPrice × totalQty / lev
    // (she has only one kernel state; we use one of her symbol states
    // for κ). Pushed as an EVENT; computeNeurochemicals derives the
    // actual dopamine lift next tick.
    const symState = this.symbolStates.get(symbol);
    try {
      const totalQtyForMargin = exchangeQty || 0.01;
      const notional = markPrice * totalQtyForMargin;
      const margin = notional / Math.max(1, 16);  // typical lev on close; kappa boost uses exit κ
      this.pushReward({
        source: 'own_close',
        symbol,
        realizedPnlUsdt: pnlAtDecision,
        marginUsdt: margin,
        kappaAtExit: symState?.kappa,
      });
    } catch { /* non-fatal */ }
    return { executed: true, orderId, reason: 'closed' };
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
    /** v0.6.2: true when this is a DCA add, not an initial entry. */
    isDCAAdd?: boolean;
    /** 0 = initial entry; 1, 2, … for nth DCA add. */
    dcaAddIndex?: number;
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
      this.bus.publish({
        type: BusEventType.KERNEL_VETO,
        source: this.instanceId,
        symbol,
        payload: { side, notional: notionalUsdt, leverage, code: decision.code, reason: decision.reason },
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

    // Persist. Encode kernel + Monkey's state into reason so the
    // close-hook + reconciler can recover attribution cheaply (no
    // schema change).
    // Format: monkey|kernel=<id>|phi=...|kappa=...|sov=...|dca=<N>|src=<ver>
    try {
      const dcaTag = req.isDCAAdd ? `|dca=${req.dcaAddIndex ?? 1}` : '';
      const reasonEncoded =
        `monkey|kernel=${this.instanceId}|phi=${req.phi.toFixed(3)}|kappa=${req.kappa.toFixed(2)}|sov=${req.sovereignty.toFixed(3)}${dcaTag}|src=v0.6.2`;
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

    logger.info(req.isDCAAdd ? '[Monkey] DCA_ADD PLACED' : '[Monkey] ORDER PLACED', {
      symbol, side, orderId,
      margin: marginUsdt.toFixed(2),
      notional: notionalUsdt.toFixed(2),
      leverage,
      formattedSize,
      phi: req.phi.toFixed(3),
      sov: req.sovereignty.toFixed(3),
      dcaAddIndex: req.dcaAddIndex ?? 0,
    });

    this.bus.publish({
      type: BusEventType.ENTRY_EXECUTED,
      source: this.instanceId,
      symbol,
      payload: {
        side, orderId, margin: marginUsdt, notional: notionalUsdt, leverage,
        entryPrice, phi: req.phi, kappa: req.kappa, sovereignty: req.sovereignty,
        isDCAAdd: Boolean(req.isDCAAdd), dcaAddIndex: req.dcaAddIndex ?? 0,
      },
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

  /**
   * Push an autonomic reward event (v0.6.7). Called whenever a trade
   * closes with realized P&L. The kernel's tick loop will consume these
   * via `decayedRewardSums()` and pass the summed deltas to
   * `computeNeurochemicals` as INPUTS — never setting a chemical
   * directly. Pantheon-style (see autonomic_kernel.py ActivityReward).
   *
   * Reward magnitude scales with P&L/margin ratio. A 1 % win on margin
   * produces dopamine_delta ~0.15; a 3 % win ~0.45 (near the Φ-gradient
   * ceiling). Losses produce small NEGATIVE deltas — mild mood dip,
   * not a punishment, because self_observation's entry bias already
   * learns from losses.
   */
  pushReward(input: {
    source: string;
    symbol?: string;
    realizedPnlUsdt: number;
    marginUsdt: number;
    kappaAtExit?: number;
  }): void {
    const pnlFrac = input.marginUsdt > 0
      ? input.realizedPnlUsdt / input.marginUsdt
      : 0;
    // Dopamine: positive only, saturates at 3× margin win (pnlFrac ≥ 3).
    // Scales by tanh so losses don't punish via dopamine (that path is
    // self_observation's job).
    const dop = pnlFrac > 0
      ? Math.tanh(pnlFrac * 1.5) * 0.5  // 1 % win → 0.01, 10 % → 0.07, 100 % → 0.45
      : -Math.tanh(-pnlFrac * 0.5) * 0.1;  // small mood dip on loss
    // Serotonin: stable wins reinforce calm. Only positive on wins.
    const ser = pnlFrac > 0 ? Math.tanh(pnlFrac) * 0.15 : 0;
    // Endorphins: peak-state reward. Fires if closed near κ* with a win.
    const kappaProxim = input.kappaAtExit != null
      ? Math.exp(-Math.abs(input.kappaAtExit - 64) / 10)
      : 0.5;
    const endo = pnlFrac > 0 ? Math.tanh(pnlFrac * 2) * 0.3 * kappaProxim : 0;

    this.pendingRewards.push({
      source: input.source,
      symbol: input.symbol,
      dopamineDelta: dop,
      serotoninDelta: ser,
      endorphinDelta: endo,
      realizedPnlUsdt: input.realizedPnlUsdt,
      pnlFraction: pnlFrac,
      atMs: Date.now(),
    });
    if (this.pendingRewards.length > REWARD_QUEUE_MAX) {
      this.pendingRewards.shift();
    }
    logger.info(`[${this.label}] reward pushed`, {
      source: input.source,
      symbol: input.symbol,
      pnl: input.realizedPnlUsdt.toFixed(4),
      pnlFrac: (pnlFrac * 100).toFixed(2) + '%',
      dop: dop.toFixed(3),
      ser: ser.toFixed(3),
      endo: endo.toFixed(3),
    });
  }

  /**
   * Sum recent rewards with exponential time-decay. Called each tick by
   * processSymbol to build the NeurochemicalInputs reward deltas.
   * Half-life = REWARD_HALF_LIFE_MS (20 min default). Old rewards decay
   * naturally; queue also FIFO-evicts at REWARD_QUEUE_MAX.
   */
  private decayedRewardSums(nowMs: number = Date.now()): {
    dopamine: number;
    serotonin: number;
    endorphin: number;
  } {
    let dop = 0, ser = 0, endo = 0;
    for (const r of this.pendingRewards) {
      const ageMs = nowMs - r.atMs;
      const decay = Math.pow(0.5, ageMs / REWARD_HALF_LIFE_MS);
      if (decay < 0.01) continue;  // negligible, skip
      dop += r.dopamineDelta * decay;
      ser += r.serotoninDelta * decay;
      endo += r.endorphinDelta * decay;
    }
    return { dopamine: dop, serotonin: ser, endorphin: endo };
  }

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
        this.bus.publish({
          type: BusEventType.BANK_WRITE,
          source: this.instanceId,
          symbol,
          payload: { orderId, side, realizedPnl, entryTime: entryTime.toISOString() },
        });
        this.bus.publish({
          type: BusEventType.OUTCOME,
          source: this.instanceId,
          symbol,
          payload: { orderId, side, realizedPnl, win: realizedPnl > 0 },
        });
        // v0.6.7: witnessed liveSignal closes are also reinforcement
        // events — her bank learned from them, so her NC should too.
        // Dampen the reward magnitude since it wasn't her trade (she
        // just observed). Estimate margin from typical liveSignal
        // position (~$5 at 16x).
        this.pushReward({
          source: 'witnessed_liveSignal',
          symbol,
          realizedPnlUsdt: realizedPnl * 0.5,  // half-weight (witnessed, not her own)
          marginUsdt: 5,
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
      // v0.8.7d-7 fix: Poloniex v3 one-way mode returns `side` as the
      // next-action direction (BUY/SELL, also long/short for some fields),
      // NOT the position direction. For a SHORT position, side="SELL".
      // The sign of `qty` is the authoritative indicator (reconciler uses
      // it correctly at stateReconciliationService.ts:152). Prior code
      // read `p.side` and fell through the else branch ("sell" !== "short"
      // → "long") causing Monkey to think shorts were longs, triggering
      // the OVERRIDE_REVERSE[long→short] loop with 21002 close-rejections.
      const qtyNum = forSymbol ? Number((forSymbol as Record<string, unknown>).qty ?? (forSymbol as Record<string, unknown>).size ?? 0) : 0;
      const heldSide: 'long' | 'short' | null = forSymbol && qtyNum !== 0
        ? (qtyNum < 0 ? 'short' : 'long')
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

// ───────────── Singletons (v0.6b multi-kernel) ─────────────
//
// Two parallel sub-Monkeys share the underlying class but differ in
// timeframe + cadence + instance identity. They compete for the same
// 1–2 open-position slots via the risk-kernel per-symbol exposure cap;
// each kernel only touches rows it owns (reason LIKE 'monkey|kernel=…|%').
// Both receive witnessExit on liveSignal closes so both banks bootstrap.
//
// sizeFraction 0.5 each = combined 1.0 of the equity-based cap when
// both are open on the same symbol; the risk kernel's 5× blast door
// still enforces the hard ceiling.

export const monkeyKernel = new MonkeyKernel({
  instanceId: 'monkey-position',
  timeframe: '15m',
  tickMs: 30_000,
  label: 'Monkey.Position',
  sizeFraction: 0.5,
});

export const swingMonkey = new MonkeyKernel({
  instanceId: 'monkey-swing',
  timeframe: '5m',
  tickMs: 30_000,
  label: 'Monkey.Swing',
  sizeFraction: 0.5,
});

export const allMonkeyKernels: readonly MonkeyKernel[] = [
  monkeyKernel,
  swingMonkey,
];
