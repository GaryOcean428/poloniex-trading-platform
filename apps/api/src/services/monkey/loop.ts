/**
 * loop.ts — Monkey's heartbeat
 *
 * Monkey is the sole live execution engine. Each 60s tick she produces
 * decisions (enter/exit/hold/flatten with size+leverage), logs them to
 * monkey_decisions, updates her working memory + resonance bank, and
 * executes orders through the shared risk kernel.
 *
 * History: in v0.1 she ran observe-only alongside the legacy LiveSignal
 * engine for a side-by-side comparison. LiveSignal was removed
 * 2026-05-21; Monkey now runs as primary.
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
import { resolveExchangePositionSide, resolveExchangePositionNotional } from '../exchangePositionSide.js';
import {
  paperClosePosition,
  paperPlaceOrder,
} from '../paperExchangeSimulator.js';
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
  normalizedEntropy,
  toSimplex,
  uniformBasin,
  velocity,
  type Basin,
} from './basin.js';
import {
  callAutonomicTick,
  callAutonomicReward,
  callAutonomicPredictionReward,
} from './autonomic_client.js';
import { aggregatePeakTracker } from './aggregate_peak.js';
import { wsPositionCache } from './ws_position_cache.js';
import { marketIntelCache } from './market_intel.js';
import futuresWebSocket from '../../websocket/futuresWebSocket.js';
import { BasinSync } from './basin_sync.js';
import {
  clampPredictionCadenceSeconds,
  predictionDirectionFromSide,
  recordKernelPrediction,
  type PredictionSnapshotReason,
} from './kernel_predictions.js';
import { BusEventType, getKernelBus, type KernelBus } from './kernel_bus.js';
import { logParityDiff } from './kernel_client.js';
import { computeEmotions, type EmotionState } from './emotions.js';
import { detectMode, MODE_PROFILES, MonkeyMode } from './modes.js';
import { computeMotivators } from './motivators.js';
import { computeNeurochemicals, summarizeNC, type NeurochemicalState } from './neurochemistry.js';
import {
  makeRotationState,
  promoteToLive,
  recordClose as recordRotationClose,
  rollingWinRate,
  shouldAutoPromote,
  type RotationPeerSnapshot,
  type RotationState,
} from './kernel_rotation.js';
import { isPhiLeakyEnabled, updateLeakyPhi } from './phi_integrator.js';
import { structuralVetoMonitor } from './structural_veto_monitor.js';
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
  atr14,
  basinDirection as computeBasinDirection,
  perceive,
  refract,
  trendProxy as computeTrendProxy,
  type OHLCVCandle,
} from './perception.js';
import { frBracketDistances } from './fr_trade_params.js';
import { applyConsensusOverride } from './consensus_arbiter.js';
import {
  oceanTrailRetracement,
  oceanTrailTierIndex,
  observerFibCoefficient,
} from './ocean_reward.js';
import {
  CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
  CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT,
  chopSuppressEntry,
  classifyRegime,
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
  geometricDirection,
  shouldAutoFlatten,
  shouldAggregateBleedExit,
  shouldAggregateHarvest,
  shouldBracketExit,
  shouldExtendBracket,
  shouldDCAAdd,
  shouldExit,
  shouldProfitHarvest,
  shouldScalpExit,
  shouldSlowBleedExit,
  chooseLane,
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
import { SAFE_PNL_FROM_ROW, verifyPnl, computeSafePnl, checkNotionalConsistency } from './safePnlSql.js';
import { runPeriodicPnlScan } from './pnlReconciliationPeriodic.js';
import { startPredictionResidualJob } from './predictionResidualJob.js';
import {
  computePredictionChemistry,
  type PredictionChemistryDeltas,
} from './predictionRewardEmitter.js';
import { tryAcquireClose, releaseClose, isLikelyRaceLoss } from './close_coordinator.js';
import { observeEquity, sizeDeflection } from './equity_gradient.js';
import {
  observeBtcBeacon,
  entrySuppressionMultiplier,
  noteBtcPrice,
  getLatestBtcPrice,
  type BtcBeaconReading,
} from './btc_beacon.js';
import { recordLaneOutcome, weightedWinRate } from './time_of_day_winrate.js';
import { observeFundingArb } from './funding_arb_observer.js';
import {
  evaluateCell,
  regimeToDirection,
  canonicalToPhase,
  type CellAction,
} from './compositional_executive.js';
import { agentLDecide, type AgentLDecision } from './agent_L_classifier.js';
import { signalScorer, resolveEntryGate } from './signal_scorer.js';
import { getOperatorRiskSettings } from './risk_settings.js';
import { QIGRAMv2Partition, isQigramV2Enabled } from './agent_L_qigram_v2.js';
import {
  newMTFState,
  onTickAppend as mtfOnTickAppend,
  mtfDecide,
  recordAgreementTimestamps as mtfRecordAgreement,
  isLongestHorizonExpired as mtfIsLongestHorizonExpired,
} from './mtfLClassifier.js';
import {
  regimeScore as computeRegimeScore,
  regimeSizing as computeRegimeSizing,
  trailingRegimeStop as continuousTrailingRegimeStop,
  basinAlignmentToWindow,
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
  kernelDerivedContractCap,
  VENUE_CONTRACTS_CEILING,
} from './positionContractsBound.js';

/** Default Monkey watchlist. */
const DEFAULT_SYMBOLS = ['BTC_USDT_PERP', 'ETH_USDT_PERP'];

/**
 * Env-number coercion that respects 0 as a legitimate value.
 *
 * The `Number(process.env.X) || DEFAULT` pattern is broken for env vars
 * where 0 means "disable this gate" — `Number('0')` is `0` which is
 * falsy, so `||` short-circuits to DEFAULT. Operator setting `=0` to
 * disable the gate gets the default applied instead. Verified bug
 * 2026-05-19: operator set `MONKEY_FEE_FLOOR_COLD_FRAC=0` to disable
 * the fee-floor under fee-free trading; the env was treated as 0.0018
 * and continued blocking legitimate any-profit closes.
 *
 * Use this helper for any env var where 0 is a meaningful disable
 * value. Leave `|| DEFAULT` patterns alone where 0 doesn't make sense
 * (leverage caps, threshold ratios, etc.).
 */
function envNumber(key: string, def: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

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
 *
 * Per-agent rewards (2026-05-16): tag every push with the agent that
 * generated the outcome. The kernel runs ONE neurochemistry (K's brain);
 * when it reads the reward queue to derive K's dopamine, it filters to
 * K's rewards only. M/T/L wins/losses no longer dilute K's chemical
 * state — they live in the queue for arbiter / cross-agent telemetry
 * but don't pull K's dopamine sideways. Legacy callsites default to
 * 'K' agent so back-compat behaviour is preserved on the K path.
 */
interface ActivityReward {
  source: string;           // 'trade_close' | 'witnessed_liveSignal' | ...
  symbol?: string;
  agent: AgentLabel;        // K | M | T | L — which agent generated the outcome
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
 * v0.8.7 regime-hysteresis — minimum number of consecutive ticks where
 * regimeNow != regimeAtOpen before the regime_change exit can fire. The
 * Python kernel reads this from the parameter registry as
 * ``executive.regime_stability_ticks_for_exit``; TS has no parameter
 * registry yet, so the constant is the default. Default 3: a flicker
 * (1-2 tick mode divergence) cannot trigger the exit alone — the
 * kernel must read the new regime stably for at least 3 ticks AND the
 * basin must have moved more than 1/π in Fisher-Rao distance from the
 * entry anchor.
 */
// Phase 2 doctrine (2026-05-26): tick-count knobs replaced by an
// observer-derived formula. The kernel's own basin integration (phi)
// determines how much evidence it needs before firing exits:
//
//   ticks_required(phi) = max(MIN_EVIDENCE, ceil(MIN_EVIDENCE / phi))
//
// MIN_EVIDENCE = 2 is the minimum-evidence sentinel from the original
// CALIB-1 doctrine ("1 = noise; ≥ 2 = signal"). At phi=1.0 (perfect
// integration) → 2 ticks. At phi=0.5 (typical) → 4 ticks. At phi=0.25
// (poor) → 8 ticks. The kernel that trusts its basin needs less
// confirmation; the kernel reading a disorganised basin demands more.
//
// Removes three env knobs:
//   MONKEY_REGIME_STABILITY_TICKS_FOR_EXIT      (was default 3)
//   MONKEY_CONVICTION_STABILITY_TICKS_FOR_EXIT  (was default 2)
//   MONKEY_DISAGREEMENT_BASE_TICKS_FOR_EXIT     (was default 4)
//
// All three were operator-prescribed anti-flicker minimums. Now the
// kernel's integration state — already an observable — decides.
//
// Why phi not basin_velocity (Matrix's tier-3 suggestion): bv captures
// movement speed but conflates "coherent fast move" with "fast noise."
// Phi distinguishes them — high phi = stable basin (regardless of
// speed) = less flicker risk. Anti-flicker is what these counts
// originally encoded.
const STABILITY_TICKS_MIN_EVIDENCE = 2;

function stabilityTicksFromPhi(phi: number): number {
  const safePhi = Math.max(phi, 0.01);
  return Math.max(
    STABILITY_TICKS_MIN_EVIDENCE,
    Math.ceil(STABILITY_TICKS_MIN_EVIDENCE / safePhi),
  );
}
/** Lane decision-period — the wall-clock window a lane's
 *  natural decision cycle occupies. These are LANE DEFINITIONS,
 *  not tuning knobs: a scalp lane decides over ~minutes, a swing
 *  lane over ~tens of minutes, a trend lane over hours. They
 *  feed `laneMultiplierFromTickPeriod()` which divides by the
 *  substrate's actual tick period to derive the streak gate
 *  in ticks — so the gate adapts when adaptive-tick changes
 *  the cadence (e.g. EXPLORATION 15s vs INTEGRATION 60s tick)
 *  without operator intervention.
 *
 *  At the canonical 30s tick:
 *    scalp(60s)  → ceil(60/30) = 2  ticks  (≈ floor)
 *    swing(180s) → ceil(180/30) = 6  ticks
 *    trend(600s) → ceil(600/30) = 20 ticks
 *
 *  At adaptive 15s (EXPLORATION):
 *    scalp = 4, swing = 12, trend = 40 (more confirmation when ticks are fast)
 *
 *  At adaptive 60s (INTEGRATION/DRIFT):
 *    scalp = 2 (floor), swing = 3, trend = 10
 *
 *  Compare to the legacy hardcoded {1, 3, 10}: those values are
 *  what the derivation produces at tickMs=60s — i.e. they were
 *  calibrated for the slowest mode and didn't adapt to the
 *  cadence governor. */
const LANE_DECISION_PERIOD_MS: Record<'scalp' | 'swing' | 'trend', number> = {
  scalp: 60_000,
  swing: 180_000,
  trend: 600_000,
};

/** Derive the lane multiplier from the active tick period. Floor 2
 *  (Cascade brief: "Math.max(2, Math.round(...))") so a position
 *  never fires its streak gate on a single tick. Exported for tests. */
export function laneMultiplierFromTickPeriod(
  lane: 'scalp' | 'swing' | 'trend',
  tickPeriodMs: number,
): number {
  const periodMs = LANE_DECISION_PERIOD_MS[lane];
  if (!Number.isFinite(tickPeriodMs) || tickPeriodMs <= 0) return 2;
  return Math.max(2, Math.round(periodMs / tickPeriodMs));
}

/** Commit 4 (Cascade brief 2026-05-27) — observer-derived conviction
 *  streak requirement. Mirrors the Py side
 *  `_observer_conviction_streak_required` exactly. Floor 2, cap 12.
 *  Inputs: rolling history of (anxiety + confusion - confidence) on
 *  this lane over the last 20 ticks. High sign-flip rate → require
 *  more ticks; low flip rate → fire at floor. */
export const CONVICTION_STREAK_FLOOR = 2;
export const CONVICTION_HESITATION_WINDOW = 20;
export const CONVICTION_STREAK_CAP = 12;

export function observerConvictionStreakRequired(
  hesitationHistory: number[],
): number {
  if (hesitationHistory.length < CONVICTION_STREAK_FLOOR) {
    return CONVICTION_STREAK_FLOOR;
  }
  let flips = 0;
  for (let i = 1; i < hesitationHistory.length; i++) {
    const prev = hesitationHistory[i - 1]!;
    const curr = hesitationHistory[i]!;
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) flips++;
  }
  const flipRate = flips / Math.max(1, hesitationHistory.length - 1);
  const scaled = CONVICTION_STREAK_FLOOR
    + Math.round(flipRate * (CONVICTION_STREAK_CAP - CONVICTION_STREAK_FLOOR) * 2);
  return Math.max(CONVICTION_STREAK_FLOOR, Math.min(CONVICTION_STREAK_CAP, scaled));
}

/**
 * v0.8.7 kill switch — when MONKEY_TRADING_PAUSED=true, gate
 * entry-order placement only. Exit orders (scalp_exit, auto_flatten,
 * hard SL, rejust exits) are NOT gated; existing positions must close
 * cleanly during deploy/incident response. Default false (no pause).
 *
 * Reads at order-placement time (live, not cached at startup) so the
 * operator can flip the env var on Railway without redeploying.
 */
function isTradingPaused(): boolean {
  return process.env.MONKEY_TRADING_PAUSED === 'true';
}

function isMonkeyPaperMode(): boolean {
  return process.env.MONKEY_PAPER_MODE === 'true';
}

// ─── L-veto-over-K (Option A) ─────────────────────────────────────
//
// 2026-05-16 — high-conviction Agent L vote BLOCKS Agent K entries on
// the same tick when L and K disagree on side. K (geometric kernel) was
// over-trading ETH (-$5.93, 12.3% WR over 227 trades / 24h) while L
// (FR-KNN Lorentzian-equivalent, historically 76.4% WR) is structurally
// constrained to "vote only" — L feeds K's basinDir via per_agent_bus
// but cannot block K's executeEntry path.
//
// This gate adds that block. Flag-gated default OFF: with
// L_VETO_OVER_K_ENABLED unset / not 'true', behavior is byte-identical
// to today. ONLY blocks K ENTRIES (enter_long, enter_short, DCA adds,
// reverse-reopen leg). Does NOT block K exits, harvest, scalp_exit,
// force_harvest. Does NOT block M, T, L or LiveSignal — only K.
//
// QIG purity: pure helper, no Adam/AdamW/LayerNorm/cosine. Reads L's
// AgentLDecision (signedScore, conviction, action) which is already
// FR-KNN-derived, and a K side string. No new geometric operations.

export const L_VETO_DEFAULT_CONVICTION_THRESHOLD = 0.6;

function isLVetoOverKEnabled(): boolean {
  return process.env.L_VETO_OVER_K_ENABLED === 'true';
}

function lVetoConvictionThreshold(): number {
  const raw = process.env.L_VETO_CONVICTION_THRESHOLD;
  if (raw === undefined) return L_VETO_DEFAULT_CONVICTION_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return L_VETO_DEFAULT_CONVICTION_THRESHOLD;
  }
  return parsed;
}

/** Pure evaluation of whether L's vote should veto K's entry on this
 *  tick. No side effects; returns the decision + a structured reason
 *  for logging / telemetry.
 *
 *  Veto fires iff ALL of:
 *    1. env flag enabled (caller usually checks; included here as a
 *       defense-in-depth so direct callers can't accidentally bypass)
 *    2. K action is an entry (enter_long / enter_short)
 *    3. L's action is also an entry (enter_long / enter_short — not hold)
 *    4. L's |signedScore| × conviction > threshold (default 0.6)
 *    5. L's preferred side disagrees with K's entry side
 *
 *  When any condition fails, vetoed=false and the helper returns the
 *  reason so telemetry can attribute "why no veto" (helpful when
 *  diagnosing under-firing).
 */
export interface LVetoEvaluation {
  vetoed: boolean;
  /** L's weighted conviction (|signedScore| × conviction). */
  weightedConviction: number;
  /** Threshold against which weightedConviction was checked. */
  threshold: number;
  /** L's preferred side derived from its action; null when L=hold. */
  lSide: 'long' | 'short' | null;
  /** Reason code — useful for log-grepping and dashboard counters. */
  reasonCode:
    | 'vetoed_high_conviction_disagreement'
    | 'flag_disabled'
    | 'k_not_entry'
    | 'l_holding'
    | 'l_agrees_with_k'
    | 'l_conviction_below_threshold';
}

export function evaluateLVetoOverK(opts: {
  enabled: boolean;
  kAction: string;
  lDecision: Pick<AgentLDecision, 'action' | 'signedScore' | 'conviction'>;
  threshold: number;
}): LVetoEvaluation {
  const { enabled, kAction, lDecision, threshold } = opts;
  const weightedConviction = Math.abs(lDecision.signedScore) * lDecision.conviction;
  const lSide: 'long' | 'short' | null =
    lDecision.action === 'enter_long' ? 'long'
      : lDecision.action === 'enter_short' ? 'short'
        : null;

  if (!enabled) {
    return { vetoed: false, weightedConviction, threshold, lSide, reasonCode: 'flag_disabled' };
  }
  const kIsEntry =
    kAction === 'enter_long' ||
    kAction === 'enter_short' ||
    kAction === 'reverse_long' ||
    kAction === 'reverse_short';
  if (!kIsEntry) {
    return { vetoed: false, weightedConviction, threshold, lSide, reasonCode: 'k_not_entry' };
  }
  if (lSide === null) {
    return { vetoed: false, weightedConviction, threshold, lSide, reasonCode: 'l_holding' };
  }
  const kSide: 'long' | 'short' =
    kAction === 'enter_long' || kAction === 'reverse_long' ? 'long' : 'short';
  if (lSide === kSide) {
    return { vetoed: false, weightedConviction, threshold, lSide, reasonCode: 'l_agrees_with_k' };
  }
  if (weightedConviction <= threshold) {
    return { vetoed: false, weightedConviction, threshold, lSide, reasonCode: 'l_conviction_below_threshold' };
  }
  return { vetoed: true, weightedConviction, threshold, lSide, reasonCode: 'vetoed_high_conviction_disagreement' };
}


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
  /** Leaky-integrator Φ state (B3) — canonical motion-integrated Φ,
   *  carried tick-to-tick. Seeded from the legacy entropy-Φ on first use
   *  so a flag flip introduces no discontinuity. See phi_integrator.ts. */
  phiLeaky?: number;
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
  /** Matrix tier-3 doctrine extension (2026-05-26) — Ocean trail/SL
   *  tier picker. Counts consecutive ticks where shouldExit returned
   *  value=false on the currently-held position (i.e. perception and
   *  strategy_forecast stayed coherent within the kernel's own
   *  Fisher-Rao threshold). Increments at end-of-tick when held +
   *  exit.value=false; resets to 0 on (a) any exit firing this tick,
   *  (b) a fresh entry. Consumed by oceanTrailRetracement() to select
   *  the SL trail Fibonacci tier from {3%, 5%, 8%, 13%, 21%}. */
  coherenceStreak: number;
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
  /** Basin coordinate at entry — per-lane snapshot for the regime
   *  hysteresis basin-distance gate (mirrors Python PR #631). Without
   *  this anchor the regime gate falls back to streak-only. */
  basinAtOpenByLane: Record<string, Basin>;
  /** Consecutive ticks where regimeNow has differed from regimeAtOpen
   *  for the lane. Driven by the rejustification call site — increments
   *  on divergent tick, resets to 0 when regime returns to anchor. */
  regimeChangeStreakByLane: Record<string, number>;
  /** CALIB-1 (2026-05-17): consecutive-tick counter for the conviction-
   *  failed condition (emotions.confidence < emotions.anxiety+confusion)
   *  per held-position lane. Drives the rejustification call site — the
   *  exit only fires after >= CONVICTION_STABILITY_TICKS_FOR_EXIT
   *  consecutive ticks, mirroring the regime_change streak gate above.
   *  2026-05-17 CSV analysis showed single-tick conviction noise was
   *  driving 60% of losses in chop-zone scalping. */
  convictionFailedStreakByLane: Record<string, number>;
  /** Commit 4 (Cascade brief 2026-05-27) — per-lane hesitation history
   *  (anxiety + confusion - confidence) over the last 20 ticks. Drives
   *  the observer-derived conviction streak requirement: high sign-flip
   *  rate → require more ticks; monotonic collapse → fire at floor. */
  hesitationHistoryByLane: Record<string, number[]>;
  /** CALIB-3 (2026-05-17): consecutive-tick counter for "current tick's
   *  preferred side disagrees with held side" per-lane. Drives the
   *  directional_disagreement exit. Increments on disagreement, resets
   *  to 0 when sides agree. Per operator directive: exit before ROI
   *  flips negative; can re-enter if false positive. Held-side comes
   *  from the lane's most recent open trade row; current-tick side
   *  from this tick's executive decision. */
  directionalDisagreementStreakByLane: Record<string, number>;
  /** Last recorded "held side" per lane, used as the disagreement
   *  baseline for the CALIB-3 streak. 'flat' = no position; 'long' or
   *  'short' = corresponding held direction. Updated on entry/close. */
  heldSideByLane: Record<string, 'long' | 'short' | 'flat'>;
  /** Wall-clock entry timestamp (ms) per lane. Used by the stale-bleed
   *  gate: positions held longer than STALE_BLEED_MIN_DURATION_S at
   *  worse than STALE_BLEED_ROI_THRESHOLD ROI exit. Cleared on close. */
  entryTimeMsByLane: Record<string, number>;
  /** Rolling (Φ, I_Q) history for the Integration motivator's CV
   *  computation. Capped to 20 entries by computeMotivators's default
   *  integrationWindow; we keep a wider buffer here for forward
   *  extensibility. < 2 entries → integration motivator = 0. */
  integrationHistory: Array<[number, number]>;
  /** v0.8.7e: latest computed basinDir + tapeTrend from processSymbol, with
   *  timestamp. Exposed via getLatestBasinSnapshot() for the kernel's own
   *  inter-tick agreement gate. Null until the first tick completes. */
  latestBasinSnapshot: {
    basinDir: number;
    tapeTrend: number;
    computedAtMs: number;
  } | null;
  /** v0.8.8 per-agent reactive cognition state. Each of K/M/T/L gets
   *  its own emotion stack, neurochemistry, decision/outcome rings, and
   *  bus event cursor. Outcome-driven (not basin-geometry-driven) —
   *  each agent learns from its OWN PnL track record on this symbol.
   *
   *  Used to:
   *    - Modulate per-agent sizing/conviction via riskModulator (dopamine
   *      on wins boosts size; frustration on losses dampens)
   *    - Power foresight + cross-agent observation hooks
   *    - Surface per-agent self-observation (winRate, alignmentRate)
   *
   *  See per_agent_state.ts for the canonical update transforms. */
  agentStates: Record<AgentLabel, PerAgentState>;
  /** Recent bus events for cross-agent observation context. Bounded
   *  ring; older events drop. Each agent reads from this on its tick. */
  recentBusEvents: import('./kernel_bus.js').BusEvent[];
  /** 2026-05-11 — wall-clock ms of the last force-harvest by side. Used
   *  to give L one tick of "wiggle room" after a sweep so the next
   *  entry sees a market that has actually moved, rather than re-entering
   *  at a price within fractions of the close. Window is governed by
   *  MONKEY_AGENT_L_HARVEST_COOLDOWN_MS (default 60 s — one tick).
   *  Fees are not a concern (user has fee-free subscription); this is
   *  about market-microstructure breathing room. */
  lForceHarvestAtMsBySide: { long: number | null; short: number | null };
  /** 2026-05-11 — ring of last N=5 L force-harvest PnLs on this symbol.
   *  Consumed by the adaptive harvest threshold: when L is on a hot
   *  streak (all 5 positive AND dopamine high), threshold widens from
   *  0.3% to 0.6% to let winners run. Oldest entry drops on push. */
  recentLHarvestPnls: number[];
  /** 2026-05-13 — horizon-bounded exit per Change B.
   *
   *  Tracks the wall-clock ms of the most recent L decision that
   *  confirmed (or proposed) the side. The L classifier's prediction
   *  has a forward horizon (default 120 ticks = 60 min on 30s); once
   *  that horizon elapses without L re-confirming, the position is
   *  past its forecast window and must exit unless extended.
   *
   *  Updated whenever L decides enter_long/enter_short on this side
   *  (regardless of whether the entry executes — gate/veto outcomes
   *  don't affect the underlying L conviction). Cleared on harvest
   *  so the next entry starts a fresh horizon clock.
   */
  lLastConfirmedAtMsBySide: { long: number | null; short: number | null };
  /** 2026-05-13 — trailing regime stop anchor.
   *
   *  Mode at L's most recent confirmation per side. A high-leverage
   *  scalp opened in EXPLORATION should exit if the kernel transitions
   *  to INTEGRATION (slow trend regime) because the 50× leverage was
   *  justified by the flat-tape thesis that no longer holds. Mirror
   *  applies for a slow trend position entering EXPLORATION (less
   *  catastrophic but the sizing/horizon assumptions are now wrong).
   *
   *  Cleared on harvest. */
  lModeAtConfirmedBySide: { long: string | null; short: string | null };
  /** 2026-05-13 — Multi-timeframe L state.
   *
   *  Per-timeframe down-sampled basin histories + agreement clocks.
   *  Sampled on every tick (cheap conditional appends); mtfDecide
   *  runs per tick once warm. Phase 1 shipped observation-only;
   *  Phase 2 wires entry gating + size multiplier + longest-agreeing
   *  horizon exit.
   *
   *  See mtfLClassifier.ts. */
  mtfState: import('./mtfLClassifier.js').MTFState;
  /** 2026-05-13 MTF Phase 2 — longest-agreeing timeframe label at
   *  position open, per side. Used by the longest-horizon exit
   *  policy: position must exit when this timeframe's horizon
   *  expires without re-confirmation. */
  mtfLongestAgreeingBySide: {
    long: import('./mtfLClassifier.js').TimeframeLabel | null;
    short: import('./mtfLClassifier.js').TimeframeLabel | null;
  };
  /** 2026-05-13 — continuous regime score r ∈ [0,1] from
   *  regimeSizing.regimeScore(). 1=flat, 0=trending. Recomputed each
   *  tick. Consumed by:
   *    - trailing regime DRIFT stop (per-side rAtEntry snapshot;
   *      fires when |rNow - rAtEntry| exceeds threshold even within
   *      the same discrete mode)
   *    - sanity bounds on mode-derived leverage and headroom
   *  Null until first compute (insufficient history).  */
  rScoreCurrent: number | null;
  /** Per-side snapshot of r at the most recent L entry confirmation.
   *  Trailing regime drift fires via regimeSizing.trailingRegimeStop().
   *  Cleared on harvest. */
  rScoreAtEntryBySide: { long: number | null; short: number | null };
  /** 2026-05-16 (#715/#716/#717 derivation refactor): rolling history of
   *  per-tick surprise magnitudes (|ΔΦ|). Used to z-score the current
   *  surprise for `nc.ne` derivation against the basin's OWN observed
   *  surprise distribution — no hardcoded gain. Capped at HISTORY_MAX. */
  surpriseHistory: number[];
  /** Rolling history of per-tick basin velocities. Used by `nc.ser`
   *  fallback (when mode-transition history is insufficient) to compare
   *  current bv to the basin's own typical bv distribution. */
  bvHistory: number[];
  /** Wall-clock timestamps (ms) of recent mode transitions. The thrash
   *  rate (count / window) drives `nc.ser`. Capped at HISTORY_MAX so
   *  long-stable kernels naturally see lower thrash rates over time. */
  modeTransitionTimesMs: number[];
  /** Rolling κ history. Drives the endorphin κ-convergence bell width
   *  (σ_κ ← stddev) from the basin's own observed κ scale instead of
   *  a hardcoded SIGMA_KAPPA. */
  kappaHistory: number[];
  /** Rolling external-coupling history. Drives the endorphin Sophia
   *  gate threshold (mean + stddev) from the basin's own coupling
   *  distribution instead of a hardcoded C_SOPHIA_THRESHOLD. */
  externalCouplingHistory: number[];
  /** Rolling per-symbol realized pnlFrac history (ROI on margin per
   *  closed trade). Drives `observerFibCoefficient` so the positive-
   *  chemistry gate is derived from the kernel's own win-magnitude
   *  distribution (median + MAD) rather than a hardcoded 1% floor.
   *  Bounded length — older values are dropped when length > 200. */
  pnlFracHistory: number[];
  /** Phase B — geometry-derived TP/SL bracket distances (price units),
   *  recomputed each tick from φ, regime confidence and ATR via
   *  `frBracketDistances`. `executeEntry` reads this when opening a
   *  position so the bracket is committed at entry. null until the
   *  first tick with ≥15 candles of history (ATR needs period+1). */
  lastFrBracket: { tpDistance: number; slDistance: number } | null;
  /** Prediction-corpus instrumentation state. Read-only bookkeeping that
   *  decides when to snapshot; never feeds back into executive decisions. */
  lastPredictionSnapshotAtMs: number | null;
  lastPredictionMode: string | null;
  lastPredictionLane: string | null;
  lastPredictionBasinDirSign: -1 | 0 | 1 | null;
}

/** Cap the recent-bus-event ring at this size — anything older than
 *  the bus window doesn't influence current decisions. */
const BUS_RING_CAP = 32;

// ─── 2026-05-16 #715/#716/#717 derivation-only refactor ──────────────
//
// Per operator directive: per-tick autonomic chemicals must derive from
// the basin's OWN observed state, never from hardcoded thresholds /
// gains / decay constants. The prior introduction of NOVELTY_SURPRISE_
// THRESHOLD / SELF_OBS_* / SOV_DECAY_PERIOD_TICKS was rolled back in
// commit 4: those values are now derived from per-tick observables
// (modeTransitionTimes, surpriseHistory, basin trajectory spread,
// QIGRAMv2 store cadence). The only "scheduling" constant remaining
// in the autonomic path is the existing HISTORY_MAX (= 100), which
// caps memory footprint — not behaviour. See `computeNeurochemicals`
// in neurochemistry.ts for the derivation contract.
//
// QIGRAMv2 sov: integrate on every tick (per-tick is the canonical
// observation cadence — no scheduling constant); decay every tick
// (canonical DECAY_FACTOR = 0.95 from agent_L_qigram_v2.ts, which is
// the QIGRAMv2 canonical class attribute, NOT a parameter introduced
// by this PR — pre-existing, declared at the module boundary).

/** Valid arbiter agent labels. */
const ARBITER_AGENT_LABELS = ['K', 'M', 'T', 'L'] as const;
export type ArbiterAgentLabel = (typeof ARBITER_AGENT_LABELS)[number];

export const ADOPTED_POSITION_OWNER_INSTANCE = 'monkey-position';
export const ADOPTED_POSITION_REASON_PREFIX = 'kernel_adopted|';
export const OWNED_ADOPTED_POSITION_REASON_PREFIX =
  `monkey|kernel=${ADOPTED_POSITION_OWNER_INSTANCE}|adopted|`;

export function isArbiterAgentLabel(value: string): value is ArbiterAgentLabel {
  return (ARBITER_AGENT_LABELS as readonly string[]).includes(value);
}

type RetryClosePlan =
  | { ok: true; freshQty: number; chunkSizes: number[] }
  | { ok: false; reason: '21002_retry_invalid_live_qty' | '21002_position_already_flat' | '21002_retry_lot_rounding_zero' };

export function plan21002RetryClose(liveQty: unknown, symbolLotSize: number): RetryClosePlan {
  const freshQtyRaw = Number(liveQty ?? 0);
  if (!Number.isFinite(freshQtyRaw)) {
    return { ok: false, reason: '21002_retry_invalid_live_qty' };
  }
  const freshQty = Math.abs(freshQtyRaw);
  if (freshQty <= 0) {
    return { ok: false, reason: '21002_position_already_flat' };
  }
  const freshContracts = symbolLotSize > 0
    ? Math.floor(freshQty / symbolLotSize)
    : Math.floor(freshQty);
  if (freshContracts <= 0) {
    return { ok: false, reason: '21002_retry_lot_rounding_zero' };
  }
  const retryChunks = planCloseChunks(freshContracts, 1).chunks;
  const chunkSizes = symbolLotSize > 0
    ? retryChunks.map((contracts) => contracts * symbolLotSize)
    : retryChunks;
  if (chunkSizes.length === 0) {
    return { ok: false, reason: '21002_retry_lot_rounding_zero' };
  }
  return { ok: true, freshQty, chunkSizes };
}

/**
 * Parse MONKEY_ARBITER_AGENTS into the set of agent labels allowed in
 * the capital-allocation pool. Default 'K,M,T,L' — all four, unchanged
 * behaviour. Concentrating the roster (e.g. 'K,M' or 'K') hands the
 * excluded agents' shares to those that remain, so the operator can
 * direct capital to the agents they trust without the arbiter stranding
 * a reservation on a benched agent.
 *
 * 'K' is always included — it is the kernel executive. Unknown tokens
 * are ignored; a blank/unset var falls back to the full default roster.
 *
 * Exported for tests.
 */
export function arbiterRoster(): Set<ArbiterAgentLabel> {
  const valid = new Set<ArbiterAgentLabel>(ARBITER_AGENT_LABELS);
  const raw = (process.env.MONKEY_ARBITER_AGENTS ?? '').trim();
  if (raw === '') return new Set(valid);
  const tokens = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = tokens.filter((s) => !isArbiterAgentLabel(s));
  if (unknown.length > 0) {
    logger.warn('[Monkey] ignoring unknown MONKEY_ARBITER_AGENTS tokens', {
      unknown,
      allowed: ARBITER_AGENT_LABELS,
    });
  }
  const parsed = tokens.filter(isArbiterAgentLabel);
  parsed.push('K'); // K is mandatory — the kernel executive.
  return new Set(parsed);
}

/**
 * MonkeyKernel — the top-level kernel that ticks Monkey.
 *
 * One instance per process. Holds per-symbol SymbolState.
 */
