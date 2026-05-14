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
import { fetchAccountContext } from './loop_account.js';
import {
  evaluatePreTradeVetoes,
  type KernelAccountState,
  type KernelContext,
  type KernelOrder,
} from '../riskKernel.js';

import { getKellyRollingStats } from './kelly_rolling_stats.js';
import { forge, forgeBankWriteLive, shadowThreshold } from './forge.js';

import {
  BASIN_DIM,
  KAPPA_STAR,
  fisherRao,
  frechetMean,
  uniformBasin,
  type Basin,
} from './basin.js';
import { BasinSync } from './basin_sync.js';
import { BusEventType, getKernelBus, type KernelBus } from './kernel_bus.js';
import {
  callTickRun,
  type TickRunAccount,
  type TickRunOHLCV,
  type TickRunSymbolState,
} from './kernel_client.js';
// Post-cutover: TS K-cognition primitives (computeEmotions / detectMode /
// computeMotivators / computeNeurochemicals) are NOT called by loop.ts —
// Python is authoritative. We import the types only so the synthesized
// bindings from pyDecision.derivation compile.
import type { EmotionState } from './emotions.js';
import { MODE_PROFILES, MonkeyMode } from './modes.js';
import { summarizeNC, type NeurochemicalState } from './neurochemistry.js';
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
// Post-cutover: perception.ts / candlePatterns.ts / classifyRegime are
// not called from loop.ts (Python computes basin / candles / regime).
// We import only the OHLCVCandle type for the array cast at the
// poloniex-fetch boundary, plus chop-suppression constants used by
// the dispatch tree's entry-gate.
import type { OHLCVCandle } from './perception.js';
import {
  CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
  CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT,
  chopSuppressEntry,
  type RegimeReading,
} from './regime.js';
import { evaluateBankWrite } from './learning_gate_client.js';
import { resonanceBank } from './resonance_bank.js';
import { computeSelfObservation, type SelfObservation } from './self_observation.js';
import { WorkingMemory, type Bubble } from './working_memory.js';
import {
  kernelShouldEnter,
  shouldDCAAdd,
  shouldExit,
  shouldProfitHarvest,
  shouldScalpExit,
  type BasinState,
  type Direction,
  type LaneType,
} from './executive.js';
import { evaluateRejustification } from './held_position_rejustification.js';
import {
  computeAgentHeadroom,
  clampSizeToHeadroom,
  computeAgentNotionalHeadroom,
  clampMarginToNotionalHeadroom,
} from './agentEquityBound.js';
import { planCloseChunks } from './closeChunker.js';
import { agentLDecide } from './agent_L_classifier.js';
import {
  newMTFState,
  onTickAppend as mtfOnTickAppend,
  mtfDecide,
  recordAgreementTimestamps as mtfRecordAgreement,
  isLongestHorizonExpired as mtfIsLongestHorizonExpired,
} from './mtfLClassifier.js';
import {
  regimeSizing as computeRegimeSizing,
  trailingRegimeStop as continuousTrailingRegimeStop,
} from './regimeSizing.js';
import {
  applyOutcomeToState,
  decayPerAgentState,
  newPerAgentState,
  recordDecision,
  riskModulator,
  type PerAgentState,
  type AgentOutcomeEvent,
  type AgentDecisionRecord,
} from './per_agent_state.js';
import {
  buildCrossAgentContext,
  convictionDampenerFromBus,
  type CrossAgentContext,
  type AgentLabel,
} from './per_agent_bus.js';
import { foresightVeto } from './per_agent_foresight.js';
import {
  clampNewContractsToCap,
  getMaxContractsPerPosition,
} from './positionContractsBound.js';

// Module-level constants + kill-switch and the loop type definitions
// were extracted to loop_constants.ts / loop_types.ts (2026-05-14
// modularization) — no behavioural change, loop.ts is now the
// orchestration spine + the MonkeyKernel class only.
import {
  DEFAULT_SYMBOLS,
  DEFAULT_TICK_MS,
  OHLCV_LOOKBACK,
  HISTORY_MAX,
  REWARD_HALF_LIFE_MS,
  REWARD_QUEUE_MAX,
  REGIME_STABILITY_TICKS_FOR_EXIT,
  BUS_RING_CAP,
  isTradingPaused,
} from './loop_constants.js';
import type {
  ActivityReward,
  MonkeyKernelConfig,
  SymbolState,
} from './loop_types.js';

