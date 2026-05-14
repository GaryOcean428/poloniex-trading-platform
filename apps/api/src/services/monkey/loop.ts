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
  findOpenMonkeyTrade as dbFindOpenMonkeyTrade,
  findOpenMonkeyTradesByLane as dbFindOpenMonkeyTradesByLane,
  sumOpenContractsForPosition as dbSumOpenContractsForPosition,
  sumOpenAgentMargin as dbSumOpenAgentMargin,
  sumOpenAgentNotional as dbSumOpenAgentNotional,
} from './loop_db.js';
import {
  forceHarvestAgentLStack as forceHarvestAgentLStackImpl,
  closeHeldPosition as closeHeldPositionImpl,
  executeEntry as executeEntryImpl,
  witnessExit as witnessExitImpl,
} from './loop_execution.js';
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
import { shouldStaleBleedExit } from './staleBleedStop.js';
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
  tickMs: number;
  private readonly baseTickMs: number;
  private readonly symbols: string[];
  private readonly timeframe: string;
  readonly instanceId: string;
  private readonly label: string;
  private readonly sizeFraction: number;
  private tickInFlight = false;
  symbolStates: Map<string, SymbolState> = new Map();
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
  witnessExitDedup: Map<string, number> = new Map();
  /** Basin-sync instance — per-kernel, so sub-kernels appear as peers. */
  private readonly basinSync: BasinSync;
  /** Kernel bus — pub/sub for inter-kernel comms (v0.6a). */
  readonly bus: KernelBus = getKernelBus();
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
  positionDirectionMode: 'HEDGE' | 'ONE_WAY' = 'ONE_WAY';
  /**
   * Arbiter — capital allocator across N agents (K kernel, M ml, T turtle
   * classical TA). Single instance per kernel. Settled trades flow back via
   * recordSettled from closeHeldPosition. T is included in the allocation
   * only when account equity ≥ ``turtleMinEquityUsdt()``; below threshold
   * the arbiter sees a 2-agent (K, M) race exactly as before T was added.
   */
  readonly arbiter: Arbiter = new Arbiter();
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

    // 2026-05-14 — rehydrate the Arbiter's per-agent PnL windows from
    // persisted settled trades. A bare ``new Arbiter()`` starts empty,
    // so the allocator sat in uniform-split bootstrap until every agent
    // re-accumulated warmupTrades — which, given multiple Railway
    // redeploys a day, was effectively never. Net effect: the
    // performance-weighting machinery never engaged and a losing agent
    // kept its full uniform capital share across every restart. The
    // 50-trade window the allocator is designed around lives in
    // autonomous_trades; we just never read it back. Fail-soft — a
    // query failure leaves the arbiter empty (the prior behaviour).
    try {
      const windowSize = this.arbiter.windowSize;
      const { rows } = await pool.query<{ agent: string; pnl: string }>(
        `SELECT agent, pnl FROM (
           SELECT agent, pnl, exit_time,
                  row_number() OVER (PARTITION BY agent ORDER BY exit_time DESC) AS rn
           FROM autonomous_trades
           WHERE paper_trade = false
             AND deleted_at IS NULL
             AND pnl IS NOT NULL
             AND exit_time IS NOT NULL
             AND agent IN ('K', 'M', 'T', 'L')
         ) t
         WHERE rn <= $1
         ORDER BY exit_time ASC`,
        [windowSize],
      );
      const history = rows.map((r) => ({ agent: r.agent, pnl: Number(r.pnl) }));
      this.arbiter.rehydrate(history);
      const snap = this.arbiter.snapshotMany(1, ['K', 'M', 'T', 'L']);
      logger.info('[Arbiter] rehydrated from autonomous_trades', {
        rows: history.length,
        windowSize,
        windows: Object.fromEntries(
          Object.entries(snap).map(([a, s]) => [
            a, { n: s.tradesInWindow, pnl: Number(s.pnlWindowTotal.toFixed(2)) },
          ]),
        ),
      });
    } catch (rehydrateErr) {
      logger.warn('[Arbiter] rehydrate failed (non-fatal — starting cold)', {
        err: rehydrateErr instanceof Error ? rehydrateErr.message : String(rehydrateErr),
      });
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
    // heldSide is the side of THIS kernel's OWN open position — derived
    // from findOpenMonkeyTrade, exactly as the design note on
    // exchangeHeldSide above prescribes ("her own held-side is derived
    // per-kernel from findOpenMonkeyTrade"). It must NOT prefer
    // exchangeHeldSide: that is the SHARED exchange state, resolved by a
    // single .find() over every position. On a HEDGE account holding
    // BOTH a long and a short on the same symbol it returns whichever
    // side .find() hits first — so preferring it made the kernel read
    // the opposite of its own position and emit a false
    // "dca: side mismatch (short vs held long)" every tick (2026-05-14).
    const heldSide: 'long' | 'short' | null = ownOpenRow
      ? ownOpenRow.side
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

        // 3.5. Stale-bleed time stop — TS path's conviction gate is
        // dormant (NEUTRAL_EMOTIONS hardcoded zeros above), so chronic
        // flat positions never get an emotion-driven exit. This stop
        // mirrors what Python's frustration > 0.6 would do here:
        // when held > lane threshold with price move inside ±0.3%,
        // force-close. 2026-05-01 live tape: scalp_exits average
        // 62-96s; positions held > 10m almost always resolve via
        // reconciliation. Once Layer 2B emotion stack ports to TS,
        // this stop becomes redundant and can be removed. Distinct
        // from held_position_rejustification's STALE_BLEED gate, which
        // fires on LOSING positions (ROI ≤ -1%); this one fires on
        // STAGNANT positions regardless of P&L sign.
        if (!exitFired) {
          const stale = shouldStaleBleedExit({
            lastEntryAtMs: state.lastEntryAtMs,
            positionNotional,
            unrealizedPnl,
            nowMs: Date.now(),
            lane: heldLane,
          });
          derivation.staleBleed = { ...stale.derivation, tradeId };
          if (stale.fire) {
            action = 'scalp_exit';
            reason = stale.reason;
            exitFired = true;
            derivation.scalp = {
              exitTypeBit: 6,  // stale-bleed time stop
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
          exitTypeBit === 6 ? 'stale_bleed_stop' :
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
      const tWantsToOpen =
        tDecision.action === 'enter_long'
        || tDecision.action === 'enter_short'
        || tDecision.action === 'pyramid_long'
        || tDecision.action === 'pyramid_short';
      // 2026-05-14 — drift-mode gate for Agent T.
      // Agent T (Turtle) is a regime-blind classical-TA control arm: by
      // design it reads only OHLCV, not the kernel's regime. In a `drift`
      // regime (sideways noise) the kernel itself stands down — "mode=drift
      // blocks entry (observe only)". T did not, so in choppy tape it
      // opened breakout units, got stopped, re-opened, and whipsawed —
      // 2026-05-14: 6 trend-lane shorts opened in ~50 min, repeated
      // turtle_stop losses. T now respects the same observe-only gate the
      // kernel applies to itself. Exits (exit_stop / exit_donchian below)
      // are NOT gated — held units must still close cleanly.
      if (tWantsToOpen && tDecision.sizeUsdt > 0 && mode === 'drift') {
        (derivation as Record<string, unknown>).agentTDriftGated = true;
        logger.info('[AgentT] entry suppressed — kernel in drift mode (observe only)', {
          symbol, action: tDecision.action,
        });
      }
      if (
        tWantsToOpen
        && tDecision.sizeUsdt > 0
        // v0.8.7 kill switch — pause Agent T entries (including pyramids)
        // when MONKEY_TRADING_PAUSED=true. Exits below are unaffected.
        && !isTradingPaused()
        // 2026-05-14 drift-mode gate — see comment above.
        && mode !== 'drift'
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

  /** Delegates to loop_db.findOpenMonkeyTrade — the scalp-exit gate's
   *  single-open-row view, aggregated across lanes. */
  private findOpenMonkeyTrade(symbol: string) {
    return dbFindOpenMonkeyTrade(this.instanceId, symbol);
  }

  /** Delegates to loop_db.findOpenMonkeyTradesByLane — per-lane
   *  open-position lookup (Proposal #10). */
  private findOpenMonkeyTradesByLane(symbol: string) {
    return dbFindOpenMonkeyTradesByLane(this.instanceId, symbol);
  }

  /** v0.8.8 per-agent reactive cognition: distill a realized outcome
   *  into an emotion + neurochemistry update for the owning agent.
   *  Called from closeHeldPosition after each settled close. */
  applyOutcomeToAgent(
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
  /** Delegates to loop_db.sumOpenContractsForPosition. */
  sumOpenContractsForPosition(
    symbol: string,
    agent: 'K' | 'M' | 'T',
    side: 'long' | 'short',
    lane: 'scalp' | 'swing' | 'trend',
    lotSize: number,
  ) {
    return dbSumOpenContractsForPosition(this.instanceId, symbol, agent, side, lane, lotSize);
  }

  /** Delegates to loop_db.sumOpenAgentMargin — per-agent open margin
   *  (USDT) for the #10 per-agent equity bound. */
  private sumOpenAgentMargin(symbol: string, agent: 'K' | 'M' | 'T' | 'L') {
    return dbSumOpenAgentMargin(this.instanceId, symbol, agent);
  }

  /** Delegates to loop_db.sumOpenAgentNotional — per-agent cumulative
   *  open notional for the stacked-exposure cap. */
  private sumOpenAgentNotional(symbol: string, agent: 'K' | 'M' | 'T' | 'L') {
    return dbSumOpenAgentNotional(this.instanceId, symbol, agent);
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
    return forceHarvestAgentLStackImpl.call(this, symbol, lastPrice);
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
    return closeHeldPositionImpl.call(this, req);
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
    return executeEntryImpl.call(this, req);
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
    return witnessExitImpl.call(this, symbol, entryTime, realizedPnl, orderId, side);
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
