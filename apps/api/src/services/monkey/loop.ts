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

import { forge, forgeBankWriteLive, shadowThreshold } from './forge.js';

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
import { mlAgentDecide } from '../ml_agent/decide.js';
import type { MLAgentInputs } from '../ml_agent/types.js';
import { Arbiter } from '../arbiter/arbiter.js';
import {
  appendUnit as turtleAppendUnit,
  clearUnitsAfterExit as turtleClearUnits,
  newTurtleState,
  turtleAgentDecide,
  turtleMinEquityUsdt,
  type TurtleAgentInputs,
  type TurtleState,
} from '../turtle_agent/index.js';
import {
  basinDirection as computeBasinDirection,
  perceive,
  refract,
  trendProxy as computeTrendProxy,
  type OHLCVCandle,
} from './perception.js';
import {
  CHOP_SUPPRESSION_CONFIDENCE,
  classifyRegime,
  isChopSuppressed,
  type RegimeReading,
} from './regime.js';
import {
  detectStrongest as detectStrongestCandlePattern,
  hammerAgainstLongSl,
  patternSignalScalar,
} from './candlePatterns.js';
import { evaluateBankWrite } from './learning_gate_client.js';
import { resonanceBank } from './resonance_bank.js';
import { computeSelfObservation, type SelfObservation } from './self_observation.js';
import { WorkingMemory, type Bubble } from './working_memory.js';
import {
  currentEntryThreshold,
  currentLeverage,
  currentPositionSize,
  kernelDirection,
  kernelShouldEnter,
  shouldAutoFlatten,
  shouldDCAAdd,
  shouldExit,
  shouldProfitHarvest,
  shouldScalpExit,
  chooseLane,
  type BasinState,
  type Direction,
  type LaneType,
} from './executive.js';
import { evaluateRejustification } from './held_position_rejustification.js';

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
  /** Proposal #9: SL defer counter. When a hammer/inverted-hammer is
   *  detected against a long position about to SL, set this to N
   *  (default 2). Each tick decrements it. While > 0, scalp_exit
   *  with exitTypeBit === -1 (stop loss) is suppressed.
   *
   *  Heuristic gate; impurity scoped to the SL-defer path only. */
  slDeferRemainingTicks: number;
  /** Proposal #4: sustained tape-flip streak counter. Increments
   *  each tick where ``alignmentNow <= -0.25`` (bearish vs the held
   *  side); resets when alignment recovers. ``shouldProfitHarvest``
   *  consumes this — trend-flip harvest fires only when streak >= 3
   *  so a single noise tick can't trigger an exit. */
  tapeFlipStreak: number;
  /** Proposal #10 — per-lane bookkeeping. Each lane independently
   *  tracks its peak unrealized PnL, the trade id it's peak-tracking,
   *  and its tape-flip streak so a swing-long's history never bleeds
   *  into a scalp-short on the same symbol. Lanes that never held
   *  state stay absent from these maps; reads default to the legacy
   *  scalar values for back-compat. */
  peakPnlUsdtByLane: Record<string, number | null>;
  peakTrackedTradeIdByLane: Record<string, string | null>;
  tapeFlipStreakByLane: Record<string, number>;
  /** Held-position re-justification anchors — per-lane (regime, Φ)
   *  snapshots taken at the moment a position opens. The kernel uses
   *  these as the geometric anchor for "is current state still
   *  consonant with entry?". Cleared on position close in that lane.
   *  Same per-lane shape as peakPnlUsdtByLane above so future multi-lane
   *  positions keep independent rejustification anchors. */
  regimeAtOpenByLane: Record<string, string>;
  phiAtOpenByLane: Record<string, number>;
  /** v0.8.7e: latest computed basinDir + tapeTrend from processSymbol, with
   *  timestamp. Exposed via getLatestBasinSnapshot() for LiveSignal's
   *  inter-engine agreement gate. Null until the first tick completes. */
  latestBasinSnapshot: {
    basinDir: number;
    tapeTrend: number;
    computedAtMs: number;
  } | null;
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
  /**
   * Proposal #10 — cached account-level position direction mode.
   * Read once at kernel start via assertHedgeModeIfPossible. When
   * 'HEDGE' the executor passes ``posSide: LONG | SHORT`` on entries
   * so a swing-long and a scalp-short can coexist. When 'ONE_WAY' the
   * executor omits posSide (Poloniex defaults to BOTH); lane discipline
   * still works at the DB layer but two opposite-side lanes will net
   * exchange-side. Defaults to 'ONE_WAY' (the historic configuration).
   */
  private positionDirectionMode: 'HEDGE' | 'ONE_WAY' = 'ONE_WAY';
  /**
   * Arbiter — capital allocator across N agents (K kernel, M ml, T turtle
   * classical TA). Single instance per kernel. Settled trades flow back via
   * recordSettled from closeHeldPosition. T is included in the allocation
   * only when account equity ≥ ``turtleMinEquityUsdt()``; below threshold
   * the arbiter sees a 2-agent (K, M) race exactly as before T was added.
   */
  private readonly arbiter: Arbiter = new Arbiter();
  /**
   * Per-symbol Turtle (Agent T) state — held units, last exit metadata.
   * Independent of the per-symbol kernel state map; T does not read
   * from K or M (the wall is here in the type graph too: TurtleState
   * has no reference to BasinState or any ML field).
   */
  private readonly turtleStates: Map<string, TurtleState> = new Map();

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
      this.turtleStates.set(sym, newTurtleState());
    }
    // Proposal #10 — detect (don't auto-flip) account position direction
    // mode. Lane-isolated positions in HEDGE mode let a swing-long and a
    // scalp-short coexist on the exchange; ONE_WAY mode nets opposite
    // sides. We log the current mode here and ship the executor with
    // posSide-aware order placement; the actual HEDGE flip is deferred
    // to a manual op once current K positions close (see TODO in
    // assertHedgeModeIfPossible).
    await this.detectPositionDirectionMode();
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

  /**
   * v0.8.7e: Read-only snapshot of the latest computed basin direction +
   * tape trend for a symbol. Returns null if the kernel hasn't ticked
   * that symbol yet, or if the snapshot is too stale (caller's problem).
   *
   * Used by liveSignalEngine's ml_signal_flip exit gate to require
   * Monkey-basin agreement before closing a position (prevents the
   * LiveSignal-closes-then-Monkey-reopens yo-yo observed in the
   * 2026-04-24 trading log — 30 trades in 5h, net PNL -0.26 USDT
   * from fee churn).
   */
  getLatestBasinSnapshot(symbol: string): {
    basinDir: number;
    tapeTrend: number;
    computedAtMs: number;
  } | null {
    return this.symbolStates.get(symbol)?.latestBasinSnapshot ?? null;
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
      slDeferRemainingTicks: 0,
      tapeFlipStreak: 0,
      peakPnlUsdtByLane: {},
      peakTrackedTradeIdByLane: {},
      tapeFlipStreakByLane: {},
      regimeAtOpenByLane: {},
      phiAtOpenByLane: {},
      latestBasinSnapshot: null,
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

    // ML-unreachable observability. Post #ml-separation: ML failure
    // means only Agent M holds (it has nothing to read). Agent K runs
    // geometry-only and is unaffected. Edge-triggered WARN so logs
    // don't flood during a long outage.
    if (raw?.error === true) {
      this.mlOutageStreak += 1;
      if (this.mlOutageStreak === 1) {
        logger.warn('[Monkey] ML unreachable — Agent M holds; Agent K continues on geometry', {
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
            agentMHeld: true,
            agentKActive: true,
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
    // Post #ml-separation: ml fields omitted; perception defaults dims
    // 3..5 to neutral. Agent K's basin is built without ml inputs.
    const rawBasin = perceive({
      ohlcv,
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

    // κ adapts from basin velocity × internal coupling. Stable near κ*
    // when integration is high and basin velocity is low.
    // Post #ml-separation: couplingHealth was mlStrength; replaced with
    // a geometric self-read (Φ × (1 − basin velocity), [0,1]).
    const bv = state.lastBasin ? velocity(state.lastBasin, basin) : 0;
    const couplingHealth = phi * (1 - Math.min(bv, 1));
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
    // Side candidate (post #ml-separation):
    //   Direction comes from basin geometry + tape consensus. The
    //   previous OVERRIDE_REVERSE quorum + TURNING_SIGNAL paths are
    //   gone — kernelDirection is the primary read.
    //
    // TS-side does not yet compute Layer 2B emotions (motivators /
    // sensations / foresight ports pending). Until v0.8.8 Python
    // cut-over, TS uses neutral emotions so direction reduces to
    // pure geometry. Entry conviction continues to gate via the
    // existing ml-strength threshold below — a geometry-only TS
    // entry would require the full emotion stack ported. This is
    // the documented "TS counterpart for parity" path.
    const basinDir = computeBasinDirection(basin);
    const tapeTrend = computeTrendProxy(ohlcv);
    state.latestBasinSnapshot = {
      basinDir,
      tapeTrend,
      computedAtMs: Date.now(),
    };

    // Proposal #5: regime classification on basin trajectory + this
    // tick's basin. Surfaced via derivation.regime for telemetry; the
    // executive's threshold + harvest tightness will eventually consume
    // it. Splice the current basin onto the history so the classifier
    // sees the most-recent observation alongside prior ticks.
    const regimeReading: RegimeReading = classifyRegime([
      ...state.basinHistory,
      basin,
    ]);

    // Proposal #9: candlestick pattern detection at the perception
    // input boundary. ``patternSignal`` is signed in [-1, +1];
    // ``hammerDefer`` triggers the SL-defer path on long positions.
    const candlePatternReading = detectStrongestCandlePattern(ohlcv as any[]);
    const candlePatternSignal = patternSignalScalar(candlePatternReading);
    const candleHammerDefer = hammerAgainstLongSl(ohlcv as any[]);
    const NEUTRAL_EMOTIONS = {
      wonder: 0, frustration: 0, satisfaction: 0, confusion: 0,
      clarity: 0, anxiety: 0, confidence: 0, boredom: 0, flow: 0,
    };
    const direction: Direction = kernelDirection({
      basinDir, tapeTrend, emotions: NEUTRAL_EMOTIONS,
    });
    const sideCandidate: 'long' | 'short' = direction === 'flat' ? 'long' : direction;
    const sideOverride = false;
    // Note: REVERSION mode flip lives only in the Python kernel (Tier 9
    // Stage 2 stud topology). TS does not implement REVERSION yet.

    // MONKEY_SHORTS_LIVE — sequencing protection retained from #575.
    // Orthogonal to agent-separation; flipped via env independently.
    const SHORTS_LIVE = process.env.MONKEY_SHORTS_LIVE === 'true';
    const sideShortRefused = sideCandidate === 'short' && !SHORTS_LIVE;
    if (sideShortRefused) {
      logger.info('[Monkey] short refused — MONKEY_SHORTS_LIVE=false', {
        symbol, basinDir, tapeTrend, direction, wantedShort: true,
      });
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
    // Proposal #10 — lane selection runs FIRST so the per-lane Kelly
    // stats query can scope to the active lane. ``chooseLane`` is a
    // pure read of basin features; leverage downstream is shaped by
    // the lane the kernel just picked.
    const laneDecisionEarly = chooseLane(basinState, tapeTrend);
    const earlyChosenLane: LaneType = laneDecisionEarly.value;
    const earlyPositionLane: 'scalp' | 'swing' | 'trend' =
      earlyChosenLane === 'observe' ? 'swing' : earlyChosenLane;
    // Proposal #3 + per-lane refinement: Kelly leverage cap is computed
    // from the LAST 50 CLOSED TRADES IN THIS LANE (not the agent-wide
    // pool). Lane-isolation philosophy (#610) — scalp wins build the
    // scalp lane's Kelly cap; trend wins build trend's. No more
    // cross-lane pollution dragging down a lane that's actually working.
    // Cold-start (no closed trades in this lane): rollingStats is null,
    // kelly cap becomes a no-op (geometric leverage unchanged).
    const rollingStats = await this.getKellyRollingStats('K', earlyPositionLane);
    const leverage = currentLeverage(
      basinState, maxLevBoundary, mode, tapeTrend, rollingStats,
    );
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
    // Proposal #10 — lane selection. Each tick picks the locally-optimal
    // execution lane via softmax over basin features (parity with the
    // Python kernel's choose_lane). The chosen lane gates size (per-lane
    // budget fraction) AND, when a position is open, scopes the exit
    // gate's TP/SL envelope. ``earlyPositionLane`` is the early read
    // above; size + leverage already used it.
    const positionLane: 'scalp' | 'swing' | 'trend' = earlyPositionLane;
    const size = currentPositionSize(
      basinState, cappedEquity, minNotional, leverage.value, bankSize, mode,
      positionLane,
    );
    // Surgical diagnostic for live size=0 regression (post PR #611). Fires
    // only when sizing collapses to zero AND the account is flat — surfaces
    // the exact numeric inputs feeding currentPositionSize so we can
    // grep `[size-zero-diag]` from Railway and trace which guard tripped.
    if (size.value === 0 && exchangeHeldSide === null) {
      logger.info('[size-zero-diag]', {
        symbol, availableEquity, effectiveSizeFraction, cappedEquity,
        minNotional, leverage: leverage.value, bankSize, mode,
        sizeValue: size.value, lane: positionLane,
        sizeDerivation: size.derivation,
      });
    }
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
      direction,
      sideOverride,
      agent: 'K',
      // Proposal #5: regime telemetry. Discrete state + confidence
      // surfaces alongside the kernel direction read. Read via
      // derivation.regime in monkey_decisions analysis.
      regime: {
        regime: regimeReading.regime,
        confidence: regimeReading.confidence,
        trend_strength: regimeReading.trendStrength,
        chop_score: regimeReading.chopScore,
      },
      // Proposal #9: candle-pattern telemetry. Signed scalar feeds
      // into perception inputs; hammer-defer hint feeds the SL-fire
      // path further down.
      candle_pattern: {
        pattern_name: candlePatternReading.patternName,
        strength: candlePatternReading.strength,
        direction: candlePatternReading.direction,
        signed_scalar: candlePatternSignal,
        hammer_defer_long_sl: candleHammerDefer,
      },
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
      // Proposal #10 — the position lane comes from the open row's
      // ``lane`` column (migration 042; existing rows defaulted to
      // 'swing'). All exit gating below evaluates against this lane's
      // envelope.
      const heldLane: 'scalp' | 'swing' | 'trend' = openRow?.lane ?? 'swing';
      derivation.heldLane = heldLane;
      if (openRow) {
        const positionNotional = Number(openRow.entry_price) * Number(openRow.quantity);
        const sidesign = heldSide === 'long' ? 1 : -1;
        const unrealizedPnl = (lastPrice - Number(openRow.entry_price)) * Number(openRow.quantity) * sidesign;
        const tradeId = String(openRow.id);

        // Reset per-lane peak tracking when we detect a NEW trade vs
        // what we were peak-tracking IN THIS LANE. (Covers reconciler-
        // replaced rows.) Each lane's peak is independent.
        const prevTracked = state.peakTrackedTradeIdByLane[heldLane] ?? null;
        if (prevTracked !== tradeId) {
          state.peakPnlUsdtByLane[heldLane] = unrealizedPnl;
          state.peakTrackedTradeIdByLane[heldLane] = tradeId;
          state.tapeFlipStreakByLane[heldLane] = 0;
        } else {
          const prevPeak = state.peakPnlUsdtByLane[heldLane] ?? 0;
          state.peakPnlUsdtByLane[heldLane] = Math.max(prevPeak, unrealizedPnl);
        }
        // Mirror to legacy scalars so non-lane-aware readers keep working.
        state.peakPnlUsdt = state.peakPnlUsdtByLane[heldLane];
        state.peakTrackedTradeId = tradeId;

        // Proposal #4 — sustained tape-flip streak counter, per-lane.
        const alignmentNowForStreak = heldSide === 'long' ? tapeTrend : -tapeTrend;
        const curStreak = state.tapeFlipStreakByLane[heldLane] ?? 0;
        if (alignmentNowForStreak <= -0.25) {
          state.tapeFlipStreakByLane[heldLane] = curStreak + 1;
        } else {
          state.tapeFlipStreakByLane[heldLane] = 0;
        }
        state.tapeFlipStreak = state.tapeFlipStreakByLane[heldLane];

        const lanePeak = state.peakPnlUsdtByLane[heldLane] ?? 0;
        const laneStreak = state.tapeFlipStreakByLane[heldLane] ?? 0;

        // 1. Hard SL pre-check (SAFETY_BOUND) — must precede the
        // rejustification block so a position bleeding hard against
        // the kernel always closes on price before the kernel re-reads
        // its own state. TP comes BELOW rejustification + harvest.
        // v0.8.6 — SL gate now reads ROI on margin, not raw price %.
        // Use the position's recorded leverage (Number(openRow.leverage))
        // so the gate scales raw movement into ROI correctly. Defaults to
        // the just-derived leverage.value when openRow lacks the column
        // (cold/legacy rows).
        const positionLeverage = openRow && Number.isFinite(Number(openRow.leverage)) && Number(openRow.leverage) > 0
          ? Number(openRow.leverage)
          : leverage.value;
        const scalp = shouldScalpExit(
          unrealizedPnl,
          positionNotional,
          basinState,
          mode,
          heldLane,
          positionLeverage,
        );
        derivation.scalp = { ...scalp.derivation, unrealizedPnl, markPrice: lastPrice, tradeId };
        const SL_DEFER_TICKS = 2;
        const isStopLoss = Number((scalp as any).derivation?.exitTypeBit) === -1;
        const longSlWithHammer = (
          isStopLoss
          && heldSide === 'long'
          && candleHammerDefer
        );
        if (scalp.value && isStopLoss) {
          // Proposal #9 path 2: SL defer. If the latest tick prints a
          // strong hammer/inverted-hammer AGAINST a long-position SL
          // about to fire, defer the SL by SL_DEFER_TICKS to let the
          // wick recover. Heuristic gate; documented impurity scoped
          // to this branch only.
          if (longSlWithHammer && state.slDeferRemainingTicks <= 0) {
            state.slDeferRemainingTicks = SL_DEFER_TICKS;
            (derivation as any).slDefer = {
              opened: true,
              ticksRemaining: state.slDeferRemainingTicks,
              reason: 'hammer_against_long_sl',
            };
          } else if (state.slDeferRemainingTicks > 0 && heldSide === 'long') {
            (derivation as any).slDefer = {
              active: true,
              ticksRemaining: state.slDeferRemainingTicks,
            };
          } else {
            action = 'scalp_exit';
            reason = scalp.reason;
            exitFired = true;
          }
        }

        // 2. Held-position re-justification — three internal exit
        // checks. Each fires immediately when the kernel's current
        // state contradicts the state that justified entry. No streak
        // counting, no hysteresis, no time-based stops. All three are
        // geometric (regime classifier output, Φ integration measure,
        // Layer 2B emotion stack — TS path uses NEUTRAL_EMOTIONS until
        // emotion stack is ported, so the conviction check is dormant
        // in TS but live in Python).
        const regimeAtOpen = state.regimeAtOpenByLane[heldLane] as MonkeyMode | undefined;
        const phiAtOpen = state.phiAtOpenByLane[heldLane];
        const rejustResult = !exitFired
          ? evaluateRejustification({
              regimeAtOpen,
              phiAtOpen,
              regimeNow: mode,
              phiNow: phi,
              emotions: NEUTRAL_EMOTIONS,
              regimeConfidence: regimeReading.confidence,
            })
          : { checked: false, fired: null, reason: '', phiFloor: null };
        const rejust: Record<string, unknown> = {
          checked: rejustResult.checked,
        };
        if (rejustResult.checked) {
          rejust.lane = heldLane;
          rejust.regimeAtOpen = regimeAtOpen;
          rejust.regimeNow = mode;
          rejust.regimeConfidence = regimeReading.confidence;
          rejust.phiAtOpen = phiAtOpen;
          rejust.phiNow = phi;
          rejust.phiFloor = rejustResult.phiFloor;
          rejust.confidence = NEUTRAL_EMOTIONS.confidence;
          rejust.anxiety = NEUTRAL_EMOTIONS.anxiety;
          rejust.confusion = NEUTRAL_EMOTIONS.confusion;
          if (rejustResult.fired) {
            rejust.fired = rejustResult.fired;
            action = 'scalp_exit';
            reason = rejustResult.reason;
            exitFired = true;
            // Tag the exit type bit explicitly for the closer — anchor
            // 5 (rejustification) is a new bit; keep tradeId/lane/pnl
            // surfaces consistent with the existing scalp_exit shape.
            derivation.scalp = {
              exitTypeBit: 5,  // rejustification
              unrealizedPnl,
              markPrice: lastPrice,
              tradeId,
              lane: heldLane,
            };
          }
        }
        derivation.rejustification = rejust;

        // 3. Profit harvest — trailing stop + trend-flip, only while green.
        if (!exitFired) {
          const harvest = shouldProfitHarvest(
            unrealizedPnl,
            lanePeak,
            positionNotional,
            tapeTrend,
            heldSide,
            basinState,
            laneStreak,
          );
          derivation.harvest = { ...harvest.derivation, unrealizedPnl, peakPnl: lanePeak, tradeId, lane: heldLane };
          if (harvest.value) {
            action = 'scalp_exit';
            reason = harvest.reason;
            exitFired = true;
            derivation.scalp = {
              exitTypeBit: harvest.derivation.exitTypeBit,
              unrealizedPnl,
              markPrice: lastPrice,
              tradeId,
              lane: heldLane,
            };
          }
        }

        // 4. Scalp TP — only TP can reach here (SL was returned above
        // unless deferred; rejustification and harvest also returned).
        if (!exitFired && scalp.value && !isStopLoss) {
          action = 'scalp_exit';
          reason = scalp.reason;
          exitFired = true;
        }

        // Decrement defer window each tick we did not exit.
        if (state.slDeferRemainingTicks > 0) {
          state.slDeferRemainingTicks = Math.max(0, state.slDeferRemainingTicks - 1);
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
          direction !== 'flat' &&
          size.value > 0 &&
          !sideShortRefused
        ) {
          action = sideCandidate === 'long' ? 'reverse_long' : 'reverse_short';
          reason = `REVERSION_FLIP[${heldSide}→${sideCandidate}] basin=${basinDir.toFixed(2)} tape=${tapeTrend.toFixed(2)}; flatten-then-open margin=${size.value.toFixed(2)} lev=${leverage.value}x`;
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
            direction !== 'flat' &&
            size.value > 0 &&
            !sideShortRefused
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
      direction !== 'flat' &&
      size.value > 0 &&
      !sideShortRefused &&
      !isChopSuppressed(regimeReading)
    ) {
      // sideCandidate from kernelDirection (geometric, post #ml-separation).
      // Entry gate is geometric: direction != flat (basinDir + 0.5*tapeTrend
      // != 0). Conviction gating via Layer 2B emotions is Python-only until
      // emotions are ported to TS — TS uses neutral emotions which collapse
      // kernelShouldEnter to false, so we gate on direction here instead.
      action = sideCandidate === 'long' ? 'enter_long' : 'enter_short';
      reason = `[${mode}] kernel-K geometric: basinDir=${basinDir.toFixed(3)} tape=${tapeTrend.toFixed(3)} → ${sideCandidate}; margin=${size.value.toFixed(2)} lev=${leverage.value}x notional=${(size.value * leverage.value).toFixed(2)}`;
      derivation.entryThreshold = entryThr.derivation;
      derivation.size = size.derivation;
      derivation.leverage = leverage.derivation;
    } else {
      action = 'hold';
      const chopSuppressed = isChopSuppressed(regimeReading);
      const why = !MODE_PROFILES[mode].canEnter
        ? `mode=${mode} blocks entry (${MODE_PROFILES[mode].description})`
        : direction === 'flat'
          ? `[${mode}] direction=flat (basinDir=${basinDir.toFixed(3)} tape=${tapeTrend.toFixed(3)})`
          : chopSuppressed
            ? `[${mode}] chop regime confidence=${regimeReading.confidence.toFixed(2)} > ${CHOP_SUPPRESSION_CONFIDENCE.toFixed(2)} — suspend new entries`
            : size.value <= 0
              ? `[${mode}] size ${size.value.toFixed(2)} below min notional ${minNotional.toFixed(2)}`
              : sideShortRefused
                ? `[${mode}] short refused — MONKEY_SHORTS_LIVE=false`
                : 'no qualifying signal';
      reason = why;
      derivation.entryThreshold = entryThr.derivation;
    }
    // CHOP suppression telemetry — surfaces whether the gate was active
    // this tick AND whether it actually blocked entry. ``active`` reads
    // the regime classifier output; ``blocked`` is true only when the
    // suspension would have flipped a would-be entry into a hold.
    derivation.chopSuppression = {
      active: isChopSuppressed(regimeReading),
      regime: regimeReading.regime,
      confidence: regimeReading.confidence,
      threshold: CHOP_SUPPRESSION_CONFIDENCE,
    };

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
    //
    // Post agent-separation (K vs M) + Turtle control arm (T): the arbiter
    // is N-agent. T is conditionally included only when account equity is
    // ≥ ``turtleMinEquityUsdt()`` (default $150). Below threshold the
    // allocator sees a 2-agent (K, M) race exactly as before, and T's
    // 1/N share isn't stranded on a sub-min-notional account. The
    // activation gate is a runtime constraint, NOT a flag — change the
    // env var and redeploy, and T comes online when equity allows.
    const minEquityForT = turtleMinEquityUsdt();
    const tEligible = availableEquity >= minEquityForT;
    const arbiterAgentLabels: string[] = tEligible ? ['K', 'M', 'T'] : ['K', 'M'];
    const arbiterAllocationMany = this.arbiter.allocateMany(
      availableEquity,
      arbiterAgentLabels,
    );
    const arbiterSnapshotMany = this.arbiter.snapshotMany(
      availableEquity,
      arbiterAgentLabels,
    );
    // Back-compat 2-agent shape — the K/M execute paths below + the
    // arbiter_allocation telemetry table both consume {k, m}. T's
    // share lives alongside in arbiterAllocationMany.T.
    const arbiterAllocation = {
      k: arbiterAllocationMany.K ?? 0,
      m: arbiterAllocationMany.M ?? 0,
    };
    const arbiterSnapshot = this.arbiter.snapshot(availableEquity);
    derivation.arbiter = {
      kShare: arbiterSnapshot.kShare,
      mShare: arbiterSnapshot.mShare,
      kPnlWindowTotal: arbiterSnapshot.kPnlWindowTotal,
      mPnlWindowTotal: arbiterSnapshot.mPnlWindowTotal,
      kTradesInWindow: arbiterSnapshot.kTradesInWindow,
      mTradesInWindow: arbiterSnapshot.mTradesInWindow,
      kAllocatedUsdt: arbiterAllocation.k,
      mAllocatedUsdt: arbiterAllocation.m,
      // T-specific telemetry. ``tEligible`` records WHY T was/wasn't in
      // the race this tick (equity gate). When eligible, ``tShare`` and
      // ``tAllocatedUsdt`` mirror the K/M shape.
      tEligible,
      minEquityForT,
      tShare: arbiterSnapshotMany.T?.share ?? 0,
      tPnlWindowTotal: arbiterSnapshotMany.T?.pnlWindowTotal ?? 0,
      tTradesInWindow: arbiterSnapshotMany.T?.tradesInWindow ?? 0,
      tAllocatedUsdt: arbiterAllocationMany.T ?? 0,
    };

    let executed = false;
    let monkeyOrderId: string | null = null;
    if (process.env.MONKEY_EXECUTE === 'true') {
      if ((action === 'enter_long' || action === 'enter_short') && size.value > 0) {
        const isDCA = Boolean(derivation.isDCAAdd);
        // Cap K's margin to its arbiter share. Without this, the existing
        // size formula could exceed K's allocation when M has been
        // accumulating and K's share has shrunk.
        const cappedMargin = Math.min(size.value, arbiterAllocation.k);
        if (cappedMargin <= 0) {
          reason += ` | k_capped_to_zero (kShare=${arbiterSnapshot.kShare.toFixed(2)})`;
        }
        const execResult = cappedMargin > 0 ? await this.executeEntry({
          symbol,
          side: action === 'enter_long' ? 'long' : 'short',
          marginUsdt: cappedMargin,
          leverage: leverage.value,
          entryPrice: lastPrice,
          minNotional,
          phi,
          kappa: state.kappa,
          sovereignty,
          trajectoryId: null,
          isDCAAdd: isDCA,
          dcaAddIndex: isDCA ? state.dcaAddCount + 1 : 0,
          agent: 'K',
          // Proposal #10 — when adding to an existing held position,
          // route the entry into THAT lane so DCA stacks under one
          // (agent, symbol, lane) row group. Otherwise use the lane
          // chosen by chooseLane this tick.
          lane: isDCA && heldSide
            ? (ownOpenRow?.lane ?? positionLane)
            : positionLane,
        }) : { executed: false, orderId: null, reason: 'k_arbiter_zero' };
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
          // Held-position re-justification — snapshot (regime, Φ) at the
          // moment of entry on this lane. Subsequent ticks compare against
          // these anchors via the three internal exit checks (regime
          // change / Φ collapse / conviction failure). DCA adds keep the
          // original anchors (first-open justification is canonical).
          if (!isDCA) {
            const entryLane = (isDCA && heldSide
              ? (ownOpenRow?.lane ?? positionLane)
              : positionLane) as 'scalp' | 'swing' | 'trend';
            state.regimeAtOpenByLane[entryLane] = mode;
            state.phiAtOpenByLane[entryLane] = phi;
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
        const scalpLane = (
          scalpDeriv?.lane === 'scalp' || scalpDeriv?.lane === 'trend'
            ? scalpDeriv.lane
            : 'swing'
        ) as 'scalp' | 'swing' | 'trend';
        if (tradeId) {
          const closeResult = await this.closeHeldPosition({
            symbol,
            tradeId,
            heldSide,
            markPrice: lastPrice,
            exitReason: exitType,
            pnlAtDecision,
            lane: scalpLane,
          });
          executed = closeResult.executed;
          monkeyOrderId = closeResult.orderId;
          if (executed) {
            // Clear lane-scoped trade-level state now the lane closed.
            // Other lanes' bookkeeping is preserved (proposal #10).
            state.peakPnlUsdtByLane[scalpLane] = null;
            state.peakTrackedTradeIdByLane[scalpLane] = null;
            state.tapeFlipStreakByLane[scalpLane] = 0;
            // Clear rejustification anchors for the lane that closed.
            delete state.regimeAtOpenByLane[scalpLane];
            delete state.phiAtOpenByLane[scalpLane];
            // Mirror legacy scalars for any non-lane-aware reader.
            state.peakPnlUsdt = null;
            state.peakTrackedTradeId = null;
            state.dcaAddCount = 0;
            state.lastEntryAtMs = null;
            state.slDeferRemainingTicks = 0;
            state.tapeFlipStreak = 0;
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
            lane: ownOpenRow?.lane ?? 'swing',
          });
          if (closeResult.executed) {
            state.peakPnlUsdt = null;
            state.peakTrackedTradeId = null;
            state.dcaAddCount = 0;
            state.lastEntryAtMs = null;
            // Clear rejustification anchors for the lane that flipped.
            const reversalLane = (ownOpenRow?.lane ?? 'swing') as 'scalp' | 'swing' | 'trend';
            delete state.regimeAtOpenByLane[reversalLane];
            delete state.phiAtOpenByLane[reversalLane];
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
              // Reversal lands in the same lane the previous position
              // occupied — REVERSION mode flips side, not lane.
              lane: reversalLane,
            });
            executed = execResult.executed;
            monkeyOrderId = execResult.orderId;
            if (executed) {
              state.lastEntryAtMs = Date.now();
              // Re-snapshot rejustification anchors for the new direction.
              state.regimeAtOpenByLane[reversalLane] = mode;
              state.phiAtOpenByLane[reversalLane] = phi;
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

    // 6c. AGENT M EXECUTE — independent ML-only path. Runs against
    // arbiter.allocation.m. Threshold-based: enters when mlSignal !=
    // HOLD AND mlStrength >= 0.55 AND M has > 0 capital. Same risk
    // kernel + position-write pipeline as K (executeEntry handles
    // veto, exchange order, DB INSERT with agent='M').
    if (process.env.MONKEY_EXECUTE === 'true' && arbiterAllocation.m > 0) {
      const mInputs: MLAgentInputs = {
        symbol,
        ohlcv: ohlcv.map((c) => ({
          timestamp: Number(c.timestamp ?? 0),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume),
        })),
        mlSignal: (mlSignal === 'BUY' || mlSignal === 'SELL' || mlSignal === 'HOLD')
          ? mlSignal : 'HOLD',
        mlStrength,
        account: {
          equityFraction,
          marginFraction,
          openPositions,
          availableEquity,
        },
        allocatedCapitalUsdt: arbiterAllocation.m,
      };
      const mDecision = mlAgentDecide(mInputs);
      derivation.agentM = {
        action: mDecision.action,
        sizeUsdt: mDecision.sizeUsdt,
        leverage: mDecision.leverage,
        reason: mDecision.reason,
        mlSignal: mInputs.mlSignal,
        mlStrength: mInputs.mlStrength,
      };
      if (
        (mDecision.action === 'enter_long' || mDecision.action === 'enter_short')
        && mDecision.sizeUsdt > 0
      ) {
        const mResult = await this.executeEntry({
          symbol,
          side: mDecision.action === 'enter_long' ? 'long' : 'short',
          marginUsdt: mDecision.sizeUsdt,
          leverage: mDecision.leverage,
          entryPrice: lastPrice,
          minNotional,
          phi,
          kappa: state.kappa,
          sovereignty,
          trajectoryId: null,
          isDCAAdd: false,
          dcaAddIndex: 0,
          agent: 'M',
        });
        derivation.agentMExecuted = mResult.executed;
        if (!mResult.executed) {
          logger.info('[AgentM] entry rejected', {
            symbol, side: mDecision.action, reason: mResult.reason,
          });
        } else {
          logger.info('[AgentM] entry placed', {
            symbol, side: mDecision.action, orderId: mResult.orderId,
            margin: mDecision.sizeUsdt.toFixed(2), leverage: mDecision.leverage,
          });
        }
      }
    }

    // 6c-T. AGENT T EXECUTE — Turtle System 1 (classical TA control arm).
    // Independent of K's basin and M's ml signal. Inputs: ohlcv only.
    // Equity-gated: when ``tEligible`` is false the arbiter excluded T
    // from the race already (allocation = 0 → decide() returns hold even
    // if a Donchian breakout printed). This block runs every tick so T
    // can ALSO close held positions cleanly when it falls below threshold
    // mid-trade — the equity gate blocks new entries / pyramids, not
    // exits.
    const tAlloc = arbiterAllocationMany.T ?? 0;
    if (process.env.MONKEY_EXECUTE === 'true') {
      const tState = this.turtleStates.get(symbol) ?? newTurtleState();
      const tInputs: TurtleAgentInputs = {
        symbol,
        ohlcv: ohlcv.map((c) => ({
          timestamp: Number(c.timestamp ?? 0),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume),
        })),
        account: {
          equityUsdt: availableEquity,
          availableEquityUsdt: availableEquity,
        },
        allocatedCapitalUsdt: tAlloc,
        state: tState,
      };
      const tDecision = turtleAgentDecide(tInputs);
      derivation.agentT = {
        action: tDecision.action,
        sizeUsdt: tDecision.sizeUsdt,
        leverage: tDecision.leverage,
        stopPrice: tDecision.stopPrice,
        reason: tDecision.reason,
        unitsHeld: tDecision.derivation.unitsHeld,
        equityGated: tDecision.derivation.equityGated,
        atr: tDecision.derivation.atr,
        donchianHigh: tDecision.derivation.donchianHigh,
        donchianLow: tDecision.derivation.donchianLow,
      };

      // T entries / pyramids — same executeEntry path as K and M; the
      // 'T' agent tag plus lane='trend' attributes the row to the
      // turtle agent. Pyramids are MORE units in the same trend-lane;
      // from autonomous_trades' perspective each unit is its own row,
      // grouped by (agent='T', symbol, lane='trend').
      if (
        (tDecision.action === 'enter_long'
          || tDecision.action === 'enter_short'
          || tDecision.action === 'pyramid_long'
          || tDecision.action === 'pyramid_short')
        && tDecision.sizeUsdt > 0
      ) {
        const tSide: 'long' | 'short' =
          tDecision.action === 'enter_long' || tDecision.action === 'pyramid_long'
            ? 'long'
            : 'short';
        const tResult = await this.executeEntry({
          symbol,
          side: tSide,
          marginUsdt: tDecision.sizeUsdt,
          leverage: tDecision.leverage,
          entryPrice: lastPrice,
          minNotional,
          // T does not consume kernel state. Pass zeros for the
          // K-only fields the executor uses for its reason-encoding;
          // these are diagnostic, not used by the executor's risk
          // logic. The agent='T' tag is what matters downstream.
          phi: 0,
          kappa: 0,
          sovereignty: 0,
          trajectoryId: null,
          isDCAAdd: false,
          dcaAddIndex: 0,
          agent: 'T',
          lane: 'trend',
        });
        derivation.agentTExecuted = tResult.executed;
        if (tResult.executed) {
          // Mirror the new unit into TurtleState. Stop, ATR, leverage,
          // margin all derive from the decision; entryPrice is the
          // exchange fill estimate (executeEntry doesn't currently
          // return the executed fill — we use lastPrice, identical to
          // what K and M assume). Future improvement: thread the actual
          // avgFillPrice back from the exchange.
          this.turtleStates.set(symbol, turtleAppendUnit(tState, {
            side: tSide,
            entryPrice: lastPrice,
            atrAtEntry: tDecision.derivation.atr,
            stopPrice: tDecision.stopPrice,
            marginUsdt: tDecision.sizeUsdt,
            leverage: tDecision.leverage,
            openedAtMs: Date.now(),
          }));
          logger.info('[AgentT] entry placed', {
            symbol, side: tSide, action: tDecision.action,
            orderId: tResult.orderId,
            margin: tDecision.sizeUsdt.toFixed(2),
            leverage: tDecision.leverage,
            stop: tDecision.stopPrice.toFixed(4),
            unitsHeld: tDecision.derivation.unitsHeld + 1,
          });
        } else {
          logger.info('[AgentT] entry rejected', {
            symbol, side: tSide, reason: tResult.reason,
          });
        }
      } else if (
        (tDecision.action === 'exit_stop' || tDecision.action === 'exit_donchian')
        && tState.units.length > 0
      ) {
        // T exit — query its open trend-lane rows under agent='T' and
        // close them via the existing closeHeldPosition path. The 2×
        // ATR stop and 10-bar opposite Donchian are the only two exit
        // triggers in System 1; both close ALL pyramid units at once.
        try {
          const tHeldSide = tState.units[0]!.side;
          const openTRows = await pool.query(
            `SELECT id, quantity FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                AND agent = 'T' AND lane = 'trend'
              ORDER BY entry_time ASC`,
            [`monkey|kernel=${this.instanceId}|%`, symbol],
          );
          const tRows = openTRows.rows as Array<{ id: string; quantity: string }>;
          if (tRows.length > 0) {
            const totalQty = tRows.reduce(
              (s, r) => s + Math.abs(Number(r.quantity) || 0),
              0,
            );
            // Estimate realized PnL across the pyramid: weighted mean
            // entry from open rows, vs lastPrice mark, times totalQty.
            // Same approximation closeHeldPosition uses for K/M.
            const sumWeighted = tState.units.reduce(
              (s, u) => s + u.entryPrice * u.marginUsdt * u.leverage,
              0,
            );
            const sumNotional = tState.units.reduce(
              (s, u) => s + u.marginUsdt * u.leverage,
              0,
            );
            const avgEntry = sumNotional > 0
              ? sumWeighted / sumNotional
              : tState.units[0]!.entryPrice;
            const sideSign = tHeldSide === 'long' ? 1 : -1;
            const pnlAtDecision = (lastPrice - avgEntry) * totalQty * sideSign;
            const closeResult = await this.closeHeldPosition({
              symbol,
              tradeId: tRows[0]!.id,
              heldSide: tHeldSide,
              markPrice: lastPrice,
              exitReason: tDecision.action === 'exit_stop'
                ? 'turtle_stop'
                : 'turtle_donchian_exit',
              pnlAtDecision,
              lane: 'trend',
            });
            if (closeResult.executed) {
              this.turtleStates.set(
                symbol,
                turtleClearUnits(tState, tDecision.action, Date.now()),
              );
              logger.info('[AgentT] exit executed', {
                symbol, exitReason: tDecision.action,
                pnl: pnlAtDecision.toFixed(4),
                unitsClosed: tState.units.length,
              });
            }
          } else {
            // No DB rows but state has units — drift / orphan. Reset
            // state so T can re-enter on the next breakout. Reconciler
            // will catch any stranded exchange position.
            this.turtleStates.set(
              symbol,
              turtleClearUnits(tState, 'state_drift_reset', Date.now()),
            );
          }
        } catch (err) {
          logger.warn('[AgentT] exit query/close failed', {
            symbol, err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 6d. Persist arbiter snapshot to telemetry table.
    try {
      await pool.query(
        `INSERT INTO arbiter_allocation
           (symbol, total_capital_usdt, k_share, m_share,
            k_pnl_window_total, m_pnl_window_total,
            k_trades_in_window, m_trades_in_window)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          symbol, availableEquity,
          arbiterSnapshot.kShare, arbiterSnapshot.mShare,
          arbiterSnapshot.kPnlWindowTotal, arbiterSnapshot.mPnlWindowTotal,
          arbiterSnapshot.kTradesInWindow, arbiterSnapshot.mTradesInWindow,
        ],
      );
    } catch (err) {
      logger.debug('[Monkey] arbiter_allocation insert failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
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
   * Proposal #10 — detect (don't flip) the live account's position
   * direction mode. Caches the answer on the kernel so the executor's
   * placeOrder path knows whether to send ``posSide: LONG | SHORT``
   * (HEDGE) or omit it (ONE_WAY → BOTH). Fail-soft: any read failure
   * leaves the cache at the historic 'ONE_WAY' default so the system
   * keeps trading the way it used to.
   *
   * The actual HEDGE switch is deferred — current K positions are open
   * and Poloniex rejects mode changes with live positions. Operator
   * runbook: once all K rows close, an admin calls
   *   poloniexFuturesService.setPositionDirectionMode(creds, 'HEDGE')
   * via the futures route or a one-shot script. Restart the kernel and
   * this method picks up the new mode.
   *
   * TODO: enable HEDGE mode in production after current K positions
   *       close — call setPositionDirectionMode('HEDGE') at next AWAKE
   *       startup.
   */
  private async detectPositionDirectionMode(): Promise<void> {
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      const userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
      if (!userId) {
        logger.info('[Monkey] position-mode detect: no creds, defaulting to ONE_WAY');
        return;
      }
      const creds = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!creds) {
        logger.info('[Monkey] position-mode detect: creds missing, defaulting to ONE_WAY');
        return;
      }
      const resp = await poloniexFuturesService.getPositionDirectionMode(creds);
      const detected = String(
        (resp as Record<string, unknown>)?.posMode
        ?? (resp as Record<string, unknown>)?.data
        ?? '',
      ).toUpperCase();
      if (detected === 'HEDGE' || detected === 'ONE_WAY') {
        this.positionDirectionMode = detected;
        logger.info('[Monkey] position-mode detected', { mode: detected });
      } else {
        // Some response shapes nest under .data — try once more.
        const data = (resp as Record<string, unknown>)?.data;
        const nested = String(
          (data && typeof data === 'object' ? (data as Record<string, unknown>).posMode : '')
          ?? '',
        ).toUpperCase();
        if (nested === 'HEDGE' || nested === 'ONE_WAY') {
          this.positionDirectionMode = nested;
          logger.info('[Monkey] position-mode detected (nested)', { mode: nested });
        } else {
          logger.info('[Monkey] position-mode detect: unrecognized response, default ONE_WAY', {
            raw: detected,
          });
        }
      }
    } catch (err) {
      logger.debug('[Monkey] position-mode detect failed (fail-soft to ONE_WAY)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Look up Monkey's most recent open trade row for a symbol. Used by
   * the scalp-exit gate (v0.4) to compute unrealized P&L.
   */
  /**
   * Proposal #3 — Kelly rolling stats reader.
   *
   * Fetches the last 50 closed Monkey trades for ``agent`` from
   * ``autonomous_trades`` (filtered by both ``agent`` column and the
   * monkey reason prefix; see Polytrade engine prefix-filter lesson)
   * and returns ``{ winRate, avgWin, avgLoss }`` summary stats.
   *
   * Returns null when fewer than 5 closed trades have accumulated —
   * the Kelly cap is a no-op until enough samples to estimate the
   * edge meaningfully.
   */
  private async getKellyRollingStats(
    agent: string,
    lane: 'scalp' | 'swing' | 'trend',
  ): Promise<{ winRate: number; avgWin: number; avgLoss: number } | null> {
    try {
      const result = await pool.query(
        `SELECT pnl FROM autonomous_trades
          WHERE status = 'closed'
            AND agent = $1
            AND lane = $2
            AND reason LIKE 'monkey|%'
          ORDER BY exit_time DESC
          LIMIT 50`,
        [agent, lane],
      );
      const pnls = (result.rows as Array<{ pnl: string | number }>)
        .map((r) => Number(r.pnl) || 0)
        .filter((p) => Number.isFinite(p));
      if (pnls.length < 5) return null;
      const wins = pnls.filter((p) => p > 0);
      const losses = pnls.filter((p) => p < 0);
      const winRate = wins.length / pnls.length;
      const avgWin = wins.length > 0
        ? wins.reduce((s, v) => s + v, 0) / wins.length
        : 0;
      const avgLoss = losses.length > 0
        ? losses.reduce((s, v) => s + v, 0) / losses.length
        : 0;
      return { winRate, avgWin, avgLoss };
    } catch (err) {
      logger.debug('[Monkey] getKellyRollingStats failed; defer to geometric formula', {
        agent,
        lane,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async findOpenMonkeyTrade(symbol: string): Promise<
    | { id: string; entry_price: string; quantity: string; leverage: number; order_id: string | null; side: 'long' | 'short'; lane: 'scalp' | 'swing' | 'trend' }
    | null
  > {
    // Aggregate over ALL open lanes (back-compat: callers that don't
    // know about lanes still need a single open-row view). Returns the
    // OLDEST lane's pseudo-row when multiple lanes hold positions; the
    // proper lane-aware path uses ``findOpenMonkeyTradesByLane`` below.
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      const result = await pool.query(
        `SELECT id, entry_price, quantity, leverage, order_id, side, lane
           FROM autonomous_trades
          WHERE reason LIKE $2 AND status = 'open' AND symbol = $1
          ORDER BY entry_time ASC`,
        [symbol, reasonPattern],
      );
      const rows = result.rows as Array<{
        id: string; entry_price: string; quantity: string; leverage: number;
        order_id: string | null; side: string; lane: string;
      }>;
      const normSide = (s: string): 'long' | 'short' =>
        s === 'buy' || s === 'long' ? 'long' : 'short';
      const normLane = (l: string | null | undefined): 'scalp' | 'swing' | 'trend' =>
        (l === 'scalp' || l === 'trend') ? l : 'swing';
      if (rows.length === 0) return null;
      if (rows.length === 1) {
        return { ...rows[0], side: normSide(rows[0].side), lane: normLane(rows[0].lane) };
      }
      // Multi-row: aggregate by quantity-weighted entry price across
      // ALL rows for legacy callers. The lane-aware path operates per
      // (lane) inside findOpenMonkeyTradesByLane and is the source of
      // truth post-#10.
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
        lane: normLane(rows[0].lane),
      };
    } catch (err) {
      logger.debug('[Monkey] findOpenMonkeyTrade failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Proposal #10 — per-lane open-position lookup. Returns one entry per
   * lane that currently has an open Monkey row on this symbol; rows
   * within a lane are aggregated (DCA adds collapse into a single
   * pseudo-row per lane the same way the symbol-wide aggregation worked
   * pre-#10).
   *
   * Used by processSymbol to thread lane-positions into TickInputs and
   * by the entry path to gate "is THIS lane flat?" rather than the
   * symbol-wide held-side question.
   */
  private async findOpenMonkeyTradesByLane(symbol: string): Promise<
    Array<{
      lane: 'scalp' | 'swing' | 'trend';
      side: 'long' | 'short';
      entry_price: number;
      quantity: number;
      trade_id: string;
      order_id: string | null;
      leverage: number;
    }>
  > {
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      const result = await pool.query(
        `SELECT id, entry_price, quantity, leverage, order_id, side, lane
           FROM autonomous_trades
          WHERE reason LIKE $2 AND status = 'open' AND symbol = $1
          ORDER BY entry_time ASC`,
        [symbol, reasonPattern],
      );
      const rows = result.rows as Array<{
        id: string; entry_price: string; quantity: string; leverage: number;
        order_id: string | null; side: string; lane: string;
      }>;
      const normSide = (s: string): 'long' | 'short' =>
        s === 'buy' || s === 'long' ? 'long' : 'short';
      const normLane = (l: string | null | undefined): 'scalp' | 'swing' | 'trend' =>
        (l === 'scalp' || l === 'trend') ? l : 'swing';
      // Group by lane, weighted-average within each lane (DCA roll-up).
      const byLane: Map<string, typeof rows> = new Map();
      for (const r of rows) {
        const lane = normLane(r.lane);
        if (!byLane.has(lane)) byLane.set(lane, []);
        byLane.get(lane)!.push(r);
      }
      const out: Array<{
        lane: 'scalp' | 'swing' | 'trend';
        side: 'long' | 'short';
        entry_price: number;
        quantity: number;
        trade_id: string;
        order_id: string | null;
        leverage: number;
      }> = [];
      for (const [laneStr, laneRows] of byLane) {
        const lane = laneStr as 'scalp' | 'swing' | 'trend';
        if (laneRows.length === 0) continue;
        const totalQty = laneRows.reduce(
          (s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
        if (totalQty === 0) continue;
        const weightedPrice = laneRows.reduce(
          (s, r) => s + Number(r.entry_price) * Math.abs(Number(r.quantity) || 0),
          0,
        ) / totalQty;
        out.push({
          lane,
          side: normSide(laneRows[0].side),
          entry_price: weightedPrice,
          quantity: totalQty,
          trade_id: laneRows[0].id,
          order_id: laneRows[0].order_id,
          leverage: laneRows[0].leverage,
        });
      }
      return out;
    } catch (err) {
      logger.debug('[Monkey] findOpenMonkeyTradesByLane failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
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
    /** Proposal #10: when provided, close only autonomous_trades rows
     *  matching this lane (and send ``posSide`` on the exchange close
     *  in HEDGE mode so the other lane stays untouched). When omitted,
     *  legacy behavior — close all open rows under (kernel, symbol). */
    lane?: 'scalp' | 'swing' | 'trend';
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, tradeId, heldSide, markPrice, exitReason, pnlAtDecision } = req;
    const closeLane = req.lane;

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
    // Proposal #10 — in HEDGE mode + lane scoped close, the exchange
    // qty for *this side* must be used (the symbol may have an opposite
    // side too); in ONE_WAY mode there's only one net position so the
    // whole-symbol qty applies.
    let exchangeQty = 0;
    try {
      const positions = await poloniexFuturesService.getPositions(credentials);
      const forSymbol = (Array.isArray(positions) ? positions : []).filter(
        (p: Record<string, unknown>) => String(p.symbol ?? '') === symbol,
      );
      if (this.positionDirectionMode === 'HEDGE' && closeLane) {
        // Match by side — under HEDGE Poloniex returns one position per side.
        const target = forSymbol.find((p: Record<string, unknown>) => {
          const s = String(p.side ?? p.posSide ?? '').toUpperCase();
          const want = heldSide === 'long' ? 'LONG' : 'SHORT';
          return s === want;
        }) ?? forSymbol[0];
        exchangeQty = Math.abs(Number(target?.qty ?? target?.size ?? 0));
      } else {
        const target = forSymbol[0];
        exchangeQty = Math.abs(Number(target?.qty ?? target?.size ?? 0));
      }
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
      // Proposal #10 — in HEDGE mode the close must specify which side
      // of the hedge book it's reducing, otherwise the exchange may
      // route against the wrong leg.
      //
      // HEDGE close: posSide=LONG|SHORT, NO reduceOnly — Poloniex v3
      // rejects reduceOnly in HEDGE with "Param error reduceOnly cannot
      // be set to true in hedge" (prod incident 2026-04-30). The
      // poloniexFuturesService strips reduceOnly for HEDGE mode, but we
      // also pass `positionMode` explicitly so the contract is obvious
      // at the call site.
      const isHedge = this.positionDirectionMode === 'HEDGE';
      const closePosSide: 'LONG' | 'SHORT' | undefined =
        isHedge ? (heldSide === 'long' ? 'LONG' : 'SHORT') : undefined;
      const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
        symbol, side: closeSide, type: 'market', size: formattedSize, lotSize: symbolLotSize,
        reduceOnly: true,
      }, {
        positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
        ...(closePosSide ? { posSide: closePosSide } : {}),
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
    //
    // Arbiter feedback: each row carries an agent tag (K|M); the PnL
    // share for that row goes back to the arbiter under that agent so
    // the rolling allocation reflects per-agent performance.
    try {
      // Proposal #10 — when a lane is scoped, only close that lane's
      // open rows. Other lanes (e.g. swing-long while we're closing a
      // scalp-short) keep their bookkeeping intact.
      const openRows = closeLane
        ? await pool.query(
            `SELECT id, quantity, agent FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                AND lane = $3
              ORDER BY entry_time ASC`,
            [`monkey|kernel=${this.instanceId}|%`, symbol, closeLane],
          )
        : await pool.query(
            `SELECT id, quantity, agent FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
              ORDER BY entry_time ASC`,
            [`monkey|kernel=${this.instanceId}|%`, symbol],
          );
      const rows = openRows.rows as Array<{ id: string; quantity: string; agent: string | null }>;
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
        // Single-row fallback: assume Agent K (the established default).
        this.arbiter.recordSettled('K', pnlAtDecision);
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
          // Tag-aware arbiter feedback. Pre-separation rows have
          // agent=NULL or 'K' (default from migration 039); those
          // attribute to K. T (Turtle classical TA) was added in the
          // three-agent decomposition; ``recordSettled`` accepts any
          // uppercase label so T's PnL share goes back to T's window.
          const agentLabel: 'K' | 'M' | 'T' =
            row.agent === 'M' ? 'M' : row.agent === 'T' ? 'T' : 'K';
          this.arbiter.recordSettled(agentLabel, rowPnl);
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
    /** Which agent placed this entry. K = kernel (geometry-only),
     *  M = ml-only, T = Turtle System 1 classical TA (control arm).
     *  Default 'K' for back-compat with the existing call sites. */
    agent?: 'K' | 'M' | 'T';
    /** Proposal #10: execution lane key. Default 'swing' = pre-#10 implicit
     *  lane so existing call sites remain bit-identical. */
    lane?: 'scalp' | 'swing' | 'trend';
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

    // Proposal #10 — when the live account is in HEDGE position-direction
    // mode, we MUST send `posSide: LONG | SHORT` so the exchange opens
    // the order on the correct side of the hedge book. In ONE_WAY mode,
    // omit posSide (the service defaults to BOTH). The mode is detected
    // once at startup (assertHedgeModeIfPossible) and cached on the
    // kernel; we read that cache here.
    const posSide: 'LONG' | 'SHORT' | undefined =
      this.positionDirectionMode === 'HEDGE'
        ? (req.side === 'long' ? 'LONG' : 'SHORT')
        : undefined;

    // Set leverage (non-fatal), then place market order.
    //
    // After the HEDGE-mode flip Poloniex returns code=11011
    // ("Position mode and posSide do not match") on /v3/position/leverage
    // when the body omits posSide (the default landed as BOTH, which is
    // an ONE_WAY-only value). Mirror the posSide derivation used for
    // placeOrder so the exchange sees a consistent side on both calls.
    try {
      await poloniexFuturesService.setLeverage(
        credentials, symbol, leverage,
        posSide ? { posSide } : {},
      );
    } catch (levErr) {
      logger.warn('[Monkey] setLeverage failed (non-fatal)', {
        symbol, leverage, posSide,
        err: levErr instanceof Error ? levErr.message : String(levErr),
      });
    }

    let orderId: string | null = null;
    try {
      const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
        symbol, side: exchangeSide, type: 'market', size: formattedSize, lotSize: symbolLotSize,
      }, posSide ? { posSide } : {});
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

    // Persist. Encode kernel + agent + lane + Monkey's state into reason
    // so the close-hook + reconciler + arbiter can recover attribution
    // cheaply.
    // Format: monkey|kernel=<id>|agent=<K|M>|lane=<scalp|swing|trend>|phi=...|kappa=...|sov=...|dca=<N>|src=<ver>
    const agentTag = req.agent ?? 'K';
    const laneTag = req.lane ?? 'swing';
    try {
      const dcaTag = req.isDCAAdd ? `|dca=${req.dcaAddIndex ?? 1}` : '';
      const reasonEncoded =
        `monkey|kernel=${this.instanceId}|agent=${agentTag}|lane=${laneTag}|phi=${req.phi.toFixed(3)}|kappa=${req.kappa.toFixed(2)}|sov=${req.sovereignty.toFixed(3)}${dcaTag}|src=v0.10`;
      await pool.query(
        `INSERT INTO autonomous_trades
           (user_id, symbol, side, entry_price, quantity, leverage,
            confidence, reason, order_id, paper_trade, engine_version, agent, lane)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          userId, symbol, exchangeSide, entryPrice, formattedSize, leverage,
          req.phi, reasonEncoded, orderId, false, getEngineVersion(), agentTag, laneTag,
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

      // Loop 3 (UCP §43.4) — gate the bank write. Pulls the Loop 1
      // sovereignty + Loop 2 convergence_type recorded on the trade
      // row at open time. Pre-refactor rows have NULL columns; the
      // gate then defaults to permissive (sovereignty=0.5, consensus)
      // so legacy rows still write.
      const triple = await pool
        .query(
          `SELECT sovereignty_score, convergence_type, created_at, exit_time
             FROM autonomous_trades
            WHERE order_id = $1
            ORDER BY created_at DESC LIMIT 1`,
          [orderId ?? ''],
        )
        .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
      const tripleRow = triple.rows[0] as
        | {
            sovereignty_score?: number | null;
            convergence_type?: string | null;
            created_at?: Date | null;
            exit_time?: Date | null;
          }
        | undefined;
      const sovereigntyScore =
        tripleRow?.sovereignty_score == null ? 0.5 : Number(tripleRow.sovereignty_score);
      const convergenceType =
        (tripleRow?.convergence_type as
          | 'consensus' | 'groupthink' | 'genuine_multi' | 'non_convergent'
          | undefined) ?? 'consensus';
      const tradeOpenMs =
        tripleRow?.created_at != null ? new Date(tripleRow.created_at).getTime() : entryTime.getTime();
      const tradeCloseMs =
        tripleRow?.exit_time != null ? new Date(tripleRow.exit_time).getTime() : Date.now();
      const tradeDurationS = Math.max(0, (tradeCloseMs - tradeOpenMs) / 1000);
      const gateDecision = await evaluateBankWrite({
        symbol,
        decisionId: orderId ?? `witness-${Date.now()}`,
        sovereigntyScore,
        convergenceType,
        tradePnlUsdt: realizedPnl,
        tradeDurationS,
      });
      if (!gateDecision.approved) {
        logger.info('[Monkey] learning_gate rejected witnessExit bank write', {
          symbol, orderId, side, pnl: realizedPnl.toFixed(4),
          reasons: gateDecision.reasons,
        });
        return;
      }

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

        // PR 3 (#608) — FORGE_BANK_WRITE_LIVE flag wiring.
        // Detect shadow material (large loss relative to a typical
        // ~$5 margin) → run Forge cycle → write nucleus + quarantine
        // original. With flag off, log forge output but don't write.
        const marginEstimate = 5.0;
        const pnlFraction = marginEstimate > 0 ? realizedPnl / marginEstimate : 0;
        if (pnlFraction < shadowThreshold()) {
          const forgeResult = forge({
            basin: entryBasin,
            phi,
            kappa: KAPPA_STAR, // anchor — exact κ at exit not preserved
            realizedPnl,
            regimeWeights: { quantum: 1 / 3, efficient: 1 / 3, equilibrium: 1 / 3 },
          });
          if (forgeBankWriteLive()) {
            // Persist nucleus as new bubble; quarantine the original.
            const nucleus = await resonanceBank.writeForgedNucleus(
              forgeResult.nucleated.basin,
              {
                symbol,
                phi,
                lane: (bubble.payload?.lane ?? 'swing') as 'scalp' | 'swing' | 'trend' | 'observe',
                forgedFromOrderId: orderId,
                lossMagnitude: Math.abs(realizedPnl),
                engineVersion: getEngineVersion(),
              },
            );
            const quarantined = await resonanceBank.markQuarantined(
              written.id,
              `forged_nucleus_id=${nucleus?.id ?? 'unknown'}`,
            );
            logger.info('[Monkey.Forge] shadow → nucleus written', {
              symbol, orderId, pnlFraction: pnlFraction.toFixed(4),
              lossMagnitude: Math.abs(realizedPnl).toFixed(4),
              nucleusId: nucleus?.id, quarantinedOriginal: quarantined,
            });
          } else {
            logger.info('[Monkey.Forge] shadow detected (flag off, observe-only)', {
              symbol, orderId, pnlFraction: pnlFraction.toFixed(4),
              wouldNucleate: true,
              shapeConcentration: forgeResult.lessonSummary.shape_concentration,
              kappaOffset: forgeResult.lessonSummary.kappa_offset,
            });
          }
        }

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


/**
 * v0.8.7e — inter-engine agreement query.
 *
 * Returns the FRESHEST (latest computedAtMs) basin snapshot across all
 * running Monkey kernels for a symbol, or null if no kernel has ticked
 * that symbol yet. LiveSignal uses this to decide whether the Monkey
 * basin agrees that its ml_signal_flip close is warranted — if Monkey
 * still reads the basin as favoring the currently-held side, we'd
 * immediately reopen (yo-yo), so LiveSignal defers.
 */
export function getFreshestMonkeyBasinSnapshot(symbol: string): {
  basinDir: number;
  tapeTrend: number;
  computedAtMs: number;
} | null {
  let best: { basinDir: number; tapeTrend: number; computedAtMs: number } | null = null;
  for (const k of allMonkeyKernels) {
    const snap = k.getLatestBasinSnapshot(symbol);
    if (snap && (best === null || snap.computedAtMs > best.computedAtMs)) {
      best = snap;
    }
  }
  return best;
}