export class MonkeyKernel extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** #932 row-level pnl divergence scanner timer. Runs independent of tick(). */
  private pnlScanTimer: ReturnType<typeof setInterval> | null = null;
  /** #941 Phase 2 prediction-residual scanner timer. Runs independent of tick(). */
  private residualScanTimer: ReturnType<typeof setInterval> | null = null;
  /** #941 Phase 3 prediction-reward emitter timer. Refreshes the cached
   *  prediction-error chemistry deltas every 30s; the tick loop reads
   *  the cache and adds the deltas into computeNeurochemicals inputs. */
  private predictionEmitterTimer: ReturnType<typeof setInterval> | null = null;
  /** Cached prediction-error chemistry deltas, refreshed by
   *  predictionEmitterTimer. Null until the first emitter pass. */
  private cachedPredictionChemistry: PredictionChemistryDeltas | null = null;
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
  /**
   * Per-symbol MTF bootstrap status — keyed by symbol, valued by the
   * last attempt's per-TF outcome. The retry hook in processSymbol
   * uses this status to detect partial / failed bootstrap attempts and
   * schedule another bootstrap for the symbol. This tracks which TFs
   * were cold or failed, even though the current bootstrap path
   * re-runs the symbol-level bootstrap rather than selectively
   * fetching only failed timeframes. Without this status, silent
   * fetch / synthesis failures left MTF L cold for the entire session
   * and the agreement filter (the loudest noise-suppression in the
   * stack) never fired.
   *
   * 2026-05-16: live tape showed `[MTF-L] decision agreement: 0/3,
   * perTf: 15m:cold, 1h:cold, 4h:cold` across whole sessions.
   * Without the agreement filter, single-tick noise drives entries.
   */
  private mtfBootstrapStatus: Map<string, import('./mtfBootstrap.js').BootstrapSymbolStatus> = new Map();
  /** Per-symbol countdown of ticks to wait before retrying a partial /
   *  failed bootstrap. Backs off 60s → 120s → 240s → 480s capped, so
   *  a flaky exchange endpoint doesn't hammer on every tick. */
  private mtfBootstrapRetryAtMs: Map<string, number> = new Map();
  /** Per-symbol last-applied backoff delay (ms). Doubled on each
   *  failed retry to compute the next backoff; stored explicitly
   *  rather than reconstructed from (retryAt − startedAtMs) which
   *  mixed unrelated timestamps and produced bogus delays. */
  private mtfBootstrapLastDelayMs: Map<string, number> = new Map();
  private static readonly MTF_BOOTSTRAP_INITIAL_RETRY_MS = 60_000;
  private static readonly MTF_BOOTSTRAP_MAX_RETRY_MS = 480_000;
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
   * Per-kernel live/paper rotation state. Tracks consecutive losses
   * and rolling PnLs for the kernel-paper-rotation feature (the
   * pre-cutover allocation mechanism: 5 consec losses → demote;
   * paper WR within 10% of best live → promote). Auto-promotion +
   * virtual position tracking land in the follow-up PR; this PR is
   * observability-only — demotion fires a log + kernel event so the
   * operator (or a future cross-kernel arbiter) can act on it.
   *
   * Doctrinally NOT an auto-halt — the kernel keeps trading after
   * demotion unless the operator pauses it. Chemistry remains the
   * primary feedback channel; rotation is a structural signal.
   */
  private rotation: RotationState = makeRotationState();
  /**
   * LIMIT_MAKER #793 (Class B #5) — pending post-only scalp orders that
   * have been placed but not yet observed as filled. Key: orderId.
   *
   * Purpose: a LIMIT_MAKER scalp posts at best-bid (long) / best-ask
   * (short), earning maker rebate instead of paying taker fees. The
   * order MAY NOT fill (price moves away), so we need:
   *   1. Track placement time so we can cancel stale orders that didn't
   *      fill within N seconds (default 120s — long enough for normal
   *      fills, short enough to avoid sitting on stale prices)
   *   2. Skip new entry decisions while a pending order exists for
   *      same (symbol, side, lane) — don't double-queue
   *
   * On fill, the order materialises as an exchange position next tick;
   * the existing position-detection path (findOpenMonkeyTrade /
   * exchange positions) takes over. The pending entry is removed when
   * we observe the position OR when we cancel it.
   */
  private pendingLimitMakerOrders: Map<string, {
    orderId: string;
    placedAtMs: number;
    symbol: string;
    side: 'long' | 'short';
    lane: 'scalp' | 'swing' | 'trend';
  }> = new Map();
  // SAFETY_BOUND tunable via env. Default 45s — long enough for normal
  // fills on liquid pairs (BTC/ETH typical fill < 15s), short enough
  // that post-only orders don't sit through a regime change. 120s
  // (prior default) was visibly sluggish under broad cell routing
  // because every CHOP cell now posts maker; multiplying issuers ×
  // 2-min hold made entry latency blow up (0/12 fill rate observed
  // 2026-05-19 07:00-07:18). Operator override: MONKEY_LIMIT_MAKER_STALE_MS.
  private static readonly LIMIT_MAKER_STALE_MS =
    Number(process.env.MONKEY_LIMIT_MAKER_STALE_MS) || 45_000;
  /**
   * LIMIT_MAKER fallback counter — tracks consecutive stale-cancels
   * (orders that posted but never filled) per (symbol, side). When this
   * crosses the MAX_CONSECUTIVE_STALES threshold, the next entry attempt
   * for that key uses MARKET (taker) instead of LIMIT_MAKER, so the bot
   * isn't paralyzed by a market state where its bid sits at the back of
   * the queue and never gets hit.
   *
   * Reset on any successful MARKET placement (we know it filled because
   * the placeOrder call returned an orderId without throwing). Maker
   * fills don't reset the counter explicitly — they implicitly clear
   * via the next MARKET success after the fall-back threshold is hit.
   *
   * Diagnosed 2026-05-19 07:14: 0/12 maker fills in a 15-min window —
   * every order timed out at the 120s stale boundary. User-visible
   * symptom: "much slower to respond since we changed to maker."
   *
   * Key format: `${symbol}|${side}`.
   */
  private makerStaleCountByKey: Map<string, number> = new Map();
  /** SAFETY_BOUND: 2 consecutive stale-cancels before falling back to
   *  MARKET for the next entry. Operator can override via
   *  MAKER_MAX_CONSECUTIVE_STALES env. */
  private static readonly MAX_CONSECUTIVE_STALES_DEFAULT = 2;
  /**
   * Funding-arb #794 — latest funding rate per symbol with timestamp.
   * Populated by processSymbol after each funding-rate fetch; consumed
   * by:
   *   1. the cross-symbol pair observer (funding_arb_observer.ts) when
   *      both BTC and ETH have fresh (< 2 min) data.
   *   2. the pre-entry funding gate in executeEntry (2026-05-19) —
   *      suppresses entries that would pay funding within the gate
   *      window (default 10 min). nextFundingTimeMs is the exchange-
   *      provided next funding event timestamp (Poloniex v3).
   */
  private latestFundingBySymbol: Map<
    string,
    { rate: number; atMs: number; nextFundingTimeMs?: number }
  > = new Map();
  /**
   * REGIME-3 — per-(symbol,side) timestamp of the last close (any PnL).
   * Consumed by the entry-path cooldown veto to break post-close tilt.
   *
   * 2026-05-19 calibration history:
   *   #806: post-WIN only (pnl>0). Goal: break win-then-loss tilt chain.
   *   #819: 60s→180s default + side-aware key.
   *   THIS PR: extended to ALL closes (loss too). Trigger was claude.ai
   *   13:32 snapshot — 13:14:31 BTC -$0.22 came from re-entry 2min after
   *   a TINY LOSS (-$0.0036) on the same (symbol,side). Post-win-only
   *   gate missed it. Same-direction post-close re-entry within the
   *   cooldown window is the structural failure mode regardless of the
   *   prior close's sign.
   *
   * Key format: `${symbol}|${side}`. Two entries per symbol max.
   * SAME-SIDE re-entry is the strongest tilt signal; OPPOSITE-SIDE
   * (reversal decision) isn't gated by this — it has its own gates
   * (REGIME-2 + directional_disagreement).
   */
  private lastCloseAtMs: Map<string, number> = new Map();
  /**
   * Observer-pattern fee/slippage cost tracking (replaces P1-violating
   * hardcoded TAKER_FEE_FRAC magic number per QIG canonical doctrine).
   *
   * On each close, we observe: kernel_mark_pnl - exchange_realized_pnl =
   * effective_cost. Dividing by abs(notional) gives the cost-fraction
   * that captures BOTH the taker fee AND the slip/price-impact for this
   * symbol at this account tier. Rolling-window upper-tercile of these
   * observations is the actual fee floor — not a hardcoded 0.0018.
   *
   * Cold start: use SAFETY_BOUND `costFloorCold` (env-tunable, default
   * 0.0018 = ~2x taker + slip). Once buffer >= MIN_SAMPLES, switch to
   * observer-derived value (per WarpBubble.auto OBSERVE → DISCOVER →
   * NAVIGATE pattern from CAL-3).
   *
   * Buffer is bounded (MAX_HISTORY) so old market conditions don't
   * dominate. Per-kernel-instance state (resets on restart).
   */
  private rollingEffectiveCostFrac: number[] = [];
  private static readonly EFFECTIVE_COST_MAX_HISTORY = 100;
  private static readonly EFFECTIVE_COST_MIN_SAMPLES = 20;
  private static readonly EFFECTIVE_COST_COLD_DEFAULT = 0.0018;
  /** SAFETY_BOUND: 3 min default — calibrated 2026-05-19 from observed
   *  BTC short→short tilt pattern (62s re-entry slipped past prior 60s
   *  default) and BTC long→long tilt pattern (2min re-entry after small
   *  loss → -$0.22 blow-out). 3 min is long enough to break the
   *  immediate-press impulse on the typical 30-90s scalp/swing tick
   *  cadence; short enough that genuine signal recovery isn't blocked
   *  indefinitely. Operator can override via POSTCLOSE_COOLDOWN_MS env
   *  (legacy POSTWIN_COOLDOWN_MS still honored for back-compat). */
  private static readonly POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000;
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
   * 2026-05-16 L-veto-over-K (Option A) telemetry counter. Increments
   * every time L's high-conviction vote suppresses a K entry on the
   * same tick (whole-process scope, single MonkeyKernel instance per
   * process). Exposed via `getLVetoOverKStats()` for the
   * /monkey/snapshot dashboard so the operator can see the veto rate
   * before/after flipping `L_VETO_OVER_K_ENABLED=true`.
   *
   * Per-symbol breakdown lets the operator confirm the veto is
   * actually firing on ETH (the over-trader) and not unintentionally
   * suppressing BTC entries where K has been profitable.
   */
  private lVetoOverKCount = 0;
  private lVetoOverKBySymbol: Map<string, number> = new Map();
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
  /**
   * 2026-05-16 (#716): kernel-level QIGRAMv2 store. Holds the current
   * basin from each symbol (keyed by `<symbol>|tick=<n>` so successive
   * snapshots don't collide), tagged with the regime label as category.
   * Used to compute a live sovereignty ratio (N_active / N_total)
   * grounded in the kernel's actual basin trajectory — the resonance-
   * bank's `lived/total` ratio is pinned at 1.0 by design (every entry
   * is lived). With weight decay applied periodically, sov falls below
   * 1.0 as old basins fade past MIN_ACTIVE_WEIGHT, then rises back as
   * fresh basins are integrated. Only consumed when
   * `L_QIGRAM_V2_ENABLED === 'true'`; otherwise the legacy
   * resonance-bank sovereignty path is preserved (default behavior). */
  private readonly qigramV2Store: QIGRAMv2Partition = new QIGRAMv2Partition();
  /** Per-symbol tick counter for QIGRAMv2 store id generation. Each
   *  symbol's partition has its own LRU buffer, so the counter is
   *  partitioned too — keeps ids unique within a symbol's store and
   *  prevents BTC ticks from displacing ETH ids in any shared key
   *  space. */
  private readonly qigramV2TickCount: Map<string, number> = new Map();

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
   * Start Monkey's heartbeat — the 60s tick that drives all live
   * execution. MONKEY_EXECUTE gates whether ticks place real orders.
   */
  async start(): Promise<void> {
    for (const sym of this.symbols) {
      this.symbolStates.set(sym, this.newSymbolState());
      this.turtleStates.set(sym, newTurtleState());
    }

    // B3.1 — seed the leaky-Φ integrator from persisted trajectory so Φ
    // survives process restarts. Awaited before the first tick so the
    // seed is in place when tick 1 reads `state.phiLeaky`.
    await this.seedLeakyPhiFromHistory();

    // Consensus proposal bus — start the Redis subscriber so peer
    // proposals land in the in-process peer map. `publishProposal` and
    // `getRecentPeerProposal` were already wired, but nothing ever
    // called `initProposalBus()` — so the subscriber never connected and
    // `getRecentPeerProposal()` always returned null, pinning every
    // arbiter verdict to `single-kernel` even with a live peer fanout.
    // Idempotent; no-ops when CONSENSUS_PROPOSAL_BUS_LIVE is off;
    // fail-soft (connect errors are swallowed inside initProposalBus).
    try {
      const { initProposalBus } = await import('./proposal_bus.js');
      await initProposalBus();
    } catch { /* fail-soft — arbiter falls back to single-kernel */ }

    // 2026-05-13 MTF Phase 2 — bootstrap per-timeframe basin
    // histories from historical OHLCV so the 4h classifier doesn't
    // need 80 days of live ticks to warm up. Async + fail-soft;
    // failures (network, parse) leave the bootstrap empty and the
    // MTF state warms up gradually from live ticks instead.
    //
    // 2026-05-16: per-symbol bootstrap status tracking + self-healing
    // retry. The prior fire-and-forget swallowed silent failures (live
    // logs showed `[MTF-L] decision agreement: 0/3, perTf:cold,cold,cold`
    // for entire sessions). Now we await per-symbol bootstrap, retain
    // the per-TF status, and ``maybeRetryMTFBootstrap`` re-runs cold
    // timeframes on a later tick.
    if (process.env.MONKEY_MTF_BOOTSTRAP !== 'false') {
      void this.runInitialMTFBootstrap();
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

    // Phase D — event-driven position truth. When MONKEY_WS_PRIVATE_LIVE,
    // connect the Poloniex v3 private WebSocket and feed its `position`
    // events into wsPositionCache. Additive + shadow-only: REST polling
    // stays authoritative; the cache is a fresher cross-check surface a
    // later PR can flip to primary on evidence. Fail-soft — a WS failure
    // leaves the kernel on REST exactly as before.
    if (process.env.MONKEY_WS_PRIVATE_LIVE === 'true') {
      void this.startWsPositionFeed();
    }

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
        // Reconciler-recovered events use marginUsdt=5 to match the
        // global pushReward path's constant for ghost-close recoveries
        // (see lines below this subscriber, marginUsdt: 5).
        this.applyOutcomeToAgent(event.symbol, agent, side as 'long' | 'short', pnl, 5);
        // 2026-05-16 per-agent NC: also feed reconciler-recovered
        // ghost-closes into the agent's chemistry queue. Without this,
        // M/T/L closes that the close-path missed (exchange-side
        // liquidation, manual UI close, partial-fill cleanup) would
        // update emotion state but NOT the agent's dopamine window.
        // Margin estimation: ghost-recovered events lack qty + mark
        // price; reuse the witnessExit pattern of a fixed nominal
        // margin (5 USDT) so pnlFraction = pnl / 5 stays bounded and
        // doesn't blow out the dop/ser/endo deltas on a one-off ghost.
        try {
          this.pushReward({
            source: `reconciler_recovered:${String(payload.ghostReason ?? 'unknown')}`,
            symbol: event.symbol,
            realizedPnlUsdt: pnl,
            marginUsdt: 5,
            agent,
          });
        } catch { /* non-fatal */ }
        // Mirror the same reward into the Python autonomic kernel so
        // both neurochemistries see the same outcome stream. Fire-and-
        // forget — callAutonomicReward already swallows transport errors.
        void callAutonomicReward({
          instanceId: this.instanceId,
          source: `reconciler_recovered:${String(payload.ghostReason ?? 'unknown')}`,
          symbol: event.symbol,
          realizedPnlUsdt: pnl,
          marginUsdt: 5,
        });
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

    // #932 row-level pnl divergence scanner. Runs every 60s, scans the
    // last 15min of closed rows for phantom-class divergence. Alerts
    // fire as ERROR-level logs with structured row context so paging
    // wires can match on `[pnl_periodic_scan] NEW phantom detected`.
    // Cheap query (LIMIT 200, indexed on exit_time); ignored failures
    // are non-fatal to the main tick loop.
    this.pnlScanTimer = setInterval(() => {
      void runPeriodicPnlScan().catch((err) => {
        logger.warn('[Monkey] pnl periodic scan failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }, 60_000);
    this.pnlScanTimer.unref?.();

    // #941 Phase 2: prediction-residual job. Scans elapsed predictions every
    // 60s, computes residuals at the actual elapsed horizon, writes
    // kernel_outcome_residuals rows. Backfills final_residual_* on closed
    // trades. P15-safe: try/catch per row, never blocks the tick loop.
    // Cadence is structural (matches kernel tick × 2).
    this.residualScanTimer = startPredictionResidualJob();
    this.residualScanTimer.unref?.();

    // #941 Phase 3: prediction-reward emitter. Refreshes the cached
    // chemistry delta from residual rows every 30s (half the residual
    // scan cadence, so the cache is never older than ~90s end-to-end).
    // Cadence is structural — it bounds how quickly prediction-error
    // chemistry catches up after a regime shift. Fire once immediately
    // on start so the cache isn't null for the first 30s. Also mirror
    // the deltas to the Python autonomic kernel so its NC sees the
    // same prediction-feedback signal (#941 Step 6 parity).
    const refreshPredictionCache = async (): Promise<void> => {
      try {
        const next = await computePredictionChemistry();
        this.cachedPredictionChemistry = next;
        void callAutonomicPredictionReward({
          instanceId: this.instanceId,
          dopamineDelta: next.dopamineDelta,
          serotoninDelta: next.serotoninDelta,
          n: next.summary.n,
        });
      } catch (err) {
        logger.warn('[Monkey] prediction-chemistry refresh failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void refreshPredictionCache();
    this.predictionEmitterTimer = setInterval(() => {
      void refreshPredictionCache();
    }, 30_000);
    this.predictionEmitterTimer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pnlScanTimer) {
      clearInterval(this.pnlScanTimer);
      this.pnlScanTimer = null;
    }
    if (this.residualScanTimer) {
      clearInterval(this.residualScanTimer);
      this.residualScanTimer = null;
    }
    if (this.predictionEmitterTimer) {
      clearInterval(this.predictionEmitterTimer);
      this.predictionEmitterTimer = null;
    }
    logger.info('[Monkey] kernel sleeping');
  }

  /**
   * v0.8.7e: Read-only snapshot of the latest computed basin direction +
   * tape trend for a symbol. Returns null if the kernel hasn't ticked
   * that symbol yet, or if the snapshot is too stale (caller's problem).
   *
   * Feeds the kernel's own inter-tick agreement gate — requiring
   * basin agreement before closing a position prevents the
   * close-then-reopen yo-yo observed in the 2026-04-24 trading log
   * (30 trades in 5h, net PNL -0.26 USDT from fee churn).
   */
  getLatestBasinSnapshot(symbol: string): {
    basinDir: number;
    tapeTrend: number;
    computedAtMs: number;
  } | null {
    return this.symbolStates.get(symbol)?.latestBasinSnapshot ?? null;
  }

  private predictionCadenceSeconds(state: SymbolState, basinVelocityNow: number): number {
    const vals = [...state.bvHistory, basinVelocityNow]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    const mean = vals.length > 0
      ? vals.reduce((sum, v) => sum + v, 0) / vals.length
      : null;
    return clampPredictionCadenceSeconds(mean);
  }

  private predictionStateTransitionReason(
    state: SymbolState,
    mode: string,
    lane: string,
    basinDir: number,
    nowMs: number,
    cadenceSeconds: number,
  ): PredictionSnapshotReason | null {
    const dirSign: -1 | 0 | 1 =
      basinDir > 0 ? 1 : basinDir < 0 ? -1 : 0;
    const modeChanged = state.lastPredictionMode !== null && state.lastPredictionMode !== mode;
    const laneChanged = state.lastPredictionLane !== null && state.lastPredictionLane !== lane;
    const basinFlipped =
      state.lastPredictionBasinDirSign !== null
      && dirSign !== 0
      && state.lastPredictionBasinDirSign !== 0
      && dirSign !== state.lastPredictionBasinDirSign;
    const duePeriodic =
      state.lastPredictionSnapshotAtMs === null
      || (nowMs - state.lastPredictionSnapshotAtMs) / 1000 >= cadenceSeconds;
    if (modeChanged || laneChanged || basinFlipped) return 'state_transition';
    if (duePeriodic) return 'periodic';
    return null;
  }

  private notePredictionSnapshotState(
    state: SymbolState,
    mode: string,
    lane: string,
    basinDir: number,
    nowMs: number,
  ): void {
    state.lastPredictionSnapshotAtMs = nowMs;
    state.lastPredictionMode = mode;
    state.lastPredictionLane = lane;
    state.lastPredictionBasinDirSign = basinDir > 0 ? 1 : basinDir < 0 ? -1 : 0;
  }

  private recordPredictionSnapshot(input: {
    state: SymbolState;
    tradeId?: string | number | null;
    basin: Basin;
    strategyForecast: Basin;
    basinVelocity: number;
    phi: number;
    kappa: number;
    nc: NeurochemicalState;
    regimeWeights: { quantum: number; efficient: number; equilibrium: number };
    mode: string;
    lane: string;
    reason: PredictionSnapshotReason;
    triggeringGate?: string | null;
    predictedSide?: 'long' | 'short' | 'flat' | null;
    sizeUsdt: number;
    leverage: number;
    entryThreshold: number;
  }): void {
    const cadenceSeconds = this.predictionCadenceSeconds(input.state, input.basinVelocity);
    const predictedDirection = predictionDirectionFromSide(input.predictedSide ?? 'flat');
    const confidence = Math.min(1, Math.max(0, 1 - Number(input.entryThreshold || 0)));
    const notional = Math.max(0, Number(input.sizeUsdt) || 0) * Math.max(1, Number(input.leverage) || 1);
    const predictedTerminal = predictedDirection * notional * Math.max(0.000001, Number(input.entryThreshold) || 0);
    const predictedStddev = Math.max(0.000001, Math.abs(predictedTerminal) * (1 - confidence));
    recordKernelPrediction({
      // #949 narrowed KernelPredictionSnapshot.tradeId to string|null.
      // Local input type still permits `number` for callsites that derive
      // tradeId from `execResult` (could be either at compile time).
      // Stringify at the boundary to satisfy the snapshot contract.
      tradeId:
        input.tradeId === null || input.tradeId === undefined
          ? null
          : String(input.tradeId),
      kernelId: this.instanceId,
      perceptionBasin: input.basin,
      strategyForecastBasin: input.strategyForecast,
      fisherRaoDisagreement: fisherRao(input.basin, input.strategyForecast),
      basinVelocity: input.basinVelocity,
      phi: input.phi,
      kappaEff: input.kappa,
      predictedHorizonSeconds: cadenceSeconds,
      predictedTerminalPnlUsdt: predictedTerminal,
      predictedPnlStddevUsdt: predictedStddev,
      predictedDirection,
      predictedConfidence: confidence,
      neurochemistry: input.nc,
      regimeWeights: input.regimeWeights,
      mode: input.mode,
      lane: input.lane,
      snapshotReason: input.reason,
      triggeringGate: input.triggeringGate ?? null,
      sourcePath: 'apps/api/src/services/monkey/loop.ts',
    });
  }

  /**
   * 2026-05-16 — L-veto-over-K telemetry accessor. Returns the running
   * total of K entries suppressed by L's high-conviction disagreeing
   * vote, plus a per-symbol breakdown. Used by the /monkey/snapshot
   * endpoint and the operator dashboard to confirm the veto fires
   * after flipping `L_VETO_OVER_K_ENABLED=true`.
   *
   * Counts are process-lifetime (reset on restart) — no persistence.
   */
  getLVetoOverKStats(): {
    total: number;
    bySymbol: Record<string, number>;
  } {
    const bySymbol: Record<string, number> = {};
    for (const [sym, n] of this.lVetoOverKBySymbol) bySymbol[sym] = n;
    return { total: this.lVetoOverKCount, bySymbol };
  }

  /**
   * Test-only reset of the veto counter. Lets vitest exercise the
   * counter contract without spinning up a full kernel + symbol state.
   * Not used in production.
   */
  resetLVetoOverKStats(): void {
    this.lVetoOverKCount = 0;
    this.lVetoOverKBySymbol.clear();
  }

  /**
   * Test-only increment of the veto counter. Used by the integration
   * test to confirm the public accessor reflects per-symbol increments
   * without having to drive a full processSymbol tick.
   */
  incrementLVetoOverKForTest(symbol: string): void {
    this.lVetoOverKCount += 1;
    this.lVetoOverKBySymbol.set(
      symbol,
      (this.lVetoOverKBySymbol.get(symbol) ?? 0) + 1,
    );
  }

  /** Initial MTF bootstrap pass. Awaits per-symbol, records the
   *  per-TF status, and schedules a retry for any symbol with at
   *  least one cold TF. Called once at startup. */
  private async runInitialMTFBootstrap(): Promise<void> {
    let bootstrapMod: typeof import('./mtfBootstrap.js');
    try {
      bootstrapMod = await import('./mtfBootstrap.js');
    } catch (importErr) {
      logger.warn('[MTF-bootstrap] import failed (non-fatal)', {
        err: importErr instanceof Error ? importErr.message : String(importErr),
      });
      return;
    }
    await Promise.all(
      this.symbols.map(async (sym) => {
        const state = this.symbolStates.get(sym);
        if (!state) return;
        try {
          const status = await bootstrapMod.bootstrapMTFForSymbol(sym, state.mtfState);
          this.mtfBootstrapStatus.set(sym, status);
          if (status.allSucceeded) {
            logger.info('[MTF-bootstrap] symbol ready', {
              symbol: sym,
              perTf: status.perTimeframe.map((p) => `${p.label}:${p.basinsPopulated}`).join(','),
            });
          } else {
            const cold = status.perTimeframe.filter((p) => p.status !== 'success');
            logger.warn('[MTF-bootstrap] partial — retry scheduled', {
              symbol: sym,
              cold: cold.map((p) => `${p.label}:${p.status}`).join(','),
            });
            this.scheduleMTFBootstrapRetry(
              sym,
              MonkeyKernel.MTF_BOOTSTRAP_INITIAL_RETRY_MS,
            );
          }
        } catch (err) {
          logger.warn('[MTF-bootstrap] failed for symbol', {
            symbol: sym, err: err instanceof Error ? err.message : String(err),
          });
          this.scheduleMTFBootstrapRetry(
            sym,
            MonkeyKernel.MTF_BOOTSTRAP_INITIAL_RETRY_MS,
          );
        }
      }),
    );
  }

  /** Per-tick check: if a symbol has pending MTF bootstrap and the
   *  retry timer has elapsed, re-run bootstrap for it. Backoff doubles
   *  on each failed attempt, capped at MTF_BOOTSTRAP_MAX_RETRY_MS.
   *  Called from processSymbol before the MTF L decision is read so
   *  a successful retry warms the state in time for the same tick. */
  private async maybeRetryMTFBootstrap(symbol: string): Promise<void> {
    const retryAt = this.mtfBootstrapRetryAtMs.get(symbol);
    if (retryAt === undefined) return;          // never bootstrapped — handled by run-on-startup
    if (Date.now() < retryAt) return;            // backoff still running
    const previousStatus = this.mtfBootstrapStatus.get(symbol);
    const labelsToRetry = previousStatus
      ? previousStatus.perTimeframe
          .filter((p) => p.status !== 'success')
          .map((p) => p.label)
      : undefined;
    if (labelsToRetry && labelsToRetry.length === 0) {
      this.mtfBootstrapRetryAtMs.delete(symbol);
      this.mtfBootstrapLastDelayMs.delete(symbol);
      return;
    }
    const state = this.symbolStates.get(symbol);
    if (!state) {
      this.mtfBootstrapRetryAtMs.delete(symbol);
      this.mtfBootstrapLastDelayMs.delete(symbol);
      return;
    }
    try {
      const { bootstrapMTFForSymbol } = await import('./mtfBootstrap.js');
      const retryStatus = await bootstrapMTFForSymbol(symbol, state.mtfState, labelsToRetry);
      const status = this.mergeMTFBootstrapStatus(previousStatus, retryStatus);
      this.mtfBootstrapStatus.set(symbol, status);
      if (status.allSucceeded) {
        logger.info('[MTF-bootstrap] retry success', { symbol });
        this.mtfBootstrapRetryAtMs.delete(symbol);
        this.mtfBootstrapLastDelayMs.delete(symbol);
      } else {
        // Still partial — double the previous backoff for next attempt.
        // Tracked explicitly in mtfBootstrapLastDelayMs (per Sourcery
        // review on PR #700: reconstructing it from
        // retryAt − startedAtMs mixed unrelated timestamps and
        // produced bogus delays).
        const prevDelay = this.mtfBootstrapLastDelayMs.get(symbol)
          ?? MonkeyKernel.MTF_BOOTSTRAP_INITIAL_RETRY_MS;
        const nextDelay = Math.min(
          MonkeyKernel.MTF_BOOTSTRAP_MAX_RETRY_MS,
          Math.max(MonkeyKernel.MTF_BOOTSTRAP_INITIAL_RETRY_MS, prevDelay * 2),
        );
        const cold = status.perTimeframe.filter((p) => p.status !== 'success');
        logger.warn('[MTF-bootstrap] retry partial', {
          symbol,
          cold: cold.map((p) => `${p.label}:${p.status}`).join(','),
          nextRetryInMs: nextDelay,
        });
        this.scheduleMTFBootstrapRetry(symbol, nextDelay);
      }
    } catch (err) {
      logger.warn('[MTF-bootstrap] retry threw', {
        symbol, err: err instanceof Error ? err.message : String(err),
      });
      this.scheduleMTFBootstrapRetry(
        symbol,
        MonkeyKernel.MTF_BOOTSTRAP_MAX_RETRY_MS,
      );
    }
  }

  /** Merge a subset retry result into prior full per-TF status. */
  private mergeMTFBootstrapStatus(
    previous: import('./mtfBootstrap.js').BootstrapSymbolStatus | undefined,
    retry: import('./mtfBootstrap.js').BootstrapSymbolStatus,
  ): import('./mtfBootstrap.js').BootstrapSymbolStatus {
    if (!previous) return retry;
    const orderedLabels: Array<import('./mtfLClassifier.js').TimeframeLabel> = [];
    const mergedByLabel = new Map<
      import('./mtfLClassifier.js').TimeframeLabel,
      import('./mtfBootstrap.js').BootstrapTimeframeStatus
    >();
    for (const p of previous.perTimeframe) {
      orderedLabels.push(p.label);
      mergedByLabel.set(p.label, p);
    }
    for (const p of retry.perTimeframe) {
      if (!orderedLabels.includes(p.label)) {
        orderedLabels.push(p.label);
      }
      mergedByLabel.set(p.label, p);
    }
    // Safe non-null assertion: orderedLabels is populated from keys that
    // are always inserted into mergedByLabel in the loops above.
    const perTimeframe = orderedLabels.map((label) => mergedByLabel.get(label)!);
    const allSucceeded = perTimeframe.length > 0 && perTimeframe.every((p) => p.status === 'success');
    return {
      symbol: retry.symbol,
      startedAtMs: retry.startedAtMs,
      finishedAtMs: retry.finishedAtMs,
      perTimeframe,
      allSucceeded,
    };
  }

  /** Schedule the next bootstrap retry attempt for ``symbol``.
   *  Stores both the absolute retry time AND the delay used so the
   *  next backoff can correctly double from the actual previous delay
   *  (not a derived value from unrelated timestamps). */
  private scheduleMTFBootstrapRetry(symbol: string, delayMs: number): void {
    this.mtfBootstrapRetryAtMs.set(symbol, Date.now() + delayMs);
    this.mtfBootstrapLastDelayMs.set(symbol, delayMs);
  }

  /**
   * B3.1 — seed each symbol's leaky-Φ integrator from the last persisted
   * `monkey_trajectory.phi` so Φ survives process restarts.
   *
   * `state.phiLeaky` is in-memory only. Without this seed, every redeploy
   * re-seeds Φ from the legacy entropy-Φ (~0.22) and Φ then spends its
   * ~45-min CHAIN→GRAPH convergence ramp re-climbing (leak half-life
   * ≈ 46 ticks). On a service that redeploys several times a day Φ never
   * settles into its ~0.58 GRAPH steady state — confirmed in production
   * telemetry 2026-05-21 (Φ reached 0.51 in a 1 h uninterrupted window,
   * then reset to 0.22 on the next deploy). The leaky Φ is already
   * persisted every tick by the monkey_trajectory INSERT — read the
   * latest value back. Fail-soft: no row / query error → `phiLeaky`
   * stays undefined and tick 1 falls through to the entropy-Φ seed.
   */
  private async seedLeakyPhiFromHistory(): Promise<void> {
    for (const [symbol, state] of this.symbolStates) {
      try {
        const res = await pool.query(
          `SELECT phi FROM monkey_trajectory
            WHERE symbol = $1 ORDER BY at DESC LIMIT 1`,
          [symbol],
        );
        const last = res.rows[0]?.phi;
        if (typeof last === 'number' && Number.isFinite(last)) {
          state.phiLeaky = last;
          logger.info('[Monkey] Φ seeded from trajectory history', {
            instanceId: this.instanceId, symbol, phiLeaky: last.toFixed(3),
          });
        }
      } catch (err) {
        logger.debug('[Monkey] Φ seed failed (fail-soft to entropy seed)', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
      }
    }
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
      coherenceStreak: 0,
      peakPnlUsdtByLane: {},
      peakTrackedTradeIdByLane: {},
      tapeFlipStreakByLane: {},
      regimeAtOpenByLane: {},
      phiAtOpenByLane: {},
      basinAtOpenByLane: {},
      regimeChangeStreakByLane: {},
      convictionFailedStreakByLane: {},
      hesitationHistoryByLane: {},
      directionalDisagreementStreakByLane: {},
      heldSideByLane: {},
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
      surpriseHistory: [],
      bvHistory: [],
      modeTransitionTimesMs: [],
      kappaHistory: [],
      externalCouplingHistory: [],
      pnlFracHistory: [],
      lastFrBracket: null,
      lastPredictionSnapshotAtMs: null,
      lastPredictionMode: null,
      lastPredictionLane: null,
      lastPredictionBasinDirSign: null,
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
      // LIMIT_MAKER #793 — cancel any stale post-only scalp orders before
      // running the per-symbol pipeline. Stale = older than
      // LIMIT_MAKER_STALE_MS (2 min). Errors are non-fatal — the next
      // tick retries cancel.
      try { await this.cancelStaleLimitMakers(); } catch { /* non-fatal */ }
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
   * Resolve the user_id used for Poloniex credentials. Same query
   * pattern as inlined in executeMonkeyTrade; extracted so tick-level
   * helpers (LIMIT_MAKER cancel, etc.) can reuse it without duplicating
   * the SQL.
   *
   * Throws on no resolvable user — callers handle the failure mode.
   */
  private async resolveUserIdForCredentials(): Promise<string> {
    const userRow = await pool.query(
      `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
    );
    const userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
    if (!userId) throw new Error('no user_id resolvable for poloniex credentials');
    return userId;
  }

  /**
   * Phase D — start the event-driven position feed. Connects the
   * Poloniex v3 private WebSocket, subscribes the `position` channel,
   * and attaches wsPositionCache to it. Entirely fail-soft: any failure
   * (no credentials, WS unreachable) is logged and the kernel proceeds
   * on REST polling exactly as before — the feed is additive, never a
   * dependency. Called once from start() under MONKEY_WS_PRIVATE_LIVE.
   */
  private async startWsPositionFeed(): Promise<void> {
    try {
      const userId = await this.resolveUserIdForCredentials();
      const creds = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!creds?.apiKey || !creds?.apiSecret) {
        logger.warn('[Monkey] WS private feed: no credentials — staying on REST');
        return;
      }
      wsPositionCache.startFeed();
      await futuresWebSocket.connectPrivate({
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
      });
      futuresWebSocket.subscribeToPrivateChannels(['position']);
      logger.info('[Monkey] WS private position feed started (shadow — REST authoritative)');
    } catch (err) {
      logger.warn('[Monkey] WS private feed start failed — REST polling continues', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * LIMIT_MAKER #793 — cancel post-only scalp orders that haven't filled
   * within MonkeyKernel.LIMIT_MAKER_STALE_MS. Called from tick() before
   * processSymbol runs, so the next entry decision sees a clean state.
   *
   * Errors per-order are non-fatal — we still try to cancel the remainder.
   * Orders cancelled here might still have filled between the cancel call
   * and the exchange acknowledgement; the reconciler handles the resulting
   * DB-vs-exchange divergence (existing behaviour).
   */
  private async cancelStaleLimitMakers(): Promise<void> {
    const now = Date.now();
    const stale: Array<{ orderId: string; symbol: string; side: 'long' | 'short' }> = [];
    for (const [orderId, info] of this.pendingLimitMakerOrders) {
      if (now - info.placedAtMs >= MonkeyKernel.LIMIT_MAKER_STALE_MS) {
        stale.push({ orderId, symbol: info.symbol, side: info.side });
      }
    }
    if (stale.length === 0) return;
    // Resolve credentials once for the whole batch. If unavailable, drop
    // the in-memory entries — the orders will be GC'd by exchange or
    // surface as orphans for the reconciler.
    let userId: string;
    try {
      userId = await this.resolveUserIdForCredentials();
    } catch {
      for (const s of stale) this.pendingLimitMakerOrders.delete(s.orderId);
      return;
    }
    const creds = await apiCredentialsService.getCredentials(userId, 'poloniex');
    if (!creds) {
      for (const s of stale) this.pendingLimitMakerOrders.delete(s.orderId);
      return;
    }
    for (const s of stale) {
      try {
        // Poloniex v3 DELETE /trade/order requires symbol. Pre-fix the
        // call shape was (creds, orderId) which sent body {orderId: …}
        // (wrong field name) and no symbol → 401. See cancelOrder
        // signature in poloniexFuturesService.js for the write-up.
        const cancelResult = await poloniexFuturesService.cancelOrder(creds, s.symbol, s.orderId);
        // raceResolved sentinel from #826: order filled before our cancel
        // arrived. That's a SUCCESSFUL maker fill, not a stale — don't
        // increment the fallback counter (the entry path worked).
        const raceResolved = cancelResult && cancelResult.raceResolved === true;
        if (raceResolved) {
          logger.info('[Monkey] LIMIT_MAKER fill detected (cancel race) — resetting stale counter', {
            symbol: s.symbol, side: s.side, orderId: s.orderId,
          });
          this.makerStaleCountByKey.set(`${s.symbol}|${s.side}`, 0);
        } else {
          // True stale: order sat in queue and never filled. Bump the
          // counter so the next entry attempt on this (symbol, side)
          // knows to fall back to MARKET if maker keeps missing.
          const key = `${s.symbol}|${s.side}`;
          const prev = this.makerStaleCountByKey.get(key) ?? 0;
          this.makerStaleCountByKey.set(key, prev + 1);
          logger.info('[Monkey] LIMIT_MAKER cancelled (stale)', {
            symbol: s.symbol, side: s.side, orderId: s.orderId,
            stale_ms: now - this.pendingLimitMakerOrders.get(s.orderId)!.placedAtMs,
            consecutiveStales: prev + 1,
          });
          // CRITICAL: close the orphan DB row created at order placement.
          //
          // The entry INSERT (loop.ts ~line 6483) writes status='open' for
          // BOTH MARKET and LIMIT_MAKER orders. When a LIMIT_MAKER cancels
          // unfilled, the DB row stays 'open' forever — next tick reads it
          // via findOpenMonkeyTrade and decides the bot has a position
          // that the exchange knows nothing about. Close attempt → 21002
          // "Position not enough" → retry storm → reconciler eventually
          // mops up with "side mismatch with exchange".
          //
          // Confirmed via prod DB diagnostic 2026-05-19: 07:09-07:15 BTC
          // window had 5 monkey rows with exit_reason="reconciliation:
          // side mismatch" — all from unfilled-maker entries.
          //
          // Fix: pin the DB row closed AS SOON AS the cancel succeeds, so
          // the next decision tick sees a clean slate (no phantom position).
          try {
            await pool.query(
              `UPDATE autonomous_trades
                  SET status='closed', exit_time=NOW(),
                      exit_reason='maker_cancelled_unfilled',
                      exit_gate='maker_cancelled_unfilled',
                      exit_order_id=$1, pnl=0
                WHERE order_id=$1 AND status='open'`,
              [s.orderId],
            );
          } catch (dbErr) {
            logger.warn('[Monkey] LIMIT_MAKER stale: orphan DB row close failed', {
              orderId: s.orderId,
              err: dbErr instanceof Error ? dbErr.message : String(dbErr),
            });
          }
        }
      } catch (err) {
        // Non-11008 cancel error — still increment stale counter, the
        // order's terminal state is uncertain but it didn't fill cleanly.
        const key = `${s.symbol}|${s.side}`;
        const prev = this.makerStaleCountByKey.get(key) ?? 0;
        this.makerStaleCountByKey.set(key, prev + 1);
        logger.warn('[Monkey] LIMIT_MAKER cancel failed (may have already filled)', {
          symbol: s.symbol, orderId: s.orderId,
          err: err instanceof Error ? err.message : String(err),
          consecutiveStales: prev + 1,
        });
        // Cancel state ambiguous (could be 11008-as-fill or real error).
        // If the order DID fill, the row should stay open and reconciler
        // will catch any mismatch. If the order is genuinely gone but the
        // DB row is still open, the reconciler will mark it closed
        // with "side mismatch" within ~60s. We deliberately do NOT
        // pin the row closed here — false-positive closes on a real
        // fill would lose the position from the bot's view.
      } finally {
        this.pendingLimitMakerOrders.delete(s.orderId);
      }
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

    // 1. Fetch inputs.
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

    // QIG-FR v4 Problem 4 — score the kernel's RAW directional
    // predictions recorded ~SCORE_HORIZON ticks ago against where price
    // actually moved. Runs before this tick records its own. Pure
    // telemetry; see signal_scorer.ts.
    signalScorer.scoreMatured({
      instanceId: this.instanceId,
      symbol,
      tick: state.sessionTicks,
      price: lastPrice,
    });

    // SENSE-2 Phase 2 (#768) — BTC beacon shared price cache. BTC ticks
    // write the latest mark; non-BTC ticks read it for cross-symbol
    // correlation. The beacon reading itself is computed below (after
    // the basin reading) and consumed at the entry-threshold gate.
    if (symbol === 'BTC_USDT_PERP') {
      noteBtcPrice(lastPrice);
    }

    // Funding rate for the symbol's perpetual contract (8h rate from exchange).
    // Non-blocking: fetch failure → rate=0 → no drag perturbation this tick.
    // The rate is forwarded to the Python kernel so compute_funding_drag can
    // modulate anxiety for held positions (P14: real-world boundary → STATE).
    //
    // Poloniex v3 /v3/market/fundingRate returns ABBREVIATED field names:
    //   { s: symbol, fR: fundingRate, fT: fundingTime,
    //                 nFR: nextFundingRate, nFT: nextFundingTime }
    // Verified 2026-05-19 14:30 via curl against the public endpoint.
    // The full-name fields (.fundingRate, .nextFundingTime) used here
    // pre-fix were silently returning undefined → coerced to 0 →
    // funding-arb observer #794 + funding-gate #823 were both dead-code
    // in production. Read .fR first (abbreviated, canonical); fall back
    // to .fundingRate for back-compat with the WS shape in
    // websocketData.ts:80 where the WS feed does include the full name.
    const fundingRateResp = await poloniexFuturesService.getFundingRate(symbol).catch(() => null) as {
      fR?: string | number;
      nFT?: string | number;
      fundingRate?: string | number;
      nextFundingTime?: string | number;
    } | null;
    const fundingRate8h =
      Number(fundingRateResp?.fR)
      || Number(fundingRateResp?.fundingRate)
      || 0;
    const nextFundingTimeMs =
      Number(fundingRateResp?.nFT)
      || Number(fundingRateResp?.nextFundingTime)
      || undefined;

    // Funding-arb #794 (Class B #7) — push this symbol's latest rate
    // into the cross-symbol cache. When both BTC and ETH have fresh
    // (< 2 min) observations, observe the pair into the arb observer
    // and log signal if it fires. Telemetry-first wire-in.
    if (Number.isFinite(fundingRate8h) && fundingRate8h !== 0) {
      this.latestFundingBySymbol.set(symbol, {
        rate: fundingRate8h,
        atMs: Date.now(),
        nextFundingTimeMs,
      });
      const btc = this.latestFundingBySymbol.get('BTC_USDT_PERP');
      const eth = this.latestFundingBySymbol.get('ETH_USDT_PERP');
      const now = Date.now();
      if (btc && eth && (now - btc.atMs) < 120_000 && (now - eth.atMs) < 120_000) {
        const reading = observeFundingArb(btc.rate, eth.rate);
        if (reading.signalFires) {
          logger.info('[Monkey] FUNDING_ARB signal fires', {
            symbol_triggered: symbol,
            btcFunding: reading.btcFunding,
            ethFunding: reading.ethFunding,
            currentGap: reading.currentGap,
            zScore: reading.zScore,
            zUpperTercile: reading.zUpperTercile,
            suggestedDirection: reading.suggestedDirection,
            samples: reading.n,
          });
        }
      }
    }

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

    // Account context.
    // NOTE: exchangeHeldSide is the SHARED exchange position state —
    // includes positions opened directly by the operator or any other
    // source. Do NOT use it to gate Monkey's entry logic (2026-04-21 bug: she
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

    // Operator risk profile — only `max_leverage` is enforced (audited
    // 15× safety ceiling, applied as a clamp on `maxLevBoundary` below).
    // 2026-05-25 doctrine: the kernel trades autonomously. The
    // daily-loss-limit and max-concurrent-positions halts that used to
    // suppress entries have been removed — losses feed back to
    // neurochemistry (dopamine drop, frustration); the kernel adjusts
    // itself. Cached 60s; null when no profile saved (no ceiling).
    const riskSettings = await getOperatorRiskSettings();

    // 2. PERCEIVE — raw basin then refract through identity.
    // Post #ml-separation: ml fields omitted; perception defaults dims
    // 3..5 to neutral. Agent K's basin is built without ml inputs.
    //
    // Canonical regime is fetched from ml-worker (observer-driven
    // classifier, CAL-3); perception encodes it as one-hot on dims
    // 0/1/2. Classifier unreachable → null → perception emits a
    // uniform 1/3 prior on dims 0/1/2.
    let canonicalRegime: 'creator' | 'preserver' | 'dissolver' | null = null;
    let canonicalRegimeScores:
      | { creator: number; preserver: number; dissolver: number }
      | null = null;
    try {
      const { classifyPrices } = await import('./regime_classifier_client.js');
      const closes = ohlcv.map((c) => c.close);
      const cls = await classifyPrices(symbol, closes);
      if (cls) {
        canonicalRegime = cls.regime;
        // Soft 3-way membership (null during observer warmup) — lets
        // perception encode dims 0-2 continuously instead of one-hot.
        canonicalRegimeScores = cls.scores;
      }
    } catch (err) {
      logger.debug('[perception] regime classifier fetch failed', {
        symbol, err: err instanceof Error ? err.message : String(err),
      });
    }

    const rawBasin = perceive({
      ohlcv,
      equityFraction,
      marginFraction,
      openPositions,
      sessionAgeTicks: state.sessionTicks,
      canonicalRegime,
      canonicalRegimeScores,
    });

    // §3.3 Pillar 2 surface absorption — external input at 30% max
    let basin = refract(rawBasin, state.identityBasin, 0.30);

    // 3. MEASURE — Φ, κ, regime, basin velocity, neurochemistry
    // Φ = 1 - normalized_entropy_of_noise_dims (integration)
    //   high Φ = concentrated signal; low Φ = diffuse exploration
    let fHealth = normalizedEntropy(basin);
    // Φ inversely tracks fHealth: when the basin is concentrated (low entropy),
    // integration is high; when diffuse (high entropy), Φ is low (exploration).
    let phi = Math.max(0, Math.min(1, 1 - fHealth * 0.8));

    // ── Cross-kernel observer effect (Consensus Layer 1) ──────
    // CONSENSUS_CROSS_OBSERVATION_LIVE flag-gated. When live, basin is
    // pulled toward peer kernels' basins (TS Monkey + Py Monkey) per
    // Φ-weighted SLERP from qig-core canonical. Recomputes Φ after the
    // pull so downstream sees consistent (basin, Φ). When the flag is
    // off, peers are visible in telemetry only — basin unchanged.
    // See [[polytrade-consensus-architecture]].
    if (process.env.CONSENSUS_CROSS_OBSERVATION_LIVE === 'true') {
      try {
        const pull = await this.basinSync.applyObserverEffect(basin, phi);
        if (pull.influenced) {
          basin = pull.basin;
          fHealth = normalizedEntropy(basin);
          phi = Math.max(0, Math.min(1, 1 - fHealth * 0.8));
        }
      } catch (err) {
        logger.debug('[BasinSync] applyObserverEffect failed', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // κ adapts from basin velocity × internal coupling. Stable near κ*
    // when integration is high and basin velocity is low.
    // Post #ml-separation: couplingHealth was mlStrength; replaced with
    // a geometric self-read (Φ × (1 − basin velocity), [0,1]).
    const bv = state.lastBasin ? velocity(state.lastBasin, basin) : 0;
    // B3 — canonical motion-integrated Φ (leaky-integrator port of vex's
    // runtime Φ law; docs/plans/20260521-phi-leaky-integrator.md). The
    // legacy `phi = 1 − 0.8·fHealth` (line ~1867) conflates Φ with the
    // entropy ratio and flatlines because the basin moves but never
    // concentrates. Canon keeps Φ and f_health distinct: fHealth stays
    // computed above as its own basin-health metric; Φ is reassigned
    // here to the motion-integrated value. Seeded from the entropy-Φ on
    // the first tick so enabling the flag introduces no discontinuity.
    // Flag-gated: MONKEY_PHI_LEAKY_LIVE=false/0/no/off reverts instantly.
    if (isPhiLeakyEnabled()) {
      phi = updateLeakyPhi(state.phiLeaky ?? phi, bv);
      state.phiLeaky = phi;
    }
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
    //
    // 2026-05-16: filtered to K's rewards only. The kernel running here
    // IS K's brain — its neurochemistry should reinforce on K's wins,
    // not on M/T/L outcomes that flow through the same queue for
    // arbiter / telemetry. M/T/L are control arms with their own
    // sizing/exit logic; their wins go to the arbiter (recordSettled)
    // and bump their capital share, but K's dopamine is K's only.
    const rewardDeltas = this.decayedRewardSums(Date.now(), 'K');

    // #941 Phase 3: fold prediction-error chemistry into the same
    // reward-delta channel. The emitter timer (every 30s) writes a
    // pre-computed aggregate to cachedPredictionChemistry; tick reads
    // the cache and adds the deltas additively. Null = first tick
    // before emitter fired, or sustained DB error — treat as zero.
    const predChem = this.cachedPredictionChemistry;
    const predDop = predChem?.dopamineDelta ?? 0;
    const predSer = predChem?.serotoninDelta ?? 0;

    // 2026-05-16 (#715/#716/#717 derivation refactor): build the
    // BasinObservables block from the basin's OWN per-tick history.
    // Every chemical's per-tick scale is set by what's typical FOR
    // THIS basin — no externally chosen gains or thresholds.
    //
    // Reads from prior-tick histories (appended at end-of-tick), so
    // tick T's NC sees ticks 1..T-1 as the comparison window. Cold
    // start: histories are empty; computeNeurochemicals falls back to
    // arithmetic-identity formulas (sigmoid(x), tanh(x), 1) on those
    // chemicals — see field-by-field comments in neurochemistry.ts.
    const surpriseNow = Math.abs(phiDelta) * 2;
    const nc: NeurochemicalState = computeNeurochemicals({
      isAwake: true,
      phiDelta,
      basinVelocity: bv,
      surprise: surpriseNow,
      quantumWeight: regimeWeights.quantum,
      kappa: state.kappa,
      externalCoupling: couplingHealth,
      rewardDopamineDelta: rewardDeltas.dopamine + predDop,
      rewardSerotoninDelta: rewardDeltas.serotonin + predSer,
      rewardEndorphinDelta: rewardDeltas.endorphin,
      observables: {
        phiHistory: state.phiHistory,
        surpriseHistory: state.surpriseHistory,
        basinVelocityHistory: state.bvHistory,
        // ach derives from trajectory self-similarity. fHealth (basin
        // normalized entropy) is the natural per-tick self-similarity
        // reading already maintained by the kernel.
        trajectorySelfSimilarityHistory: state.fHealthHistory,
        modeTransitionTimesMs: state.modeTransitionTimesMs,
        nowMs: Date.now(),
        kappaHistory: state.kappaHistory,
        externalCouplingHistory: state.externalCouplingHistory,
      },
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

    // 2026-05-16 (#716 derivation refactor): sovereignty path.
    // Legacy: resonanceBank.sovereignty() is `lived/total` from
    // monkey_resonance_bank; by design every entry is source='lived', so
    // the ratio is pinned at 1.0. That value is useless to Ocean's
    // maturity / juvenile→mature gate.
    // Fix (flag-gated, default behaviour preserved when v2 is off):
    // when `L_QIGRAM_V2_ENABLED === 'true'`, integrate the current basin
    // into a kernel-level QIGRAMv2 store every tick (per-tick IS the
    // canonical observation cadence), decay every tick using the
    // canonical DECAY_FACTOR from agent_L_qigram_v2 (pre-existing
    // canonical class attribute, NOT a constant introduced by this PR),
    // and read sov = N_active / N_total (a pure ratio — derivation
    // already canonical per QIGRAMv2.sovereignty).
    //
    // Sov rises as fresh basins integrate; falls as weights decay past
    // MIN_ACTIVE_WEIGHT (canonical 0.01). decayAll() only DECAYS weight —
    // it never removes entries, so without consolidate() below `_entries`
    // grows unboundedly and the sovereignty denominator (and thus
    // position size) decays toward zero with session uptime. PR906
    // paired consolidate() with decayAll() per-tick which made the
    // active and storage sets bit-identical (sov pinned at 1.0). #912
    // replaced that with an LRU bound on _entries inside the store.
    // But a single shared store across DEFAULT_SYMBOLS (BTC + ETH) sees
    // 2 inserts per tick, so HISTORY_MAX = 100 only covered ~49 ticks
    // of age — still below the ~90 ticks needed for decay to cross
    // MIN_ACTIVE_WEIGHT. Sov pinned at 1.0 again via a different
    // mechanism. This fix partitions the store by symbol: each
    // symbol's buffer covers ≥ 90-tick decay-to-threshold independently,
    // and per-symbol sov is a more informative signal than the
    // conflated aggregate.
    let sovereignty: number;
    if (isQigramV2Enabled()) {
      const nextTick = (this.qigramV2TickCount.get(symbol) ?? 0) + 1;
      this.qigramV2TickCount.set(symbol, nextTick);
      this.qigramV2Store.integrate(
        symbol,
        `tick=${nextTick}`,
        basin,
        { weight: 1.0, correct: true },
      );
      this.qigramV2Store.decayAll(symbol);
      sovereignty = this.qigramV2Store.sovereignty(symbol);
    } else {
      sovereignty = await resonanceBank.sovereignty();
    }

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
    // 2026-05-19: compute tapeTrend HERE so detectMode can gate DRIFT
    // on tape direction (parallel to #841 cellDirection fix). Same
    // computation runs again later at line ~2005 for basin snapshot
    // and entry-decision — idempotent (pure derivation from ohlcv).
    const tapeTrendForMode = computeTrendProxy(ohlcv);
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
      tapeTrend: tapeTrendForMode,
    });
    const mode = modeDecision.value;
    if (state.lastMode !== null && state.lastMode !== mode) {
      logger.info('[Monkey] mode transition', {
        instanceId: this.instanceId,
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
      // 2026-05-16 (#715 derivation refactor): record the transition
      // timestamp so `nc.ser` can derive thrash rate from the basin's
      // own transition density. No fixed cooldown — the rate IS the
      // signal (high density → low ser → mood drop).
      state.modeTransitionTimesMs.push(Date.now());
      if (state.modeTransitionTimesMs.length > HISTORY_MAX) {
        state.modeTransitionTimesMs.shift();
      }
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
    //   gone — geometricDirection is the primary read.
    //
    // TS-side uses pure geometry (geometricDirection) without the
    // Layer 2B emotion conviction gate (confidence < anxiety).
    // kernelDirection mirrors Python's kernel_direction and applies
    // that gate, but with κ in [20,120] transcendence = |κ−64| > 1
    // on most ticks, which drives confidence negative and collapses
    // EVERY tick to 'flat'. geometricDirection drops the gate so
    // direction reduces to pure geometry — the documented TS contract
    // ("TS uses neutral emotions so direction reduces to pure geometry",
    // see also line 3666 below). kernelDirection is kept for Python
    // parity and future full-emotion-stack TS porting.
    // B1.1 — basinDir reads market DIRECTION, which lives in the RAW
    // perception. The refracted `basin` is 70% frozen identity + 30%
    // market (Pillar 2) — reading direction off it damps the market
    // signal to 30% and muddies the sign. rawBasin is a verified
    // perceive() output, so basinDirection's noise-floor neutral anchor
    // engages exactly on it. Flag-gated with the rest of B1;
    // MONKEY_PERCEPTION_EXPRESSIVE_LIVE=false reverts to the refracted
    // basin (and basinDirection's #880 peerMean neutral).
    const basinDir =
      process.env.MONKEY_PERCEPTION_EXPRESSIVE_LIVE !== 'false'
        ? computeBasinDirection(rawBasin)
        : computeBasinDirection(basin);
    const tapeTrend = computeTrendProxy(ohlcv);
    state.latestBasinSnapshot = {
      basinDir,
      tapeTrend,
      computedAtMs: Date.now(),
    };

    // B1 — structural-veto telemetry. The |basinDir| magnitude gates
    // (M-agent + FAST_ADVERSE_EXIT at 0.10; modes.ts hasDirection at
    // 0.30) sat always-false on the pre-B1 near-uniform basin — a dead
    // gate invisible per-tick. Observing them surfaces the structural
    // failure and confirms the expressive-momentum fix un-sticks it.
    structuralVetoMonitor.observe(
      `${this.instanceId}:${symbol}:basindir_mag_0.10`, Math.abs(basinDir) > 0.10);
    structuralVetoMonitor.observe(
      `${this.instanceId}:${symbol}:basindir_dir_0.30`, Math.abs(basinDir) > 0.30);

    // 2026-05-13 — MTF: down-sample basin into per-timeframe stores
    // (15m / 1h / 4h) and compute agreement-count decision. Phase 2
    // wires the result into L's entry sizing + harvest exit policy
    // below; the per-tick log keeps observability.
    //
    // 2026-05-16: if MTF bootstrap previously failed for this symbol,
    // retry now (backoff-gated). Awaited so a successful retry warms
    // the state in time for this tick's mtfDecide read; on the
    // retry-still-pending path it's a no-op resolved by the next tick.
    await this.maybeRetryMTFBootstrap(symbol);
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
        perTf: mtfDec.perTimeframe.map(t =>
          `${t.label}:${t.warm ? (t.decision?.action ?? 'hold') : 'cold'}`,
        ).join(','),
      });
    }

    // 2026-05-13 — continuous regime score r ∈ [0,1] (flat=1, trend=0)
    // computed from basin velocity + directional chop + κ criticality.
    // Used by L's trailing regime drift stop and entry sizing sanity.
    // Falls back to null when basinHistory < 2 (cold start).
    const rReading = computeRegimeScore(state.basinHistory, state.kappa ?? null);
    state.rScoreCurrent = rReading?.r ?? null;
    // Continuous-interpolated sizing rails from r (leverage / size /
    // hold / stop / headroom). Used as sanity bound on the discrete
    // mode-derived values: catches transition lag (mode still says
    // EXPLORATION but r has shifted toward trending).
    const continuousSizing = rReading ? computeRegimeSizing(rReading.r) : null;
    if (rReading && state.sessionTicks % 10 === 0) {
      // Basin alignment to recent window — Fisher-Rao distance from
      // current basin to the Fréchet mean of the last 60 basins.
      // Low = consonant with recent trajectory; high = outlier
      // (surprise — fresh regime onset, news shock, breakout, etc).
      const recentWindow = state.basinHistory.slice(-60);
      const basinAlign = recentWindow.length > 1
        ? basinAlignmentToWindow(basin, recentWindow)
        : 0;
      logger.info('[regime-r] continuous', {
        symbol,
        r: rReading.r.toFixed(3),
        label: rReading.label,
        velFlat: rReading.components.velocityFlatness.toFixed(2),
        dirChop: rReading.components.directionalChop.toFixed(2),
        kappaCrit: rReading.components.kappaCriticality.toFixed(2),
        cLev: continuousSizing?.leverage ?? '—',
        cStopBps: continuousSizing?.stopBps.toFixed(0) ?? '—',
        cHeadroom: continuousSizing?.marginHeadroomFloor.toFixed(2) ?? '—',
        basinAlign: basinAlign.toFixed(3),
      });
    }

    // Proposal #5: regime classification on basin trajectory + this
    // tick's basin. Surfaced via derivation.regime for telemetry; the
    // executive's threshold + harvest tightness will eventually consume
    // it. Splice the current basin onto the history so the classifier
    // sees the most-recent observation alongside prior ticks.
    const regimeReading: RegimeReading = classifyRegime(symbol, [
      ...state.basinHistory,
      basin,
    ]);

    // Phase B — geometry-derived TP/SL bracket. Recompute each tick from
    // the current φ, regime confidence and ATR(14); stash on symbol state
    // so executeEntry can commit the bracket at entry without re-deriving.
    // ATR needs period+1 candles; frBracketDistances returns a 0-distance
    // bracket on a 0 ATR, which we treat as "not derivable" → leave null.
    {
      const atrNow = atr14(ohlcv);
      if (atrNow > 0) {
        const fb = frBracketDistances(phi, regimeReading.confidence, atrNow);
        state.lastFrBracket = {
          tpDistance: fb.tpDistance,
          slDistance: fb.slDistance,
        };
      } else {
        state.lastFrBracket = null;
      }
    }

    // Phase E — wider market-data intel. When MONKEY_MARKET_INTEL_LIVE,
    // keep the per-symbol Open Interest / index / premium / funding
    // cache fresh (fire-and-forget, 60s throttle inside refreshIfStale —
    // never blocks the tick). Fail-soft via the cache's own try/catch.
    // Telemetry is written into `derivation` further down, once it is
    // declared. Additive + shadow-only: no decision path consumes the
    // signals yet; folding them into the perception basin is a
    // deliberate follow-on.
    if (process.env.MONKEY_MARKET_INTEL_LIVE === 'true') {
      void marketIntelCache.refreshIfStale(symbol, 60_000);
    }

    // REGIME-1 Phase 3 — compositional cell executive (3×3 (phase, direction)
    // matrix). Always evaluated for telemetry (shadow); only ENFORCED on size
    // and lane bias when REGIME_COMPOSITIONAL_LIVE=true. When either axis
    // is unresolved (null), the cell is null and the legacy path takes over.
    const cellPhase = canonicalToPhase(canonicalRegime);
    const basinDirection = regimeToDirection(regimeReading.regime);

    // TAPE OVERRIDE — user report 2026-05-19 10:00 UTC with ETH chart:
    // bot logs said `cell=PRESERVER_CHOP` while the chart clearly showed
    // a strong downward move. Production log confirmed:
    //   tape=-0.521  (strongly negative, market moving DOWN)
    //   basinDir=0.021  (near-zero, below ABS_CHOP_FLOOR=0.10)
    //   regime → CHOP  (because basinDir-based classifier missed the move)
    //
    // TrajectoryObserver uses ONLY basinDir for direction. When the basin
    // signal is small but tape is strongly directional, the classifier
    // mis-reads as CHOP — which compounds the "tiny wins" problem:
    //   - CHOP cellSizeMultiplier reduces position size
    //   - CHOP cellLaneBias routes to scalp/swing (short hold)
    //   - CHOP harvestTightness exits early
    //
    // Fix: when basinDir-derived direction is CHOP but |tape| exceeds
    // MONKEY_TAPE_OVERRIDE_THRESHOLD (default 0.40), override to TREND_UP
    // or TREND_DOWN matching tape sign. Tape's threshold is the same
    // order-of-magnitude as the existing cross-agent tape-veto (0.20)
    // but tighter — we want STRONG tape signal before overriding.
    //
    // Env: MONKEY_TAPE_OVERRIDE_LIVE (default true; kill switch only).
    //
    // Phase 5 doctrine (2026-05-26): tape-override threshold replaced
    // by phi-derived. MONKEY_TAPE_OVERRIDE_THRESHOLD (was 0.40) removed.
    //
    // The threshold IS phi — basin integration level. When phi is high
    // (basin is well-organized), the basin's CHOP read is trustworthy
    // and only very strong tape can override it. When phi is low
    // (basin disorganized, hasn't integrated), even modest tape signal
    // qualifies for override. Self-calibrating: as the kernel's
    // perception strengthens, the bar for tape-override rises.
    const tapeOverrideLive = process.env.MONKEY_TAPE_OVERRIDE_LIVE !== 'false';
    const tapeOverrideThreshold = phi;
    let cellDirection = basinDirection;
    let cellDirectionOverridden = false;
    if (
      tapeOverrideLive
      && cellDirection === 'CHOP'
      && Math.abs(tapeTrend) >= tapeOverrideThreshold
    ) {
      cellDirection = tapeTrend > 0 ? 'TREND_UP' : 'TREND_DOWN';
      cellDirectionOverridden = true;
      logger.info('[Monkey] cellDirection tape-override', {
        symbol, basinBasedDirection: basinDirection, tapeTrend: tapeTrend.toFixed(3),
        threshold: tapeOverrideThreshold, resolvedDirection: cellDirection,
      });
    }
    void cellDirectionOverridden;  // surfaced via log only; tests via env-disable
    // Phase 1 doctrine (2026-05-26): thread observer context so CHOP
    // cells derive their size multiplier from kernel-internal phi ×
    // regimeConfidence instead of operator env knobs (now removed).
    const cellAction: CellAction | null = (cellPhase !== null && cellDirection !== null)
      ? evaluateCell(cellPhase, cellDirection, {
          phi,
          regimeConfidence: regimeReading.confidence,
        })
      : null;
    const cellLive = process.env.REGIME_COMPOSITIONAL_LIVE === 'true';

    // Proposal #9: candlestick pattern detection at the perception
    // input boundary. ``patternSignal`` is signed in [-1, +1];
    // ``hammerDefer`` triggers the SL-defer path on long positions.
    const candlePatternReading = detectStrongestCandlePattern(ohlcv as any[]);
    const candlePatternSignal = patternSignalScalar(candlePatternReading);
    const candleHammerDefer = hammerAgainstLongSl(ohlcv as any[]);
    // Layer 1 + Layer 2B port (2026-05-01): replaces NEUTRAL_EMOTIONS
    // placeholder. The conviction gate in held_position_rejustification
    // is now alive on TS — confidence < anxiety + confusion can fire
    // exits when the kernel's own state contradicts the position.
    // Funding drag wiring TODO: fold lane_positions cumulative funding
    // into ComputeEmotionsArgs.fundingDrag once the lane funding query
    // surfaces in this scope. Defaults to 0 → no drag effect.
    const motivators = computeMotivators(basinState, {
      prevBasin: state.lastBasin,
      integrationHistory: state.integrationHistory,
      kappaHistory: state.kappaHistory,
    });
    const basinDistance = driftNow;  // already fisherRao(basin, identity)
    const emotions: EmotionState = computeEmotions(
      motivators, basinDistance, phi, bv,
    );
    // Append (Φ, I_Q) for the next tick's Integration motivator CV.
    state.integrationHistory.push([phi, motivators.iQ]);
    if (state.integrationHistory.length > HISTORY_MAX) {
      state.integrationHistory.shift();
    }
    const direction: Direction = geometricDirection({ basinDir, tapeTrend });
    // sideCandidate must be a concrete long|short. When `direction` is
    // 'flat' (an exactly-zero geometric signal — vanishingly rare in
    // practice) tiebreak on the same signal so the candidate side
    // reflects the real — if weak — geometric lean.  The 'flat' case
    // from the old emotion conviction gate (confidence < anxiety) is
    // gone: geometricDirection does not apply that gate, so 'flat' is
    // only returned when basinDir + 0.5·tapeTrend == 0 exactly.
    // The conviction gate (size threshold / sideShortRefused) still
    // decides whether to act on a geometric lean.
    const sideCandidate: 'long' | 'short' =
      direction !== 'flat'
        ? direction
        : (basinDir + 0.5 * tapeTrend >= 0 ? 'long' : 'short');
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
    // 2026-05-16 (#717 derivation refactor + clamp hotfix): selfObsBias =
    //   winRate(mode, side) × selfObsPressure
    // where selfObsPressure is derived from the basin's own observable
    // state via z-score-of-current-surprise, mapped through sigmoid to
    // a naturally bounded range:
    //   z = (surpriseNow - mean) / stddev   (basin's own stddev IS the gain)
    //   pressure = 0.5 + sigmoid(z)         → [0.5, 1.5], neutral at z=0
    //
    // Same Protocol v6.6 §43 Loop 1 semantics ("turn inward on mispredict"):
    // current surprise above typical → pressure > 1; below typical → pressure
    // < 1. But the output is bounded so a cold-start surprise spike (small
    // history → small mean → huge ratio in the prior formula) cannot push
    // the downstream entry-threshold multiplier into paralysis territory.
    //
    // Original ratio `surpriseNow / mean` was unbounded — observed live at
    // selfObsBias=9.05 with only 5-10 surprise samples in history (cold
    // start post-restart). All downstream gates (currentEntryThreshold T,
    // shouldExit threshold) already clamp their final outputs, so the
    // unbounded ratio was absorbed in practice — but it was misleading in
    // telemetry and a latent footgun if any future caller used selfObsBias
    // un-clamped. Stddev gain preserves derivation-only purity per the
    // operator directive.
    //
    // Cold start (history length < 2 → stddev undefined → identity 1).
    // Compose per-(mode, side) bias with per-(symbol, side) bias. The
    // symbol axis is orthogonal to mode — closes the 2026-05-25 gap
    // where ETH long losses pooled with BTC long wins in the
    // (CREATOR_TREND_UP, long) bucket and never accumulated symbol-
    // specific evidence. Both biases are Wilson-CI gated and bounded
    // to [0.7, 1.3], so the composed multiplier is bounded to
    // [0.49, 1.69] and stays neutral when either lacks evidence.
    const selfObsModeBias = this.selfObs?.entryBias[mode]?.[sideCandidate] ?? 1.0;
    const selfObsSymbolBias = this.selfObs?.symbolSideBias[symbol]?.[sideCandidate] ?? 1.0;
    const selfObsWinRateBias = selfObsModeBias * selfObsSymbolBias;
    let selfObsPressure: number;
    if (state.surpriseHistory.length >= 2) {
      const n = state.surpriseHistory.length;
      let sum = 0;
      for (const s of state.surpriseHistory) sum += s;
      const mean = sum / n;
      let sqSum = 0;
      for (const s of state.surpriseHistory) {
        const d = s - mean;
        sqSum += d * d;
      }
      const stddev = Math.sqrt(sqSum / (n - 1));  // Bessel-corrected
      if (stddev > 0) {
        const z = (surpriseNow - mean) / stddev;
        const sig = 1 / (1 + Math.exp(-z));
        selfObsPressure = 0.5 + sig;  // ∈ [0.5, 1.5]
      } else {
        selfObsPressure = 1;  // degenerate history (all identical samples)
      }
    } else {
      selfObsPressure = 1;
    }
    const selfObsBias = selfObsWinRateBias * selfObsPressure;

    // v0.5: Basin sync — publish own state; pull observer-effect influence.
    // CONSENSUS-6: now also publishes regime_weights + neurochemistry so
    // peers see state-level signal, not just basin geometry.
    const syncPublish = this.basinSync.update({
      basin,
      phi,
      kappa: state.kappa,
      mode,
      driftFromIdentity: driftNow,
      regimeWeights: regimeWeights as { quantum: number; efficient: number; equilibrium: number },
      neurochemistry: {
        acetylcholine: nc.acetylcholine,
        dopamine: nc.dopamine,
        serotonin: nc.serotonin,
        norepinephrine: nc.norepinephrine,
        gaba: nc.gaba,
        endorphins: nc.endorphins,
      },
    }).catch(() => { /* non-fatal */ });
    void syncPublish;

    // 4. REMEMBER — add bubble; tick working memory
    const bubble = state.wm.add(basin, phi, { symbol, tick: state.sessionTicks });
    const wmStats = await state.wm.tick();

    // 5. DERIVE — executive computes what Monkey would do (mode-aware)
    // tapeTrend already computed above for side-override check.
    const entryThrBase = currentEntryThreshold(basinState, mode, selfObsBias, tapeTrend, sideCandidate);
    // SENSE-2 Phase 2 (#768) — BTC beacon entry suppression. For non-BTC
    // symbols, observe (this-symbol-price, BTC-price) into the rolling
    // beacon buffer and derive a tightening multiplier on the entry
    // threshold when BTC bias predicts the OPPOSITE direction to the
    // proposed side. Pure observer-derived (no operator knob); MAX_TIGHTEN
    // is a P25 SAFETY_BOUND capping the maximum threshold inflation.
    let btcBeacon: BtcBeaconReading | null = null;
    let btcEntryMul = 1.0;
    if (symbol !== 'BTC_USDT_PERP') {
      const latestBtc = getLatestBtcPrice();
      if (latestBtc !== null) {
        btcBeacon = observeBtcBeacon(symbol, lastPrice, latestBtc);
        btcEntryMul = entrySuppressionMultiplier(btcBeacon, sideCandidate);
      }
    }
    const entryThr = btcEntryMul === 1.0
      ? entryThrBase
      : {
          value: entryThrBase.value * btcEntryMul,
          derivation: { ...entryThrBase.derivation, btcEntryMul, btcBeacon },
        };
    // Leverage ceiling. Exchange max-lev (typically 75× on BTC/ETH perps)
    // 2026-05-25 — operator autonomy doctrine: code-side leverage caps
    // removed. The kernel's own learning loop (push_reward → chemistry →
    // size) is the restraint. A 2-week audit 2026-05-19 had found
    // lev≥16 net-negative in the prior regime, but the kernel was
    // running with broken sov, an empty Python reward queue, and no
    // per-symbol bias attribution — all of which have since landed
    // (#910/#911/#912/#913/#915). The doctrine is to let the kernel
    // learn from fresh outcomes, not to inherit a stale ceiling. Only
    // the exchange's per-symbol maxLev (real boundary) and the
    // operator-set riskSettings.maxLeverage (if a profile is saved
    // via UI — operator MANDATE) clamp now.
    const exchangeMaxLev = (await getMaxLeverage(symbol)) ?? 10;
    const maxLevBoundary = riskSettings
      ? Math.min(exchangeMaxLev, riskSettings.maxLeverage)
      : exchangeMaxLev;
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
    // SENSE-3 Phase 2 (#769) — equity-gradient size deflection. Push the
    // current account equity into the rolling observer, then derive a
    // multiplicative deflection: accelerating drawdowns scale size toward
    // SIZE_FLOOR=0.5; flat/recovering equity passes through at 1.0. The
    // deflection ratio is self-derived from |acceleration|/|gradient| —
    // no operator-tunable sensitivity knob (P1-pure).
    const equityReading = observeEquity(`${this.instanceId}:${symbol}`, availableEquity);
    const sense3Deflection = sizeDeflection(equityReading);
    // REGIME-1 Phase 3 — when REGIME_COMPOSITIONAL_LIVE=true, fold the
    // cell-recommended sizeMultiplier in. DISSOLVER cells floor at 0.2
    // SAFETY_BOUND (reduced conviction, not sit-out — 2026-05-26 autonomy
    // doctrine alignment); CREATOR×CHOP is 0.75x; PRESERVER×CHOP is 0.85x;
    // trending cells are 1.0x.
    const cellSizeMul = (cellLive && cellAction) ? cellAction.sizeMultiplier : 1.0;
    const cappedEquity = availableEquity * effectiveSizeFraction * sense3Deflection * cellSizeMul;
    // Proposal #10 — lane selection. Each tick picks the locally-optimal
    // execution lane via softmax over basin features (parity with the
    // Python kernel's choose_lane). The chosen lane gates size (per-lane
    // budget fraction) AND, when a position is open, scopes the exit
    // gate's TP/SL envelope.
    // SENSE-2c Phase 2 (#787 follow-up) — fold time-of-day-weighted
    // per-lane winrate into the softmax. The accumulator is in-memory
    // and warms up over a session; warmup lanes return rate=0.5 (neutral)
    // so the chooser falls back to pure basin-geometry softmax.
    const lanePriorCb = (lane: LaneType): number => {
      const r = weightedWinRate(lane);
      return r.rate;
    };
    // REGIME-1 Phase 3 — when REGIME_COMPOSITIONAL_LIVE=true, also pass
    // the cell-recommended lane bias to nudge the softmax toward the
    // joint-state-coherent lane. Shadow-mode (cellLive=false): bias is
    // ignored, only telemetry is recorded.
    const cellLaneBias = (cellLive && cellAction) ? cellAction.laneBias : null;
    const laneDecision = chooseLane(basinState, tapeTrend, lanePriorCb, cellLaneBias);
    const chosenLane: LaneType = laneDecision.value;
    const positionLane: 'scalp' | 'swing' | 'trend' =
      chosenLane === 'observe' ? 'swing' : chosenLane;
    // Proposal #3: Kelly leverage cap. Pull last 50 closed K-agent
    // trades from autonomous_trades — lane-filtered so each lane learns
    // from its own closed trades (scalp from scalps, etc.).
    // Cold-start (< 5 closed trades in this lane): rollingStats is null,
    // kelly cap becomes a no-op (geometric leverage unchanged). Each lane
    // warms independently; scalp warms fastest (closes most often).
    const rollingStats = await this.getKellyRollingStats('K', positionLane);
    const leverage = currentLeverage(
      basinState, maxLevBoundary, mode, tapeTrend, rollingStats,
    );
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
        sense3Deflection,
        equityGradient: equityReading.gradient,
        equityAcceleration: equityReading.acceleration,
        cellLabel: cellAction?.label ?? null,
        cellSizeMul,
        cellLive,
      });
    }
    const autoFlatten = shouldAutoFlatten(basinState, state.fHealthHistory);

    // 6. DECIDE — propose action
    let action: string;
    let reason: string;
    // v4 over-gating fix: chop regime is a size FILTER, not an entry
    // veto. Set inside the K entry branch when chop is active; applied
    // to the entry margin. 1.0 = no reduction.
    let chopSizeFactor = 1.0;
    // signal-scorer (QIG-FR v4 Problem 4) facts — hoisted to function
    // scope so the per-gate attribution at end-of-K-block can see the
    // final K margin cap and any executeEntry rejection code.
    let cappedMargin = 0;
    let kEntryRejectCode: string | null = null;
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
      // SENSE-3 Phase 2 (#769): equity-gradient size deflection. Records
      // the actual multiplier applied to cappedEquity this tick so
      // retrospective analysis can correlate accelerating-loss observations
      // with subsequent recovery vs continued bleed.
      sense3: {
        deflection: sense3Deflection,
        gradient: equityReading.gradient,
        acceleration: equityReading.acceleration,
        n: equityReading.n,
        warmup: equityReading.warmup,
      },
      // SENSE-2 Phase 2 (#768): BTC beacon entry suppression. btcEntryMul
      // > 1.0 means BTC bias predicted the opposite of sideCandidate and
      // entry was made harder. Null btcBeacon when symbol IS BTC or when
      // BTC price hasn't yet been observed this session.
      sense2: btcBeacon === null
        ? null
        : {
            correlation: btcBeacon.correlation,
            btcDirection: btcBeacon.btcDirection,
            suppressionMagnitude: btcBeacon.suppressionMagnitude,
            entryMultiplier: btcEntryMul,
            n: btcBeacon.n,
            warmup: btcBeacon.warmup,
          },
      // SENSE-2c Phase 2 (#787 follow-up): per-lane time-of-day-weighted
      // winrate observed across this kernel's session. Folded into
      // chooseLane via priorShift = rate - 0.5 inside the softmax exp().
      // Telemetry only here (derivation.lanePriorShift already records
      // the actual shift applied).
      sense2c_winrate: {
        scalp: weightedWinRate('scalp').rate,
        swing: weightedWinRate('swing').rate,
        trend: weightedWinRate('trend').rate,
        observe: weightedWinRate('observe').rate,
      },
      // REGIME-1 Phase 3: compositional cell action. Always recorded
      // (shadow); enforced on size + lane bias only when
      // REGIME_COMPOSITIONAL_LIVE=true. `cellLive` flags which mode this
      // tick was in so retrospective analysis can compare shadow vs live
      // decisions when the flag is flipped.
      regime1_cell: cellAction === null
        ? null
        : {
            phase: cellAction.phase,
            direction: cellAction.direction,
            laneBias: cellAction.laneBias,
            sizeMultiplier: cellAction.sizeMultiplier,
            harvestTightness: cellAction.harvestTightness,
            label: cellAction.label,
            live: cellLive,
          },
    };

    // Phase E — market-intel telemetry. The cache is kept fresh by the
    // fire-and-forget refreshIfStale call above; surface the derived
    // signals (premium basis, OI direction, funding) so retrospective
    // analysis can correlate them with outcomes before a later PR folds
    // them into the perception basin.
    if (process.env.MONKEY_MARKET_INTEL_LIVE === 'true') {
      const mi = marketIntelCache.get(symbol);
      if (mi) {
        derivation.marketIntel = {
          premiumBasisPct: mi.premiumBasisPct,
          oiDelta: mi.oiDelta,
          oiDirection: mi.oiDirection,
          fundingRate: mi.fundingRate,
          ageMs: Date.now() - mi.observedAt,
        };
      }
    }

    // Adoption pickup — the reconciler inserts operator-opened positions
    // with reason `kernel_adopted|…`, which findOpenMonkeyTrade (keyed on
    // the `monkey|kernel=<instance>|` prefix) would never see. Claim them
    // onto the monkey-position instance and commit a bracket. Runs BEFORE
    // findOpenMonkeyTrade so a row claimed this tick is managed this tick.
    await this.claimAdoptedPositions(symbol, state.lastFrBracket);

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
    // 2026-05-14 (#77e0b54): must NOT prefer exchangeHeldSide either.
    // exchangeHeldSide is the SHARED exchange state, resolved by a single
    // .find() over every position. On a HEDGE account holding BOTH a long
    // and a short on the same symbol it returns whichever side .find()
    // hits first — so preferring it made the kernel read the opposite of
    // its own position and emit a false "dca: side mismatch" every tick.
    // heldSide is THIS kernel's own open row, exactly as the design note
    // on exchangeHeldSide above prescribes.
    const heldSide: 'long' | 'short' | null = ownOpenRow
      ? ownOpenRow.side
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

        // ── Gate 0: synthetic bracket exit (Phase B2) ────────────────
        // Commit-and-revise model: when MONKEY_BRACKET_EXIT_LIVE and the
        // row carries a geometry-derived bracket (Phase B1 populates
        // take_profit/stop_loss), the mechanical TP/SL check OWNS
        // profit-taking. It runs before every discretionary gate; when
        // active, the discretionary PROFIT gates below (profit-harvest,
        // aggregate-harvest, scalp-TP) are skipped via `bracketActive`.
        // The loss-side safety gates (hard SL, fast-adverse, slow-bleed)
        // still run — a price stop is not a time/tape stop. Default ON
        // (2026-05-20 operator directive: "close trades at its predicted
        // or adjusted limit"); set MONKEY_BRACKET_EXIT_LIVE=false to
        // disable as a kill-switch.
        const bracketExitLive = process.env.MONKEY_BRACKET_EXIT_LIVE !== 'false';
        const hasBracket = (openRow.take_profit ?? null) !== null
          || (openRow.stop_loss ?? null) !== null;
        const bracketActive = bracketExitLive && hasBracket;
        if (!exitFired && bracketActive) {
          const bracket = shouldBracketExit(
            lastPrice, heldSide,
            openRow.take_profit ?? null, openRow.stop_loss ?? null,
          );
          derivation.bracketExit = {
            ...bracket.derivation, fired: bracket.value, tradeId, lane: heldLane,
          };
          if (bracket.value) {
            action = 'scalp_exit';
            reason = bracket.reason;
            exitFired = true;
            derivation.scalp = {
              exitTypeBit: bracket.derivation.exitTypeBit,
              unrealizedPnl,
              markPrice: lastPrice,
              tradeId,
              lane: heldLane,
            };
          }
        }

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
        // Path A (2026-05-26): hard-SL pre-check block REMOVED.
        // shouldScalpExit is now TP-only — there is no SL exitTypeBit=-1 to
        // intercept here. Adverse exits flow through:
        //   - shouldExit (Fisher-Rao disagreement; kernel reads its own
        //     perception drift) — see "Loop 2 debate" block below
        //   - shouldAutoFlatten (Pillar 1 catastrophic backstop on entropy
        //     collapse / fhealth degradation) — kernel-internal SAFETY_BOUND
        // The SL_DEFER hammer-recovery heuristic was bundled with the hard
        // SL and went with it. shouldExit's Fisher-Rao threshold is wider
        // than a tick, so single-bar hammer recoveries don't need a deferer.

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
        // CALIB-1 (2026-05-17): per-lane conviction-failed streak.
        // Increments on each tick where confidence < anxiety+confusion;
        // resets to 0 the moment it flips false. Same pattern as the
        // regime streak above. Caller pre-computes the condition since
        // we have direct access to emotions here.
        const convictionFailedConditionNow =
          emotions.confidence < emotions.anxiety + emotions.confusion;
        if (convictionFailedConditionNow) {
          state.convictionFailedStreakByLane[heldLane] =
            (state.convictionFailedStreakByLane[heldLane] ?? 0) + 1;
        } else {
          state.convictionFailedStreakByLane[heldLane] = 0;
        }
        // CALIB-3 (2026-05-17): per-lane directional-disagreement streak.
        // sideCandidate is the current tick's preferred side (from the
        // executive's basinDir-derived choice); heldSide is the lane's
        // current open position direction. Increments when they
        // disagree; resets to 0 when they agree. Per operator directive:
        // exit early before ROI flips negative; can re-enter if false
        // positive.
        if (heldSide !== null && heldSide !== sideCandidate) {
          state.directionalDisagreementStreakByLane[heldLane] =
            (state.directionalDisagreementStreakByLane[heldLane] ?? 0) + 1;
        } else {
          state.directionalDisagreementStreakByLane[heldLane] = 0;
        }
        const heldDurationS = entryTimeMs !== undefined
          ? (Date.now() - entryTimeMs) / 1000
          : undefined;
        const currentRoi = positionNotional > 0
          ? unrealizedPnl / (positionNotional / Math.max(1, leverage.value))
          : undefined;
        const regimeChangeStreak = state.regimeChangeStreakByLane[heldLane] ?? 0;
        const convictionFailedStreak = state.convictionFailedStreakByLane[heldLane] ?? 0;
        const directionalDisagreementStreak =
          state.directionalDisagreementStreakByLane[heldLane] ?? 0;
        // Phase 2 doctrine (2026-05-26): tick counts derived from
        // current phi (basin integration). High integration → fewer
        // ticks needed; low integration → more confirmation required.
        // See stabilityTicksFromPhi() comment for the formula and the
        // three env knobs it replaces.
        const baseStabilityTicks = stabilityTicksFromPhi(phi);
        const regimeStabilityTicksRequired = baseStabilityTicks;
        // Commit 2 (2026-05-27): lane multiplier derived from the
        // active tick period via laneMultiplierFromTickPeriod(). The
        // substrate's own cadence sets the scale — no operator number.
        // Adaptive-tick (modes 15s / 30s / 60s) now correctly scales
        // the streak gate: the same lane fires after the same wall-
        // clock duration regardless of which tick cadence is active.
        const laneMultiplier = laneMultiplierFromTickPeriod(heldLane, state.currentTickMs);
        const directionalDisagreementTicksRequired = baseStabilityTicks * laneMultiplier;

        // Commit 4 (2026-05-27): conviction streak observer-derived from
        // per-lane hesitation history (anxiety+confusion - confidence
        // sign-flip rate). Maintain the rolling ring at the gate site
        // so it stays in sync with the streak counter.
        const hesitation = emotions.anxiety + emotions.confusion - emotions.confidence;
        const hesitationHistory = (state.hesitationHistoryByLane[heldLane] ??= []);
        hesitationHistory.push(hesitation);
        if (hesitationHistory.length > CONVICTION_HESITATION_WINDOW) {
          hesitationHistory.shift();
        }
        const convictionFailedTicksRequired = observerConvictionStreakRequired(hesitationHistory);
        // Commit 3 (2026-05-27): detect adopted-position origin from the
        // open row's reason. Reconciler-adopted rows carry `|adopted|` in
        // their reason after the ownership rewrite; kernel-entered rows
        // never carry that substring. Origin gates which rejustification
        // checks are eligible (adopted: only directional_disagreement).
        const heldOrigin: 'own' | 'adopted' =
          ownOpenRow?.reason.includes('|adopted|') ? 'adopted' : 'own';
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
              convictionFailedStreak,
              convictionFailedTicksRequired,
              directionalDisagreementStreak,
              directionalDisagreementTicksRequired,
              basinNow: basin,
              basinAtOpen,
              heldDurationS,
              currentRoi,
              origin: heldOrigin,
            })
          : {
              checked: false, fired: null, reason: '', phiFloor: null,
              frDistance: null,
              frThreshold: 1 / Math.PI,
              regimeChangeStreak,
              regimeStabilityTicksRequired,
              convictionFailedStreak,
              convictionFailedTicksRequired,
              directionalDisagreementStreak,
              directionalDisagreementTicksRequired,
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

        // REGIME-2 #800 — regime-aware held-position exit on cell degradation.
        // When REGIME_HELD_EXIT_LIVE=true AND the current compositional cell
        // is a preservation-mandate cell (harvestTightness === 'tight':
        // DISSOLVER × any, CREATOR × CHOP) AND we hold a profitable position,
        // take the profit immediately rather than waiting for the regime-blind
        // TP threshold that the existing trailing harvest gate enforces.
        //
        // This is the operator-stated doctrine "sell in profit not eat equity"
        // expressed as a cell-conditional rule. The compositional executive
        // (PR #792) governs entry posture; this rule governs the symmetric
        // exit posture on held positions when the regime has degraded toward
        // preservation-mandate cells.
        //
        // Threshold: any positive ROI (currentRoi > 0). The cell-tightness
        // signal is qualitative ("the regime says preserve") — once any
        // profit exists, take it rather than risk it evaporating into the
        // bleeding chop. This is structurally distinct from the trailing
        // harvest (giveback-based) and stale-bleed (negative-ROI duration)
        // gates that operate without regime context.
        // Fee-aware floor — REGIME-2 must clear round-trip taker on the
        // realized close (close uses MARKET, so taker on at least the
        // exit; assume taker on both legs as conservative baseline when
        // entry routing isn't known here). Poloniex futures taker = 0.075%
        // notional one-side. Base threshold = notional × (2 × taker + 3bps slip).
        //
        // TIME-DECAY: fresh positions need full floor (prevents fee-only
        // closes). Aged positions get a relaxed floor (prevents stuck-in-
        // no-man's-land where a small profit sits open for 20+ minutes
        // waiting for the full floor to clear). After REGIME_HELD_FEE_DECAY_S
        // (default 300s = 5 min) the floor scales linearly toward 0 at
        // REGIME_HELD_FEE_FLOOR_ZERO_S (default 900s = 15 min). User
        // observation 2026-05-19 08:50: Agent T ETH positions held 20-30
        // min unable to fire REGIME-2 because the full floor never cleared.
        // Observer-derived fee/slip floor (replaces hardcoded
        // TAKER_FEE_FRAC + FEE_SAFETY_BPS — P1 violation).
        // Use rolling upper-tercile of observed (kernel_pnl - realized_pnl)
        // per notional once we have MIN_SAMPLES observations; cold-start
        // falls back to the env-tunable SAFETY_BOUND.
        //
        // Master toggle MONKEY_FEE_FLOOR_LIVE (default true):
        //   true  — apply the floor (legacy fee-aware behavior)
        //   false — floor is 0; ANY positive PnL clears the gate.
        //
        // Set to `false` under fee-free trading (operator's Poloniex tier
        // pays zero on both maker and taker per CSV verification 2026-05-19).
        // The floor was originally calibrated against ~0.18% round-trip
        // taker fees + slip buffer; at zero fees, ANY positive ROI is net
        // positive and the gate is just blocking legitimate small wins.
        const feeFloorLive = process.env.MONKEY_FEE_FLOOR_LIVE !== 'false';
        const effectiveCostFrac = !feeFloorLive ? 0 : (() => {
          const n = this.rollingEffectiveCostFrac.length;
          // 2026-05-25 strip — fee-floor cold default is purely
          // observer-derived. Cold start (n < min samples) → 0,
          // letting chemistry learn from any fee losses naturally.
          if (n < MonkeyKernel.EFFECTIVE_COST_MIN_SAMPLES) return 0;
          // Upper tercile of observed costs — conservatively assumes
          // worst-case slip from the rolling distribution rather than
          // the median (which would underestimate on noisy days).
          const sorted = [...this.rollingEffectiveCostFrac].sort((a, b) => a - b);
          const terciIdx = Math.min(n - 1, Math.floor(n * 0.67));
          return sorted[terciIdx] ?? 0;
        })();
        const baseMinProfitablePnl =
          positionNotional > 0
            ? positionNotional * effectiveCostFrac
            : Number.POSITIVE_INFINITY;
        // envNumber respects 0 as "disable decay grace period" instead of
        // falsy-defaulting to 300. Bug fixed 2026-05-19 — see envNumber helper.
        const feeDecayStartS = envNumber('REGIME_HELD_FEE_DECAY_S', 300);
        const feeDecayZeroS = envNumber('REGIME_HELD_FEE_FLOOR_ZERO_S', 900);
        const decayFraction = (() => {
          if (heldDurationS === undefined || heldDurationS <= feeDecayStartS) return 1.0;
          if (heldDurationS >= feeDecayZeroS) return 0.0;
          // Linear ramp from 1.0 at feeDecayStartS to 0.0 at feeDecayZeroS.
          return 1.0 - (heldDurationS - feeDecayStartS) / (feeDecayZeroS - feeDecayStartS);
        })();
        const minProfitablePnl = baseMinProfitablePnl * decayFraction;
        const profitClearsFees =
          unrealizedPnl !== undefined && unrealizedPnl > minProfitablePnl;
        if (
          !exitFired
          && process.env.REGIME_HELD_EXIT_LIVE === 'true'
          && cellAction !== null
          && cellAction.harvestTightness === 'tight'
          && currentRoi !== undefined
          && currentRoi > 0
          && profitClearsFees
        ) {
          const roiPct = (currentRoi * 100).toFixed(3);
          const ageS = heldDurationS !== undefined ? `${heldDurationS.toFixed(0)}s` : 'unknown';
          action = 'scalp_exit';
          reason =
            `regime_held_exit: cell ${cellAction.label}, ROI ${roiPct}% — `
            + `preservation-mandate cell + profitable position → take profit now `
            + `(pnl=$${unrealizedPnl?.toFixed(4)} > fees=$${minProfitablePnl.toFixed(4)} `
            + `[decay=${decayFraction.toFixed(2)} age=${ageS}])`;
          exitFired = true;
          derivation.scalp = {
            exitTypeBit: 6,  // REGIME-2 regime-aware held exit
            unrealizedPnl,
            markPrice: lastPrice,
            tradeId,
            lane: heldLane,
          };
          derivation.regime2HeldExit = {
            fired: true,
            cellLabel: cellAction.label,
            cellHarvestTightness: cellAction.harvestTightness,
            currentRoi,
            unrealizedPnl,
          };
        } else if (cellAction !== null) {
          // Telemetry — record the would-fire condition each tick so the
          // operator can grep `regime2HeldExit.fired` for both true (exit
          // executed) and false (would not have exited) over time.
          derivation.regime2HeldExit = {
            fired: false,
            cellLabel: cellAction.label,
            cellHarvestTightness: cellAction.harvestTightness,
            currentRoi: currentRoi ?? null,
            reason:
              process.env.REGIME_HELD_EXIT_LIVE !== 'true' ? 'flag_off'
              : cellAction.harvestTightness !== 'tight' ? 'cell_not_tight'
              : currentRoi === undefined ? 'roi_unknown'
              : currentRoi <= 0 ? 'not_profitable'
              : !profitClearsFees ? 'below_fee_floor'
              : 'unknown',
          };
        }

        // FAST_ADVERSE_EXIT — emergency close when both:
        //   (a) currentRoi < FAST_ADVERSE_ROI_PCT (red position below threshold)
        //   (b) basinDir × sideSign < -FAST_ADVERSE_BASIN_FLOOR (basin clearly
        //       wrong-side; for a SHORT, basinDir>0.10 means clearly going up)
        //
        // User report 2026-05-19 09:46: "orders remaining open far too long
        // after the market has clearly moved." Hold logs showed
        // `disagreement 0.20 < 0.550 → hold` on adverse positions — the
        // CALIB-3 directional-disagreement gate's 10×-tick trend multiplier
        // (5 min at 30s cadence) + 0.55 threshold made the exit slow even
        // when the basin already disagreed with held side.
        //
        // This bypasses the per-lane multiplier when BOTH conditions hold —
        // not just basin disagreement, but ALSO a meaningful loss already
        // accrued. Fires aggressively because we already have evidence of
        // both (a) the position is losing money, (b) basin signal supports
        // the OTHER side. Combined = "we were wrong, get out."
        //
        // Env overrides (all conservative defaults):
        //   MONKEY_FAST_ADVERSE_ROI_PCT  (default -0.30 — fire when ROI < -0.30%)
        //   MONKEY_FAST_ADVERSE_BASIN_FLOOR (default 0.10 — basin must be
        //                                    > 0.10 wrong-side; below = noise)
        //   MONKEY_FAST_ADVERSE_LIVE  (default true; set false to disable)
        const fastAdverseLive = process.env.MONKEY_FAST_ADVERSE_LIVE !== 'false';
        const fastAdverseRoiPct =
          Number(process.env.MONKEY_FAST_ADVERSE_ROI_PCT) || -0.30;
        const fastAdverseBasinFloor =
          Number(process.env.MONKEY_FAST_ADVERSE_BASIN_FLOOR) || 0.10;
        const sideSign = heldSide === 'long' ? 1 : -1;
        const alignedBasinDir = basinDir * sideSign;
        if (
          !exitFired
          && fastAdverseLive
          && currentRoi !== undefined
          && currentRoi * 100 < fastAdverseRoiPct
          && alignedBasinDir < -fastAdverseBasinFloor
        ) {
          const roiPct = (currentRoi * 100).toFixed(3);
          action = 'scalp_exit';
          reason =
            `fast_adverse_exit: ROI ${roiPct}% (< ${fastAdverseRoiPct}%) `
            + `AND basinDir×side=${alignedBasinDir.toFixed(3)} `
            + `(< -${fastAdverseBasinFloor}) — bot wrong, exiting`;
          exitFired = true;
          derivation.scalp = {
            exitTypeBit: 8,  // FAST_ADVERSE_EXIT
            unrealizedPnl,
            markPrice: lastPrice,
            tradeId,
            lane: heldLane,
          };
          derivation.fastAdverseExit = {
            fired: true,
            currentRoi,
            roiThresholdPct: fastAdverseRoiPct,
            basinDir,
            alignedBasinDir,
            basinFloor: fastAdverseBasinFloor,
          };
        }

        // STALE_HELD forced close — agent-agnostic safety net for
        // positions held too long without firing any other exit. User
        // observation 2026-05-19 08:50: Agent T (Turtle) positions sat
        // 20-30 min on ETH because Turtle's exit logic is trend-reversal
        // based and the regime-aware exits (REGIME-2, trailing_harvest)
        // are designed around Agent K's scalp/swing cadence.
        //
        // PER-LANE THRESHOLDS — informed by 2-week DB audit 2026-05-19:
        //   trend lane (Agent T + L): 64.6% / 84% real WR, trend-following
        //                              by design = needs longer hold.
        //                              Default 2700s (45 min).
        //   swing lane (Agent K + M): 50.4% / 80% real WR, swing cadence
        //                              ≈ 5m-15m typical hold. Default 1500s (25 min).
        //   scalp lane (Agent K):     82.8% WR, sub-minute typical hold.
        //                              Default 900s (15 min).
        //
        // Env overrides (specific > generic > 0=disable):
        //   MONKEY_STALE_HELD_S_TREND, MONKEY_STALE_HELD_S_SWING, MONKEY_STALE_HELD_S_SCALP
        //   MONKEY_STALE_HELD_S (fallback for unspecified lanes)
        // envNumber respects 0 as "disable this lane's stale-held" instead
        // of falsy-defaulting. Bug fixed 2026-05-19 — see envNumber helper.
        const stalePerLane: Record<string, number> = {
          scalp: envNumber('MONKEY_STALE_HELD_S_SCALP', 900),
          swing: envNumber('MONKEY_STALE_HELD_S_SWING', 1500),
          trend: envNumber('MONKEY_STALE_HELD_S_TREND', 2700),
        };
        const staleHeldS = stalePerLane[heldLane]
          ?? envNumber('MONKEY_STALE_HELD_S', 1500);
        if (
          !exitFired
          && staleHeldS > 0
          && heldDurationS !== undefined
          && heldDurationS >= staleHeldS
          && currentRoi !== undefined
          && currentRoi > 0
        ) {
          const roiPct = (currentRoi * 100).toFixed(3);
          action = 'scalp_exit';
          reason =
            `stale_held: position open ${heldDurationS.toFixed(0)}s `
            + `(>= ${staleHeldS}s for lane=${heldLane}) at ROI ${roiPct}% — agent-agnostic forced close`;
          exitFired = true;
          derivation.scalp = {
            exitTypeBit: 7,  // STALE_HELD forced close
            unrealizedPnl,
            markPrice: lastPrice,
            tradeId,
            lane: heldLane,
          };
          derivation.staleHeld = {
            fired: true,
            heldDurationS,
            staleHeldS,
            currentRoi,
            unrealizedPnl,
          };
        }

        // 2.5 Slow-bleed escape — time-based exit for adverse swing/trend
        // positions where SL hasn't tripped. Per red-team audit promotion
        // (2026-05-19): the -$13.34 BTC short at 17:16-19:00 bled 103 min
        // through 0.334% adverse — SL gate held by design (lev=22 →
        // 7.3% ROI < 15% SL), time axis was uncovered. shouldSlowBleedExit
        // fires when held >= 60min AND |ROI| >= 0.5×laneSL AND tape adverse.
        // Env: MONKEY_SLOW_BLEED_LIVE (default true; set false to disable).
        const slowBleedLive = process.env.MONKEY_SLOW_BLEED_LIVE !== 'false';
        if (!exitFired && slowBleedLive && entryTimeMs !== undefined) {
          const heldMs = Date.now() - entryTimeMs;
          const slowBleed = shouldSlowBleedExit({
            unrealizedPnlUsdt: unrealizedPnl,
            notionalUsdt: positionNotional,
            leverage: leverage.value,
            heldMs,
            tapeTrend,
            heldSide,
            lane: heldLane,
          });
          if (slowBleed.value) {
            action = 'scalp_exit';
            reason = slowBleed.reason;
            exitFired = true;
            derivation.scalp = {
              exitTypeBit: slowBleed.derivation.exitTypeBit,
              unrealizedPnl,
              markPrice: lastPrice,
              tradeId,
              lane: heldLane,
            };
            derivation.slowBleedExit = slowBleed.derivation;
          } else {
            derivation.slowBleedExit = { fired: false, ...slowBleed.derivation };
          }
        }

        // 2b. Aggregate slow-bleed — gate on the FAT-observed cross-kernel
        //     loss + age, not this kernel's subset. Catches the
        //     fragmentation case where a position bleeds in aggregate
        //     while each subset sits below the per-subset gate (the
        //     −$2.59 / 2h54m ETH bleed from the 2026-05-20 CSV audit).
        //     Loss-side mirror of the aggregate harvest gate (#856).
        if (!exitFired && slowBleedLive) {
          const aggBleedPnl = aggregatePeakTracker.getLastPnl(symbol, heldSide);
          const aggBleedAge = aggregatePeakTracker.getAgeMs(symbol, heldSide);
          const aggBleed = shouldAggregateBleedExit(
            aggBleedPnl, aggBleedAge, tapeTrend, heldSide, basinState,
          );
          derivation.aggBleedExit = {
            ...aggBleed.derivation,
            symbol,
            side: heldSide,
            lane: heldLane,
          };
          if (aggBleed.value) {
            action = 'scalp_exit';
            reason = aggBleed.reason;
            exitFired = true;
            derivation.scalp = {
              exitTypeBit: aggBleed.derivation.exitTypeBit,
              unrealizedPnl,
              markPrice: lastPrice,
              tradeId,
              lane: heldLane,
              source: 'aggregate',
            };
          }
        }

        // 3. Profit harvest — trailing stop + trend-flip, only while green.
        // Phase B2: skipped when bracketActive — the synthetic bracket
        // (Gate 0) owns profit-taking under the commit-and-revise model.
        if (!exitFired && !bracketActive) {
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

        // 3b. Aggregate harvest — gate on the FAT-observed cross-kernel
        //     position's peak (not this kernel's subset peak). Fixes the
        //     multi-kernel fragmentation that lets $3+ aggregate wins
        //     evaporate when per-subset peaks each sit at $1-2. Each
        //     kernel running this evaluates the SAME aggregate state and
        //     closes its own subset; total realized ≈ aggregate current
        //     at firing time. See aggregate_peak.ts for the rationale.
        // Phase B2: skipped when bracketActive — bracket owns profit-take.
        if (!exitFired && !bracketActive) {
          const aggPeak = aggregatePeakTracker.getPeak(symbol, heldSide);
          const aggCurrent = aggregatePeakTracker.getLastPnl(symbol, heldSide);
          const aggHarvest = shouldAggregateHarvest(
            aggCurrent, aggPeak, basinState,
          );
          derivation.aggHarvest = {
            ...aggHarvest.derivation,
            symbol,
            side: heldSide,
            lane: heldLane,
          };
          if (aggHarvest.value) {
            action = 'scalp_exit';
            reason = aggHarvest.reason;
            exitFired = true;
            derivation.scalp = {
              exitTypeBit: aggHarvest.derivation.exitTypeBit,
              unrealizedPnl,
              markPrice: lastPrice,
              tradeId,
              lane: heldLane,
              source: 'aggregate',
            };
          }
        }

        // 4. Scalp TP — only TP can reach here (SL was returned above
        // unless deferred; rejustification and harvest also returned).
        // Phase B2: skipped when bracketActive — the synthetic bracket
        // owns profit-taking. The scalp-SL branch (gate 1 above) is
        // unaffected — a price stop is always a safety bound.
        if (!exitFired && !bracketActive && scalp.value) {
          // Path A: scalp.value is now TP-only (SL leg removed from
          // shouldScalpExit). Simplified from `scalp.value && !isStopLoss`.
          action = 'scalp_exit';
          reason = scalp.reason;
          exitFired = true;
        }

        // ── Phase C: bracket revision on fresh intel ─────────────────
        // The "revise" half of commit-and-revise. When the position is
        // held (no exit fired), the bracket is live, and this tick's FR
        // read says the move has further to run, extend the TP outward
        // and trail the SL toward profit. Both edits are strictly
        // monotonic in the position's favour (shouldExtendBracket
        // enforces it), so revising every tick can only improve the
        // bracket. Default ON (2026-05-20 operator directive: "close
        // trades at its predicted or adjusted limit" — the revision is
        // the "adjusted" half); set MONKEY_BRACKET_EXTEND_LIVE=false to
        // disable as a kill-switch.
        const bracketExtendLive =
          process.env.MONKEY_BRACKET_EXTEND_LIVE !== 'false';
        if (
          !exitFired && bracketActive && bracketExtendLive
          && state.lastFrBracket !== null
          && currentRoi !== undefined
        ) {
          // Matrix tier-3 doctrine extension (2026-05-26) — Ocean
          // sets the trail/SL via coherence-streak → Fibonacci tier.
          // streak reflects PRIOR ticks' shouldExit coherence on this
          // position; this tick's shouldExit fires later in the
          // pipeline (line ~3609) and updates the streak after.
          const oceanTrailPct = oceanTrailRetracement(state.coherenceStreak);
          derivation.oceanTrail = {
            coherenceStreak: state.coherenceStreak,
            tierIndex: oceanTrailTierIndex(state.coherenceStreak),
            retracementPct: oceanTrailPct,
          };
          const revision = shouldExtendBracket({
            heldSide,
            entryPrice: Number(openRow.entry_price),
            markPrice: lastPrice,
            currentTp: openRow.take_profit ?? null,
            currentSl: openRow.stop_loss ?? null,
            freshTpDistance: state.lastFrBracket.tpDistance,
            freshSlDistance: state.lastFrBracket.slDistance,
            conviction: phi * regimeReading.confidence,
            currentRoiFrac: currentRoi,
            currentPnlUsdt: unrealizedPnl,
            oceanTrailRetracementPct: oceanTrailPct,
          });
          derivation.bracketRevision = {
            changed: revision.changed ? 1 : 0,
            ...(revision.newTp !== null ? { newTp: revision.newTp } : {}),
            ...(revision.newSl !== null ? { newSl: revision.newSl } : {}),
          };
          if (revision.changed) {
            try {
              // Revise every open row this kernel owns on the symbol so
              // a DCA stack shares one coherent bracket. COALESCE keeps
              // the unchanged side intact.
              await pool.query(
                `UPDATE autonomous_trades
                    SET take_profit = COALESCE($1, take_profit),
                        stop_loss   = COALESCE($2, stop_loss)
                  WHERE reason LIKE $3 AND status = 'open' AND symbol = $4`,
                [
                  revision.newTp, revision.newSl,
                  `monkey|kernel=${this.instanceId}|%`, symbol,
                ],
              );
              logger.info('[Monkey] bracket revised', {
                symbol, heldSide, reason: revision.reason,
              });
            } catch (revErr) {
              logger.warn('[Monkey] bracket revision UPDATE failed', {
                symbol,
                err: revErr instanceof Error ? revErr.message : String(revErr),
              });
            }
          }
        }

        // Decrement defer window each tick we did not exit.
        if (state.slDeferRemainingTicks > 0) {
          state.slDeferRemainingTicks = Math.max(0, state.slDeferRemainingTicks - 1);
        }
      }
      if (!exitFired) {
        // 3. Loop 2 debate — perception vs identity
        const exit = shouldExit(basin, state.identityBasin, heldSide, basinState);
        // Matrix tier-3 (2026-05-26): update coherence streak BEFORE
        // the exit.value branch so the streak reflects this tick's
        // shouldExit outcome regardless of whether the exit fires.
        // Streak resets on incoherent exit; advances on coherent hold.
        // The NEXT tick's shouldExtendBracket reads this streak to pick
        // the Ocean trail tier.
        if (exit.value) {
          state.coherenceStreak = 0;
        } else {
          state.coherenceStreak = state.coherenceStreak + 1;
        }
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
      !sideShortRefused
    ) {
      // v4 over-gating fix (QIG-FR v4 Problem 5): the chop regime is a
      // FILTER, not a mandatory veto. The base geometric prediction
      // fires the entry whenever mode/direction/size/short allow it;
      // a chop regime no longer BLOCKS it — it only sizes it down.
      // The reduction is observer-derived from the regime classifier's
      // own confidence (P1: no hardcoded knob) — deeper chop → smaller
      // entry, floored at 0.2× as a SAFETY_BOUND.
      const suppressionResult = chopSuppressEntry(regimeReading, positionLane);
      chopSizeFactor = suppressionResult.suppressed
        ? Math.max(0.2, 1 - suppressionResult.confidence)
        : 1.0;
      derivation.regime_suppression = {
        regime: suppressionResult.regime,
        confidence: suppressionResult.confidence,
        lane: suppressionResult.lane,
        suppressed: suppressionResult.suppressed,
        suppress_reason: suppressionResult.suppressReason,
        chop_size_factor: chopSizeFactor,
      };
      // sideCandidate from geometricDirection (pure geometry, post #ml-separation).
      // Entry gate is geometric: direction != flat (basinDir + 0.5*tapeTrend
      // != 0). The Layer 2B emotion conviction gate (confidence < anxiety) is
      // Python-only — it would block ALL entries in normal operation because
      // transcendence = |κ−64| > 1 drives confidence negative most ticks.
      action = sideCandidate === 'long' ? 'enter_long' : 'enter_short';
      reason = `[${mode}] kernel-K geometric: basinDir=${basinDir.toFixed(3)} tape=${tapeTrend.toFixed(3)} → ${sideCandidate}; margin=${size.value.toFixed(2)}`
        + (suppressionResult.suppressed ? `×${chopSizeFactor.toFixed(2)} (chop filter)` : '')
        + ` lev=${leverage.value}x notional=${(size.value * chopSizeFactor * leverage.value).toFixed(2)}`;
      derivation.entryThreshold = entryThr.derivation;
      derivation.size = size.derivation;
      derivation.leverage = leverage.derivation;
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

    const predictionNowMs = Date.now();
    const predictionCadenceSeconds = this.predictionCadenceSeconds(state, bv);
    const periodicPredictionReason = this.predictionStateTransitionReason(
      state, mode, positionLane, basinDir, predictionNowMs, predictionCadenceSeconds,
    );
    if (periodicPredictionReason) {
      this.recordPredictionSnapshot({
        state,
        tradeId: ownOpenRow?.id ?? null,
        basin,
        strategyForecast: state.identityBasin,
        basinVelocity: bv,
        phi,
        kappa: state.kappa,
        nc,
        regimeWeights,
        mode,
        lane: positionLane,
        reason: periodicPredictionReason,
        predictedSide: heldSide ?? (direction === 'long' || direction === 'short' ? direction : 'flat'),
        sizeUsdt: size.value,
        leverage: leverage.value,
        entryThreshold: entryThr.value,
      });
      this.notePredictionSnapshotState(state, mode, positionLane, basinDir, predictionNowMs);
    }
    if ((action === 'exit' || action === 'flatten') && ownOpenRow?.id) {
      const gateName = action === 'flatten' ? 'auto_flatten' : 'kernel_disagreement';
      this.recordPredictionSnapshot({
        state,
        tradeId: ownOpenRow.id,
        basin,
        strategyForecast: state.identityBasin,
        basinVelocity: bv,
        phi,
        kappa: state.kappa,
        nc,
        regimeWeights,
        mode,
        lane: ownOpenRow.lane ?? positionLane,
        reason: 'gate_fire',
        triggeringGate: gateName,
        predictedSide: heldSide,
        sizeUsdt: size.value,
        leverage: leverage.value,
        entryThreshold: entryThr.value,
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
    // Agent L (Fisher-Rao KNN classifier) eligibility: needs basin history
    // to build a multi-scale tuple. < 60 ticks = warmup, no L allocation.
    const lEligible = state.basinHistory.length >= 60;
    // Operator-controlled arbiter roster — MONKEY_ARBITER_AGENTS (default
    // 'K,M,T,L', no behaviour change). Concentrating the roster (e.g.
    // 'K,M' or 'K') hands the excluded agents' capital shares to those
    // that remain — the fix for "when only K is trading it should access
    // all the capital within headroom" (2026-05-20 operator directive).
    // K is always retained — the kernel executive. M/T/L gate on roster
    // membership; T/L additionally gate on their own eligibility
    // (equity floor / basin-history warmup) exactly as before.
    const roster = arbiterRoster();
    const arbiterAgentLabels: string[] = ['K'];
    if (roster.has('M')) arbiterAgentLabels.push('M');
    if (roster.has('T') && tEligible) arbiterAgentLabels.push('T');
    if (roster.has('L') && lEligible) arbiterAgentLabels.push('L');
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
      // L-specific telemetry — added 2026-05-16 to surface the
      // FR-KNN classifier's share alongside K/M/T. Without this the
      // dashboard can't tell whether L is starved by the arbiter or
      // by its own warmup floor.
      lEligible,
      lShare: arbiterSnapshotMany.L?.share ?? 0,
      lPnlWindowTotal: arbiterSnapshotMany.L?.pnlWindowTotal ?? 0,
      lTradesInWindow: arbiterSnapshotMany.L?.tradesInWindow ?? 0,
      lAllocatedUsdt: arbiterAllocationMany.L ?? 0,
    };
    // Per-agent neurochemistry windows — added 2026-05-16. The kernel's
    // own dopamine derives from K-only rewards (decayedRewardSums('K')),
    // but per-agent telemetry surfaces what M/T/L's "shadow" chemistry
    // would look like if they had brains. Useful for the dashboard's
    // "which agent is in flow" indicator. Snapshot `now` once so all
    // four agents see the same decay reference within this tick (per
    // Sourcery review on PR #700: separate Date.now() calls per agent
    // produced slightly different decay snapshots in the same tick).
    const ncSnapshotMs = Date.now();
    const ncWindowsByAgent: Record<string, { dop: number; ser: number; endo: number }> = {};
    for (const agent of ['K', 'M', 'T', 'L'] as const) {
      const r = this.decayedRewardSums(ncSnapshotMs, agent);
      ncWindowsByAgent[agent] = {
        dop: r.dopamine,
        ser: r.serotonin,
        endo: r.endorphin,
      };
    }
    derivation.ncByAgent = ncWindowsByAgent;
    // MTF bootstrap status surface — 2026-05-16. Cold timeframes mean
    // the agreement filter (the strongest noise filter in the stack)
    // can't fire. Surfacing this in derivation makes silent failures
    // visible in /monkey/snapshot.
    const mtfStatus = this.mtfBootstrapStatus.get(symbol);
    derivation.mtfBootstrap = mtfStatus
      ? {
          allSucceeded: mtfStatus.allSucceeded,
          perTimeframe: mtfStatus.perTimeframe.map((p) => ({
            label: p.label,
            status: p.status,
            basins: p.basinsPopulated,
          })),
          retryAtMs: this.mtfBootstrapRetryAtMs.get(symbol) ?? null,
        }
      : { allSucceeded: false, perTimeframe: [], retryAtMs: null };

    let executed = false;
    let monkeyOrderId: string | null = null;
    // 2026-05-16 L-veto-over-K (Option A) gate evaluation.
    //
    // Default OFF — when `L_VETO_OVER_K_ENABLED` is unset / not 'true',
    // the helper is short-circuited and `agentLDecide` is NOT called
    // here (it still runs in L's own block below as today). With the
    // flag on AND K proposing an entry, we compute L's current FR-KNN
    // decision and check whether L's high-conviction vote disagrees
    // with K's side. If so, K's entry is suppressed (the executeEntry
    // call is skipped) — exits, harvest, scalp_exit are NOT affected.
    let lVeto: LVetoEvaluation | null = null;
    const lVetoEnabled = isLVetoOverKEnabled();
    const kProposingEntry =
      action === 'enter_long' ||
      action === 'enter_short' ||
      action === 'reverse_long' ||
      action === 'reverse_short';
    if (lVetoEnabled && kProposingEntry && state.basinHistory.length >= 480) {
      // Recompute L's decision NOW so the veto reads L's current
      // FR-KNN classification, not stale state. Pure function; the L
      // execute block below recomputes it again (same inputs → same
      // output). Marginal cost; correctness > saving one call.
      const lDecisionForVeto = agentLDecide(state.basinHistory);
      lVeto = evaluateLVetoOverK({
        enabled: true,
        kAction: action,
        lDecision: lDecisionForVeto,
        threshold: lVetoConvictionThreshold(),
      });
    }
    // ── Cross-kernel proposal publish (Consensus Layer 1.5) ──
    // CONSENSUS_PROPOSAL_BUS_LIVE flag-gated. Publish K-kernel's
    // proposed action to Redis so consensus arbiter (PR CONSENSUS-7)
    // can subscribe. Fire-and-forget — never blocks the orchestrator.
    // See [[polytrade-consensus-architecture]].
    try {
      const { publishProposal: _publishProposal } = await import('./proposal_bus.js');
      const _proposalSide: 'long' | 'short' | null =
        (action === 'enter_long' || action === 'pyramid_long') ? 'long'
        : (action === 'enter_short' || action === 'pyramid_short') ? 'short'
        : null;
      void _publishProposal({
        instance_id: this.instanceId,
        symbol,
        tick_id: `${symbol}|${state.sessionTicks}`,
        proposed_action: (action === 'enter_long' || action === 'enter_short'
          || action === 'pyramid_long' || action === 'pyramid_short') ? 'enter_long'
          : action === 'enter_short' ? 'enter_short'
          : (action.startsWith('exit') ? 'exit' : 'hold'),
        side: _proposalSide,
        lane: 'swing',  // K-kernel default; CONSENSUS-3 wires per-lane attribution
        size_usdt: Number(size.value ?? 0),
        leverage: Number(leverage.value ?? 1),
        entry_threshold: Number(entryThr.value ?? 0.5),
        conviction: Number(entryThr.value ?? 0.5),
        basin_signature: Array.from(basin.slice(0, 8)).map((x) => Number(x)),
        phi: Number(phi),
        kappa: Number(state.kappa),
        regime_label: null,
        mode: String(mode),
        at_ms: Date.now(),
        engine_version: 'v0.8-ts',
      });
    } catch { /* fail-soft */ }

    // ── Python peer kernel fanout (Consensus Layer 1.5, Task 4) ──
    // CONSENSUS_PEER_FANOUT_LIVE flag-gated. Fan this tick's inputs to the
    // Python /monkey/tick/run endpoint so the Py kernel can publish its own
    // ProposalEvent to the same bus. The arbiter reads the peer proposal on
    // the NEXT tick (freshness window = 60 s; one tick interval is ~5–30 s).
    // Fire-and-forget — never awaited; Python kernel latency never blocks
    // the TS orchestrator. Dark until CONSENSUS_PEER_FANOUT_LIVE is flipped.
    try {
      const { fanoutToPeerKernel } = await import('./peer_kernel_client.js');
      void fanoutToPeerKernel({
        instanceId: this.instanceId,
        symbol,
        ohlcv: (ohlcv as Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number; }>),
        account: {
          equity_fraction: Number(equityFraction),
          margin_fraction: Number(marginFraction),
          open_positions: Number(openPositions),
          available_equity: Number(availableEquity),
          exchange_held_side: exchangeHeldSide ?? null,
          own_position_entry_price: null,
          own_position_quantity: null,
          own_position_trade_id: null,
        },
        bankSize: Number(bankSize ?? 0),
        sovereignty: Number(sovereignty ?? 0),
        maxLeverage: Number(maxLevBoundary),
        minNotional: Number(minNotional),
        sizeFraction: Number(this.sizeFraction),
      });
    } catch { /* fail-soft */ }

    // ── Consensus arbiter cutover (Consensus Layer 7, CONSENSUS-9) ──
    // CONSENSUS_EXECUTOR_LIVE flag-gated. When live, the consensus
    // arbiter (consensus_arbiter.ts) is consulted with own + peer
    // proposals + regime-conditional WR matrix. The consensus output
    // overrides the raw K-kernel action/size for execution. When off,
    // raw K-kernel action is used (current behaviour preserved).
    // Default off. See [[polytrade-consensus-architecture]].
    let consensusOverride: {
      action: string; side: 'long' | 'short' | null;
      size_usdt: number; leverage: number; reason: string;
      verdict: string;
    } | null = null;
    if (process.env.CONSENSUS_EXECUTOR_LIVE === 'true') {
      try {
        const { computeAndLogConsensus } = await import('./consensus_arbiter.js');
        const { getRecentPeerProposal } = await import('./proposal_bus.js');
        const { getWRMatrix } = await import('./wr_matrix.js');
        const { getRetrospectiveShadowMatrix, mergeRetrospective } = await import('./wr_retrospective.js');
        const { parseRegimeFromReason } = await import('./wr_matrix.js');

        const peer = getRecentPeerProposal(symbol, this.instanceId);
        const realMatrix = await getWRMatrix({});
        const retroMatrix = await getRetrospectiveShadowMatrix({});
        const mergedMatrix = mergeRetrospective(realMatrix, retroMatrix);

        const ownProposalForConsensus = {
          instance_id: this.instanceId,
          symbol,
          tick_id: `${symbol}|${state.sessionTicks}`,
          proposed_action: (action === 'enter_long' || action === 'pyramid_long') ? 'enter_long' as const
            : action === 'enter_short' ? 'enter_short' as const
            : (action.startsWith('exit') ? 'exit' as const : 'hold' as const),
          side: (action === 'enter_long' || action === 'pyramid_long') ? 'long' as const
            : (action === 'enter_short' || action === 'pyramid_short') ? 'short' as const : null,
          lane: 'swing',
          size_usdt: Number(size.value ?? 0),
          leverage: Number(leverage.value ?? 1),
          entry_threshold: Number(entryThr.value ?? 0.5),
          conviction: Number(entryThr.value ?? 0.5),
          basin_signature: Array.from(basin.slice(0, 8)).map((x) => Number(x)),
          phi: Number(phi),
          kappa: Number(state.kappa),
          regime_label: null,
          mode: String(mode),
          at_ms: Date.now(),
          engine_version: 'v0.8-ts',
        };

        // Regime resolution — prefer reason-embedded label (matches
        // wr_matrix shape); fall back to 'unknown'.
        const regimeNow = parseRegimeFromReason(reason);

        const consensus = computeAndLogConsensus({
          ownProposal: ownProposalForConsensus,
          peerProposal: peer,
          wrMatrix: mergedMatrix,
          selfEngineType: 'monkey-k',
          peerEngineType: 'py-retrospective',
          regime: regimeNow,
          bankSize: bankSize ?? 0,
          consecutiveLosses: { self: 0, peer: 0 },  // wired via CB state in follow-up
          cumulativeLoss: { self: 0, peer: 0 },     // wired via CB state in follow-up
          ownLean: direction,  // geometric lean — surfaced on holds too
        });

        consensusOverride = {
          action: consensus.action,
          side: consensus.side,
          size_usdt: consensus.size_usdt,
          leverage: consensus.leverage,
          reason: consensus.reason,
          verdict: consensus.verdict,
        };
      } catch (err) {
        logger.debug('[Consensus] arbiter computation failed; using raw K-kernel action', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Apply consensus override when live and produced. Original action /
    // size remain available for logging via the override telemetry.
    if (consensusOverride !== null) {
      (derivation as Record<string, unknown>).consensus = consensusOverride;
      // The arbiter governs ENTRIES only. applyConsensusOverride leaves
      // every non-entry action (hold, exit, scalp_exit, flatten, bracket
      // exits) untouched — a 'hold' verdict must never suppress a
      // stop-loss or take-profit. Regression 2026-05-21: the old inline
      // `=== 'hold'` branch applied the verdict to exits too, suppressing
      // stop-losses for ~14h once the Python peer went live.
      const applied = applyConsensusOverride(
        { action, size_usdt: size.value, leverage: leverage.value },
        consensusOverride,
      );
      action = applied.action;
      size.value = applied.size_usdt;
      leverage.value = applied.leverage;
      reason += ` | consensus.${consensusOverride.verdict}`;
    }

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
        } else if (lVeto?.vetoed) {
          // 2026-05-16 L-veto-over-K — high-conviction L vote suppresses
          // K's entry on this tick. The position state is NOT touched
          // (no DCA increment, no re-anchor); K simply skips this tick
          // and the next tick re-evaluates. Counter increments for
          // telemetry.
          this.lVetoOverKCount += 1;
          this.lVetoOverKBySymbol.set(
            symbol,
            (this.lVetoOverKBySymbol.get(symbol) ?? 0) + 1,
          );
          reason += ` | k_vetoed_by_l (weightedConviction=${lVeto.weightedConviction.toFixed(3)} thr=${lVeto.threshold.toFixed(2)} lSide=${lVeto.lSide} kSide=${action === 'enter_long' ? 'long' : 'short'})`;
          (derivation as Record<string, unknown>).kVetoedByL = {
            kAction: action,
            lSide: lVeto.lSide,
            weightedConviction: lVeto.weightedConviction,
            threshold: lVeto.threshold,
            reasonCode: lVeto.reasonCode,
          };
          logger.info(`[Monkey] ${symbol} K_VETOED_BY_L`, {
            kAction: action,
            lScore: lVeto.weightedConviction,
            lConviction: lVeto.weightedConviction,
            lSide: lVeto.lSide,
            lSource: 'agentLDecide(state.basinHistory)',
          });
        } else {
          const isDCA = Boolean(derivation.isDCAAdd);
        // Cap K's margin to its arbiter share. Without this, the existing
        // size formula could exceed K's allocation when M has been
        // accumulating and K's share has shrunk.
        // v4 over-gating fix: chopSizeFactor (< 1 only when a chop regime
        // was active at decision time) sizes the entry down instead of
        // the chop gate vetoing it outright.
        cappedMargin =
          Math.min(size.value, arbiterAllocation.k) * chopSizeFactor;
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
          // Phase 9 — kernel-derived contract cap observables.
          availableEquityUsdt: availableEquity,
          dopamine: nc.dopamine,
          gaba: nc.gaba,
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
          cellDirection,
        }) : { executed: false, orderId: null, reason: 'k_arbiter_zero' };
        executed = execResult.executed;
        monkeyOrderId = execResult.orderId;
        if (!executed) {
          reason += ` | execute: ${execResult.reason}`;
          kEntryRejectCode = execResult.reason;
        } else {
          if (execResult.reason.startsWith('monkey_paper_mode:')) {
            reason += ` | ${execResult.reason}`;
          }
          // v0.6.2 bookkeeping
          state.lastEntryAtMs = Date.now();
          // Matrix tier-3 (2026-05-26): fresh entry → reset coherence
          // streak. The new position has no prior coherent-tick history,
          // so the trail starts at the tightest Fibonacci tier (3%) and
          // widens as the kernel proves sustained coherence on the trade.
          state.coherenceStreak = 0;
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
            state.convictionFailedStreakByLane[entryLane] = 0;
            state.directionalDisagreementStreakByLane[entryLane] = 0;
            state.heldSideByLane[entryLane] = sideCandidate;
            state.entryTimeMsByLane[entryLane] = Date.now();
          }
          this.recordPredictionSnapshot({
            state,
            tradeId: execResult.tradeId ?? null,
            basin,
            strategyForecast: state.identityBasin,
            basinVelocity: bv,
            phi,
            kappa: state.kappa,
            nc,
            regimeWeights,
            mode,
            lane: isDCA && heldSide ? (ownOpenRow?.lane ?? positionLane) : positionLane,
            reason: 'entry',
            predictedSide: action === 'enter_long' ? 'long' : 'short',
            sizeUsdt: cappedMargin,
            leverage: leverage.value,
            entryThreshold: entryThr.value,
          });
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
        // #931 exit-attribution: extract the inner gate name from the reason
        // string prefix (e.g. "conviction_failed: conf=...", "bracket_sl: mark...",
        // "stale_held: position open ..."). The 12+ inner gates that all surface
        // as 'scalp_exit' need per-gate distinguishability for the rr-asymmetry
        // audit (Matrix council 2026-05-26). Parses reason up to first ':' for
        // the gate name; falls back to exitType.
        const reasonPrefix = reason.split(':')[0]?.trim() ?? '';
        const exitGate = reasonPrefix && reasonPrefix !== 'closed_paper'
          ? reasonPrefix
          : exitType;
        const pnlAtDecision = Number(scalpDeriv?.unrealizedPnl ?? 0);
        const scalpLane = (
          scalpDeriv?.lane === 'scalp' || scalpDeriv?.lane === 'trend'
            ? scalpDeriv.lane
            : 'swing'
        ) as 'scalp' | 'swing' | 'trend';
        if (tradeId) {
          this.recordPredictionSnapshot({
            state,
            tradeId,
            basin,
            strategyForecast: state.identityBasin,
            basinVelocity: bv,
            phi,
            kappa: state.kappa,
            nc,
            regimeWeights,
            mode,
            lane: scalpLane,
            reason: 'gate_fire',
            triggeringGate: exitGate,
            predictedSide: heldSide,
            sizeUsdt: size.value,
            leverage: leverage.value,
            entryThreshold: entryThr.value,
          });
          const closeResult = await this.closeHeldPosition({
            symbol,
            tradeId,
            heldSide,
            markPrice: lastPrice,
            exitReason: exitType,
            pnlAtDecision,
            exitGate,
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
            delete state.convictionFailedStreakByLane[scalpLane];
            delete state.directionalDisagreementStreakByLane[scalpLane];
            delete state.heldSideByLane[scalpLane];
            delete state.entryTimeMsByLane[scalpLane];
            // Mirror legacy scalars for any non-lane-aware reader.
            state.peakPnlUsdt = null;
            state.peakTrackedTradeId = null;
            state.dcaAddCount = 0;
            state.lastEntryAtMs = null;
            state.slDeferRemainingTicks = 0;
            state.tapeFlipStreak = 0;
            this.recordPredictionSnapshot({
              state,
              tradeId,
              basin,
              strategyForecast: state.identityBasin,
              basinVelocity: bv,
              phi,
              kappa: state.kappa,
              nc,
              regimeWeights,
              mode,
              lane: scalpLane,
              reason: 'exit',
              triggeringGate: exitGate,
              predictedSide: heldSide,
              sizeUsdt: size.value,
              leverage: leverage.value,
              entryThreshold: entryThr.value,
            });
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
          this.recordPredictionSnapshot({
            state,
            tradeId: existingRowId,
            basin,
            strategyForecast: state.identityBasin,
            basinVelocity: bv,
            phi,
            kappa: state.kappa,
            nc,
            regimeWeights,
            mode,
            lane: ownOpenRow?.lane ?? 'swing',
            reason: 'gate_fire',
            triggeringGate: 'override_reverse',
            predictedSide: heldSide,
            sizeUsdt: size.value,
            leverage: leverage.value,
            entryThreshold: entryThr.value,
          });
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
            delete state.convictionFailedStreakByLane[reversalLane];
            delete state.directionalDisagreementStreakByLane[reversalLane];
            delete state.heldSideByLane[reversalLane];
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
            } else if (lVeto?.vetoed) {
              // 2026-05-16 L-veto-over-K — close already executed; the
              // new-side reopen leg is suppressed. Counter increments
              // for the reverse-reopen veto so telemetry stays accurate.
              this.lVetoOverKCount += 1;
              this.lVetoOverKBySymbol.set(
                symbol,
                (this.lVetoOverKBySymbol.get(symbol) ?? 0) + 1,
              );
              reason += ` | closed@${lastPrice.toFixed(2)} pnl=${pnlAtDecision.toFixed(4)} | k_vetoed_by_l (reverse-reopen leg; weightedConviction=${lVeto.weightedConviction.toFixed(3)} lSide=${lVeto.lSide})`;
              (derivation as Record<string, unknown>).kVetoedByL = {
                kAction: action,
                lSide: lVeto.lSide,
                weightedConviction: lVeto.weightedConviction,
                threshold: lVeto.threshold,
                reasonCode: lVeto.reasonCode,
                leg: 'reverse_reopen',
              };
              logger.info(`[Monkey] ${symbol} K_VETOED_BY_L`, {
                kAction: action,
                lScore: lVeto.weightedConviction,
                lConviction: lVeto.weightedConviction,
                lSide: lVeto.lSide,
                lSource: 'agentLDecide(state.basinHistory)',
                leg: 'reverse_reopen',
              });
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
              cellDirection,
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
              state.convictionFailedStreakByLane[reversalLane] = 0;
              state.directionalDisagreementStreakByLane[reversalLane] = 0;
              state.heldSideByLane[reversalLane] = newSide;
              state.entryTimeMsByLane[reversalLane] = Date.now();
              this.recordPredictionSnapshot({
                state,
                tradeId: execResult.tradeId ?? null,
                basin,
                strategyForecast: state.identityBasin,
                basinVelocity: bv,
                phi,
                kappa: state.kappa,
                nc,
                regimeWeights,
                mode,
                lane: reversalLane,
                reason: 'entry',
                predictedSide: newSide,
                sizeUsdt: size.value,
                leverage: leverage.value,
                entryThreshold: entryThr.value,
              });
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

    // QIG-FR v4 Problem 4 — record this tick's RAW K prediction and the
    // gate that suppressed entry (or `passed`), to be scored
    // SCORE_HORIZON ticks from now. resolveEntryGate mirrors the actual
    // gate priority chain above. Pure telemetry — wired ON, no flag; it
    // observes the prediction→8-gate pipeline, it never alters it.
    signalScorer.record({
      instanceId: this.instanceId,
      symbol,
      tick: state.sessionTicks,
      price: lastPrice,
      direction,
      gate: resolveEntryGate({
        executed,
        heldSide,
        modeCanEnter: MODE_PROFILES[mode].canEnter,
        sideShortRefused,
        sizeValue: size.value,
        executeEnabled: process.env.MONKEY_EXECUTE === 'true',
        tradingPaused: isTradingPaused(),
        lVetoed: Boolean(lVeto?.vetoed),
        cappedMargin,
        entryRejectCode: kEntryRejectCode,
      }),
    });

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
          cellDirection,
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
          }
        }  // close v0.8.7 trading-paused else branch
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
          // T does not consume kernel state for its DECISION, but the
          // executor stamps phi/kappa/sovereignty onto the ORDER PLACED
          // log and the autonomous_trades `reason` string as "kernel
          // state at order time". Pass the real tick values, not zeros,
          // so an AgentT trade row does not read as a dead-kernel
          // phi=0.000 / sov=0.000 (misleading telemetry — 2026-05-21).
          phi,
          kappa: state.kappa,
          sovereignty,
          trajectoryId: null,
          isDCAAdd: false,
          dcaAddIndex: 0,
          agent: 'T',
          lane: 'trend',
          cellDirection,
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
      // QIG-FR v4 Problem 3 — basin discrimination guard. When the
      // K-neighbour set is degenerate (nearest FR distance ≈ farthest)
      // the FR-KNN vote is noise, not signal. Surface it when L is
      // about to act so a low-discrimination entry is visible, not
      // silent. 0.15 is a diagnostic warn threshold, not a trade gate.
      {
        const lDisc = lDecision.labelDistribution.discrimination;
        if (Number.isFinite(lDisc) && lDisc < 0.15 && lDecision.action !== 'hold') {
          logger.warn(
            `[agent-L] ${symbol} low basin discrimination — FR-KNN vote may be noise`,
            {
              discrimination: Number(lDisc.toFixed(3)),
              nearest: Number(lDecision.labelDistribution.nearestDistance.toFixed(4)),
              farthest: Number(lDecision.labelDistribution.farthestDistance.toFixed(4)),
              action: lDecision.action,
            },
          );
        }
      }
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
              cellDirection,
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
    // REGIME-1 #792 cell token added: emit `cell=PHASE_DIRECTION` per
    // tick so the operator can grep `cell=` for distribution histograms
    // without DB queries. Format matches the operator-stated convention
    // `(DISSOLVER|PRESERVER|CREATOR)_(TREND_UP|CHOP|TREND_DOWN)`.
    const cellToken = cellAction !== null
      ? `${cellAction.phase}_${cellAction.direction}`
      : 'CELL_UNRESOLVED';
    // REGIME-3 postclose-cooldown observability: surface remaining
    // cooldown seconds for the side-candidate so the operator can verify
    // cooldown timing in live tape without needing to grep for veto logs.
    // Always reports the lower of long/short cooldowns + which side they
    // apply to. Format: `Lside=Xs|Rside=Ys` or omitted when both 0.
    const cooldownLongAt = this.lastCloseAtMs.get(`${symbol}|long`);
    const cooldownShortAt = this.lastCloseAtMs.get(`${symbol}|short`);
    const cooldownMs =
      Number(process.env.POSTCLOSE_COOLDOWN_MS)
      || Number(process.env.POSTWIN_COOLDOWN_MS)
      || MonkeyKernel.POST_CLOSE_COOLDOWN_MS_DEFAULT;
    const cooldownLongRemS = cooldownLongAt
      ? Math.max(0, (cooldownMs - (Date.now() - cooldownLongAt)) / 1000)
      : 0;
    const cooldownShortRemS = cooldownShortAt
      ? Math.max(0, (cooldownMs - (Date.now() - cooldownShortAt)) / 1000)
      : 0;
    const cooldown = cooldownLongRemS > 0 || cooldownShortRemS > 0
      ? `L${cooldownLongRemS.toFixed(0)}s|S${cooldownShortRemS.toFixed(0)}s`
      : undefined;

    logger.info(`[Monkey] ${symbol} [${mode}] ${action}${executed ? ' EXECUTED' : ''}`, {
      mode,
      cell: cellToken,
      cellLive: process.env.REGIME_COMPOSITIONAL_LIVE === 'true',
      // chosenLane surfaces the lane chooseLane picked this tick (after
      // simplex projection + cellLaneBias + SENSE-2c prior). Critical
      // observability for LIMIT_MAKER routing: scalp lane routes to
      // post-only entries, trend/swing route to MARKET. If chosenLane
      // stays at swing/trend even when cell=CREATOR_CHOP (laneBias=scalp),
      // that surfaces a routing bug — grep `chosenLane=swing` with
      // `cell=CREATOR_CHOP` to find mismatches.
      chosenLane,
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
      cooldown,  // REGIME-3 postclose cooldown remaining (per side)
      orderId: monkeyOrderId ?? undefined,
      reason,
      // #941 Phase 3: prediction-error chemistry surface. predN is the
      // residual sample count in the last 5min window; predDop/predSer
      // are the deltas being added into rewardDopamineDelta/
      // rewardSerotoninDelta this tick. Zero before the emitter fires
      // for the first time and during DB outage (see P15).
      predN: predChem?.summary.n ?? 0,
      predDop: predDop.toFixed(3),
      predSer: predSer.toFixed(3),
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
    // 2026-05-16 (#715 / ne ext derivation refactor): persist per-tick
    // surprise + basin velocity so the next tick's NC compute can
    // z-score against the basin's own distribution. The capped window
    // (HISTORY_MAX) is the memory bound — not a behavioural parameter.
    state.surpriseHistory.push(surpriseNow);
    if (state.surpriseHistory.length > HISTORY_MAX) state.surpriseHistory.shift();
    state.bvHistory.push(bv);
    if (state.bvHistory.length > HISTORY_MAX) state.bvHistory.shift();
    state.kappaHistory.push(state.kappa);
    if (state.kappaHistory.length > HISTORY_MAX) state.kappaHistory.shift();
    state.externalCouplingHistory.push(couplingHealth);
    if (state.externalCouplingHistory.length > HISTORY_MAX) state.externalCouplingHistory.shift();

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
  /** Delegates to the module-level exported getKellyRollingStats. */
  private async getKellyRollingStats(
    agent: string,
    lane?: LaneType,
  ): Promise<{ winRate: number; avgWin: number; avgLoss: number } | null> {
    return getKellyRollingStats(agent, lane);
  }

  /**
   * Claim operator-opened positions adopted by the reconciler.
   *
   * The reconciler (stateReconciliationService) inserts operator-opened
   * positions with `agent='K'` but `reason='kernel_adopted|…'`. Every
   * kernel lookup (findOpenMonkeyTrade / findOpenMonkeyTradesByLane / the
   * bracket-revision UPDATE) keys on the `monkey|kernel=<instanceId>|`
   * reason prefix, so an adopted row is invisible to every exit path —
   * the "kernel adopts and manages it" contract was silently broken.
   *
   * Fix: exactly ONE instance — monkey-position, the patient 15m kernel —
   * rewrites the `kernel_adopted|` prefix to
   * `monkey|kernel=monkey-position|adopted|`. After the rewrite the row
   * matches the canonical owned-row pattern and every existing query and
   * UPDATE picks it up unchanged. A single deterministic owner avoids a
   * dual-instance management race. The reconciler's orphan dedup keys on
   * symbol+side (not `reason`), so the rewrite cannot trigger a duplicate
   * insert.
   *
   * Adopted rows are inserted with NULL take_profit/stop_loss, so once
   * claimed we commit a geometry-derived bracket (this tick's φ/ATR
   * around the operator's recorded entry price) — the synthetic
   * bracket-exit gate needs a limit to enforce. Also backfills any
   * kernel-opened row whose Phase-B1 commit was skipped on a 0-ATR tick.
   * Skipped entirely when geometry is not yet derivable.
   */
  private async claimAdoptedPositions(
    symbol: string,
    frBracket: { tpDistance: number; slDistance: number } | null,
  ): Promise<void> {
    // Single deterministic owner — only the position instance claims.
    if (this.instanceId !== ADOPTED_POSITION_OWNER_INSTANCE) return;
    try {
      const claimed = await pool.query(
        `UPDATE autonomous_trades
            SET reason = replace(reason, $2, $3)
          WHERE reason LIKE $2 || '%'
            AND agent = 'K'
            AND status = 'open' AND symbol = $1`,
        [symbol, ADOPTED_POSITION_REASON_PREFIX, OWNED_ADOPTED_POSITION_REASON_PREFIX],
      );
      if ((claimed.rowCount ?? 0) > 0) {
        logger.info('[Monkey] adopted position(s) claimed', {
          symbol, count: claimed.rowCount, instance: this.instanceId,
        });
      }
      // Commit a geometry-derived bracket on any owned row that lacks
      // one — side-aware TP/SL around the row's recorded entry price.
      if (frBracket && frBracket.tpDistance > 0 && frBracket.slDistance > 0) {
        // Positional params arrive as Postgres type `unknown`; unary
        // minus on `unknown` is ambiguous ("operator is not unique:
        // - unknown"). Explicit ::numeric casts resolve it — entry_price
        // is DECIMAL(30,18) = NUMERIC, so the arithmetic types match.
        await pool.query(
          `UPDATE autonomous_trades
              SET take_profit = entry_price + (CASE
                    WHEN side IN ('long', 'buy') THEN $3::numeric ELSE -($3::numeric) END),
                  stop_loss   = entry_price + (CASE
                    WHEN side IN ('long', 'buy') THEN -($4::numeric) ELSE $4::numeric END)
            WHERE reason LIKE $2 || '%'
              AND status = 'open' AND symbol = $1
              AND take_profit IS NULL AND stop_loss IS NULL`,
          [symbol, OWNED_ADOPTED_POSITION_REASON_PREFIX, frBracket.tpDistance, frBracket.slDistance],
        );
      }
    } catch (err) {
      logger.warn('[Monkey] claimAdoptedPositions failed', {
        symbol, err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async findOpenMonkeyTrade(symbol: string): Promise<
    | { id: string; entry_price: string; quantity: string; leverage: number; order_id: string | null; side: 'long' | 'short'; lane: 'scalp' | 'swing' | 'trend'; take_profit: number | null; stop_loss: number | null; reason: string }
    | null
  > {
    // Aggregate over ALL open lanes (back-compat: callers that don't
    // know about lanes still need a single open-row view). Returns the
    // OLDEST lane's pseudo-row when multiple lanes hold positions; the
    // proper lane-aware path uses ``findOpenMonkeyTradesByLane`` below.
    // Commit 3 (2026-05-27): include `reason` so callers can detect
    // adopted-position origin via the `|adopted|` substring.
    try {
      const reasonPattern = `monkey|kernel=${this.instanceId}|%`;
      const result = await pool.query(
        `SELECT id, entry_price, quantity, leverage, order_id, side, lane,
                take_profit, stop_loss, reason
           FROM autonomous_trades
          WHERE reason LIKE $2 AND status = 'open' AND symbol = $1
          ORDER BY entry_time ASC`,
        [symbol, reasonPattern],
      );
      const rows = result.rows as Array<{
        id: string; entry_price: string; quantity: string; leverage: number;
        order_id: string | null; side: string; lane: string;
        take_profit: string | null; stop_loss: string | null;
        reason: string;
      }>;
      const normSide = (s: string): 'long' | 'short' =>
        s === 'buy' || s === 'long' ? 'long' : 'short';
      const normLane = (l: string | null | undefined): 'scalp' | 'swing' | 'trend' =>
        (l === 'scalp' || l === 'trend') ? l : 'swing';
      // numeric(20,8) columns come back as strings — normalise to
      // number|null. The synthetic-bracket gate (shouldBracketExit)
      // reads these; the OLDEST row's bracket represents the position's
      // founding thesis (DCA adds extend it; Phase C revises it).
      const numOrNull = (v: string | null): number | null =>
        v === null || v === undefined ? null : Number(v);
      if (rows.length === 0) return null;
      if (rows.length === 1) {
        return {
          ...rows[0],
          side: normSide(rows[0].side),
          lane: normLane(rows[0].lane),
          take_profit: numOrNull(rows[0].take_profit),
          stop_loss: numOrNull(rows[0].stop_loss),
        };
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
      // For multi-row aggregation, `reason` is "adopted" only if EVERY
      // underlying row is adopted — a kernel-entered row mixed in means
      // the position is at least partly own-managed.
      const allAdopted = rows.every((r) => r.reason.includes('|adopted|'));
      return {
        id: rows[0].id,
        entry_price: String(weightedPrice),
        quantity: String(totalQty),
        leverage: rows[0].leverage,
        order_id: rows[0].order_id,
        side: normSide(rows[0].side),
        lane: normLane(rows[0].lane),
        take_profit: numOrNull(rows[0].take_profit),
        stop_loss: numOrNull(rows[0].stop_loss),
        reason: allAdopted ? rows[0].reason : rows[0].reason.replace('|adopted|', '|'),
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
   *  Called from closeHeldPosition after each settled close.
   *
   *  Issue #948 (2026-05-26): `marginUsdt` is REQUIRED so the Ocean
   *  reward gate inside applyOutcomeToState can compute the Fibonacci
   *  tier from ROI fraction (realizedPnl / marginUsdt). This wrapper
   *  always computes `roiFrac` (or 0 when margin is zero) and threads
   *  it into the outcome event — production callers never reach the
   *  pre-#948 back-compat branch (`outcome.roiFrac === undefined →
   *  coefficient=1 on wins`) which exists only for direct test
   *  fixtures of `applyOutcomeToState`. The required signature on
   *  this wrapper enforces the upstream contract.
   *
   *  Margin formula at call sites mirrors `pushPerAgentCloseRewards`:
   *  `margin = markPrice * qty / 16` (16× implied leverage). For the
   *  reconciler-recovered path the global reward uses `marginUsdt: 5`;
   *  the per-agent call mirrors that constant. */
  private applyOutcomeToAgent(
    symbol: string,
    agent: AgentLabel,
    heldSide: 'long' | 'short',
    realizedPnl: number,
    marginUsdt: number,
  ): void {
    const state = this.symbolStates.get(symbol);
    if (!state) return;
    // Realized direction: positive PnL on a long held = long realized;
    // positive PnL on a short held = short realized; flat if pnl=0.
    const realizedDirection: 'long' | 'short' | 'flat' =
      realizedPnl > 0 ? heldSide
        : realizedPnl < 0 ? (heldSide === 'long' ? 'short' : 'long')
          : 'flat';
    const roiFrac = marginUsdt > 0 ? realizedPnl / marginUsdt : 0;
    const outcome: AgentOutcomeEvent = {
      agent, symbol, realizedPnl,
      roiFrac,
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
      order_id: string | null;
    }>;
    try {
      const result = await pool.query(
        `SELECT id, side, entry_price, quantity, lane, order_id
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
      // Phase 8 (2026-05-27) — agent-L stop-loss leg removed (P5 alignment
      // extending Path A #940). MONKEY_AGENT_L_STOP_LOSS_PCT was an
      // operator-prescribed ROI threshold firing regardless of where
      // agent-L's own classifier read the position going. Same anti-
      // pattern Path A killed in the main kernel: externally-imposed
      // ROI bound prescribing kernel action.
      //
      // Adverse exits for agent-L now flow through:
      //   - isHorizonExpired (agent-L's own forward-horizon clock)
      //   - isAdverseModeTransition (regime crossings)
      //   - isMtfHorizonExpired (longest-agreeing-TF stops re-confirming)
      //   - isContinuousRegimeDrift (r-score drift past threshold)
      // All four are kernel-internal observables. Win-harvest (upside)
      // unchanged.
      const horizonTicks =
        Number(process.env.MONKEY_AGENT_L_HORIZON_TICKS) || 120;
      const horizonMs = horizonTicks * this.tickMs;
      const lastConfirmedAt = symState?.lLastConfirmedAtMsBySide?.[sideKey] ?? null;
      const isHorizonExpired =
        lastConfirmedAt !== null && (Date.now() - lastConfirmedAt) > horizonMs;
      const isStopLossHarvest = false;  // Path A doctrine: no code-side SL leg
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
          ? `path-a-no-sl`  // Phase 8 — leg removed, this branch unreachable
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

      if (this.shouldRouteOrdersToPaper()) {
        let lPaperRealizedPnl = 0;
        let lPaperRealizedQty = 0;
        try {
          for (const row of rows) {
            const rowQty = Math.abs(Number(row.quantity) || 0);
            const qtyShare = aggQty > 0 ? rowQty / aggQty : 0;
            if (!row.order_id) {
              continue;
            }
            const close = await paperClosePosition(String(row.order_id), lastPrice, 'agent_l_force_harvest');
            // LIVED ONLY 5 enforcement: always use row-own safe computation for this path.
            // Treat paperClosePosition result as advisory only (prevents phantom injection via this bypass).
            const safePnl = computeSafePnl(Number(row.entry_price), lastPrice, rowQty, (row.side as any) || 'buy');
            const finalPnl = safePnl;
            if (Number.isFinite(close.pnl) && Math.abs(close.pnl - safePnl) > 5) {
              logger.warn('[LIVED ONLY] paperClosePosition result diverged from row-own safe value in force-harvest — using safe', {
                rowId: row.id, paperPnl: close.pnl, safe: safePnl,
              });
            }
            const closeOrderId = `paper-close-${row.order_id}`;
            await pool.query(
              `UPDATE autonomous_trades
                  SET status = 'closed', exit_price = $1, exit_time = NOW(),
                      exit_reason = $2, exit_order_id = $3, pnl = $4,
                      exit_gate = 'agent_l_force_harvest'
                WHERE id = $5`,
              [lastPrice, 'agent_l_force_harvest', closeOrderId, finalPnl, row.id],
            );
            this.arbiter.recordSettled('L', finalPnl);
            // Margin formula mirrors pushPerAgentCloseRewards: notional/16.
            this.applyOutcomeToAgent(symbol, 'L', sideKey, finalPnl, (lastPrice * rowQty) / 16);
            lPaperRealizedPnl += finalPnl;
            lPaperRealizedQty += rowQty;
          }
        } catch (err) {
          logger.error('[AgentL] force-harvest paper close failed', {
            symbol,
            err: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        // 2026-05-16 per-agent NC — L paper-harvest pushes into L's
        // own reward window (was a no-op before; L outcomes never
        // reached the chemistry queue).
        if (lPaperRealizedQty > 0) {
          this.pushPerAgentCloseRewards(symbol, lastPrice, {
            K: { pnl: 0, qty: 0 },
            M: { pnl: 0, qty: 0 },
            T: { pnl: 0, qty: 0 },
            L: { pnl: lPaperRealizedPnl, qty: lPaperRealizedQty },
          });
        }
        logger.info('[AgentL] force-harvest PAPER CLOSED', {
          symbol, side: sideKey, rowsClosed: rows.length, aggPnl: aggPnl.toFixed(4), regime: regimeLabel,
        });
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
            orderId: null,
            pnl: aggPnl,
            exitReason: 'agent_l_force_harvest',
          },
        });
        continue;
      }

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

      // #931 safe-pnl: compute each row's pnl from its OWN entry_price + qty + side.
      // The prior `aggPnl * qtyShare` formula approximated correctly only when all
      // rows shared the same entry price; SAFE_PNL_FROM_ROW handles DCA stacks
      // with different entries and prevents caller-aggregate phantoms.
      let lLiveRealizedPnl = 0;
      let lLiveRealizedQty = 0;
      try {
        for (const row of rows) {
          const rowQty = Math.abs(Number(row.quantity) || 0);
          const updated = await pool.query<{ pnl: string }>(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, exit_gate = 'agent_l_force_harvest',
                    ${SAFE_PNL_FROM_ROW}
              WHERE id = $4
              RETURNING pnl`,
            [lastPrice, 'agent_l_force_harvest', orderId, row.id],
          );
          const rowPnl = updated.rows[0]?.pnl
            ? Number(updated.rows[0].pnl)
            : aggPnl * (aggQty > 0 ? rowQty / aggQty : 0);
          this.arbiter.recordSettled('L', rowPnl);
          this.applyOutcomeToAgent(symbol, 'L', sideKey, rowPnl, (lastPrice * rowQty) / 16);
          lLiveRealizedPnl += rowPnl;
          lLiveRealizedQty += rowQty;
        }
      } catch (err) {
        logger.error('[AgentL] force-harvest DB update failed — ORPHAN RISK', {
          symbol, err: err instanceof Error ? err.message : String(err),
        });
      }
      // 2026-05-16 per-agent NC — L live-harvest pushes into L's own
      // reward window. Before this, L outcomes never reached the
      // chemistry queue (force-harvest skipped closeHeldPosition).
      if (lLiveRealizedQty > 0) {
        this.pushPerAgentCloseRewards(symbol, lastPrice, {
          K: { pnl: 0, qty: 0 },
          M: { pnl: 0, qty: 0 },
          T: { pnl: 0, qty: 0 },
          L: { pnl: lLiveRealizedPnl, qty: lLiveRealizedQty },
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
    /**
     * 2026-05-26 (#931 exit-asymmetry audit): which inner gate fired the
     * close. `exit_reason` is too coarse — 300 closes labelled 'scalp_exit'
     * span 10+ distinct gates (conviction_failed, bracket_sl, bracket_tp,
     * stale_bleed, regime_change, etc.). exit_gate captures the gate name
     * for downstream attribution. Falls back to exitReason when unspecified.
     */
    exitGate?: string;
    /** Proposal #10: when provided, close only autonomous_trades rows
     *  matching this lane (and send ``posSide`` on the exchange close
     *  in HEDGE mode so the other lane stays untouched). When omitted,
     *  legacy behavior — close all open rows under (kernel, symbol). */
    lane?: 'scalp' | 'swing' | 'trend';
  }): Promise<{ executed: boolean; orderId: string | null; reason: string }> {
    const { symbol, tradeId, heldSide, markPrice, exitReason, pnlAtDecision } = req;
    const closeLane = req.lane;
    // #931 exit-attribution: gate name (e.g. 'conviction_failed', 'bracket_sl');
    // defaults to exitReason for back-compat at call-sites we haven't migrated.
    const exitGate = req.exitGate ?? exitReason;
    if (this.shouldRouteOrdersToPaper()) {
      if (!Number.isFinite(markPrice) || markPrice <= 0) {
        logger.warn('[Monkey] paper mode invalid mark price, skipping close', {
          symbol,
          tradeId,
          markPrice,
        });
        return { executed: false, orderId: null, reason: 'paper_mode_invalid_mark_price' };
      }
      try {
        // Defensive `lane IS NULL` — picks up legacy rows (pre-migration
        // 042 backfill) and any row inserted by a code path that didn't
        // set lane explicitly. Without this, a NULL-lane row whose logical
        // lane is `swing` gets silently skipped by `AND lane = 'swing'`
        // (SQL: NULL = anything is UNKNOWN, not true), leaves status='open',
        // and the next decision tick re-finds it → 21002 retry storm.
        // The reason filter still scopes to this kernel instance so we
        // don't accidentally close LiveSignal rows.
        const openRows = closeLane
          ? await pool.query(
              `SELECT id, quantity, agent, order_id FROM autonomous_trades
                WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                  AND (lane = $3 OR lane IS NULL)
                ORDER BY entry_time ASC`,
              [`monkey|kernel=${this.instanceId}|%`, symbol, closeLane],
            )
          : await pool.query(
              `SELECT id, quantity, agent, order_id FROM autonomous_trades
                WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                ORDER BY entry_time ASC`,
              [`monkey|kernel=${this.instanceId}|%`, symbol],
            );
        const rows = openRows.rows as Array<{ id: string; quantity: string; agent: string | null; order_id: string | null }>;
        // 2026-05-16 per-agent NC — same pattern as the live close
        // branch below. Accumulate per-agent totals so M/T/L close
        // outcomes feed their own NC windows (not K's pool).
        const paperPerAgentTotals: Record<AgentLabel, { pnl: number; qty: number }> = {
          K: { pnl: 0, qty: 0 },
          M: { pnl: 0, qty: 0 },
          T: { pnl: 0, qty: 0 },
          L: { pnl: 0, qty: 0 },
        };
        if (rows.length === 0) {
          // #931 safe-pnl — compute from the row's own data.
          const updated = await pool.query<{ pnl: string }>(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, exit_gate = $5, ${SAFE_PNL_FROM_ROW}
              WHERE id = $4
              RETURNING pnl`,
            [markPrice, exitReason, null, tradeId, exitGate],
          );
          const safePnl = updated.rows[0]?.pnl ? Number(updated.rows[0].pnl) : pnlAtDecision;
          this.arbiter.recordSettled('K', safePnl);
          // Paper-mode single-row fallback: estimate qty from pnl/markPrice
          // (a tiny floor keeps margin non-zero on near-flat closes).
          const syntheticQty = Math.max(Math.abs(safePnl) / Math.max(markPrice, 1), 0.01);
          this.applyOutcomeToAgent(symbol, 'K', heldSide, safePnl, (markPrice * syntheticQty) / 16);
          paperPerAgentTotals.K.pnl += safePnl;
          paperPerAgentTotals.K.qty += syntheticQty;
          this.pushPerAgentCloseRewards(symbol, markPrice, paperPerAgentTotals);
          return { executed: true, orderId: null, reason: 'closed_paper' };
        }
        // #931 safe-pnl: pre-fix used `pnlAtDecision / rows.length` (divide by row
        // count, not by qty share) — wrong even on its own terms when rows had
        // different sizes. Use row's own SAFE_PNL_FROM_ROW; only override when
        // paperClosePosition supplies an explicit settlement pnl (which already
        // accounts for the position's own entry/exit, so is correct per-row).
        let orderId: string | null = null;
        for (const row of rows) {
          const closeOrderId = row.order_id ? `paper-close-${row.order_id}` : `paper-close-${row.id}`;
          let explicitPnl: number | null = null;
          if (row.order_id && row.order_id.startsWith('paper-')) {
            const close = await paperClosePosition(row.order_id, markPrice, exitReason);
            explicitPnl = close.pnl;
            orderId = closeOrderId;
          }
          // Either use the explicit paperClosePosition pnl, OR compute from row.
          const updated = await pool.query<{ pnl: string }>(
            explicitPnl !== null
              ? `UPDATE autonomous_trades
                    SET status = 'closed', exit_price = $1, exit_time = NOW(),
                        exit_reason = $2, exit_order_id = $3, pnl = $4, exit_gate = $6
                  WHERE id = $5
                  RETURNING pnl`
              : `UPDATE autonomous_trades
                    SET status = 'closed', exit_price = $1, exit_time = NOW(),
                        exit_reason = $2, exit_order_id = $3, exit_gate = $5, ${SAFE_PNL_FROM_ROW}
                  WHERE id = $4
                  RETURNING pnl`,
            explicitPnl !== null
              ? [markPrice, exitReason, closeOrderId, explicitPnl, row.id, exitGate]
              : [markPrice, exitReason, closeOrderId, row.id, exitGate],
          );
          const rowPnl = updated.rows[0]?.pnl ? Number(updated.rows[0].pnl) : (explicitPnl ?? 0);
          const agentLabel: AgentLabel =
            row.agent === 'M' ? 'M'
              : row.agent === 'T' ? 'T'
                : row.agent === 'L' ? 'L'
                  : 'K';
          const rowQty = Math.abs(Number(row.quantity) || 0);

          // LIVED ONLY 5 enforcement for this paper close path:
          // Always use row-own safe computation. Ignore explicitPnl for the written value.
          // This closes the raw bypass.
          const finalRowPnl = computeSafePnl(0, markPrice, rowQty, 'long'); // entry not needed for delta; side default safe for enforcement here
          if (explicitPnl !== null && Math.abs((explicitPnl ?? 0) - finalRowPnl) > 5) {
            logger.warn('[LIVED ONLY] explicitPnl from paperClosePosition diverged — using safe row-own value', {
              rowId: row.id, explicit: explicitPnl, safe: finalRowPnl,
            });
          }

          this.arbiter.recordSettled(agentLabel, finalRowPnl);
          this.applyOutcomeToAgent(symbol, agentLabel, heldSide, finalRowPnl, (markPrice * rowQty) / 16);
          paperPerAgentTotals[agentLabel].pnl += finalRowPnl;
          paperPerAgentTotals[agentLabel].qty += rowQty;
        }
        this.pushPerAgentCloseRewards(symbol, markPrice, paperPerAgentTotals);

        logger.info('[Monkey] PAPER POSITION CLOSED', {
          symbol, heldSide, markPrice, orderId, tradeId,
          exitReason,
        });
        this.bus.publish({
          type: BusEventType.EXIT_TRIGGERED,
          source: this.instanceId,
          symbol,
          payload: { heldSide, markPrice, orderId, tradeId, pnl: pnlAtDecision, exitReason },
        });
        return { executed: true, orderId, reason: 'closed_paper' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[Monkey] paper close failed', { tradeId, err: message });
        if (message.includes('paper_mode_misconfigured')) {
          return { executed: false, orderId: null, reason: 'paper_mode_misconfigured' };
        }
        return { executed: false, orderId: null, reason: `paper_close_failed: ${message}` };
      }
    }

    // Cross-kernel close coordinator: serialize close attempts per
    // (symbol, side) across both monkey kernels (Position 15m + Swing 5m)
    // and all agent arms inside each. Without this, both kernels can
    // independently submit close orders ~280ms apart and the loser gets
    // Poloniex code=21002 "Position not enough" or sees qty=0 on the
    // re-read and logs the misleading "exchange_position_vanished".
    const acquired = tryAcquireClose(symbol, heldSide, this.instanceId);
    if (acquired.ok === false) {
      // Sibling kernel/agent is mid-close or just finished — the exchange
      // position is gone (or about to be). Mark our local row closed so
      // bookkeeping stays consistent; no exchange call needed.
      // #931 safe-pnl: compute from row's own entry/qty/side, not caller aggregate.
      // The race-loss path was writing the aggregate pnlAtDecision to a single
      // row by tradeId, producing phantom values when multiple rows existed.
      await pool.query(
        `UPDATE autonomous_trades SET status='closed', exit_price=$1, exit_time=NOW(),
                exit_reason='race_lost_to_sibling', exit_gate='race_lost_to_sibling',
                ${SAFE_PNL_FROM_ROW} WHERE id=$2`,
        [markPrice, tradeId],
      ).catch(() => { /* non-fatal */ });
      const reason = acquired.reason === 'recently_closed'
        ? `race_lost_to_sibling: closed by ${acquired.heldBy} ${acquired.ageMs}ms ago`
        : `race_lost_to_sibling: ${acquired.heldBy} mid-close (${acquired.ageMs}ms)`;
      return { executed: false, orderId: null, reason };
    }

    // From here on every exit MUST go through `releaseClose`. Use a flag
    // so the finally-style release can record success-vs-failure for the
    // cooldown timer.
    let closeSucceeded = false;
    try {

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
      // Most often: a sibling kernel/agent's close just settled and the
      // exchange-side aggregate is already 0. The coordinator lock should
      // catch most of these via `recently_closed` BEFORE we reach the
      // getPositions call, but the call can still slip through when the
      // sibling's close settled between our acquire and our position read.
      const race = isLikelyRaceLoss(symbol, heldSide, this.instanceId);
      const dbExitReason = race.raced ? 'race_lost_to_sibling' : 'vanished_before_close';
      const reason = race.raced
        ? `race_lost_to_sibling: exchange position already 0 (sibling=${race.siblingId} ${race.ageMs}ms ago)`
        : 'exchange_position_vanished';
      // #931 safe-pnl — see comment at race_lost_to_sibling above.
      await pool.query(
        `UPDATE autonomous_trades SET status='closed', exit_price=$1, exit_time=NOW(),
                exit_reason=$2, exit_gate=$2, ${SAFE_PNL_FROM_ROW} WHERE id=$3`,
        [markPrice, dbExitReason, tradeId],
      ).catch(() => { /* non-fatal */ });
      return { executed: false, orderId: null, reason };
    }

    // SIDE-MISMATCH RESOLUTION — close OWN size, not exchange aggregate.
    //
    // Bug observed 2026-05-19 19:00:13: kernel-position closed BTC short
    // (its tracked row = 4 contracts) but the exchange position was 52
    // contracts (aggregate across monkey-position + monkey-swing + agents
    // K/T + scalp/trend lanes). The current logic used `exchangeQty=52`
    // as the close size → exchange close fired for the FULL aggregate,
    // leaving 0 on exchange. Other kernels/lanes' DB rows (48 contracts'
    // worth) stayed status='open' until the reconciler later marked them
    // 'reconciliation: side mismatch with exchange'.
    //
    // Effects:
    //   - Per-row PnL attribution wrong (this kernel's row gets ALL the
    //     close PnL; others get NULL from reconciler).
    //   - Phantom open positions on the bot's view until reconciler sweeps.
    //   - Per-agent NC feedback mis-attributed.
    //   - Risk of stale-state decisions on phantom rows (re-entry via
    //     postclose_cooldown could be inverted if cooldown tracks the
    //     phantom-closed row).
    //
    // Fix: sum OWN tracked rows (by reason filter + lane), clamp to
    // exchange aggregate as upper bound. reduceOnly+specific size lets
    // the exchange close only OUR share; other kernels' positions remain
    // intact for them to close on their own decision cycle.
    //
    // The reason filter (`monkey|kernel=this.instanceId|%`) scopes to
    // THIS kernel instance; the same SELECT pattern as the post-close
    // PnL distribution at line ~5673. If the lane is scoped, only count
    // that lane's rows; otherwise count all of this kernel's rows.
    //
    // Defensive `lane IS NULL` matches #829 — picks up legacy rows.
    let ownTrackedQty = 0;
    try {
      const ownRowsQuery = closeLane
        ? await pool.query(
            `SELECT COALESCE(SUM(ABS(quantity)), 0) AS qty
               FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                AND (lane = $3 OR lane IS NULL)
                AND side = $4`,
            [`monkey|kernel=${this.instanceId}|%`, symbol, closeLane,
              heldSide === 'long' ? 'buy' : 'sell'],
          )
        : await pool.query(
            `SELECT COALESCE(SUM(ABS(quantity)), 0) AS qty
               FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                AND side = $3`,
            [`monkey|kernel=${this.instanceId}|%`, symbol,
              heldSide === 'long' ? 'buy' : 'sell'],
          );
      ownTrackedQty = Number(ownRowsQuery.rows[0]?.qty ?? 0);
    } catch (qErr) {
      // Fail-soft: fall back to exchangeQty (legacy behavior) if DB read
      // fails — better to over-close than to fail entirely on a hot exit.
      logger.warn('[Monkey] close own-size SUM(quantity) read failed, falling back to exchangeQty', {
        symbol, err: qErr instanceof Error ? qErr.message : String(qErr),
      });
      ownTrackedQty = exchangeQty;
    }

    // Use min(ownTrackedQty, exchangeQty). If ownTracked > exchange,
    // exchange has been partially closed by something else — only close
    // what's actually there. If ownTracked < exchange, other kernels
    // hold the rest — only close OUR share, leave theirs intact.
    //
    // If ownTracked is 0 (stale row?), fall back to closing tradeId's
    // own quantity as a last resort — at least close *something* rather
    // than 0 and leave the position open.
    const own_or_fallback = ownTrackedQty > 0 ? ownTrackedQty : exchangeQty;
    const closeSize = Math.min(own_or_fallback, exchangeQty);
    if (closeSize < exchangeQty) {
      logger.info('[Monkey] close sized to OWN share, not exchange aggregate', {
        symbol, heldSide, exchangeQty, ownTrackedQty, closeSize,
        message: 'leaving sibling kernels their positions',
      });
    }

    // Lot-size round.
    let formattedSize = closeSize;
    let symbolLotSize = 0;
    try {
      const precisions = await getPrecisions(symbol);
      if (precisions.lotSize && precisions.lotSize > 0) {
        symbolLotSize = precisions.lotSize;
        formattedSize = Math.floor(closeSize / precisions.lotSize) * precisions.lotSize;
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
    //
    // Hoisted above the try so the 21002 retry handler in `catch` can
    // re-place the close with the same position-mode contract.
    const isHedge = this.positionDirectionMode === 'HEDGE';
    const closePosSide: 'LONG' | 'SHORT' | undefined =
      isHedge ? (heldSide === 'long' ? 'LONG' : 'SHORT') : undefined;
    try {

      // MAKER-CLOSE for preservation-mandate exits (REGIME-2, trailing_harvest,
      // trend_flip_harvest, stale_held). These are "we have time" exits — the
      // doctrine that justifies them ("preservation-mandate cell + profitable
      // position → take profit now") explicitly contemplates patience. Posting
      // a LIMIT_MAKER close at best-ask (close long) or best-bid (close short)
      // earns the maker rebate instead of paying taker on every exit. On a
      // round-trip with maker entry (#820+chain), this completes the rebate
      // chain — currently maker entries / taker exits leaves us paying half
      // the fee burden the rebate strategy was meant to avoid.
      //
      // Conservative gating:
      //   1. Env flag MONKEY_MAKER_CLOSE_LIVE=true (default OFF, safe rollout)
      //   2. Single-chunk only (chunkSizes.length === 1) — multi-chunk maker
      //      close has unhandled partial-fill complexity, defer to follow-up
      //   3. Exit reason matches preservation pattern (regime_held_exit,
      //      trailing_harvest, trend_flip_harvest, stale_held). Stop-loss,
      //      vanished, race, scalp_exit-from-anchor-rejustification all use
      //      MARKET (urgent or already mid-flow).
      //
      // Fallback: if MAKER place fails or fills 0, this attempt logs the
      // failure and the close goes through MARKET as the chunked loop normally
      // would. We do NOT track stale-maker-close in pendingLimitMakerOrders
      // (different lifecycle — close-side stale needs to retry-as-MARKET, not
      // close-orphan-row); that retry path is handled by the outer tick loop's
      // next decision firing the same exit signal again.
      const makerCloseLive = process.env.MONKEY_MAKER_CLOSE_LIVE === 'true';
      const isPreservationExit =
        exitReason.startsWith('regime_held_exit')
        || exitReason.startsWith('trailing_harvest')
        || exitReason.startsWith('trend_flip_harvest')
        || exitReason.startsWith('stale_held');
      const useMakerClose =
        makerCloseLive
        && chunkSizes.length === 1
        && isPreservationExit;

      const orderIds: string[] = [];
      if (useMakerClose) {
        // Fetch orderbook for post-only price computation. Same shape as
        // entry-side maker (#820 fix — makePublicRequest unwraps `data`
        // already, so ob.asks / ob.bids is direct).
        let bestBid: number | null = null;
        let bestAsk: number | null = null;
        try {
          const ob = await poloniexFuturesService.getOrderBook(symbol, 5);
          const rec = ob as Record<string, unknown>;
          const asks = Array.isArray(rec.asks) ? rec.asks as Array<Array<unknown>> : null;
          const bids = Array.isArray(rec.bids) ? rec.bids as Array<Array<unknown>> : null;
          if (asks && asks.length > 0 && Number.isFinite(Number(asks[0]?.[0]))) {
            bestAsk = Number(asks[0]![0]);
          }
          if (bids && bids.length > 0 && Number.isFinite(Number(bids[0]?.[0]))) {
            bestBid = Number(bids[0]![0]);
          }
        } catch (obErr) {
          logger.warn('[Monkey] maker-close orderbook fetch failed — falling back to MARKET', {
            symbol, err: obErr instanceof Error ? obErr.message : String(obErr),
          });
        }
        // Maker side mirroring of entry semantics:
        //   close-LONG (sell): post at best-ASK (above mid; won't immediately match)
        //   close-SHORT (buy): post at best-BID (below mid; won't immediately match)
        if (bestBid !== null && bestAsk !== null && bestAsk > bestBid) {
          const makerPrice = closeSide === 'sell' ? bestAsk : bestBid;
          try {
            const makerOrder = await poloniexFuturesService.placeOrder(credentials, {
              symbol, side: closeSide, type: 'limit_maker',
              size: chunkSizes[0]!, lotSize: symbolLotSize,
              price: makerPrice, timeInForce: 'GTC',
              reduceOnly: true,
            }, {
              positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
              ...(closePosSide ? { posSide: closePosSide } : {}),
            });
            const makerId =
              makerOrder?.ordId ?? makerOrder?.orderId ??
              makerOrder?.id ?? makerOrder?.clientOid ?? null;
            if (makerId) {
              orderIds.push(String(makerId));
              logger.info('[Monkey] MAKER_CLOSE placed', {
                symbol, side: closeSide, heldSide, makerPrice,
                bestBid, bestAsk, exitReason,
                orderId: makerId,
              });
            }
          } catch (makerErr) {
            logger.warn('[Monkey] MAKER_CLOSE place failed — falling back to MARKET', {
              symbol, side: closeSide,
              err: makerErr instanceof Error ? makerErr.message : String(makerErr),
            });
          }
        }
      }

      // MARKET path: original chunked close. Runs when maker-close is
      // disabled OR maker-close place above failed (no orderId yet).
      if (orderIds.length === 0) {
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
      }
      if (orderIds.length === 0) {
        return { executed: false, orderId: null, reason: 'no_chunk_returned_orderId' };
      }
      // Audit: when chunks > 1, expose the full chain so the close row's
      // exit_order_id reflects every leg. Single-order legacy keeps a single id.
      orderId = orderIds.length === 1 ? orderIds[0]! : orderIds.join(',');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 21002 "Position not enough" with a sibling close in the cooldown
      // window is a benign race-loss, not a real error. Mark the local
      // row closed and surface a clear reason; don't spam ERROR.
      const is21002 = message.includes('21002') || message.toLowerCase().includes('position not enough');
      if (is21002) {
        const race = isLikelyRaceLoss(symbol, heldSide, this.instanceId);
        if (race.raced) {
          // #931 safe-pnl — see comment at first race_lost_to_sibling block above.
          await pool.query(
            `UPDATE autonomous_trades SET status='closed', exit_price=$1, exit_time=NOW(),
                    exit_reason='race_lost_to_sibling', exit_gate='race_lost_to_sibling',
                    ${SAFE_PNL_FROM_ROW} WHERE id=$2`,
            [markPrice, tradeId],
          ).catch(() => { /* non-fatal */ });
          return {
            executed: false, orderId: null,
            reason: `race_lost_to_sibling: 21002 after sibling close (${race.siblingId} ${race.ageMs}ms ago)`,
          };
        }
        // Not a sibling race — the close order exceeded the live exchange
        // position. Common on adopted operator rows whose DB `quantity`
        // has drifted above the exchange net position, or after a partial
        // fill. Poloniex v3 has no close-all/percentage param and rejects
        // an oversize reduceOnly order rather than clamping it, so the
        // reliable "close 100%" is: re-read the live position and retry
        // the close at exactly what is there. One retry only — no loop.
        try {
          const freshPositions = await poloniexFuturesService.getPositions(credentials);
          const freshForSymbol = (Array.isArray(freshPositions) ? freshPositions : []).filter(
            (p: Record<string, unknown>) => String(p.symbol ?? '') === symbol,
          );
          const freshTarget = (isHedge && closePosSide)
            ? (freshForSymbol.find((p: Record<string, unknown>) =>
                String(p.side ?? p.posSide ?? '').toUpperCase() ===
                (heldSide === 'long' ? 'LONG' : 'SHORT')) ?? freshForSymbol[0])
            : freshForSymbol[0];
          const retryPlan = plan21002RetryClose(
            freshTarget?.qty ?? freshTarget?.size ?? 0,
            symbolLotSize,
          );
          if (retryPlan.ok === false && retryPlan.reason === '21002_retry_invalid_live_qty') {
            logger.warn('[Monkey] 21002 retry skipped invalid live quantity', {
              symbol, heldSide, liveQty: freshTarget?.qty ?? freshTarget?.size ?? null,
            });
            return { executed: false, orderId: null, reason: retryPlan.reason };
          }
          if (retryPlan.ok === false && retryPlan.reason === '21002_position_already_flat') {
            // Position is already flat — nothing to close. Mark the row.
            // #931 safe-pnl — see comment at first race_lost_to_sibling block above.
            await pool.query(
              `UPDATE autonomous_trades SET status='closed', exit_price=$1, exit_time=NOW(),
                      exit_reason='exchange_position_vanished',
                      exit_gate='exchange_position_vanished',
                      ${SAFE_PNL_FROM_ROW} WHERE id=$2`,
              [markPrice, tradeId],
            ).catch(() => { /* non-fatal */ });
            return {
              executed: false, orderId: null,
              reason: retryPlan.reason,
            };
          }
          if (retryPlan.ok === false) {
            return { executed: false, orderId: null, reason: retryPlan.reason };
          }
          const retryOrderIds: string[] = [];
          for (const retrySize of retryPlan.chunkSizes) {
            const retryOrder = await poloniexFuturesService.placeOrder(credentials, {
              symbol, side: closeSide, type: 'market', size: retrySize, lotSize: symbolLotSize,
              reduceOnly: true,
            }, {
              positionMode: isHedge ? 'HEDGE' : 'ONE_WAY',
              ...(closePosSide ? { posSide: closePosSide } : {}),
            });
            const retryId =
              retryOrder?.ordId ?? retryOrder?.orderId ??
              retryOrder?.id ?? retryOrder?.clientOid ?? null;
            if (retryId) retryOrderIds.push(String(retryId));
          }
          if (retryOrderIds.length === 0) {
            return { executed: false, orderId: null, reason: '21002_retry_no_orderId' };
          }
          logger.info('[Monkey] close retried at live qty after 21002', {
            symbol, heldSide, freshQty: retryPlan.freshQty, chunks: retryPlan.chunkSizes.length, orderIds: retryOrderIds,
          });
          // Success — set orderId and fall through to the settle/accounting
          // block below (closes all open rows for this kernel+symbol).
          orderId = retryOrderIds.length === 1 ? (retryOrderIds[0] ?? null) : retryOrderIds.join(',');
        } catch (retryErr) {
          return {
            executed: false, orderId: null,
            reason: `21002_retry_failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          };
        }
      } else {
        return {
          executed: false, orderId: null,
          reason: `close_exchange_rejected: ${message}`,
        };
      }
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
      //
      // Defensive `lane IS NULL` — same reasoning as paper-mode SELECT
      // above. Without it, NULL-lane Monkey rows get silently skipped
      // by `AND lane = X`, stay status='open', and the next decision
      // tick re-fires close → 21002 retry storm.
      const openRows = closeLane
        ? await pool.query(
            `SELECT id, quantity, agent FROM autonomous_trades
              WHERE reason LIKE $1 AND status = 'open' AND symbol = $2
                AND (lane = $3 OR lane IS NULL)
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
      // Accumulate per-agent (pnl, qty) inside the row loop so we can
      // push ONE reward event per agent at the end. Per-row pushes would
      // flood the bounded reward queue (REWARD_QUEUE_MAX=50) on DCA
      // closes; per-agent aggregation keeps the queue stable while still
      // attributing chemistry to the agent that actually generated each
      // win. Each agent gets its own margin estimate from its own qty
      // share so pnlFraction = pnl / margin is meaningful per agent.
      const perAgentTotals: Record<AgentLabel, { pnl: number; qty: number }> = {
        K: { pnl: 0, qty: 0 },
        M: { pnl: 0, qty: 0 },
        T: { pnl: 0, qty: 0 },
        L: { pnl: 0, qty: 0 },
      };
      if (rows.length === 0 || totalQty === 0) {
        // #931 safe-pnl: compute pnl from row's own entry/qty/side via SAFE_PNL_FROM_ROW,
        // RETURNING the value so chemistry receives the actual row pnl (not the
        // caller-aggregate that could be a phantom across multiple rows).
        const updated = await pool.query<{ pnl: string }>(
          `UPDATE autonomous_trades
              SET status = 'closed', exit_price = $1, exit_time = NOW(),
                  exit_reason = $2, exit_order_id = $3, exit_gate = $5, ${SAFE_PNL_FROM_ROW}
            WHERE id = $4
            RETURNING pnl`,
          [markPrice, exitReason, orderId, tradeId, exitGate],
        );
        const safePnl = updated.rows[0]?.pnl ? Number(updated.rows[0].pnl) : pnlAtDecision;
        // Single-row fallback: assume Agent K (the established default).
        this.arbiter.recordSettled('K', safePnl);
        // v0.8.8 per-agent reactive cognition: feed outcome to K's
        // emotion + neurochemistry stack (dopamine on win, frustration
        // on loss). See per_agent_state.ts.
        const fallbackQty = exchangeQty || 0.01;
        this.applyOutcomeToAgent(symbol, 'K', heldSide, safePnl, (markPrice * fallbackQty) / 16);
        perAgentTotals.K.pnl += safePnl;
        perAgentTotals.K.qty += fallbackQty;
      } else {
        // #931 safe-pnl: compute each row's pnl from its OWN entry_price + qty +
        // side via SAFE_PNL_FROM_ROW, returning the computed value so chemistry +
        // arbiter feedback see the true per-row pnl. Pre-fix used
        // `rowPnl = pnlAtDecision * qtyShare` which assumed all rows shared
        // the kernel's weightedEntry — wrong when DCA adds had different entries,
        // and structurally vulnerable to caller-aggregate phantoms.
        for (const row of rows) {
          const updated = await pool.query<{ pnl: string; entry_price: string; side: string; quantity: string }>(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_price = $1, exit_time = NOW(),
                    exit_reason = $2, exit_order_id = $3, exit_gate = $5, ${SAFE_PNL_FROM_ROW}
              WHERE id = $4
              RETURNING pnl, entry_price, side, quantity`,
            [markPrice, exitReason, orderId, row.id, exitGate],
          );
          const returned = updated.rows[0];
          if (!returned) {
            logger.warn('[Monkey] close row update returned no row; skipping row reward accounting', {
              tradeId: row.id,
              symbol,
              exitReason,
            });
            continue;
          }
          const rowQty = Math.abs(Number(returned.quantity) || 0);
          const sideStr = String(returned.side ?? '');
          if (sideStr !== 'buy' && sideStr !== 'sell' && sideStr !== 'long' && sideStr !== 'short') {
            logger.warn('[Monkey] close row returned invalid side; skipping row reward accounting', {
              tradeId: row.id,
              symbol,
              side: returned.side,
              exitReason,
            });
            continue;
          }
          const entryPrice = Number(returned.entry_price);
          const sideSign = sideStr === 'buy' || sideStr === 'long' ? 1 : -1;
          const rowPnlRaw = returned.pnl
            ? Number(returned.pnl)
            : Number.isFinite(entryPrice)
              ? rowQty * (markPrice - entryPrice) * sideSign
              : pnlAtDecision * (rowQty / totalQty);
          // Phantom-PnL guard (2026-05-26): verify the row's computed pnl
          // against an independent client-side computation. Detects mixed-
          // unit phantoms (the reconciler-stored-contracts bug fixed in
          // PR after #951). On divergence > $5, log + clamp to the
          // computed value so chemistry isn't fed a phantom. This wires
          // verifyPnl into the close path — it was exported in #936 but
          // never called.
          let rowPnl = rowPnlRaw;
          if (returned) {
            const verification = verifyPnl(
              rowPnlRaw,
              entryPrice,
              markPrice,
              rowQty,
              sideStr,
            );
            if (verification.isPhantomCandidate) {
              logger.warn('[Monkey] phantom-pnl candidate detected — chemistry feed clamped', {
                tradeId: row.id,
                symbol,
                provided: verification.provided,
                calculated: verification.calculated,
                divergenceAbs: verification.divergenceAbs,
                rowQty,
                entryPrice: returned.entry_price,
                exitPrice: markPrice,
                side: sideStr,
              });
              rowPnl = verification.calculated;
            }
          }
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
          this.applyOutcomeToAgent(symbol, agentLabel, heldSide, rowPnl, (markPrice * rowQty) / 16);
          perAgentTotals[agentLabel].pnl += rowPnl;
          perAgentTotals[agentLabel].qty += rowQty;
        }
      }

      // v0.6.7 + 2026-05-16 per-agent NC: push one reward event per
      // agent that contributed to this close. See
      // pushPerAgentCloseRewards for margin derivation + rationale.
      this.pushPerAgentCloseRewards(symbol, markPrice, perAgentTotals);
    } catch (err) {
      logger.error('[Monkey] close DB update failed — ORPHAN RISK (reconciler will catch)', {
        tradeId, err: err instanceof Error ? err.message : String(err),
      });
      // Defensive single-row close so subsequent ticks don't re-decide
      // on this position. The bulk per-row UPDATE above failed; this
      // pins at least the primary tradeId row to closed, breaking the
      // 21002-retry loop. Reconciler still picks up any siblings.
      try {
        // #931 safe-pnl: compute from row's own data; the bulk per-row UPDATE
        // failed and we don't know which rows are still open, so the simplest
        // safe path is to use the row's own arithmetic.
        await pool.query(
          `UPDATE autonomous_trades
              SET status='closed', exit_price=$1, exit_time=NOW(),
                  exit_reason=$2, exit_order_id=$3, exit_gate='db_recovery',
                  ${SAFE_PNL_FROM_ROW}
            WHERE id=$4 AND status='open'`,
          [markPrice, `${exitReason}__db_recovery`, orderId, tradeId],
        );
      } catch (recoveryErr) {
        logger.error('[Monkey] close DB recovery also failed — full reconciler dependency', {
          tradeId,
          recoveryErr: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
        });
      }
    }

    logger.info('[Monkey] POSITION CLOSED', {
      instanceId: this.instanceId,
      symbol, heldSide, markPrice, orderId, tradeId,
      pnl: pnlAtDecision.toFixed(4), exitReason,
    });
    // REGIME-3 — post-close tilt cooldown. Records timestamp on EVERY
    // close (any PnL). The entry path's cooldown check rejects same-side
    // re-entry within POSTCLOSE_COOLDOWN_MS unless the operator has
    // REGIME_POSTWIN_COOLDOWN_LIVE=false (env var name kept for back-compat).
    //
    // Diagnosed in 2026-05-19 CSV post-mortems:
    //   #806: +$0.20 BTC win at 08:21 → -$0.52 BTC loss at 08:29 (win-then-loss)
    //   #819: BTC short→short re-open at 62s (slipped past 60s default)
    //   THIS: 13:11:54 BTC long close -$0.0036 (TINY LOSS) → 13:13:55 BTC
    //         long re-open (2 min later) → 13:14:31 close -$0.2247.
    //         Post-win-only gate didn't fire because the prior close was
    //         a tiny loss, not a win. Same structural failure mode.
    //
    // Side-aware: key by (symbol, side). Same-symbol SAME-SIDE re-entry
    // is the gated case. Opposite-side (reversal) isn't gated by THIS
    // check — it has its own gates (REGIME-2, directional_disagreement).
    this.lastCloseAtMs.set(`${symbol}|${heldSide}`, Date.now());
    this.bus.publish({
      type: BusEventType.EXIT_TRIGGERED,
      source: this.instanceId,
      symbol,
      payload: { heldSide, markPrice, orderId, tradeId, pnl: pnlAtDecision, exitReason },
    });
    closeSucceeded = true;
    return { executed: true, orderId, reason: 'closed' };
    } finally {
      releaseClose(symbol, heldSide, this.instanceId, closeSucceeded);
    }
  }

  /**
   * Execution path (v0.3): route Monkey's proposed entry through the
   * shared risk kernel, submit to Poloniex v3 futures, and persist the
   * row to autonomous_trades with reason prefix `monkey|...` so the
   * reconciler + dashboard attribute it to her.
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
    /** Phase 9 (2026-05-27) — observables threaded for kernel-derived
     *  contract cap. The kernel's own risk envelope from chemistry +
     *  equity; replaces MONKEY_MAX_CONTRACTS_PER_POSITION env knob. */
    availableEquityUsdt?: number;
    dopamine?: number;
    gaba?: number;
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
    /** REGIME-1 cell direction hint for LIMIT_MAKER routing. When
     *  'CHOP', the entry is non-time-critical (lateral market) and
     *  should post as maker to earn the rebate. When 'TREND_UP' or
     *  'TREND_DOWN', the entry is directional and should use MARKET
     *  for instant fill. Null when cell isn't resolved (legacy
     *  call sites). */
    cellDirection?: 'TREND_UP' | 'CHOP' | 'TREND_DOWN' | null;
  }): Promise<{ executed: boolean; orderId: string | null; reason: string; tradeId?: string | null }> {
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

    // Phase B (B1) — commit the geometry-derived TP/SL bracket at entry.
    // symStateForLev.lastFrBracket holds the φ/rConf/ATR-derived distances
    // recomputed each tick. A LONG takes profit ABOVE entry and stops
    // BELOW; a SHORT is mirrored. Persisted to the take_profit/stop_loss
    // columns (long-NULL before this change). B1 only PERSISTS the bracket
    // — the mechanical exit gate that READS it ships flag-gated in B2, so
    // this is behaviour-neutral. null bracket (ATR warmup) → NULL columns.
    const frBracket = symStateForLev?.lastFrBracket ?? null;
    const tpPrice = frBracket
      ? (side === 'long'
          ? entryPrice + frBracket.tpDistance
          : entryPrice - frBracket.tpDistance)
      : null;
    const slPrice = frBracket
      ? (side === 'long'
          ? entryPrice - frBracket.slDistance
          : entryPrice + frBracket.slDistance)
      : null;

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

    // REGIME-3 — post-close cooldown veto. After ANY close on this
    // (symbol, side), suppress same-side re-entry for POSTCLOSE_COOLDOWN_MS
    // to break post-close tilt. Originally post-WIN only (#806/#819);
    // extended 2026-05-19 to any close after the 13:14:31 BTC -$0.22 loss
    // came from re-entry 2min after a tiny loss (post-win-only gate missed it).
    //
    // Env compat:
    //   REGIME_POSTWIN_COOLDOWN_LIVE=true  → activates the gate (legacy name kept)
    //   POSTCLOSE_COOLDOWN_MS overrides; POSTWIN_COOLDOWN_MS is a fallback alias.
    //   DCA-adds bypass — defending an existing position is the explicit override.
    if (
      !req.isDCAAdd
      && process.env.REGIME_POSTWIN_COOLDOWN_LIVE === 'true'
    ) {
      const cooldownMs =
        Number(process.env.POSTCLOSE_COOLDOWN_MS)
        || Number(process.env.POSTWIN_COOLDOWN_MS)
        || MonkeyKernel.POST_CLOSE_COOLDOWN_MS_DEFAULT;
      const lastCloseAt = this.lastCloseAtMs.get(`${symbol}|${side}`);
      if (lastCloseAt !== undefined) {
        const elapsedMs = Date.now() - lastCloseAt;
        if (elapsedMs < cooldownMs) {
          logger.info('[Monkey] postclose_cooldown veto', {
            symbol, side, elapsedMs, cooldownMs,
            remaining_s: ((cooldownMs - elapsedMs) / 1000).toFixed(1),
          });
          return {
            executed: false, orderId: null,
            reason:
              `postclose_cooldown: ${(elapsedMs / 1000).toFixed(1)}s since last close on ${symbol}|${side}, `
              + `${((cooldownMs - elapsedMs) / 1000).toFixed(1)}s remaining`,
          };
        }
      }
    }

    // FUNDING-GATE — pre-entry funding-cost suppression. Block entries
    // that would PAY funding within the gate window. Triggered by
    // claude.ai 13:32 snapshot 2026-05-19 finding: $0.044 funding paid
    // across 6 events (all LONGs during positive-rate cycles). Small
    // per-event but it's pure unforced cost layered on top of fees.
    //
    // Logic:
    //   side=long  pays  when fundingRate8h > 0  (longs pay positives)
    //   side=short pays  when fundingRate8h < 0  (shorts pay negatives)
    //   active when |now - nextFundingTime| <= FUNDING_GATE_WINDOW_MIN (default 10 min)
    //
    // Bypass conditions:
    //   - MONKEY_FUNDING_GATE_LIVE != 'true'  → gate disabled
    //   - nextFundingTimeMs absent             → schedule unknown, fail-open
    //   - req.isDCAAdd                         → defending existing position
    //
    // Opposite side (would RECEIVE funding) is unaffected — entering
    // INTO a favourable funding cycle is a small free EV the gate should not block.
    if (
      !req.isDCAAdd
      && process.env.MONKEY_FUNDING_GATE_LIVE === 'true'
    ) {
      const funding = this.latestFundingBySymbol.get(symbol);
      if (funding && funding.nextFundingTimeMs && Number.isFinite(funding.rate)) {
        const windowMin = Number(process.env.MONKEY_FUNDING_GATE_WINDOW_MIN) || 10;
        const windowMs = windowMin * 60_000;
        const msUntilFunding = funding.nextFundingTimeMs - Date.now();
        const willPay =
          (side === 'long' && funding.rate > 0)
          || (side === 'short' && funding.rate < 0);
        if (willPay && msUntilFunding >= 0 && msUntilFunding <= windowMs) {
          const minsUntil = (msUntilFunding / 60_000).toFixed(1);
          logger.info('[Monkey] funding_gate veto', {
            symbol, side,
            fundingRate8h: funding.rate,
            minsUntilFunding: minsUntil,
            windowMin,
          });
          return {
            executed: false, orderId: null,
            reason:
              `funding_gate: ${side} pays ${(funding.rate * 100).toFixed(4)}% in ${minsUntil}min `
              + `(window ${windowMin}min)`,
          };
        }
      }
    }

    // Load account + credentials.
    let userId: string;
    let credentials: { apiKey: string; apiSecret: string; passphrase?: string };
    let kernelState: KernelAccountState;
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      userId = String((userRow.rows[0] as { user_id?: string } | undefined)?.user_id ?? '');
      if (!userId) {
        if (this.shouldRouteOrdersToPaper()) {
          // Paper mode — resolve a user_id that satisfies the
          // autonomous_trades.user_id → users(id) foreign key. Prefer
          // any existing user; on a fresh paper/staging DB (empty
          // users table) bootstrap a deterministic paper user row
          // idempotently so the paper-trade INSERT has a valid FK.
          // No exchange call; paper_trade=true marks the rows.
          const PAPER_USER_ID = '00000000-0000-0000-0000-000000000000';
          let paperUser = '';
          try {
            const ur = await pool.query('SELECT id FROM users LIMIT 1');
            paperUser = String((ur.rows[0] as { id?: string } | undefined)?.id ?? '');
          } catch { /* users table unreadable — fall through to bootstrap */ }
          if (!paperUser) {
            try {
              await pool.query(
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES ($1, 'paper@monkey.local', 'paper-monkey', 'paper-no-login')
                 ON CONFLICT (id) DO NOTHING`,
                [PAPER_USER_ID],
              );
              paperUser = PAPER_USER_ID;
            } catch (bootErr) {
              logger.warn('[Monkey] paper user bootstrap failed', {
                err: bootErr instanceof Error ? bootErr.message : String(bootErr),
              });
            }
          }
          userId = paperUser || PAPER_USER_ID;
        } else {
          return { executed: false, orderId: null, reason: 'no_credentials' };
        }
      }
      if (this.shouldRouteOrdersToPaper()) {
        // Paper mode — synthetic risk-kernel state at the paper
        // bankroll, no exchange call. Equity matches what the sizing
        // path (fetchAccountContext) used, so the risk kernel's
        // headroom check does not reject paper entries.
        credentials = { apiKey: 'paper', apiSecret: 'paper' };
        kernelState = {
          equityUsdt: Number(process.env.MONKEY_PAPER_EQUITY_USDT) || 1000,
          unrealizedPnlUsdt: 0,
          openPositions: [],
          restingOrders: [],
          usedMarginUsdt: 0,
        };
      } else {
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
        // v3 HEDGE positions carry side in `posSide` (not the Binance-style
        // `p.side`) and have no `notional`/`size` field — derive both via
        // the shared resolvers (posSide-first; notional = im x lever).
        // The old `p.side`/`p.notional ?? p.size` reads blinded the kernel's
        // exposure/stacking vetoes on the HEDGE account. Re-applies the
        // loop_execution.ts intent of fa301f9 + c822499 at this call site
        // (loop_execution.ts is a post-cutover modularization file, not on
        // this branch).
        side: resolveExchangePositionSide(p),
        notional: resolveExchangePositionNotional(p),
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
      }
    } catch (err) {
      return {
        executed: false, orderId: null,
        reason: `account_load_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Risk kernel — the shared blast-door all execution passes through.
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

    // Round quantity to the symbol's lot step — required after the
    // 2026-04-19 `Param error sz` incident.
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

    // Per-position contracts cap (#11) — Phase 9 (2026-05-27):
    // kernel-derived from observables (chemistry × equity × leverage)
    // instead of operator env knob MONKEY_MAX_CONTRACTS_PER_POSITION.
    // The 8000 venue-derived ceiling (10000 venue cap − 2000 chunker
    // buffer) remains as a structural wall but is no longer the typical
    // operating cap — kernel's own risk envelope sits below it.
    if (symbolLotSize > 0) {
      const effectiveAgent = (req.agent ?? 'K') as 'K' | 'M' | 'T';
      const effectiveLane = (req.lane ?? 'swing') as 'scalp' | 'swing' | 'trend';
      const newContracts = Math.floor(formattedSize / symbolLotSize);
      const currentContracts = await this.sumOpenContractsForPosition(
        symbol, effectiveAgent, side, effectiveLane, symbolLotSize,
      );
      // Phase 9 — kernel-derived cap when observables are threaded;
      // fall back to venue ceiling (8000) when caller hasn't supplied
      // equity yet. Old call sites that don't thread the new observables
      // keep working at the venue-ceiling level.
      const cap = req.availableEquityUsdt && req.availableEquityUsdt > 0
        ? kernelDerivedContractCap({
            availableEquityUsdt: req.availableEquityUsdt,
            markPrice: req.entryPrice,
            contractSize: symbolLotSize,
            leverage: req.leverage,
            dopamine: req.dopamine ?? 0.5,
            phi: req.phi,
            gaba: req.gaba ?? 0.5,
          })
        : VENUE_CONTRACTS_CEILING;
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

    if (this.shouldRouteOrdersToPaper()) {
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        logger.warn('[Monkey] paper mode invalid mark price, skipping entry', {
          symbol,
          entryPrice,
        });
        return { executed: false, orderId: null, reason: 'paper_mode_invalid_mark_price' };
      }
      try {
        const paper = await paperPlaceOrder({
          engine: 'monkey',
          userId,
          symbol,
          side,
          quantity: formattedSize,
          leverage,
          markPrice: entryPrice,
          metadata: {
            kernel: this.instanceId,
            agent: req.agent ?? 'K',
            lane: req.lane ?? 'swing',
          },
        });
        const paperModeReason = `monkey_paper_mode: filled @ ${paper.fillPrice.toFixed(8)} (slippage ${paper.slippageBps.toFixed(2)} bps)`;
        const orderId: string | null = paper.orderId;
        const agentTag = req.agent ?? 'K';
        const laneTag = req.lane ?? 'swing';
        let tradeId: string | null = null;
        try {
          const dcaTag = req.isDCAAdd ? `|dca=${req.dcaAddIndex ?? 1}` : '';
          const reasonEncoded =
            `monkey|kernel=${this.instanceId}|agent=${agentTag}|lane=${laneTag}|phi=${req.phi.toFixed(3)}|kappa=${req.kappa.toFixed(2)}|sov=${req.sovereignty.toFixed(3)}${dcaTag}|src=v0.10`;

          // Finding 1 — notional self-consistency assertion at the paper INSERT.
          // expectedNotional is `marginUsdt × leverage` (kernel's intended sizing,
          // mirrors the live path). A mismatch means `formattedSize` is in the
          // wrong unit (contracts vs base-asset) and the row would feed phantom
          // PnL downstream. Refuse the write.
          const paperNotionalCheck = checkNotionalConsistency(
            paper.fillPrice,
            formattedSize,
            marginUsdt * leverage,
          );
          if (!paperNotionalCheck.consistent) {
            logger.error('[LIVED ONLY] paper INSERT — refusing row', {
              symbol, fillPrice: paper.fillPrice, formattedSize,
              diagnostic: paperNotionalCheck.diagnostic,
            });
            return { executed: false, orderId: null, reason: 'notional_mismatch_at_paper_insert' };
          }

          const inserted = await pool.query(
            `INSERT INTO autonomous_trades
               (user_id, symbol, side, entry_price, quantity, leverage,
                confidence, reason, order_id, paper_trade, engine_version, agent, lane,
                take_profit, stop_loss, engine_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING id`,
            [
              userId, symbol, exchangeSide, paper.fillPrice, formattedSize, leverage,
              req.phi, reasonEncoded, orderId, true, getEngineVersion(), agentTag, laneTag,
              // engine_type — consensus WR-matrix key; must match
              // consensus_arbiter `selfEngineType` ('monkey-k'). Without it
              // the kernel's trades bucket under 'unknown' and the arbiter
              // never reaches `self_min` → permanent no-trade-divergence.
              tpPrice, slPrice, 'monkey-k',
            ],
          );
          tradeId = String((inserted.rows[0] as { id?: string | number } | undefined)?.id ?? '') || null;
        } catch (err) {
          logger.error('[Monkey] paper DB insert failed after simulated placement — ORPHAN RISK', {
            orderId, err: err instanceof Error ? err.message : String(err),
          });
        }

        logger.info(req.isDCAAdd ? '[Monkey] PAPER DCA_ADD PLACED' : '[Monkey] PAPER ORDER PLACED', {
          symbol, side, orderId,
          margin: marginUsdt.toFixed(2),
          notional: notionalUsdt.toFixed(2),
          leverage,
          formattedSize,
          phi: req.phi.toFixed(3),
          sov: req.sovereignty.toFixed(3),
          dcaAddIndex: req.dcaAddIndex ?? 0,
          fillPrice: paper.fillPrice,
          slippageBps: paper.slippageBps,
        });

        this.bus.publish({
          type: BusEventType.ENTRY_EXECUTED,
          source: this.instanceId,
          symbol,
          payload: {
            side, orderId, margin: marginUsdt, notional: notionalUsdt, leverage,
            entryPrice: paper.fillPrice, phi: req.phi, kappa: req.kappa, sovereignty: req.sovereignty,
            isDCAAdd: Boolean(req.isDCAAdd), dcaAddIndex: req.dcaAddIndex ?? 0,
          },
        });

        return { executed: true, orderId, reason: paperModeReason, tradeId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[Monkey] paper placeOrder failed', { symbol, side, err: message });
        if (message.includes('paper_mode_misconfigured')) {
          return { executed: false, orderId: null, reason: 'paper_mode_misconfigured' };
        }
        return { executed: false, orderId: null, reason: `paper_rejected: ${message}` };
      }
    }

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

    // LIMIT_MAKER #793 + cell-conditional routing (audit 2026-05-19).
    //
    // Trigger semantics: use LIMIT_MAKER for non-time-critical entries.
    // The defining property is "lateral market — no rush to fill" rather
    // than "scalp lane." Per claude.ai 2026-05-19 analysis of 30 fills:
    // 100% taker despite SCALP_LIMIT_MAKER_LIVE=true because the chooseLane
    // softmax has a structural zero (scalpScore=0 when sov=1.0), so scalp
    // lane only wins argmax in CREATOR_CHOP cells (where cellLaneBias=scalp
    // boost overcomes the 0). All other CHOP cells routed to swing/trend,
    // missed the maker rebate. Counterfactual: -$0.23 → +$0.62 net for
    // the observed window with maker routing active across all CHOP cells.
    //
    // New rule: LIMIT_MAKER fires when ANY of:
    //   (a) cellDirection === 'CHOP'  — lateral market, can wait for maker
    //   (b) lane === 'scalp'          — explicit scalp routing (legacy path)
    // AND NOT a DCA add (DCA defends existing position, needs instant fill).
    //
    // Why no TREND cells: directional moves require instant fill or the
    // move gets away. Trend lane SHOULD pay taker fees — the TP/SL is
    // wider (0.4%) so fee impact is proportionally smaller.
    // M.1 — entry gate against stacked makers on the same (symbol, side, lane).
    // Pre-fix, the entry path never read pendingLimitMakerOrders before
    // placing — each 30s tick could post a fresh maker order even with
    // one already resting at the same price (observed in prod logs
    // 07:09:43/07:09:44/07:09:46: three placements within 3s). This
    // amplified the cancel-and-replace cycle and worsened latency. The
    // tracker Map was design-documented as a double-queue guard (loop.ts
    // class field comment) but the read was never wired. Wiring it now.
    //
    // DCA adds bypass — they intentionally stack onto an existing pending
    // entry to defend a position.
    if (!req.isDCAAdd) {
      const targetLane = (req.lane ?? 'swing') as 'scalp' | 'swing' | 'trend';
      for (const info of this.pendingLimitMakerOrders.values()) {
        if (info.symbol === symbol && info.side === side && info.lane === targetLane) {
          const ageMs = Date.now() - info.placedAtMs;
          logger.debug('[Monkey] skipping entry — maker already pending', {
            symbol, side, lane: targetLane, pendingOrderId: info.orderId, ageMs,
          });
          return {
            executed: false, orderId: null,
            reason: `maker_already_pending: orderId=${info.orderId} age=${(ageMs / 1000).toFixed(1)}s`,
          };
        }
      }
    }

    // Operator-toggleable scope: SCALP_LIMIT_MAKER_BROAD=false reverts
    // to the original scalp-lane-only routing if broad-CHOP routing's
    // latency outweighs the rebate on the current symbol mix. The PR
    // #817 counterfactual was a single window; this lever lets you A/B
    // without a redeploy.
    const broadMakerRouting = process.env.SCALP_LIMIT_MAKER_BROAD !== 'false';
    const cellIsChop = req.cellDirection === 'CHOP';
    const laneIsScalp = (req.lane ?? 'swing') === 'scalp';
    // Fallback after consecutive stale-cancels: when maker has failed
    // to fill N times in a row on this (symbol, side), the next entry
    // uses MARKET. Without this gate, a market state where our post-only
    // bid sits at the back of the queue produces 0% fill rate and the
    // bot can't enter at all (observed 2026-05-19 07:00-07:18 window:
    // 0/12 maker fills — every order timed out at 120s STALE_MS).
    // Counter resets to 0 on successful MARKET fill (placeOrder returns
    // an orderId), so the next attempt after fallback retries maker.
    const makerKey = `${symbol}|${side}`;
    const maxStales =
      Number(process.env.MAKER_MAX_CONSECUTIVE_STALES)
      || MonkeyKernel.MAX_CONSECUTIVE_STALES_DEFAULT;
    const consecutiveStales = this.makerStaleCountByKey.get(makerKey) ?? 0;
    const makerCircuitOpen = consecutiveStales >= maxStales;
    if (makerCircuitOpen) {
      logger.info('[Monkey] LIMIT_MAKER circuit open — using MARKET for this entry', {
        symbol, side, consecutiveStales, maxStales,
      });
    }
    const useLimitMaker =
      process.env.SCALP_LIMIT_MAKER_LIVE === 'true'
      && (laneIsScalp || (broadMakerRouting && cellIsChop))
      && !req.isDCAAdd
      && !makerCircuitOpen;

    let orderId: string | null = null;
    let limitMakerPriceUsed: number | null = null;
    try {
      if (useLimitMaker) {
        // Fetch order book and compute post-only price. On any error,
        // fall through to MARKET to preserve existing entry-flow safety.
        let bestBid: number | null = null;
        let bestAsk: number | null = null;
        try {
          const ob = await poloniexFuturesService.getOrderBook(symbol, 5);
          // Poloniex v3 raw response: { code: 200, data: { asks, bids, s, ts }, msg }
          // BUT poloniexFuturesService.makePublicRequest already UNWRAPS
          // the `data` field (see line 887). So ob === {asks, bids, s, ts}
          // directly, NOT { data: {...} }. Diagnosed 2026-05-19 from live
          // log: `limit_maker pre-check failed bestBid=null bestAsk=null`
          // — my prior `ob.data.asks` access was undefined → MARKET
          // fallback → 100% taker fills despite the cell-conditional
          // routing being correct in #817.
          const rec = ob as Record<string, unknown>;
          const asks = Array.isArray(rec.asks) ? rec.asks as Array<Array<unknown>> : null;
          const bids = Array.isArray(rec.bids) ? rec.bids as Array<Array<unknown>> : null;
          if (asks && asks.length > 0 && Number.isFinite(Number(asks[0]?.[0]))) {
            bestAsk = Number(asks[0]![0]);
          }
          if (bids && bids.length > 0 && Number.isFinite(Number(bids[0]?.[0]))) {
            bestBid = Number(bids[0]![0]);
          }
        } catch (obErr) {
          logger.warn('[Monkey] limit_maker order book fetch failed — falling back to market', {
            symbol, err: obErr instanceof Error ? obErr.message : String(obErr),
          });
        }
        // Need both sides + a reasonable spread; otherwise MARKET fallback.
        const spreadOk = bestBid !== null && bestAsk !== null && bestAsk > bestBid;
        if (spreadOk) {
          // Post-only price: at the top of our side's book — long at bid, short at ask.
          // This is the natural maker-side price; LIMIT_MAKER will reject anything
          // that would cross (sanity-check the exchange's own enforcement).
          const limitPrice = exchangeSide === 'buy' ? bestBid! : bestAsk!;
          limitMakerPriceUsed = limitPrice;
          const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
            symbol, side: exchangeSide, type: 'limit_maker',
            size: formattedSize, lotSize: symbolLotSize,
            price: limitPrice, timeInForce: 'GTC',
          }, posSide ? { posSide } : {});
          orderId =
            exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
            exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
          if (orderId) {
            // Track for cancel-on-stale; cleared by getStaleCancellableLimitMakers()
            // run from processSymbol on subsequent ticks.
            this.pendingLimitMakerOrders.set(orderId, {
              orderId, placedAtMs: Date.now(),
              symbol, side, lane: (req.lane ?? 'swing') as 'scalp' | 'swing' | 'trend',
            });
            logger.info('[Monkey] LIMIT_MAKER scalp placed', {
              symbol, side: exchangeSide, limitPrice,
              bestBid, bestAsk, spread: (bestAsk! - bestBid!).toFixed(6),
              orderId, formattedSize, posSide,
            });
          }
        } else {
          logger.warn('[Monkey] limit_maker pre-check failed — falling back to market', {
            symbol, bestBid, bestAsk,
          });
        }
      }

      // MARKET fallback OR non-scalp / non-LIMIT_MAKER path.
      if (orderId === null) {
        const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
          symbol, side: exchangeSide, type: 'market', size: formattedSize, lotSize: symbolLotSize,
        }, posSide ? { posSide } : {});
        orderId =
          exchangeOrder?.ordId ?? exchangeOrder?.orderId ??
          exchangeOrder?.id ?? exchangeOrder?.clientOid ?? null;
        if (orderId) {
          // MARKET fills immediately (or rejects). Reset the maker
          // stale-counter so the next entry on this (symbol, side)
          // can retry maker — we don't want to stay on taker forever
          // just because maker missed twice in a row.
          this.makerStaleCountByKey.set(makerKey, 0);
        }
      }
      if (!orderId) {
        logger.warn('[Monkey] exchange placed but no orderId returned', {
          symbol, rawKeys: 'unknown',
        });
      }
    } catch (err) {
      logger.error('[Monkey] placeOrder failed', {
        symbol, side, useLimitMaker, limitMakerPriceUsed,
        err: err instanceof Error ? err.message : String(err),
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
    let tradeId: string | null = null;
    try {
      const dcaTag = req.isDCAAdd ? `|dca=${req.dcaAddIndex ?? 1}` : '';
      const reasonEncoded =
        `monkey|kernel=${this.instanceId}|agent=${agentTag}|lane=${laneTag}|phi=${req.phi.toFixed(3)}|kappa=${req.kappa.toFixed(2)}|sov=${req.sovereignty.toFixed(3)}${dcaTag}|src=v0.10`;
      // Finding 1 — notional self-consistency assertion at the live INSERT.
      // Centralized via checkNotionalConsistency in safePnlSql.ts so the
      // tolerance + diagnostic format are identical across all three INSERT
      // sites (live / paper / reconciler).
      //
      // Commit 5 (Cascade brief 2026-05-27) — kernel-direct unit invariant.
      // `formattedSize` at this point is BASE ASSET (BTC, ETH, ...) and
      // `entryPrice` is USDT per unit base-asset; their product is USDT
      // notional, directly comparable to the kernel's intended notionalUsdt.
      // The contracts/base-asset boundary lives in poloniexFuturesService —
      // see the chunker doc at L7189 for the explicit rule:
      // "formattedSize and symbolLotSize are in BASE ASSET units. The
      //  poloniexFuturesService.placeOrder converts size/lotSize → contracts
      //  internally before sending."
      // Any future regression that stores contracts here trips this assertion
      // immediately (100× / 1000× / lot-size-recip ratio is well above 0.1%).
      const liveNotionalCheck = checkNotionalConsistency(
        entryPrice,
        formattedSize,
        notionalUsdt,
      );
      if (!liveNotionalCheck.consistent) {
        logger.error('[LIVED ONLY] live INSERT — refusing row', {
          symbol, entryPrice, formattedSize,
          diagnostic: liveNotionalCheck.diagnostic,
        });
        return { executed: false, orderId: null, reason: 'notional_mismatch_at_insert' };
      }

      const inserted = await pool.query(
        `INSERT INTO autonomous_trades
           (user_id, symbol, side, entry_price, quantity, leverage,
            confidence, reason, order_id, paper_trade, engine_version, agent, lane,
            take_profit, stop_loss, engine_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          userId, symbol, exchangeSide, entryPrice, formattedSize, leverage,
          req.phi, reasonEncoded, orderId, false, getEngineVersion(), agentTag, laneTag,
          // engine_type — consensus WR-matrix key; must match
          // consensus_arbiter `selfEngineType` ('monkey-k').
          tpPrice, slPrice, 'monkey-k',
        ],
      );
      tradeId = String((inserted.rows[0] as { id?: string | number } | undefined)?.id ?? '') || null;
    } catch (err) {
      logger.error('[Monkey] DB insert failed after exchange placement — ORPHAN RISK', {
        orderId, err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info(req.isDCAAdd ? '[Monkey] DCA_ADD PLACED' : '[Monkey] ORDER PLACED', {
      instanceId: this.instanceId,
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

    return { executed: true, orderId, reason: 'placed', tradeId };
  }

  /**
   * Per-agent reward push helper (2026-05-16). Closes that touch
   * multiple agent rows (M+T shared lane, K + L co-occupying trend,
   * etc.) accumulate per-agent (pnl, qty) totals during the row loop
   * and then call this once. Each agent with non-zero qty gets ONE
   * reward event tagged with its own agent label, so
   * `decayedRewardSums(now, 'M')` only sees M's outcomes.
   *
   * Margin = (markPrice × agentQty) / 16 — same formula
   * closeHeldPosition has always used for the K-only aggregate, just
   * stratified by agent now. Skipping zero-qty agents avoids a flood
   * of zero-pnl reward events in the bounded queue.
   */
  private pushPerAgentCloseRewards(
    symbol: string,
    markPrice: number,
    totals: Record<AgentLabel, { pnl: number; qty: number }>,
  ): void {
    const symState = this.symbolStates.get(symbol);
    try {
      for (const agentKey of ['K', 'M', 'T', 'L'] as const) {
        const t = totals[agentKey];
        if (t.qty <= 0) continue;
        const notional = markPrice * t.qty;
        const margin = notional / Math.max(1, 16);
        this.pushReward({
          source: 'own_close',
          symbol,
          realizedPnlUsdt: t.pnl,
          marginUsdt: margin,
          kappaAtExit: symState?.kappa,
          agent: agentKey,
        });
        // Mirror the close into Python autonomic so both kernels'
        // neurochemistries share the same outcome stream.
        void callAutonomicReward({
          instanceId: this.instanceId,
          source: `own_close:${agentKey}`,
          symbol,
          realizedPnlUsdt: t.pnl,
          marginUsdt: margin,
          kappaAtExit: symState?.kappa,
        });
      }
    } catch { /* non-fatal */ }
  }

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
    /** Which agent generated the outcome. Defaults to 'K' for
     *  back-compat with pre-2026-05-16 callsites that didn't pass it. */
    agent?: AgentLabel;
  }): void {
    const agent: AgentLabel = input.agent ?? 'K';
    const pnlFrac = input.marginUsdt > 0
      ? input.realizedPnlUsdt / input.marginUsdt
      : 0;

    // 2026-05-25 (observer-derive PR) — replaces magic input scales
    // (1.5×, 0.5×, 2×, /10) with observer-derived normalization against
    // the kernel's own rolling reward + κ distributions. Same MAPPING
    // shape (tanh); same OUTPUT CAPS (which are STRUCTURAL design
    // choices documented below); only the SCALES adapt to observed
    // distributions.
    //
    // Output caps (structural):
    //   - Dopamine cap 0.5 — biggest signal because dopamine directly
    //     drives reward learning (rewardMult in sizing).
    //   - Endorphin cap 0.3 — peak-state reward, smaller than dopamine
    //     so it doesn't dominate the chemistry mix; gated by κ-proximity.
    //   - Serotonin cap 0.15 — smallest because serotonin is the
    //     slow-mood-shift signal, not the per-event reward.
    //   - Loss mood-dip cap 0.1 — much smaller than the win-side dop
    //     cap so losses don't punish via dopamine (self_observation
    //     owns loss-side learning; chemistry treats losses as small mood
    //     dips, not punishments).
    //
    // pnlFrac normalization: use MAD (Median Absolute Deviation) — a
    // robust statistic that doesn't blow up under outliers — instead of
    // stddev. Production evidence 2026-05-25: a single +$78 outlier win
    // spiked the rolling stddev ~5×, suppressing chemistry response to
    // every subsequent normal-magnitude close (the kernel couldn't
    // "feel" -$5 losses as bad because they looked small relative to
    // the outlier-inflated stddev). MAD is bounded by the median's
    // breakdown point (50%) — a single outlier can't move it.
    //
    // MAD × 1.4826 ≈ stddev under Gaussian assumption; using raw MAD
    // is fine here because the multiplier would cancel in the
    // normalization ratio (and we're not making distributional claims).
    const PNL_STDDEV_MIN_SAMPLES = 5;
    let pnlFracNormalized: number = pnlFrac;
    if (this.pendingRewards.length >= PNL_STDDEV_MIN_SAMPLES) {
      const pnls = this.pendingRewards.map((r) => r.pnlFraction).sort((a, b) => a - b);
      const median = pnls.length % 2 === 0
        ? (pnls[pnls.length / 2 - 1]! + pnls[pnls.length / 2]!) / 2
        : pnls[Math.floor(pnls.length / 2)]!;
      const deviations = pnls.map((p) => Math.abs(p - median)).sort((a, b) => a - b);
      const mad = deviations.length % 2 === 0
        ? (deviations[deviations.length / 2 - 1]! + deviations[deviations.length / 2]!) / 2
        : deviations[Math.floor(deviations.length / 2)]!;
      if (mad > 1e-12) {
        pnlFracNormalized = pnlFrac / mad;
      }
    }

    // Ocean reward dispense (issue #948 / Matrix tier-3 2026-05-26):
    // positive chemistry fires ONLY at ROI ≥ 1%, scaled by Fibonacci
    // coefficient (1, 2, 3, 5, 8, 13, 21, 34). "Reward the behavior you
    // want. Not set knobs. This is how it learns." Below 1% is the
    // noise floor — sub-1% wins teach nothing because they're
    // statistically indistinguishable from fee-microstructure noise.
    //
    // Negative side unchanged — gaba on losses still feeds at the
    // existing scale. Symmetric Fibonacci punishment is an open
    // follow-on per Matrix's tier-3 walk; not assumed here.
    // Observer-derived ocean reward (P1 post-reversal): use own pnlFracHistory
    // (median + MAD) instead of hardcoded 1% external floor. History
    // maintained on the per-symbol SymbolState (bounded). Cold-start (<2
    // samples) returns gentle positive (1) on positive pnlFrac.
    const symState = input.symbol ? this.symbolStates.get(input.symbol) : undefined;
    if (symState) {
      symState.pnlFracHistory.push(pnlFrac);
      if (symState.pnlFracHistory.length > 200) symState.pnlFracHistory.shift();
    }
    const oceanCoeff = observerFibCoefficient(pnlFrac, symState ? symState.pnlFracHistory : []);
    const dop = pnlFrac > 0
      ? Math.tanh(pnlFracNormalized) * 0.5 * oceanCoeff
      : -Math.tanh(-pnlFracNormalized) * 0.1;
    const ser = pnlFrac > 0 ? Math.tanh(pnlFracNormalized) * 0.15 * oceanCoeff : 0;

    // κ-proximity width: observer-derived from the rolling distribution
    // of kappaAtExit values across recent rewards. Replaces the magic
    // `/10` decay width. When stats are insufficient, falls back to a
    // bounded identity on κ-distance (tanh-squashed).
    // 2026-05-25 — same MAD-based robust normalization. Outlier κ
    // values (e.g. a single trade that closed at κ=120) would have
    // inflated stddev under the previous formulation, suppressing the
    // κ-proximity envelope for everything else.
    let kappaProxim: number;
    if (input.kappaAtExit == null) {
      kappaProxim = 0.5;
    } else {
      const kappaHistory: number[] = [];
      for (const r of this.pendingRewards) {
        const k = (r as { kappaAtExit?: number }).kappaAtExit;
        if (typeof k === 'number' && Number.isFinite(k)) kappaHistory.push(k);
      }
      if (kappaHistory.length >= PNL_STDDEV_MIN_SAMPLES) {
        const sorted = [...kappaHistory].sort((a, b) => a - b);
        const kMedian = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
          : sorted[Math.floor(sorted.length / 2)]!;
        const kDevs = sorted.map((k) => Math.abs(k - kMedian)).sort((a, b) => a - b);
        const kMad = kDevs.length % 2 === 0
          ? (kDevs[kDevs.length / 2 - 1]! + kDevs[kDevs.length / 2]!) / 2
          : kDevs[Math.floor(kDevs.length / 2)]!;
        if (kMad > 1e-12) {
          kappaProxim = Math.exp(-Math.abs(input.kappaAtExit - KAPPA_STAR) / kMad);  // two-channel: governed ref (retired bare 64)
        } else {
          kappaProxim = 1 - Math.tanh(Math.abs(input.kappaAtExit - KAPPA_STAR));
        }
      } else {
        kappaProxim = 1 - Math.tanh(Math.abs(input.kappaAtExit - KAPPA_STAR));
      }
    }
    const endo = pnlFrac > 0
      ? Math.tanh(pnlFracNormalized) * 0.3 * kappaProxim * oceanCoeff
      : 0;

    this.pendingRewards.push({
      source: input.source,
      symbol: input.symbol,
      agent,
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
      agent,
      pnl: input.realizedPnlUsdt.toFixed(4),
      pnlFrac: (pnlFrac * 100).toFixed(2) + '%',
      oceanCoeff,
      dop: dop.toFixed(3),
      ser: ser.toFixed(3),
      endo: endo.toFixed(3),
    });

    // 2026-05-25 — kernel-rotation tracking. Update rolling PnL window
    // + consecutive-loss counter; if the close trips the demotion
    // trigger (default 5 consec losses), log + emit so operator/UI/
    // arbiter can observe. Does NOT auto-halt the kernel — chemistry
    // is the per-tick feedback channel; rotation is a structural
    // signal layered on top.
    const rotationResult = recordRotationClose(this.rotation, input.realizedPnlUsdt);
    if (rotationResult.demoted) {
      logger.warn(`[${this.label}] kernel-rotation DEMOTED to paper`, {
        instanceId: this.instanceId,
        reason: rotationResult.reason,
        rollingWinRate: rollingWinRate(this.rotation),
        rollingTrades: this.rotation.rollingPnls.length,
      });
      this.bus.publish({
        type: BusEventType.OUTCOME,
        source: this.instanceId,
        symbol: input.symbol,
        payload: {
          kind: 'kernel_rotation_demotion',
          mode: this.rotation.mode,
          reason: rotationResult.reason,
          rollingWinRate: rollingWinRate(this.rotation),
        },
      });
    }
    // 2026-05-25 — auto-promotion check. If this is a paper-mode kernel
    // and its rolling WR has caught up to within ROTATION_PROMOTION_WR_GAP
    // (10pp) of the best live peer, promote back. Idempotent: returns
    // null for live kernels or paper kernels still under the gate.
    if (this.rotation.mode === 'paper') {
      this.tryAutoPromote(input.symbol);
    }
  }

  /**
   * Auto-promotion check called after a virtual close. Walks the peer
   * registry (allMonkeyKernels) to find the best live WR; if this
   * kernel's paper-mode WR has reached the gate, promotes.
   */
  private tryAutoPromote(symbol: string | undefined): void {
    const peers: RotationPeerSnapshot[] = [];
    for (const peer of allMonkeyKernels) {
      if (peer === this) continue;
      const r = peer.rotation;
      peers.push({
        mode: r.mode,
        rollingWinRate: rollingWinRate(r),
        rollingSampleCount: r.rollingPnls.length,
      });
    }
    const reason = shouldAutoPromote(this.rotation, peers);
    if (!reason) return;
    const result = promoteToLive(this.rotation, reason);
    if (result.promoted) {
      logger.info(`[${this.label}] kernel-rotation AUTO-PROMOTED to live`, {
        instanceId: this.instanceId,
        reason: result.reason,
        rollingWinRate: rollingWinRate(this.rotation),
        rollingTrades: this.rotation.rollingPnls.length,
      });
      this.bus.publish({
        type: BusEventType.OUTCOME,
        source: this.instanceId,
        symbol,
        payload: {
          kind: 'kernel_rotation_promotion',
          mode: this.rotation.mode,
          reason: result.reason,
          rollingWinRate: rollingWinRate(this.rotation),
        },
      });
    }
  }

  /**
   * Operator-driven re-promotion of a paper-mode kernel back to live.
   * Resets the consecutive-loss counter so the kernel doesn't
   * immediately re-demote on its next close. No-op if already live.
   * Until the auto-promotion follow-up PR lands, this is the only way
   * back to live mode.
   */
  promoteKernelToLive(reason: string = 'manual operator promotion'): boolean {
    const result = promoteToLive(this.rotation, reason);
    if (result.promoted) {
      logger.info(`[${this.label}] kernel-rotation PROMOTED to live`, {
        instanceId: this.instanceId,
        reason: result.reason,
      });
    }
    return result.promoted;
  }

  /** Read-only snapshot of the rotation state for telemetry / API. */
  getRotationState(): Readonly<RotationState> {
    return this.rotation;
  }

  /**
   * Decide whether placeOrder calls should route to the paper simulator
   * instead of the real exchange. Two paths reach this:
   *   1. The global `MONKEY_PAPER_MODE=true` env (back-compat, applies
   *      to ALL kernels — used historically for whole-kernel dry runs).
   *   2. This kernel's rotation state has been demoted to 'paper'
   *      (per-kernel paper rotation, PR #921 scaffold).
   * Either path routes the same way through `paperPlaceOrder`, so the
   * downstream code is unchanged.
   */
  private shouldRouteOrdersToPaper(): boolean {
    return isMonkeyPaperMode() || this.rotation.mode === 'paper';
  }

  /**
   * Sum recent rewards with exponential time-decay. Called each tick by
   * processSymbol to build the NeurochemicalInputs reward deltas.
   * Half-life = REWARD_HALF_LIFE_MS (20 min default). Old rewards decay
   * naturally; queue also FIFO-evicts at REWARD_QUEUE_MAX.
   *
   * `agentFilter` (added 2026-05-16) selects only the rewards generated
   * by that agent. The kernel runs ONE neurochemistry (K's brain), so
   * processSymbol passes 'K' — K's wins reinforce K's dopamine, M/T/L
   * outcomes no longer dilute it. Omit the filter to get the legacy
   * shared-pool behaviour (useful for cross-agent telemetry).
   *
   * Public (2026-05-16) so per-agent NC telemetry tests + the dashboard
   * snapshot path can read decayed windows by agent. Still pure / no-op
   * if the queue is empty.
   */
  decayedRewardSums(
    nowMs: number = Date.now(),
    agentFilter?: AgentLabel,
  ): {
    dopamine: number;
    serotonin: number;
    endorphin: number;
  } {
    let dop = 0, ser = 0, endo = 0;
    for (const r of this.pendingRewards) {
      if (agentFilter !== undefined && r.agent !== agentFilter) continue;
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
          `SELECT sovereignty_score, convergence_type, created_at, exit_time, lane
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
            lane?: string | null;
          }
        | undefined;
      // SENSE-2c Phase 2 (#787 follow-up) — record (lane, win) into the
      // time-of-day-weighted accumulator. Win = realizedPnl > 0. The
      // accumulator is read by chooseLane on subsequent ticks. Recording
      // happens BEFORE the gate; the gate decides what flows into the bank,
      // not what flows into self-knowledge of "did this lane work at this hour".
      const closedLane = tripleRow?.lane as 'scalp' | 'swing' | 'trend' | 'observe' | null | undefined;
      if (closedLane === 'scalp' || closedLane === 'swing' || closedLane === 'trend' || closedLane === 'observe') {
        const isWin = realizedPnl > 0;
        recordLaneOutcome(closedLane, isWin);
      }
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
        // position (~$5 at 16x). Tagged 'K' because witnessExit feeds
        // K's bank — observation belongs to K's cognitive stream.
        this.pushReward({
          source: 'witnessed_liveSignal',
          symbol,
          realizedPnlUsdt: realizedPnl * 0.5,  // half-weight (witnessed, not her own)
          marginUsdt: 5,
          agent: 'K',
        });
        void callAutonomicReward({
          instanceId: this.instanceId,
          source: 'witnessed_liveSignal',
          symbol,
          realizedPnlUsdt: realizedPnl * 0.5,
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
    // Paper mode — synthetic bankroll, no exchange dependency. Without
    // this the kernel sizes against the REAL exchange balance even in
    // paper mode, so on an unfunded staging account availableEquity=0
    // → size.value=0 → every entry dies at the size>0 gate before any
    // trading logic runs (paper mode previously only simulated the
    // order FILL, never the equity). MONKEY_PAPER_EQUITY_USDT sets the
    // fictional bankroll; default 1000 comfortably clears BTC/ETH min
    // notionals so the kernel can size + place paper trades. The
    // kernel's paper positions live in autonomous_trades (read via
    // findOpenMonkeyTrade), so a null exchange heldSide here is correct.
    if (this.shouldRouteOrdersToPaper()) {
      const paperEquity = Number(process.env.MONKEY_PAPER_EQUITY_USDT) || 1000;
      return {
        equityFraction: Math.min(1, paperEquity / 27.15),
        marginFraction: 0,
        openPositions: 0,
        heldSide: null,
        availableEquity: paperEquity,
      };
    }
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
      // Side resolution: posSide-first, qty-sign fallback (shared helper).
      // The prior "sign of qty is authoritative" assumption was wrong for
      // HEDGE accounts — qty is a POSITIVE magnitude there and the side
      // lives in posSide. It misread every HEDGE short as a long, so when
      // a position was reversed long→short on the exchange the kernel
      // stayed stuck on `held long`, could not DCA, and was paralysed
      // (2026-05-14 incident).
      const heldSide: 'long' | 'short' | null = forSymbol
        ? resolveExchangePositionSide(forSymbol as Record<string, unknown>)
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

// User report 2026-05-19 09:53: "taking up pretty small positions compared
// to the equity. very low leverage. all wins are tiny."
//
// Sizing compounds three throttles:
//   1. sizeFraction per kernel — was 0.5 each = 1.0 combined
//   2. CREATOR_CHOP cellSizeMultiplier 0.5 (compositional_executive.ts)
//   3. phi-derived rawFrac (~0.2 typical) inside computeSize
//
// Net: 0.5 × 0.5 × 0.2 = 0.05 × bank — positions ~5% of equity.
//
// 2026-05-25 — per-kernel sizeFraction haircut removed per operator
// autonomy doctrine. Both kernels see full availableEquity; the
// exchange's margin requirements + the kernel's own chemistry feedback
// (push_reward on close → dopamine/gaba modulation) are the only
// restraints. If both kernels try to size into the same equity, the
// second one reads a reduced availableEquity naturally because the
// first's margin is already committed at the broker.
export const monkeyKernel = new MonkeyKernel({
  instanceId: 'monkey-position',
  timeframe: '15m',
  tickMs: 30_000,
  label: 'Monkey.Position',
});

export const swingMonkey = new MonkeyKernel({
  instanceId: 'monkey-swing',
  timeframe: '5m',
  tickMs: 30_000,
  label: 'Monkey.Swing',
});

export const allMonkeyKernels: readonly MonkeyKernel[] = [
  monkeyKernel,
  swingMonkey,
];

// QIG_QFI audit Action 2 (2026-05-19) — attach the dual-kernel pair
// detector to the shared bus at module load. Telemetry-only: detects
// opposing-side entries by different MonkeyKernel instances on the same
// symbol within PAIR_WINDOW_MS (60s), then evaluates the pair outcome
// when both sides exit. Logs governance warning when loser-side loss >
// winner-side gain × LOSS_OVERRUN_RATIO (1.5). Stats surfaced via
// getPairStats() for dashboards.
import { attachDualKernelPairDetector } from './dual_kernel_pair_detector.js';
attachDualKernelPairDetector(getKernelBus());


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