export type { MonkeyKernelConfig };

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
  /**
   * orderId → submitted_at_ms cache for witnessExit dedup. Prevents
   * duplicate learning_gate calls from the close path racing the
   * reconciler (close fires witnessExit; reconciler runs ~30ms later,
   * sees DB still showing open, marks closed, second witnessExit fires).
   * Currently benign because both calls usually rejected by gate, but
   * if the gate ever approved on race, the bank would write the same
   * exchange twice. Dedup at this layer also halves the gate-call
   * volume for noisy reconcile cycles.
   *
   * Window: 60 seconds. Entries pruned lazily on next call.
   */
  private witnessExitDedup: Map<string, number> = new Map();
  private static readonly WITNESS_DEDUP_WINDOW_MS = 60_000;
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

    // 2026-05-13 MTF Phase 2 — bootstrap per-timeframe basin
    // histories from historical OHLCV so the 4h classifier doesn't
    // need 80 days of live ticks to warm up. Async + fail-soft;
    // failures (network, parse) leave the bootstrap empty and the
    // MTF state warms up gradually from live ticks instead.
    if (process.env.MONKEY_MTF_BOOTSTRAP !== 'false') {
      try {
        const { bootstrapMTFForSymbol } = await import('./mtfBootstrap.js');
        for (const sym of this.symbols) {
          const state = this.symbolStates.get(sym);
          if (state) {
            // Fire-and-forget — each symbol's bootstrap is independent.
            void bootstrapMTFForSymbol(sym, state.mtfState).catch((err) => {
              logger.warn('[MTF-bootstrap] failed for symbol', {
                symbol: sym, err: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      } catch (importErr) {
        logger.warn('[MTF-bootstrap] import failed (non-fatal)', {
          err: importErr instanceof Error ? importErr.message : String(importErr),
        });
      }
    }

    // v0.8.8 cross-agent observation — subscribe to the bus and append
    // symbol-scoped events into each symbol's recentBusEvents ring.
    // Each agent's tick reads this ring to build its CrossAgentContext
    // (who else just entered, was anyone vetoed, are anomalies firing).
    this.bus.subscribe({
      id: `${this.instanceId}-cross-agent-observer`,
      symbols: this.symbols,
      handler: (event) => {
        if (!event.symbol) return;
        const state = this.symbolStates.get(event.symbol);
        if (!state) return;
        state.recentBusEvents.push(event);
        if (state.recentBusEvents.length > BUS_RING_CAP) {
          state.recentBusEvents.shift();
        }
      },
    });

    // 2026-05-08 #11 — OUTCOME subscriber for the reconciler PnL
    // recovery path.
    // 2026-05-10 #12 — broadened to ALL ghost-close reasons. When ANY
    // out-of-band actor closes a kernel-issued position (user UI close,
    // exchange-side liquidation/stop, partial-fill cleanup), the
    // reconciler ghosts the DB row AND publishes an OUTCOME event with
    // the recovered PnL. This subscriber consumes those events and
    // updates the owning agent's emotion + neurochemistry stack —
    // closing the learning-feedback loop that was previously broken
    // for ALL exchange-side closes, not just user-initiated ones.
    this.bus.subscribe({
      id: `${this.instanceId}-outcome-feedback`,
      types: [BusEventType.OUTCOME],
      symbols: this.symbols,
      handler: (event) => {
        if (!event.symbol) return;
        const payload = event.payload as Record<string, unknown> | undefined;
        if (!payload) return;
        const agent = String(payload.agent ?? '');
        if (agent !== 'K' && agent !== 'M' && agent !== 'T' && agent !== 'L') return;
        const side = String(payload.side ?? '').toLowerCase();
        if (side !== 'long' && side !== 'short') return;
        const pnl = Number(payload.pnl ?? 0);
        if (!Number.isFinite(pnl)) return;
        // Don't double-fire: closeHeldPosition already calls
        // applyOutcomeToAgent on its own path. Reconciler-recovered
        // PnL events have source starting with 'reconciler_recovered'
        // (followed by ':<ghostReason>'). The legacy
        // 'manual_close_recovered' tag is kept for backward compat
        // with any in-flight events from older deploys.
        const src = String(payload.source ?? '');
        const isRecovered =
          src === 'manual_close_recovered' ||
          src.startsWith('reconciler_recovered');
        if (!isRecovered) return;
        this.applyOutcomeToAgent(event.symbol, agent, side as 'long' | 'short', pnl);
        const ghostReason = String(payload.ghostReason ?? 'unknown');
        logger.info(
          `[Monkey] Agent ${agent} emotion stack updated from recovered ghost close: pnl=${pnl.toFixed(4)} side=${side} reason=${ghostReason}`,
        );
      },
    });
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
      basinAtOpenByLane: {},
      regimeChangeStreakByLane: {},
      entryTimeMsByLane: {},
      integrationHistory: [],
      latestBasinSnapshot: null,
      agentStates: {
        K: newPerAgentState(),
        M: newPerAgentState(),
        T: newPerAgentState(),
        L: newPerAgentState(),
      },
      recentBusEvents: [],
      lForceHarvestAtMsBySide: { long: null, short: null },
      recentLHarvestPnls: [],
      lLastConfirmedAtMsBySide: { long: null, short: null },
      lModeAtConfirmedBySide: { long: null, short: null },
      mtfState: newMTFState(),
      mtfLongestAgreeingBySide: { long: null, short: null },
      rScoreCurrent: null,
      rScoreAtEntryBySide: { long: null, short: null },
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

    // Python-authoritative tick: serialize the kernel state BEFORE any
    // mutation, so the /monkey/tick/run call sees the same "prior state"
    // the TS pipeline starts from. The TS cognition section below runs
    // for M/T/L agent inputs but its decision is overridden by Python's
    // (the K-kernel cutover — PR #674).
    const prevPyState: TickRunSymbolState = {
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
      regime_at_open_by_lane: { ...state.regimeAtOpenByLane },
      phi_at_open_by_lane: { ...state.phiAtOpenByLane },
    };

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

    // Funding rate for the symbol's perpetual contract (8h rate from exchange).
    // Non-blocking: fetch failure → rate=0 → no drag perturbation this tick.
    // The rate is forwarded to the Python kernel so compute_funding_drag can
    // modulate anxiety for held positions (P14: real-world boundary → STATE).
    const fundingRateResp = await poloniexFuturesService.getFundingRate(symbol).catch(() => null) as { fundingRate?: string | number } | null;
    const fundingRate8h = Number(fundingRateResp?.fundingRate) || 0;

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
    } = await fetchAccountContext(symbol);

    // ── PYTHON-AUTHORITATIVE KERNEL TICK (PR #674 Phase 3 cutover) ──
    //
    // Replaces the in-process TS K-cognition (perceive, refract,
    // velocity, normalizedEntropy, computeNeurochemicals, detectMode,
    // basinDirection, trendProxy, regimeScore/Sizing, classifyRegime,
    // computeMotivators, computeEmotions, kernelDirection, candle
    // patterns, computeSelfObservation, basinSync.update) with a single
    // /monkey/tick/run call. The TS bindings below pull every shared
    // local var (basin, basinDir, tapeTrend, basinState, mode, nc,
    // emotions, motivators, regimeReading, ...) from pyDecision +
    // pyState so the downstream K-dispatch tree and M/T/L agent paths
    // continue to read the same local-var names without modification.
    //
    // Still TS-side (not yet ported; planned for the M/T/L cutover):
    //   * MTF L classifier (mtfDecide(state.mtfState)) — L agent path
    //   * Working memory bubble store (state.wm) — kept for L resonance
    //   * Identity crystallization (state.identityBasin = frechetMean)
    //   * Per-agent emotion-state decay (state.agentStates.K/M/T/L)
    //   * Self-observation refresh (this.selfObs) — periodic
    //
    // Fail-loud: Python down → tick errors and operator sees it. No TS
    // fallback. 5 s default timeout.
    const maxLevBoundary = (await getMaxLeverage(symbol)) ?? 10;
    const precisions = await getPrecisions(symbol).catch(() => null);
    const lotSize = precisions?.lotSize ?? 0;
    const minNotional = lastPrice * Math.max(lotSize, 1e-9);
    const bankSize = await resonanceBank.bankSize();
    const sovereignty = await resonanceBank.sovereignty();
    const ownOpenRow = await this.findOpenMonkeyTrade(symbol);
    const heldSide: 'long' | 'short' | null = ownOpenRow
      ? (exchangeHeldSide ?? ownOpenRow.side)
      : null;

    const tickRunOhlcv: TickRunOHLCV[] = ohlcv.map((c) => ({
      timestamp: Number(c.timestamp ?? 0),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }));
    const tickRunAccount: TickRunAccount = {
      equity_fraction: equityFraction,
      margin_fraction: marginFraction,
      open_positions: openPositions,
      available_equity: availableEquity,
      exchange_held_side: exchangeHeldSide,
      own_position_entry_price: ownOpenRow ? Number(ownOpenRow.entry_price) : null,
      own_position_quantity: ownOpenRow ? Number(ownOpenRow.quantity) : null,
      own_position_trade_id: ownOpenRow ? String(ownOpenRow.id) : null,
    };
    const tickRunResult = await callTickRun({
      instance_id: this.instanceId,
      inputs: {
        symbol,
        ohlcv: tickRunOhlcv,
        account: tickRunAccount,
        bank_size: bankSize,
        sovereignty,
        max_leverage: maxLevBoundary,
        min_notional: minNotional,
        size_fraction: this.sizeFraction,
        self_obs_bias: this.selfObs?.entryBias ?? null,
        funding_rate_8h: fundingRate8h,
        rolling_kelly_stats: null,
      },
      prev_state: prevPyState,
    });
    const pyDecision = tickRunResult.decision;
    const pyState = tickRunResult.new_state;

    // Hydrate TS state from Python's authoritative new_state.
    const prevMode = state.lastMode;
    state.kappa = pyState.kappa;
    state.lastMode = pyState.last_mode as MonkeyMode | null;
    state.phiHistory = pyState.phi_history;
    state.fHealthHistory = pyState.fhealth_history;
    state.driftHistory = pyState.drift_history;
    state.basinHistory = pyState.basin_history.map((b) => Float64Array.from(b) as Basin);
    state.identityBasin = Float64Array.from(pyState.identity_basin) as Basin;
    state.lastBasin = pyState.last_basin
      ? Float64Array.from(pyState.last_basin) as Basin
      : Float64Array.from(pyDecision.basin) as Basin;
    state.dcaAddCount = pyState.dca_add_count;
    state.lastEntryAtMs = pyState.last_entry_at_ms;
    state.peakPnlUsdt = pyState.peak_pnl_usdt;
    state.peakTrackedTradeId = pyState.peak_tracked_trade_id;
    state.rScoreCurrent = pyDecision.r_score ?? null;

    // Local-var bindings from pyDecision (the dispatch tree + M/T/L
    // agents below read these names; preserved for behavioral parity).
    const basin: Basin = state.lastBasin;
    const phi = pyDecision.phi;
    const fHealth = pyDecision.f_health;
    const bv = pyDecision.basin_velocity;
    const driftNow = pyDecision.drift_from_identity;
    const basinDir = pyDecision.basin_direction;
    const tapeTrend = pyDecision.tape_trend;
    const mode = pyDecision.mode as MonkeyMode;
    const sideCandidate: 'long' | 'short' =
      pyDecision.side_candidate === 'short' ? 'short' : 'long';
    const direction: Direction = pyDecision.direction as Direction;
    const sideOverride = pyDecision.side_override;
    const nc = pyDecision.neurochemistry as unknown as NeurochemicalState;
    const regimeWeights = (
      (pyDecision.derivation.regime_weights as { quantum: number; efficient: number; equilibrium: number } | undefined)
      ?? { quantum: 1 / 3, efficient: 1 / 3, equilibrium: 1 / 3 }
    );
    state.latestBasinSnapshot = { basinDir, tapeTrend, computedAtMs: Date.now() };
    if (prevMode !== null && prevMode !== mode) {
      const modePyDeriv = pyDecision.derivation.mode as Record<string, unknown> | undefined;
      const transitionReason = String(modePyDeriv?.reason ?? 'mode_transition');
      logger.info('[Monkey] mode transition', {
        symbol, from: prevMode, to: mode, reason: transitionReason,
      });
      this.bus.publish({
        type: BusEventType.MODE_TRANSITION,
        source: this.instanceId,
        symbol,
        payload: { from: prevMode, to: mode, reason: transitionReason, phi, kappa: state.kappa },
      });
    }

    // L agent's MTF state stays TS-side until M/T/L cutover.
    mtfOnTickAppend(state.mtfState, basin, state.sessionTicks);
    const mtfDec = mtfDecide(state.mtfState);
    if (mtfDec.action !== 'hold') {
      mtfRecordAgreement(state.mtfState, mtfDec, Date.now());
    }
    if (mtfDec.action !== 'hold' || state.sessionTicks % 10 === 0) {
      logger.info('[MTF-L] decision', {
        symbol,
        action: mtfDec.action,
        agreement: `${mtfDec.agreementCount}/${mtfDec.totalTfs}`,
        sizeMult: mtfDec.sizeMultiplier.toFixed(2),
        longest: mtfDec.longestAgreeingLabel ?? '—',
        perTf: mtfDec.perTimeframe.map((t) =>
          `${t.label}:${t.warm ? (t.decision?.action ?? 'hold') : 'cold'}`,
        ).join(','),
      });
    }

    // Self-observation refresh (kept TS-side; periodic, light-weight).
    const now = Date.now();
    if (now - this.selfObsLastUpdate > MonkeyKernel.SELF_OBS_REFRESH_MS) {
      this.selfObs = await computeSelfObservation(24, this.instanceId);
      this.selfObsLastUpdate = now;
    }

    // Working memory bubble (kept until WM moves to Python).
    const bubble = state.wm.add(basin, phi, { symbol, tick: state.sessionTicks });
    const wmStats = await state.wm.tick();
    void bubble;

    // Basin-sync publish — observability only, fail-soft.
    const syncPublish = this.basinSync.update({
      basin, phi, kappa: state.kappa, mode, driftFromIdentity: driftNow,
    }).catch(() => { /* non-fatal */ });
    void syncPublish;

    // Synthesize BasinState for downstream readers (held-position
    // rejustification + chop-suppression in the dispatch tree).
    const basinState: BasinState = {
      basin, phi, kappa: state.kappa, regimeWeights,
      neurochemistry: nc, sovereignty, basinVelocity: bv,
      identityBasin: state.identityBasin,
    };

    // Side / sizing / lane — all Python-authoritative.
    const SHORTS_LIVE = process.env.MONKEY_SHORTS_LIVE === 'true';
    const sideShortRefused = sideCandidate === 'short' && !SHORTS_LIVE;
    if (sideShortRefused) {
      logger.info('[Monkey] short refused — MONKEY_SHORTS_LIVE=false', {
        symbol, basinDir, tapeTrend, direction, wantedShort: true,
      });
    }
    const selfObsBias = this.selfObs?.entryBias[mode]?.[sideCandidate] ?? 1.0;
    const expFloorApprox = 0.10;
    const maxNewbornLev = 20;
    const minNeededForMinNotional = minNotional / (expFloorApprox * maxNewbornLev);
    const effectiveSizeFraction = availableEquity * this.sizeFraction < minNeededForMinNotional
      ? 1.0
      : this.sizeFraction;
    const cappedEquity = availableEquity * effectiveSizeFraction;
    const chosenLane: LaneType = pyDecision.lane;
    const positionLane: 'scalp' | 'swing' | 'trend' =
      chosenLane === 'observe' ? 'swing' : chosenLane;
    const rollingStats = await getKellyRollingStats('K', positionLane);
    void rollingStats;

    const entryThr = {
      value: pyDecision.entry_threshold,
      reason: pyDecision.reason,
      derivation: (pyDecision.derivation.entry_threshold ?? {}) as Record<string, number>,
    };
    const leverage = {
      value: pyDecision.leverage,
      reason: pyDecision.reason,
      derivation: (pyDecision.derivation.leverage ?? {}) as Record<string, number>,
    };
    const size = {
      value: pyDecision.size_usdt,
      reason: pyDecision.reason,
      derivation: (pyDecision.derivation.size ?? {}) as Record<string, number>,
    };
    if (size.value === 0 && exchangeHeldSide === null) {
      logger.info('[size-zero-diag]', {
        symbol, availableEquity, effectiveSizeFraction, cappedEquity,
        minNotional, leverage: leverage.value, bankSize, mode,
        sizeValue: size.value, lane: positionLane,
        sizeDerivation: size.derivation,
      });
    }

    // Auto-flatten / regime / candle / emotion / motivator readings —
    // all derived from pyDecision.derivation. Local shapes match what
    // the dispatch tree (and held_position_rejustification.ts) expects.
    const autoFlatten = {
      value: pyDecision.action === 'flatten',
      reason: pyDecision.action === 'flatten' ? pyDecision.reason : '',
      derivation: (pyDecision.derivation.auto_flatten ?? {}) as Record<string, number>,
    };
    const regimeReading = (pyDecision.derivation.regime ?? {
      regime: 'CHOP',
      confidence: 0.5,
      trendStrength: 0,
      chopScore: 0.5,
    }) as unknown as RegimeReading;
    const emotions = (pyDecision.derivation.emotions ?? {}) as unknown as EmotionState;
    const motivators = (pyDecision.derivation.motivators ?? {}) as unknown as {
      iQ: number;
      [k: string]: number;
    };
    void motivators;
    const candlePatternReading = (pyDecision.derivation.candle_pattern ?? {
      patternName: 'none', strength: 0, direction: 0,
    }) as { patternName: string; strength: number; direction: number };
    const candleDeriv = pyDecision.derivation.candle_pattern as Record<string, unknown> | undefined;
    const candlePatternSignal = (candleDeriv?.signed_scalar ?? 0) as number;
    const candleHammerDefer = (candleDeriv?.hammer_defer_long_sl ?? false) as boolean;
    void candlePatternSignal;

    // ``action``/``reason``/``derivation`` start at Python's verdict.
    // The dispatch tree below still runs to perform its state-mutation
    // side-effects (per-lane peak tracking, streak counters, regime
    // anchors, SL defer); any action reassignments it makes are
    // overridden by the explicit re-assertion at the end of this block.
    let action: string = pyDecision.action;
    let reason: string = pyDecision.reason;
    const modeDecision = {
      value: mode,
      reason: String((pyDecision.derivation.mode as Record<string, unknown> | undefined)?.reason ?? ''),
      derivation: (pyDecision.derivation.mode ?? {}) as Record<string, number | string>,
    };
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
      regime: {
        regime: regimeReading.regime,
        confidence: regimeReading.confidence,
        trend_strength: regimeReading.trendStrength,
        chop_score: regimeReading.chopScore,
      },
      candle_pattern: {
        pattern_name: candlePatternReading.patternName,
        strength: candlePatternReading.strength,
        direction: candlePatternReading.direction,
        signed_scalar: candlePatternSignal,
        hammer_defer_long_sl: candleHammerDefer,
      },
      python_kernel: {
        mode: pyDecision.mode,
        action: pyDecision.action,
        lane: pyDecision.lane,
        direction: pyDecision.direction,
        side_candidate: pyDecision.side_candidate,
        side_override: pyDecision.side_override,
        entry_threshold: pyDecision.entry_threshold,
        leverage: pyDecision.leverage,
        size_usdt: pyDecision.size_usdt,
        phi: pyDecision.phi,
        kappa: pyDecision.kappa,
        basin_velocity: pyDecision.basin_velocity,
        basin_direction: pyDecision.basin_direction,
        tape_trend: pyDecision.tape_trend,
        harvest_kind: pyDecision.harvest_kind ?? null,
        r_score: pyDecision.r_score ?? null,
        mtf_decision_action: pyDecision.mtf_decision_action ?? null,
        mtf_size_multiplier: pyDecision.mtf_size_multiplier ?? null,
        leverage_cap_from_regime: pyDecision.leverage_cap_from_regime ?? null,
        derivation: pyDecision.derivation,
      },
    };
    void wmStats;

    // v0.6.3: heldSide / ownOpenRow already bound from the early Python
    // tick-run section above. The dispatch tree below consumes them.
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

        // 2. Held-position re-justification — four internal exit
        // checks. Regime carries hysteresis (streak ≥ 3 + basin FR
        // > 1/π — mirrors Python PR #631); phi/conviction fire on
        // first match; stale_bleed is a belt-and-braces guard
        // alongside the now-live conviction gate. Layer 2B emotions
        // computed above via computeEmotions — conviction can fire
        // when the kernel's own geometric self-read says hesitation
        // > conviction.
        const regimeAtOpen = state.regimeAtOpenByLane[heldLane] as MonkeyMode | undefined;
        const phiAtOpen = state.phiAtOpenByLane[heldLane];
        const basinAtOpen = state.basinAtOpenByLane[heldLane];
        const entryTimeMs = state.entryTimeMsByLane[heldLane];
        // Maintain the per-lane streak counter — increment on
        // divergent tick, reset to 0 when regime returns to anchor.
        // Persists across exitFired so subsequent ticks see the right
        // count even when this tick's check is skipped.
        if (regimeAtOpen !== undefined) {
          if (mode !== regimeAtOpen) {
            state.regimeChangeStreakByLane[heldLane] =
              (state.regimeChangeStreakByLane[heldLane] ?? 0) + 1;
          } else {
            state.regimeChangeStreakByLane[heldLane] = 0;
          }
        }
        const heldDurationS = entryTimeMs !== undefined
          ? (Date.now() - entryTimeMs) / 1000
          : undefined;
        const currentRoi = positionNotional > 0
          ? unrealizedPnl / (positionNotional / Math.max(1, leverage.value))
          : undefined;
        const regimeChangeStreak = state.regimeChangeStreakByLane[heldLane] ?? 0;
        // Registry-controlled stability requirement; default 3 ticks.
        // TS has no parameter registry yet — the constant lives in
        // executive.ts mirroring ml-worker's _DEFAULT_REGIME_STABILITY_TICKS_FOR_EXIT.
        const regimeStabilityTicksRequired = REGIME_STABILITY_TICKS_FOR_EXIT;
        const rejustResult = !exitFired
          ? evaluateRejustification({
              regimeAtOpen,
              phiAtOpen,
              regimeNow: mode,
              phiNow: phi,
              emotions,
              regimeConfidence: regimeReading.confidence,
              regimeChangeStreak,
              regimeStabilityTicksRequired,
              basinNow: basin,
              basinAtOpen,
              heldDurationS,
              currentRoi,
            })
          : {
              checked: false, fired: null, reason: '', phiFloor: null,
              frDistance: null,
              frThreshold: 1 / Math.PI,
              regimeChangeStreak,
              regimeStabilityTicksRequired,
            };
        const rejust: Record<string, unknown> = {
          checked: rejustResult.checked,
        };
        if (rejustResult.checked) {
          rejust.lane = heldLane;
          rejust.regimeAtOpen = regimeAtOpen;
          rejust.regimeNow = mode;
          rejust.regimeConfidence = regimeReading.confidence;
          rejust.regimeChangeStreak = regimeChangeStreak;
          rejust.regimeStabilityTicksRequired = regimeStabilityTicksRequired;
          rejust.frDistance = rejustResult.frDistance;
          rejust.frThreshold = rejustResult.frThreshold;
          rejust.phiAtOpen = phiAtOpen;
          rejust.phiNow = phi;
          rejust.phiFloor = rejustResult.phiFloor;
          rejust.confidence = emotions.confidence;
          rejust.anxiety = emotions.anxiety;
          rejust.confusion = emotions.confusion;
          rejust.regimeChangeStreak = rejustResult.regimeChangeStreak;
          rejust.heldDurationS = heldDurationS;
          rejust.currentRoi = currentRoi;
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
      !chopSuppressEntry(regimeReading, positionLane).suppressed
    ) {
      // Regime suppression check (issue #623): before opening a new entry,
      // consult the regime classifier reading. Held positions are unaffected —
      // re-justification (#619) owns those exits independently.
      const suppressionResult = chopSuppressEntry(regimeReading, positionLane);
      derivation.regime_suppression = {
        regime: suppressionResult.regime,
        confidence: suppressionResult.confidence,
        lane: suppressionResult.lane,
        suppressed: suppressionResult.suppressed,
        suppress_reason: suppressionResult.suppressReason,
      };
      if (suppressionResult.suppressed) {
        action = 'hold';
        reason = suppressionResult.suppressReason!;
        derivation.entryThreshold = entryThr.derivation;
      } else {
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
      }
    } else {
      action = 'hold';
      const chopSuppressionForLane = chopSuppressEntry(regimeReading, positionLane);
      const chopSuppressed = chopSuppressionForLane.suppressed;
      const chopThresholdForLane = positionLane === 'trend'
        ? CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT
        : CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT;
      const why = !MODE_PROFILES[mode].canEnter
        ? `mode=${mode} blocks entry (${MODE_PROFILES[mode].description})`
        : direction === 'flat'
          ? `[${mode}] direction=flat (basinDir=${basinDir.toFixed(3)} tape=${tapeTrend.toFixed(3)})`
          : chopSuppressed
            ? `[${mode}] chop regime confidence=${regimeReading.confidence.toFixed(2)} > ${chopThresholdForLane.toFixed(2)} — suspend new entries (lane=${positionLane})`
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
    const chopTelemetry = chopSuppressEntry(regimeReading, positionLane);
    derivation.chopSuppression = {
      active: chopTelemetry.suppressed,
      regime: regimeReading.regime,
      confidence: regimeReading.confidence,
      lane: positionLane,
      threshold: positionLane === 'trend'
        ? CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT
        : CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
    };

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
    // Agent L (Fisher-Rao KNN classifier) eligibility: needs basin history
    // to build a multi-scale tuple. < 60 ticks = warmup, no L allocation.
    const lEligible = state.basinHistory.length >= 60;
    const baseLabels = ['K', 'M'];
    if (tEligible) baseLabels.push('T');
    if (lEligible) baseLabels.push('L');
    const arbiterAgentLabels: string[] = baseLabels;
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
        // v0.8.7 kill switch — pause new entries (including DCA pyramids)
        // when MONKEY_TRADING_PAUSED=true on Railway. Exits remain
        // active so open positions can close cleanly.
        if (isTradingPaused()) {
          reason += ' | trading_paused: MONKEY_TRADING_PAUSED=true (entry suppressed; exits unaffected)';
          (derivation as Record<string, unknown>).tradingPausedSkipped = {
            agent: 'K',
            action,
            reason: 'MONKEY_TRADING_PAUSED env',
          };
        } else {
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
            state.basinAtOpenByLane[entryLane] = Float64Array.from(basin) as Basin;
            state.regimeChangeStreakByLane[entryLane] = 0;
            state.entryTimeMsByLane[entryLane] = Date.now();
          }
        }
        }  // close v0.8.7 trading-paused else branch
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
            delete state.basinAtOpenByLane[scalpLane];
            delete state.regimeChangeStreakByLane[scalpLane];
            delete state.entryTimeMsByLane[scalpLane];
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
            delete state.basinAtOpenByLane[reversalLane];
            delete state.regimeChangeStreakByLane[reversalLane];
            delete state.entryTimeMsByLane[reversalLane];
            // v0.8.7 kill switch — close on the reverse path proceeded
            // (exits unaffected); skip the new-entry leg when paused.
            if (isTradingPaused()) {
              reason += ` | closed@${lastPrice.toFixed(2)} pnl=${pnlAtDecision.toFixed(4)} | trading_paused: new ${newSide} entry suppressed`;
              (derivation as Record<string, unknown>).tradingPausedSkipped = {
                agent: 'K',
                action,
                reason: 'MONKEY_TRADING_PAUSED env (reverse-reopen leg)',
              };
            } else {
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
              state.basinAtOpenByLane[reversalLane] = Float64Array.from(basin) as Basin;
              state.regimeChangeStreakByLane[reversalLane] = 0;
              state.entryTimeMsByLane[reversalLane] = Date.now();
              reason += ` | closed@${lastPrice.toFixed(2)} pnl=${pnlAtDecision.toFixed(4)} | new ${newSide} orderId=${monkeyOrderId}`;
            } else {
              reason += ` | flattened ok, new-entry failed: ${execResult.reason}`;
            }
            }  // close v0.8.7 trading-paused else branch
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
    //
    // Per-agent equity bound (2026-05-05 #10): M's cumulative open
    // margin is held within the Arbiter's per-tick allocation. K and T
    // are unaffected — each agent operates on its own discipline. Bound
    // is self-regulating: profitable streaks loosen the cap (Arbiter
    // grants more), drawdowns tighten it. See agentEquityBound.ts.
    //
    // v0.8.8 — cross-agent observation + foresight + risk modulator.
    // M now reads the recent bus events ring + its own emotion state
    // and modulates entry sizing/conviction:
    //   - if K/T/L just entered the OPPOSITE side, dampen via
    //     convictionDampenerFromBus
    //   - high dopamine on M → boost via riskModulator
    //   - high frustration on M → dampen
    //   - foresight check: if basin trajectory predicts reversal,
    //     veto entirely
    const mCrossAgentCtx: CrossAgentContext = buildCrossAgentContext(
      state.recentBusEvents, 'M', state.sessionTicks,
    );
    const mRiskMod = riskModulator(state.agentStates.M);
    if (process.env.MONKEY_EXECUTE === 'true' && arbiterAllocation.m > 0) {
      const mOpenMargin = await this.sumOpenAgentMargin(symbol, 'M');
      const mHeadroom = computeAgentHeadroom(arbiterAllocation.m, mOpenMargin);
      if (mHeadroom <= 0) {
        derivation.agentM = {
          skipped: true,
          reason: 'at_alloc_cap',
          openMargin: Number(mOpenMargin.toFixed(2)),
          allocation: Number(arbiterAllocation.m.toFixed(2)),
        };
      } else {
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
      // v0.8.8 — apply cross-agent dampener + risk modulator + foresight.
      const mProposedSide: 'long' | 'short' | null =
        mDecision.action === 'enter_long' ? 'long'
          : mDecision.action === 'enter_short' ? 'short' : null;
      // 2026-05-13 — agreement gate. Observed 5/13: ML signal stuck
      // at BUY@0.4 on ETH while ETH was bouncing weakly off a 2.7%
      // downtrend → M kept entering longs at local highs and getting
      // chopped out. Require tape AND basin to both agree with the
      // ML signal direction at minimum strengths. The thresholds are
      // intentionally conservative — M is the riskiest agent because
      // its only signal is the external ML pipeline, no geometric
      // self-check. K (geometric) and T (turtle pyramid) have their
      // own discipline; L uses FR-KNN similarity. M needed agreement.
      const M_MIN_TAPE_ABS =
        Number(process.env.MONKEY_AGENT_M_MIN_TAPE_STRENGTH) || 0.4;
      const M_MIN_BASIN_ABS =
        Number(process.env.MONKEY_AGENT_M_MIN_BASIN_STRENGTH) || 0.10;
      let mAgreementVeto = false;
      let mAgreementReason = '';
      if (mProposedSide === 'long') {
        if (!(tapeTrend > M_MIN_TAPE_ABS && basinDir > M_MIN_BASIN_ABS)) {
          mAgreementVeto = true;
          mAgreementReason = `agreement_below_threshold: tape=${tapeTrend.toFixed(3)} (need >${M_MIN_TAPE_ABS}) basin=${basinDir.toFixed(3)} (need >${M_MIN_BASIN_ABS})`;
        }
      } else if (mProposedSide === 'short') {
        if (!(tapeTrend < -M_MIN_TAPE_ABS && basinDir < -M_MIN_BASIN_ABS)) {
          mAgreementVeto = true;
          mAgreementReason = `agreement_below_threshold: tape=${tapeTrend.toFixed(3)} (need <-${M_MIN_TAPE_ABS}) basin=${basinDir.toFixed(3)} (need <-${M_MIN_BASIN_ABS})`;
        }
      }
      const mDampener = mProposedSide
        ? convictionDampenerFromBus(mCrossAgentCtx, mProposedSide)
        : 1.0;
      const mForesight = mProposedSide
        ? foresightVeto(state.basinHistory, mProposedSide)
        : { veto: false, reason: 'hold', predictedDirection: 0, confidence: 0 };
      const mModulatedSize = mDecision.sizeUsdt * mDampener * mRiskMod;
      const clampedSize = (mForesight.veto || mAgreementVeto)
        ? 0
        : clampSizeToHeadroom(mModulatedSize, mHeadroom);
      derivation.agentM = {
        action: mDecision.action,
        sizeUsdt: clampedSize,
        requestedSize: mDecision.sizeUsdt,
        modulatedSize: mModulatedSize,
        crossAgentDampener: mDampener,
        riskModulator: mRiskMod,
        foresightVeto: mForesight.veto,
        foresightReason: mForesight.reason,
        agreementVeto: mAgreementVeto,
        agreementReason: mAgreementVeto ? mAgreementReason : 'aligned',
        emotions: state.agentStates.M.emotions,
        headroom: Number(mHeadroom.toFixed(2)),
        openMargin: Number(mOpenMargin.toFixed(2)),
        allocation: Number(arbiterAllocation.m.toFixed(2)),
        leverage: mDecision.leverage,
        reason: mDecision.reason,
        mlSignal: mInputs.mlSignal,
        mlStrength: mInputs.mlStrength,
      };
      if (mAgreementVeto) {
        logger.info('[AgentM] entry vetoed by agreement gate', {
          symbol, side: mProposedSide,
          tape: tapeTrend.toFixed(3),
          basin: basinDir.toFixed(3),
          mlStrength: mInputs.mlStrength,
        });
      }
      if (
        (mDecision.action === 'enter_long' || mDecision.action === 'enter_short')
        && clampedSize > 0
      ) {
        // v0.8.7 kill switch — pause new entries from Agent M.
        if (isTradingPaused()) {
          logger.info('[AgentM] entry suppressed by MONKEY_TRADING_PAUSED', {
            symbol, side: mDecision.action,
          });
          (derivation as Record<string, unknown>).agentMTradingPausedSkipped = true;
        } else {
        const mResult = await this.executeEntry({
          symbol,
          side: mDecision.action === 'enter_long' ? 'long' : 'short',
          marginUsdt: clampedSize,
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
            margin: clampedSize.toFixed(2), leverage: mDecision.leverage,
            headroom: mHeadroom.toFixed(2),
          });
        }
        }  // close v0.8.7 trading-paused else branch
      }
      }  // close mHeadroom > 0 else branch
    }

    // 6c-T. AGENT T EXECUTE — Turtle System 1 (classical TA control arm).
    // v0.8.8 — T also reads cross-agent context + applies risk modulator
    // from its own emotion stack. Foresight veto applied after Donchian
    // breakout decision: a breakout LONG against a basin reversal gets
    // suppressed, mirroring K's held-position rejustification gate.
    const tCrossAgentCtx: CrossAgentContext = buildCrossAgentContext(
      state.recentBusEvents, 'T', state.sessionTicks,
    );
    const tRiskMod = riskModulator(state.agentStates.T);
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
      // v0.8.8 — modulate T's size by its emotion state + cross-agent context.
      const tProposedSide: 'long' | 'short' | null =
        tDecision.action === 'enter_long' || tDecision.action === 'pyramid_long' ? 'long'
          : tDecision.action === 'enter_short' || tDecision.action === 'pyramid_short' ? 'short'
            : null;
      const tDampener = tProposedSide
        ? convictionDampenerFromBus(tCrossAgentCtx, tProposedSide)
        : 1.0;
      const tForesight = tProposedSide
        ? foresightVeto(state.basinHistory, tProposedSide)
        : { veto: false, reason: 'hold', predictedDirection: 0, confidence: 0 };
      // Apply modulators to T's sizeUsdt.
      const tModulatedSize = tDecision.sizeUsdt * tDampener * tRiskMod;
      derivation.agentT = {
        action: tDecision.action,
        sizeUsdt: tForesight.veto ? 0 : tModulatedSize,
        requestedSize: tDecision.sizeUsdt,
        crossAgentDampener: tDampener,
        riskModulator: tRiskMod,
        foresightVeto: tForesight.veto,
        foresightReason: tForesight.reason,
        emotions: state.agentStates.T.emotions,
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
      // v0.8.7 telemetry: surface the pause state when Agent T would
      // have entered but the kill switch suppressed it.
      if (
        (tDecision.action === 'enter_long'
          || tDecision.action === 'enter_short'
          || tDecision.action === 'pyramid_long'
          || tDecision.action === 'pyramid_short')
        && tDecision.sizeUsdt > 0
        && isTradingPaused()
      ) {
        (derivation as Record<string, unknown>).agentTTradingPausedSkipped = true;
        logger.info('[AgentT] entry suppressed by MONKEY_TRADING_PAUSED', {
          symbol, action: tDecision.action,
        });
      }
      if (
        (tDecision.action === 'enter_long'
          || tDecision.action === 'enter_short'
          || tDecision.action === 'pyramid_long'
          || tDecision.action === 'pyramid_short')
        && tDecision.sizeUsdt > 0
        // v0.8.7 kill switch — pause Agent T entries (including pyramids)
        // when MONKEY_TRADING_PAUSED=true. Exits below are unaffected.
        && !isTradingPaused()
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

    // 6c-L. AGENT L EXECUTE — multi-scale Fisher-Rao KNN classifier.
    // v0.8.8 — full QIG cognition: per-agent state, cross-agent
    // observation, foresight veto, risk modulator (same as M and T).
    const lCrossAgentCtx: CrossAgentContext = buildCrossAgentContext(
      state.recentBusEvents, 'L', state.sessionTicks,
    );
    const lRiskMod = riskModulator(state.agentStates.L);
    const lAlloc = arbiterAllocationMany.L ?? 0;
    if (
      process.env.MONKEY_EXECUTE === 'true'
      && lAlloc > 0
      // 2026-05-13 — warmup gate bumped to match recalibrated
      // longWindow (480). 480 ticks × 30s ≈ 4h. K/M/T continue
      // trading during L's warmup.
      && state.basinHistory.length >= 480
    ) {
      const lDecision = agentLDecide(state.basinHistory);
      // 2026-05-13 Change B — record per-side L confirmation timestamp
      // + cognitive mode at confirmation. Updated even when the entry
      // is vetoed: the L conviction is the signal, the gate is the
      // policy. The mode snapshot powers the trailing regime stop —
      // a position opened in EXPLORATION but now in INTEGRATION has
      // outlived its strategic justification and must exit.
      const lCurrentModeStr = String(state.lastMode ?? '');
      if (lDecision.action === 'enter_long') {
        state.lLastConfirmedAtMsBySide.long = Date.now();
        state.lModeAtConfirmedBySide.long = lCurrentModeStr || null;
        // 2026-05-13 MTF Phase 2 — snapshot longest agreeing TF at
        // entry so the exit policy knows which clock to watch.
        if (mtfDec.action === 'enter_long' && mtfDec.longestAgreeingLabel) {
          state.mtfLongestAgreeingBySide.long = mtfDec.longestAgreeingLabel;
        }
        // 2026-05-13 — snapshot continuous regime score at entry for
        // the trailing regime drift stop.
        if (state.rScoreCurrent !== null) {
          state.rScoreAtEntryBySide.long = state.rScoreCurrent;
        }
      } else if (lDecision.action === 'enter_short') {
        state.lLastConfirmedAtMsBySide.short = Date.now();
        state.lModeAtConfirmedBySide.short = lCurrentModeStr || null;
        if (mtfDec.action === 'enter_short' && mtfDec.longestAgreeingLabel) {
          state.mtfLongestAgreeingBySide.short = mtfDec.longestAgreeingLabel;
        }
        if (state.rScoreCurrent !== null) {
          state.rScoreAtEntryBySide.short = state.rScoreCurrent;
        }
      }
      derivation.agentL = {
        action: lDecision.action,
        signedScore: lDecision.signedScore,
        conviction: lDecision.conviction,
        neighbors: lDecision.neighbors.length,
        // 2026-05-11 — neighbor label distribution + IDW weights surface
        // whether a saturated score (e.g. signedScore=1.000) reflects a
        // clean unanimous vote (all neighbors long-labeled) or a
        // degenerate normalizer pin. Logged in the entry path below.
        labelDistribution: lDecision.labelDistribution,
        reason: lDecision.reason,
      };
      // 2026-05-11 — minimal L harvest "wiggle room" after a sweep.
      // 2026-05-13 — default dropped 60s → 30s. The 60s cooldown was
      // constraining L's rapid re-stack pattern that produced the
      // +$153/8h harvest cadence on 5/10. One kernel tick (30s) gives
      // microstructure breathing room without locking out the next
      // harvest cycle. Configurable; set to 0 to disable entirely.
      let lCooldownActive = false;
      const lProposedSideForCooldown: 'long' | 'short' | null =
        lDecision.action === 'enter_long' ? 'long'
          : lDecision.action === 'enter_short' ? 'short'
            : null;
      if (lProposedSideForCooldown) {
        const cooldownMs =
          process.env.MONKEY_AGENT_L_HARVEST_COOLDOWN_MS !== undefined
            ? Number(process.env.MONKEY_AGENT_L_HARVEST_COOLDOWN_MS)
            : 30_000;
        const lastHarvestAt = state.lForceHarvestAtMsBySide[lProposedSideForCooldown];
        if (
          lastHarvestAt !== null
          && Number.isFinite(cooldownMs)
          && cooldownMs > 0
          && Date.now() - lastHarvestAt < cooldownMs
        ) {
          const remainingS = ((cooldownMs - (Date.now() - lastHarvestAt)) / 1000).toFixed(0);
          (derivation.agentL as Record<string, unknown>).cooldownActive = true;
          (derivation.agentL as Record<string, unknown>).cooldownRemainingS = remainingS;
          logger.info('[AgentL] entry suppressed by harvest cooldown', {
            symbol, side: lProposedSideForCooldown, remainingS,
          });
          lCooldownActive = true;
        }
      }
      if (
        !lCooldownActive
        && (lDecision.action === 'enter_long' || lDecision.action === 'enter_short')
        && lAlloc > 0
      ) {
        // v0.8.7 kill switch — pause Agent L entries.
        if (isTradingPaused()) {
          logger.info('[AgentL] entry suppressed by MONKEY_TRADING_PAUSED', {
            symbol, action: lDecision.action,
          });
          (derivation as Record<string, unknown>).agentLTradingPausedSkipped = true;
        } else {
          // Size: conviction-weighted with cross-agent dampener +
          // emotion risk-modulator + foresight veto.
          //
          // 2026-05-13 MTF Phase 2 — also multiply by MTF agreement
          // size multiplier. When 3-of-3 timeframes agree, sizeMult=1.0
          // (full size). 2-of-3 agreement → sizeMult=0.5 (half size).
          // Below 2 → mtfDec.action is 'hold' / sizeMultiplier=0 and
          // single-TF L proceeds at normal size during MTF warmup.
          //
          // Gating: when at least 2 TFs warm, REQUIRE MTF action to
          // match L's proposed side (or be hold). MTF disagreement
          // = veto. When MTF is fully cold (no warm TFs), fall back
          // to single-TF L behavior.
          const lProposedSide: 'long' | 'short' =
            lDecision.action === 'enter_long' ? 'long' : 'short';
          const lDampener = convictionDampenerFromBus(lCrossAgentCtx, lProposedSide);
          const lForesight = foresightVeto(state.basinHistory, lProposedSide);
          const lBaseMargin = lAlloc * 0.5 * lDecision.conviction;
          // MTF agreement gate + size multiplier.
          const warmTfCount = mtfDec.perTimeframe.filter(t => t.warm).length;
          let mtfMult = 1.0;
          let mtfVeto = false;
          let mtfReason = 'cold (single-TF L)';
          if (warmTfCount >= 1) {
            const mtfAction = lProposedSide === 'long' ? 'enter_long' : 'enter_short';
            if (mtfDec.action === mtfAction) {
              // MTF agrees with single-TF L. Apply the agreement
              // size multiplier (0.5 for 2-of-3, 1.0 for 3-of-3).
              mtfMult = Math.max(mtfDec.sizeMultiplier, 0.5);
              mtfReason = `agree ${mtfDec.agreementCount}/${mtfDec.totalTfs} sizeMult=${mtfMult.toFixed(2)}`;
            } else if (mtfDec.action !== 'hold') {
              // MTF wants the opposite side — strong veto.
              mtfVeto = true;
              mtfReason = `veto: mtf=${mtfDec.action} vs single=${lDecision.action}`;
            } else {
              // MTF holds while single-TF L wants to enter.
              // Allow with reduced size — single-TF didn't have full
              // multi-TF confirmation but MTF isn't actively against.
              mtfMult = 0.5;
              mtfReason = `mtf hold + single-TF entry → half size`;
            }
          }
          (derivation.agentL as Record<string, unknown>).mtfMult = mtfMult;
          (derivation.agentL as Record<string, unknown>).mtfVeto = mtfVeto;
          (derivation.agentL as Record<string, unknown>).mtfReason = mtfReason;
          if (mtfVeto) {
            logger.info('[AgentL] entry vetoed by MTF disagreement', {
              symbol, side: lProposedSide,
              mtfAction: mtfDec.action,
              agreement: `${mtfDec.agreementCount}/${mtfDec.totalTfs}`,
            });
          }
          let lMargin = (lForesight.veto || mtfVeto)
            ? 0
            : lBaseMargin * lDampener * lRiskMod * mtfMult;
          (derivation.agentL as Record<string, unknown>).crossAgentDampener = lDampener;
          (derivation.agentL as Record<string, unknown>).riskModulator = lRiskMod;
          (derivation.agentL as Record<string, unknown>).foresightVeto = lForesight.veto;
          (derivation.agentL as Record<string, unknown>).foresightReason = lForesight.reason;
          (derivation.agentL as Record<string, unknown>).emotions = state.agentStates.L.emotions;
          // 2026-05-10 — per-agent CUMULATIVE NOTIONAL cap. L was
          // stacking 39 BTC LONGs (17.7× equity) without any
          // bound: per-row margin was tiny but cumulative leveraged
          // exposure was the problem. Cap = lAlloc × ratio (default
          // 4×). Below: query open notional for L on this symbol;
          // clamp lMargin so that lMargin × leverage stays within
          // the remaining headroom.
          const lOpenNotional = await this.sumOpenAgentNotional(symbol, 'L');
          const lNotionalRatio =
            Number(process.env.MONKEY_PER_AGENT_NOTIONAL_RATIO) || 4.0;
          const lNotionalHeadroom = computeAgentNotionalHeadroom(
            lAlloc, lOpenNotional, lNotionalRatio,
          );
          (derivation.agentL as Record<string, unknown>).openNotional =
            Number(lOpenNotional.toFixed(2));
          (derivation.agentL as Record<string, unknown>).notionalCap =
            Number((lAlloc * lNotionalRatio).toFixed(2));
          (derivation.agentL as Record<string, unknown>).notionalHeadroom =
            Number(lNotionalHeadroom.toFixed(2));
          if (lMargin > 0) {
            const lLeverage = leverage.value;
            const lClamped = clampMarginToNotionalHeadroom(
              lMargin, lLeverage, lNotionalHeadroom,
            );
            if (lClamped < lMargin) {
              logger.info('[AgentL] entry margin clamped by notional cap', {
                symbol,
                requested: lMargin.toFixed(2),
                clamped: lClamped.toFixed(2),
                openNotional: lOpenNotional.toFixed(2),
                notionalCap: (lAlloc * lNotionalRatio).toFixed(2),
                leverage: lLeverage,
              });
            }
            lMargin = lClamped;
            (derivation.agentL as Record<string, unknown>).clampedMargin =
              Number(lMargin.toFixed(2));
          }
          if (lMargin > 0) {
            const lLeverage = leverage.value;
            const lResult = await this.executeEntry({
              symbol,
              side: lDecision.action === 'enter_long' ? 'long' : 'short',
              marginUsdt: lMargin,
              leverage: lLeverage,
              entryPrice: lastPrice,
              minNotional,
              phi,
              kappa: state.kappa,
              sovereignty,
              trajectoryId: null,
              isDCAAdd: false,
              dcaAddIndex: 0,
              agent: 'L',
              lane: 'trend',  // L is a long-horizon classifier; co-locate with trend lane
            });
            (derivation as Record<string, unknown>).agentLExecuted = lResult.executed;
            if (lResult.executed) {
              const ld = lDecision.labelDistribution;
              logger.info('[AgentL] entry placed', {
                symbol, side: lDecision.action, orderId: lResult.orderId,
                margin: lMargin.toFixed(2), leverage: lLeverage,
                signedScore: lDecision.signedScore.toFixed(3),
                conviction: lDecision.conviction.toFixed(2),
                // 2026-05-11 — raw KNN diagnostic so the saturated
                // signedScore=1.000 case is interpretable. `labels`
                // shows the raw vote counts (long/short/neutral) and
                // `weight` the IDW-weighted vote totals; `nearD`
                // and `farD` bound the FR distance spread on top-K.
                labels: `${ld.long}L/${ld.short}S/${ld.neutral}N`,
                weight: `${ld.longWeight.toFixed(2)}L/${ld.shortWeight.toFixed(2)}S`,
                nearD: ld.nearestDistance.toFixed(4),
                farD: ld.farthestDistance.toFixed(4),
              });
              // Publish to bus so other agents see L's action.
              this.bus.publish({
                type: BusEventType.ENTRY_EXECUTED,
                source: this.instanceId,
                symbol,
                payload: {
                  agent: 'L',
                  side: lDecision.action,
                  orderId: lResult.orderId,
                  margin: lMargin,
                  signedScore: lDecision.signedScore,
                  conviction: lDecision.conviction,
                },
              });
            } else {
              logger.info('[AgentL] entry rejected', {
                symbol, side: lDecision.action, reason: lResult.reason,
              });
            }
          }
        }
      }
    }

    // 6c-L'. AGENT L FORCE-HARVEST — per-tick sweep for stacked winners.
    //
    // Observed 2026-05-10: 39 BTC LONG rows held 14-16h on Agent L
    // (73% win rate per the live tape). The shared-lane harvest path
    // (shouldProfitHarvest) reads aggregate position across ALL
    // agents in the held lane, so L's small winners get washed out
    // by K's break-even rows. Result: L's stack sits frozen, margin
    // committed, no exit firing.
    //
    // This sweep is L-only: query L's open rows for the symbol,
    // compute aggregate unrealized PnL at lastPrice, and if it
    // exceeds MONKEY_AGENT_L_HARVEST_PCT × aggregate notional,
    // close ONLY L's contribution (reduce-only market sized to
    // L's qty, DB updates only L's row IDs). Other agents' rows
    // — even in the same lane — are untouched.
    //
    // Threshold default 0.003 (0.3% on aggregate notional ≈ 4-5%
    // ROI at 14× margin). Env-tunable.
    if (
      process.env.MONKEY_EXECUTE === 'true'
      && !isTradingPaused()
    ) {
      try {
        await this.forceHarvestAgentLStack(symbol, lastPrice);
      } catch (err) {
        logger.debug('[AgentL] force-harvest sweep failed (fail-soft)', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
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

    // v0.8.8 per-agent state idle decay — emotions and neurochemistry
    // nudge toward their neutral targets each tick. Counters:
    //   - dopamine fading from a single big win
    //   - frustration fading after a recent loss
    //   - keeps the state from getting stuck at extremes when the
    //     agent isn't actively trading
    state.agentStates.K = decayPerAgentState(state.agentStates.K);
    state.agentStates.M = decayPerAgentState(state.agentStates.M);
    state.agentStates.T = decayPerAgentState(state.agentStates.T);
    state.agentStates.L = decayPerAgentState(state.agentStates.L);
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

  /** v0.8.8 per-agent reactive cognition: distill a realized outcome
   *  into an emotion + neurochemistry update for the owning agent.
   *  Called from closeHeldPosition after each settled close. */
  private applyOutcomeToAgent(
    symbol: string,
    agent: AgentLabel,
    heldSide: 'long' | 'short',
    realizedPnl: number,
  ): void {
    const state = this.symbolStates.get(symbol);
    if (!state) return;
    // Realized direction: positive PnL on a long held = long realized;
    // positive PnL on a short held = short realized; flat if pnl=0.
    const realizedDirection: 'long' | 'short' | 'flat' =
      realizedPnl > 0 ? heldSide
        : realizedPnl < 0 ? (heldSide === 'long' ? 'short' : 'long')
          : 'flat';
    const outcome: AgentOutcomeEvent = {
      agent, symbol, realizedPnl,
      expectedDirection: heldSide,
      realizedDirection,
    };
    state.agentStates[agent] = applyOutcomeToState(state.agentStates[agent], outcome);
  }

  /**
   * Sum of currently-open contracts for a given (agent, symbol, side, lane).
   * Quantities in autonomous_trades are stored in BASE ASSET units; this
   * helper converts to contracts by dividing by lotSize before summing,
   * matching the exchange's per-order cap units.
   *
   * Used by the per-position contracts cap (#11): the kernel checks
   * cumulative open contracts against MAX_CONTRACTS_PER_POSITION before
   * letting any agent stack a fresh entry that would push the cumulative
   * position past the exchange's 10,000-contract per-order limit.
   *
   * Fail-soft returns 0 — the closeChunker remains as the downstream
   * safety net if this query fails.
   */
  private async sumOpenContractsForPosition(
    symbol: string,
    agent: 'K' | 'M' | 'T',
    side: 'long' | 'short',
    lane: 'scalp' | 'swing' | 'trend',
    lotSize: number,
  ): Promise<number> {
    if (!Number.isFinite(lotSize) || lotSize <= 0) return 0;
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      // DB stores 'buy'|'sell' historically AND 'long'|'short' on newer
      // rows — match either to be safe.
      const sideAlternates =
        side === 'long' ? ['buy', 'long'] : ['sell', 'short'];
      const result = await pool.query(
        `SELECT COALESCE(SUM(ABS(quantity)), 0) AS sum_qty
           FROM autonomous_trades
          WHERE status = 'open'
            AND symbol = $1
            AND agent = $2
            AND lane = $3
            AND side = ANY($4)
            AND reason LIKE $5`,
        [symbol, agent, lane, sideAlternates, reasonPattern],
      );
      const row = result.rows[0] as { sum_qty: string | number } | undefined;
      const sumBaseAsset = Number(row?.sum_qty ?? 0);
      // Convert base-asset quantity to contracts.
      return Math.floor(sumBaseAsset / lotSize);
    } catch (err) {
      logger.debug('[Monkey] sumOpenContractsForPosition failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /**
   * Sum of currently-open margin (USDT) for a given agent on a symbol.
   * Margin = quantity × entry_price ÷ leverage (legacy rows without
   * leverage fall back to notional).
   *
   * Used by the per-agent equity bound (#10): the kernel checks this
   * against the Arbiter's per-tick allocation before letting an agent
   * stack a fresh entry. Fail-soft returns 0 — the exchange-side
   * margin enforcement (Poloniex 21005) is the hard ceiling, this
   * guard is the soft preventative.
   */
  private async sumOpenAgentMargin(
    symbol: string,
    agent: 'K' | 'M' | 'T' | 'L',
  ): Promise<number> {
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      const result = await pool.query(
        `SELECT COALESCE(SUM(
            CASE
              WHEN leverage > 0 THEN (quantity * entry_price / leverage)
              ELSE quantity * entry_price
            END
          ), 0) AS sum_margin
           FROM autonomous_trades
          WHERE status = 'open'
            AND symbol = $1
            AND agent = $2
            AND reason LIKE $3`,
        [symbol, agent, reasonPattern],
      );
      const row = result.rows[0] as { sum_margin: string | number } | undefined;
      return Number(row?.sum_margin ?? 0);
    } catch (err) {
      logger.debug('[Monkey] sumOpenAgentMargin failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /**
   * 2026-05-10 — sum cumulative open notional (quantity × entry_price)
   * for an agent on a symbol. Distinct from sumOpenAgentMargin which
   * divides by leverage. Used by the per-agent cumulative notional cap
   * to bound stacked-row exposure (L stacked 39 rows on a $200 account
   * → 17.7× equity in cumulative notional, each row individually
   * within margin limits).
   */
  private async sumOpenAgentNotional(
    symbol: string,
    agent: 'K' | 'M' | 'T' | 'L',
  ): Promise<number> {
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      const result = await pool.query(
        `SELECT COALESCE(SUM(quantity * entry_price), 0) AS sum_notional
           FROM autonomous_trades
          WHERE status = 'open'
            AND symbol = $1
            AND agent = $2
            AND reason LIKE $3`,
        [symbol, agent, reasonPattern],
      );
      const row = result.rows[0] as { sum_notional: string | number } | undefined;
      return Number(row?.sum_notional ?? 0);
    } catch (err) {
      logger.debug('[Monkey] sumOpenAgentNotional failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /**
   * 2026-05-10 — Agent-L-only force harvest. Closes L's contribution
   * to the exchange position (a reduce-only market for L's qty) and
   * updates only L's DB rows. Other agents on the same lane are
   * untouched.
   *
   * Trigger: aggregate L unrealized PnL on the symbol exceeds
   * MONKEY_AGENT_L_HARVEST_PCT (default 0.003 = 0.3% on aggregate
   * notional). Returns silently when no L rows are open or the
   * threshold is not met.
   *
   * Per-row PnL allocation, arbiter feedback, and applyOutcomeToAgent
   * fire for each L row, mirroring closeHeldPosition's accounting.
   */
  private async forceHarvestAgentLStack(
    symbol: string,
    lastPrice: number,
  ): Promise<void> {
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;
    const baseHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT) || 0.003;
    if (!Number.isFinite(baseHarvestPct) || baseHarvestPct <= 0) return;

    // 2026-05-13 — regime-aware harvest threshold.
    //
    // The single base threshold (0.3%) was calibrated for medium-vol
    // sideways tape. Two failure modes observed:
    //   chop  (range < ~1.5%, tape ~0): harvest opportunities are
    //         scarce; even small green prints should be captured
    //         → use LOWER threshold so wins aren't left on the table
    //   trend (|tape| > 0.3): position can ride further; capturing at
    //         0.3% on a 2-3% directional move leaves significant PnL
    //         → use HIGHER threshold so winners run
    //
    // Regime detection uses Monkey's own basin-velocity and tape
    // signals (already QIG-derived per processSymbol). These are
    // surfaced on the SymbolState's latestBasinSnapshot.
    //
    // Hot-regime (dopamine + recent-wins) heuristic from PR #653 is
    // KEPT as an override: if the agent has been winning + dopamine
    // is high, threshold also widens to hot — even on chop.
    const chopHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT_CHOP) || 0.0025;
    const trendHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT_TREND) || 0.0045;
    const hotHarvestPct =
      Number(process.env.MONKEY_AGENT_L_HARVEST_PCT_HOT) || 0.006;
    const hotHarvestDopamineFloor =
      Number(process.env.MONKEY_AGENT_L_HARVEST_HOT_DOPAMINE_FLOOR) || 0.7;

    const symState = this.symbolStates.get(symbol);
    const recentPnls = symState?.recentLHarvestPnls ?? [];
    const lDopamine =
      symState?.agentStates?.L?.neurochemistry?.dopamine ?? 0;
    const allRecentPositive =
      recentPnls.length >= 5 && recentPnls.every((p) => p > 0);
    const hotRegime = allRecentPositive && lDopamine > hotHarvestDopamineFloor;

    const snap = symState?.latestBasinSnapshot;
    const tapeAbs = snap ? Math.abs(snap.tapeTrend) : 0;
    // chop: weak tape across BOTH absolute magnitude and basin direction.
    // trend: strong, directional tape (|tape| > 0.3).
    const isChop = tapeAbs < 0.15 && snap !== null && snap !== undefined;
    const isTrend = tapeAbs > 0.30;

    let harvestPct: number;
    let regimeLabel: 'hot' | 'trend' | 'chop' | 'base';
    if (hotRegime) {
      harvestPct = hotHarvestPct;
      regimeLabel = 'hot';
    } else if (isTrend) {
      harvestPct = trendHarvestPct;
      regimeLabel = 'trend';
    } else if (isChop) {
      harvestPct = chopHarvestPct;
      regimeLabel = 'chop';
    } else {
      harvestPct = baseHarvestPct;
      regimeLabel = 'base';
    }

    const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
    let lRows: Array<{
      id: string;
      side: string;
      entry_price: string;
      quantity: string;
      lane: string;
    }>;
    try {
      const result = await pool.query(
        `SELECT id, side, entry_price, quantity, lane
           FROM autonomous_trades
          WHERE status = 'open'
            AND symbol = $1
            AND agent = 'L'
            AND reason LIKE $2`,
        [symbol, reasonPattern],
      );
      lRows = result.rows as typeof lRows;
    } catch (err) {
      logger.debug('[AgentL] forceHarvest query failed', {
        symbol, err: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (lRows.length === 0) return;

    // Bucket by side — L can hold opposite directions across rows
    // only if entries spanned a regime flip. Each side harvests
    // independently against its own aggregate notional.
    const bySide: Record<'long' | 'short', typeof lRows> = { long: [], short: [] };
    const normSide = (s: string): 'long' | 'short' =>
      s === 'buy' || s === 'long' ? 'long' : 'short';
    for (const r of lRows) bySide[normSide(r.side)].push(r);

    for (const sideKey of ['long', 'short'] as const) {
      const rows = bySide[sideKey];
      if (rows.length === 0) continue;
      const aggQty = rows.reduce(
        (s, r) => s + Math.abs(Number(r.quantity) || 0),
        0,
      );
      if (aggQty <= 0) continue;
      const sumWeightedEntry = rows.reduce(
        (s, r) => s + Number(r.entry_price) * Math.abs(Number(r.quantity) || 0),
        0,
      );
      const aggEntry = sumWeightedEntry / aggQty;
      const aggNotional = aggEntry * aggQty;
      const sideSign = sideKey === 'long' ? 1 : -1;
      const aggPnl = (lastPrice - aggEntry) * aggQty * sideSign;
      const pnlPct = aggNotional > 0 ? aggPnl / aggNotional : 0;
      // 2026-05-13 — STOP-LOSS HARVEST. Fire on aggregate loss
      // beyond -MONKEY_AGENT_L_STOP_LOSS_PCT (default 0.005 = 0.5%
      // adverse on notional). Win-harvest threshold ladder
      // (chop/base/trend/hot) still applies on the upside.
      //
      // 2026-05-13 Change B — HORIZON-BOUNDED EXIT.
      //
      // Trades must not run past L's predicted forward horizon
      // unless fresh L signal extends the ride. Once the horizon
      // elapses without L re-confirming the side, force-exit
      // regardless of PnL. Implements the canonical Lorentzian's
      // bar-count exit (4 bars = forecast window) on our cadence.
      //
      // Horizon: config.horizon × tickMs = 120 × 30s = 60 min.
      // Re-confirmation: each tick where L's decision proposes the
      // same side updates `lLastConfirmedAtMsBySide[side]`.
      const stopLossPct =
        Number(process.env.MONKEY_AGENT_L_STOP_LOSS_PCT) || 0.005;
      const horizonTicks =
        Number(process.env.MONKEY_AGENT_L_HORIZON_TICKS) || 120;
      const horizonMs = horizonTicks * this.tickMs;
      const lastConfirmedAt = symState?.lLastConfirmedAtMsBySide?.[sideKey] ?? null;
      const isHorizonExpired =
        lastConfirmedAt !== null && (Date.now() - lastConfirmedAt) > horizonMs;
      const isStopLossHarvest = pnlPct <= -stopLossPct;
      const isWinHarvest = pnlPct >= harvestPct;
      // 2026-05-13 — trailing regime stop. Position opened under one
      // cognitive mode must exit if the kernel transitions to a
      // categorically different mode (EXPLORATION ↔ INTEGRATION).
      // The leverage / size / horizon thesis that justified the
      // entry no longer holds. INVESTIGATION is the transition zone
      // and doesn't trigger by itself; only crossings of the gap
      // count.
      const modeAtEntry = symState?.lModeAtConfirmedBySide?.[sideKey] ?? null;
      const modeNow = String(symState?.lastMode ?? '');
      const isAdverseModeTransition =
        modeAtEntry !== null && modeAtEntry !== modeNow && (
          (modeAtEntry === 'exploration' && modeNow === 'integration') ||
          (modeAtEntry === 'integration' && modeNow === 'exploration')
        );
      // 2026-05-13 MTF Phase 2 — longest-agreeing-horizon exit.
      // When the longest timeframe that agreed at entry stops
      // re-confirming for its forecast window, exit. The agreement
      // clocks (state.mtfState.lastAgreementByTfSide) are updated
      // every tick by mtfRecordAgreement; here we just check whether
      // the longest-at-entry timeframe's clock has elapsed.
      const longestAtEntry = symState?.mtfLongestAgreeingBySide?.[sideKey] ?? null;
      const isMtfHorizonExpired = longestAtEntry !== null && symState
        ? mtfIsLongestHorizonExpired(symState.mtfState, sideKey, longestAtEntry, Date.now(), this.tickMs)
        : false;
      // 2026-05-13 — continuous regime DRIFT stop. Even within the
      // same discrete mode, if r has drifted past the threshold
      // since position open, the entry thesis no longer holds.
      // Catches transitions inside (e.g.) EXPLORATION between
      // r=0.9 → r=0.5 that don't cross to INTEGRATION but invalidate
      // the high-leverage scalp assumption.
      const rAtEntry = symState?.rScoreAtEntryBySide?.[sideKey] ?? null;
      const rNow = symState?.rScoreCurrent ?? null;
      const continuousDriftDelta =
        Number(process.env.MONKEY_AGENT_L_REGIME_DRIFT_DELTA) || 0.30;
      const isContinuousRegimeDrift =
        rAtEntry !== null && rNow !== null &&
        continuousTrailingRegimeStop(rAtEntry, rNow, continuousDriftDelta);
      if (!isStopLossHarvest && !isWinHarvest && !isHorizonExpired && !isAdverseModeTransition && !isMtfHorizonExpired && !isContinuousRegimeDrift) continue;
      const harvestKind: 'win' | 'stop_loss' | 'horizon_expired' | 'regime_transition' | 'mtf_horizon_expired' | 'continuous_regime_drift' =
        isStopLossHarvest ? 'stop_loss'
          : isWinHarvest ? 'win'
            : isHorizonExpired ? 'horizon_expired'
              : isAdverseModeTransition ? 'regime_transition'
                : isMtfHorizonExpired ? 'mtf_horizon_expired'
                  : 'continuous_regime_drift';

      logger.info('[AgentL] force-harvest threshold met', {
        symbol,
        side: sideKey,
        kind: harvestKind,
        rows: rows.length,
        aggQty: aggQty.toFixed(6),
        aggEntry: aggEntry.toFixed(2),
        aggNotional: aggNotional.toFixed(2),
        aggPnl: aggPnl.toFixed(4),
        pnlPct: (pnlPct * 100).toFixed(3),
        threshold: isStopLossHarvest
          ? `-${(stopLossPct * 100).toFixed(3)} (stop-loss)`
          : isHorizonExpired
            ? `horizon ${horizonTicks}t (${(horizonMs / 60000).toFixed(0)}min)`
            : isAdverseModeTransition
              ? `regime ${modeAtEntry}→${modeNow}`
              : isMtfHorizonExpired
                ? `mtf-horizon ${longestAtEntry}`
                : isContinuousRegimeDrift
                  ? `r-drift ${rAtEntry?.toFixed(2) ?? '?'}→${rNow?.toFixed(2) ?? '?'} (Δ${Math.abs((rAtEntry ?? 0) - (rNow ?? 0)).toFixed(2)})`
                  : (harvestPct * 100).toFixed(3),
        ...(isHorizonExpired && lastConfirmedAt
          ? { ageMin: ((Date.now() - lastConfirmedAt) / 60000).toFixed(1) }
          : {}),
        regime: regimeLabel,
        dopamine: lDopamine.toFixed(2),
        recentHarvests: recentPnls.length,
      });

      // Reduce-only market for L's aggregate qty. In HEDGE mode pass
      // posSide; in ONE_WAY rely on opposite-side semantics.
      let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
      try {
        const userRow = await pool.query(
          `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
        );
        const userId = String(
          (userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '',
        );
        if (!userId) return;
        const c = await apiCredentialsService.getCredentials(userId, 'poloniex');
        if (!c) return;
        credentials = c;
      } catch (err) {
        logger.warn('[AgentL] force-harvest credentials fetch failed', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // Lot-size round.
      let formattedSize = aggQty;
      let symbolLotSize = 0;
      try {
        const precisions = await getPrecisions(symbol);
        if (precisions.lotSize && precisions.lotSize > 0) {
          symbolLotSize = precisions.lotSize;
          formattedSize = Math.floor(aggQty / precisions.lotSize) * precisions.lotSize;
        }
      } catch { /* use raw */ }
      if (formattedSize <= 0) {
        logger.debug('[AgentL] force-harvest lot rounding zero', {
          symbol, aggQty, symbolLotSize,
        });
        continue;
      }

      const closeSide: 'buy' | 'sell' = sideKey === 'long' ? 'sell' : 'buy';
      const isHedge = this.positionDirectionMode === 'HEDGE';
      const closePosSide: 'LONG' | 'SHORT' | undefined =
        isHedge ? (sideKey === 'long' ? 'LONG' : 'SHORT') : undefined;

      let orderId: string | null = null;
      try {
        const exchangeOrder = await poloniexFuturesService.placeOrder(
          credentials,
          {
            symbol,
            side: closeSide,
            type: 'market',
            size: formattedSize,
            lotSize: symbolLotSize,
            reduceOnly: !isHedge,  // HEDGE rejects reduceOnly per #10
          },
          {
            positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
            ...(closePosSide ? { posSide: closePosSide } : {}),
          },
        );
        orderId =
          exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
          exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn('[AgentL] force-harvest exchange order rejected', {
          symbol, side: sideKey, qty: formattedSize, err: errMsg,
        });
        // 2026-05-13 — Poloniex 21002 "Position not enough" means the
        // exchange doesn't have the qty the DB thinks it has. These
        // rows are PHANTOMS — keeping them open spins this branch
        // every tick (observed: 11:37→11:47Z BTC stop-loss tried 13×
        // with same -$6 PnL, never closed, position bled). Ghost the
        // rows immediately with reason 'position_mismatch_phantom'
        // so subsequent ticks skip them. PnL = null because we never
        // had a real close.
        if (errMsg.includes('code=21002') || errMsg.includes('Position not enough')) {
          try {
            for (const row of rows) {
              await pool.query(
                `UPDATE autonomous_trades
                    SET status = 'closed',
                        exit_reason = 'position_mismatch_phantom',
                        exit_time = NOW(),
                        pnl = COALESCE(pnl, 0)
                  WHERE id = $1`,
                [row.id],
              );
            }
            logger.warn('[AgentL] phantom rows ghost-closed (Poloniex 21002)', {
              symbol, side: sideKey, ghostedRows: rows.length,
            });
          } catch (updErr) {
            logger.error('[AgentL] phantom ghost-close DB update failed', {
              symbol, err: updErr instanceof Error ? updErr.message : String(updErr),
            });
          }
        }
        continue;
      }
      if (!orderId) {
        logger.warn('[AgentL] force-harvest no orderId returned', {
          symbol, side: sideKey,
        });
        continue;
      }

      // Update only L's rows (close them with proportional PnL).
      try {
        for (const row of rows) {
          const rowQty = Math.abs(Number(row.quantity) || 0);
          const qtyShare = aggQty > 0 ? rowQty / aggQty : 0;
          const rowPnl = aggPnl * qtyShare;
          await pool.query(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, pnl = $4
              WHERE id = $5`,
            [lastPrice, 'agent_l_force_harvest', orderId, rowPnl, row.id],
          );
          this.arbiter.recordSettled('L', rowPnl);
          this.applyOutcomeToAgent(symbol, 'L', sideKey, rowPnl);
        }
      } catch (err) {
        logger.error('[AgentL] force-harvest DB update failed — ORPHAN RISK', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('[AgentL] force-harvest CLOSED', {
        symbol, side: sideKey, orderId,
        rowsClosed: rows.length,
        aggPnl: aggPnl.toFixed(4),
        regime: regimeLabel,
      });

      // 2026-05-11 — record cooldown timestamp + push pnl into the
      // recent-harvests ring so subsequent entries see the cooldown
      // gate, and the adaptive threshold can lift on a hot streak.
      // 2026-05-13 — clear lLastConfirmedAtMsBySide so the next entry
      // starts a fresh horizon clock (no inherited expiry from prior
      // stack).
      if (symState) {
        symState.lForceHarvestAtMsBySide[sideKey] = Date.now();
        symState.lLastConfirmedAtMsBySide[sideKey] = null;
        symState.lModeAtConfirmedBySide[sideKey] = null;
        symState.mtfLongestAgreeingBySide[sideKey] = null;
        symState.rScoreAtEntryBySide[sideKey] = null;
        symState.recentLHarvestPnls.push(aggPnl);
        if (symState.recentLHarvestPnls.length > 5) {
          symState.recentLHarvestPnls.shift();
        }
      }

      this.bus.publish({
        type: BusEventType.EXIT_TRIGGERED,
        source: this.instanceId,
        symbol,
        payload: {
          agent: 'L',
          heldSide: sideKey,
          markPrice: lastPrice,
          orderId,
          pnl: aggPnl,
          exitReason: 'agent_l_force_harvest',
        },
      });
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

    // Poloniex v3 rejects single orders > 10,000 contracts with code 21010.
    // Live tape 2026-05-05 02:08 — and again 2026-05-06 00:20: BTC stale_bleed
    // retried every tick because the position had grown beyond the cap and
    // the close was permanently rejected.
    //
    // CRITICAL: Poloniex's 10,000 cap is in CONTRACTS, while ``formattedSize``
    // and ``symbolLotSize`` are in BASE ASSET (BTC, ETH) units. The
    // poloniexFuturesService.placeOrder converts ``size / lotSize → contracts``
    // internally before sending. So the chunker must reason in CONTRACTS, not
    // base asset — passing 1.5 BTC unchunked converts to 15,000 contracts and
    // hits 21010 even though "1.5" is far below the 9,999 base-asset threshold.
    //
    // Chunk in contracts space (lot=1), then convert each chunk back to base
    // asset for placeOrder by multiplying by symbolLotSize.
    //
    // Math.floor (not Math.round) for the conversion: if float precision
    // noise pushes formattedSize/symbolLotSize slightly above the true
    // integer (e.g., 15000.0000000001), rounding up would claim 15001
    // contracts the exchange doesn't actually have on the position, and
    // the reconciler's "exchange has positions not tracked in DB" branch
    // would have to clean up. Flooring under-closes by ≤ 1 contract worst
    // case — that residual is picked up by the reconciler's standard
    // ghost-close path on the next tick.
    const sizeInContracts = symbolLotSize > 0
      ? Math.floor(formattedSize / symbolLotSize)
      : Math.floor(formattedSize);
    const plan = planCloseChunks(sizeInContracts, 1);  // contracts, no lot rounding
    const chunkContracts = plan.chunks;
    if (plan.residual > 0) {
      const residualBaseAsset = symbolLotSize > 0
        ? plan.residual * symbolLotSize
        : plan.residual;
      logger.warn('[Monkey] close chunk residual stranded', {
        symbol,
        formattedSize,                  // base-asset (input from lot-rounding)
        symbolLotSize,
        sizeInContracts,                // contracts (post-conversion)
        residualContracts: plan.residual,
        residualBaseAsset,              // ditto, in base-asset for quick eyeballing
      });
    }
    if (chunkContracts.length === 0) {
      return { executed: false, orderId: null, reason: 'chunk_planning_zero' };
    }
    // Convert chunks back to base asset for placeOrder. lotSize=0 (legacy
    // path) keeps base-asset == contracts, preserving prior behavior.
    const chunkSizes = symbolLotSize > 0
      ? chunkContracts.map((c) => c * symbolLotSize)
      : chunkContracts;

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
      const orderIds: string[] = [];
      for (let i = 0; i < chunkSizes.length; i++) {
        const chunkSize = chunkSizes[i]!;
        const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
          symbol, side: closeSide, type: 'market', size: chunkSize, lotSize: symbolLotSize,
          reduceOnly: true,
        }, {
          positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
          ...(closePosSide ? { posSide: closePosSide } : {}),
        });
        const id =
          exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
          exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
        if (id) orderIds.push(String(id));
        if (chunkSizes.length > 1) {
          logger.info('[Monkey] close chunk placed', {
            symbol, chunk: i + 1, total: chunkSizes.length, size: chunkSize, orderId: id,
          });
        }
      }
      if (orderIds.length === 0) {
        return { executed: false, orderId: null, reason: 'no_chunk_returned_orderId' };
      }
      // Audit: when chunks > 1, expose the full chain so the close row's
      // exit_order_id reflects every leg. Single-order legacy keeps a single id.
      orderId = orderIds.length === 1 ? orderIds[0]! : orderIds.join(',');
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
        // v0.8.8 per-agent reactive cognition: feed outcome to K's
        // emotion + neurochemistry stack (dopamine on win, frustration
        // on loss). See per_agent_state.ts.
        this.applyOutcomeToAgent(symbol, 'K', heldSide, pnlAtDecision);
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
          // v0.8.8 — Agent L (FR-KNN classifier) joins the race.
          const agentLabel: AgentLabel =
            row.agent === 'M' ? 'M'
              : row.agent === 'T' ? 'T'
                : row.agent === 'L' ? 'L'
                  : 'K';
          this.arbiter.recordSettled(agentLabel, rowPnl);
          this.applyOutcomeToAgent(symbol, agentLabel, heldSide, rowPnl);
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
    agent?: 'K' | 'M' | 'T' | 'L';
    /** Proposal #10: execution lane key. Default 'swing' = pre-#10 implicit
     *  lane so existing call sites remain bit-identical. */
    lane?: 'scalp' | 'swing' | 'trend';
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, side, marginUsdt, entryPrice, minNotional } = req;
    // 2026-05-13 — continuous-regime leverage sanity bound.
    //
    // Discrete mode leverage (50× EXPLORATION / 5× INTEGRATION) can
    // lag the actual market shape during regime transitions. The
    // continuous r ∈ [0,1] computed from velocity + chop + κ-criticality
    // produces a regimeSizing(r).leverage that responds tick-by-tick.
    // Use it as an UPPER BOUND on req.leverage so a mode-derived 50×
    // cannot fire when r says we're actually trending.
    const symStateForLev = this.symbolStates.get(symbol);
    const rNow = symStateForLev?.rScoreCurrent ?? null;
    let effectiveLeverage = req.leverage;
    let levBoundedReason = '';
    if (rNow !== null) {
      const continuous = computeRegimeSizing(rNow);
      if (continuous.leverage < effectiveLeverage) {
        levBoundedReason = `continuous_r=${rNow.toFixed(2)} caps ${effectiveLeverage}→${continuous.leverage}`;
        effectiveLeverage = continuous.leverage;
      }
    }
    if (levBoundedReason) {
      logger.info('[Monkey] continuous-regime leverage cap', {
        symbol, side, agent: req.agent ?? 'K', reason: levBoundedReason,
      });
    }
    const leverage = effectiveLeverage;
    const notionalUsdt = marginUsdt * leverage;
    const quantity = notionalUsdt / entryPrice;
    const exchangeSide: 'buy' | 'sell' = side === 'long' ? 'buy' : 'sell';

    // 2026-05-13 — CROSS-AGENT tape-disagreement veto.
    //
    // Observed 5/13 ~18:00-19:15Z: bot took -$68 in 3h by repeatedly
    // re-entering LONG ETH/BTC as both fell. Pattern: agent opens long
    // → tape drops → stack closes at -$18 → agent re-enters long 1s
    // later → tape still falling → another -$18 close.
    //
    // PR #663 added a tape+basin agreement gate to M only. K (geometric),
    // T (turtle), L (FR-KNN) all bypassed it. They're each individually
    // disciplined but none alone protect against "entering against the
    // tape." This gate is the cross-agent veto: regardless of which
    // agent proposes the entry, if tape is strongly against the side,
    // block it.
    //
    // Thresholds (env-tunable):
    //   long  vetoed when tape < -MONKEY_CROSS_AGENT_TAPE_VETO (default 0.20)
    //   short vetoed when tape > +MONKEY_CROSS_AGENT_TAPE_VETO
    //
    // Catches "actively going wrong way" only; weak disagreement
    // (|tape| < 0.20) still permits the entry. Each agent's own
    // discipline applies on top.
    const symState = this.symbolStates.get(symbol);
    const snap = symState?.latestBasinSnapshot;
    const SNAP_MAX_AGE_MS = 120_000;
    const snapAgeMs = snap ? Date.now() - snap.computedAtMs : Infinity;
    if (snap && snapAgeMs < SNAP_MAX_AGE_MS) {
      const tapeVetoThreshold =
        Number(process.env.MONKEY_CROSS_AGENT_TAPE_VETO) || 0.20;
      const tape = snap.tapeTrend;
      const blocked =
        (side === 'long' && tape < -tapeVetoThreshold) ||
        (side === 'short' && tape > tapeVetoThreshold);
      if (blocked) {
        logger.info('[Monkey] cross-agent tape veto', {
          symbol,
          side,
          agent: req.agent ?? 'K',
          tape: tape.toFixed(3),
          threshold: tapeVetoThreshold,
        });
        return {
          executed: false,
          orderId: null,
          reason: `cross_agent_tape_veto: tape=${tape.toFixed(3)} vs side=${side} (threshold ${tapeVetoThreshold})`,
        };
      }
    }

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
      // v0.8.8: thread used-margin telemetry to the kernel for the
      // headroom veto. Cross-margin: usedMargin = equity - availableBalance.
      // Falls back to 0 (kernel-side veto stays no-op) when the balance
      // feed doesn't expose availableBalance.
      const availableBalance = Number(
        balance?.availableBalance ?? balance?.availMgn ?? balance?.am ?? equityUsdt,
      );
      const usedMarginUsdt = Math.max(0, equityUsdt - availableBalance);
      kernelState = { equityUsdt, unrealizedPnlUsdt, openPositions, restingOrders: [], usedMarginUsdt };
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
    // 2026-05-13 — pass monkeyMode through so risk kernel's headroom
    // check is regime-conditional (35% reserve EXPLORATION, 15% INTEGRATION).
    const monkeyMode = symState?.lastMode ?? undefined;
    const kernelContext: KernelContext = {
      isLive: mode === 'auto', mode, symbolMaxLeverage,
      monkeyMode: monkeyMode ?? undefined,
    };
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

    // Per-position contracts cap (#11) — keep cumulative open contracts
    // for (agent, symbol, side, lane) below MAX_CONTRACTS_PER_POSITION
    // (default 8000, with 2000-contract buffer below Poloniex's 10000
    // per-order rejection threshold). When already-open contracts plus
    // this new entry's contracts would exceed the cap, clamp the new
    // entry; if no headroom, suppress the entry entirely. Independent
    // per-agent — K, M, T each get their own envelope.
    if (symbolLotSize > 0) {
      const effectiveAgent = (req.agent ?? 'K') as 'K' | 'M' | 'T';
      const effectiveLane = (req.lane ?? 'swing') as 'scalp' | 'swing' | 'trend';
      const newContracts = Math.floor(formattedSize / symbolLotSize);
      const currentContracts = await this.sumOpenContractsForPosition(
        symbol, effectiveAgent, side, effectiveLane, symbolLotSize,
      );
      const cap = getMaxContractsPerPosition();
      const clampedNewContracts = clampNewContractsToCap(
        newContracts, currentContracts, cap,
      );
      if (clampedNewContracts === 0) {
        logger.info('[Monkey] entry suppressed by contracts cap', {
          symbol, agent: effectiveAgent, side, lane: effectiveLane,
          currentContracts, attemptedNew: newContracts, cap,
        });
        return {
          executed: false, orderId: null,
          reason: `at_position_contracts_cap: open=${currentContracts} desired=${newContracts} cap=${cap}`,
        };
      }
      if (clampedNewContracts < newContracts) {
        logger.info('[Monkey] entry clamped by contracts cap', {
          symbol, agent: effectiveAgent, side, lane: effectiveLane,
          currentContracts, requested: newContracts,
          granted: clampedNewContracts, cap,
        });
        formattedSize = clampedNewContracts * symbolLotSize;
        // Re-check min notional with the clamped size; the cap may push
        // a small entry below the exchange minimum.
        if (formattedSize * entryPrice < minNotional) {
          return {
            executed: false, orderId: null,
            reason: `cap_clamp_below_min_notional: ${(formattedSize * entryPrice).toFixed(2)} < ${minNotional.toFixed(2)} (cap headroom too small)`,
          };
        }
      }
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
    // Dedup guard — close path races reconciler. Skip if we've already
    // run witnessExit for this orderId within the window. Same orderId-
    // dedup pattern as resonance_bank.writeBubble (#575); this layer
    // catches the race before the gate / bank are touched at all.
    if (orderId) {
      const now = Date.now();
      const submittedAt = this.witnessExitDedup.get(orderId);
      if (submittedAt != null && now - submittedAt < MonkeyKernel.WITNESS_DEDUP_WINDOW_MS) {
        logger.info('[Monkey] witnessExit deduplicated', {
          orderId,
          age_ms: now - submittedAt,
        });
        return;
      }
      this.witnessExitDedup.set(orderId, now);
      // Lazy prune of expired entries (cap unbounded growth).
      if (this.witnessExitDedup.size > 256) {
        const cutoff = now - MonkeyKernel.WITNESS_DEDUP_WINDOW_MS;
        for (const [oid, ts] of this.witnessExitDedup) {
          if (ts < cutoff) this.witnessExitDedup.delete(oid);
        }
      }
    }
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
