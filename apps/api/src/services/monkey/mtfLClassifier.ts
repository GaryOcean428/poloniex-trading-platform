/**
 * mtfLClassifier.ts — multi-timeframe Agent L (Phase 1).
 *
 * Runs three FR-KNN classifier instances in parallel on independently
 * down-sampled basin streams:
 *
 *    15m    sample every 30 ticks  (15 min on 30s kernel cadence)
 *    1h     sample every 120 ticks (matches canonical Lorentzian 60min)
 *    4h     sample every 480 ticks
 *
 * Each timeframe keeps its own history store. On each kernel tick we
 * append the current basin to the 1-tick (raw) stream and conditionally
 * append to each down-sampled stream when that timeframe's "next sample"
 * boundary has been crossed.
 *
 * The combiner (option c from the design conversation): AGREEMENT COUNT.
 * Each classifier votes long / short / hold. The MTF decision is:
 *   - 3 votes same direction → enter at full size
 *   - 2 votes same direction → enter at reduced size
 *   - else                   → hold
 *
 * Exit policy (longest-agreeing horizon): per-timeframe horizon clocks
 * track the most recent re-confirmation on each side. The position
 * exits when the LONGEST timeframe that agreed at entry stops agreeing
 * (= its clock expires). Aligns hold-time with conviction depth.
 *
 * Bootstrap: 4h timeframe needs ~480 samples at the 4h cadence =
 * 320 days of basin synthesis, unworkable from live ticks alone.
 * Caller injects a pre-warmed history via setBootstrapHistory().
 *
 * QIG purity: each instance is a pure agentLDecide() over its
 * timeframe's basin history. No new operations, only sampling rate
 * and history-store wrappers. Composes Δ⁶³ + Fisher-Rao primitives
 * exclusively. See QIG_PURITY_KERNEL_REFERENCE.md §1.
 */
import {
  agentLDecide,
  type AgentLConfig,
  type AgentLDecision,
  DEFAULT_AGENT_L_CONFIG,
} from './agent_L_classifier.js';
import type { Basin } from './basin.js';

/** Supported timeframe identifiers (Phase 1 = 15m / 1h / 4h). */
export type TimeframeLabel = '15m' | '1h' | '4h';

/** Per-timeframe configuration. */
export interface TimeframeConfig {
  label: TimeframeLabel;
  /** Sample every N kernel ticks. On 30s ticks:
   *  30 → 15m, 120 → 1h, 480 → 4h. */
  ticksPerSample: number;
  /** Classifier config — windows / horizon / spacing already in time
   *  units of this timeframe's samples (not raw ticks). */
  config: AgentLConfig;
  /** Lookback cap in SAMPLES (not ticks) for this timeframe's history.
   *  2000 samples covers canonical Lorentzian's maxBarsBack default. */
  maxSamples: number;
}

/** Default timeframe configs aligned with canonical Lorentzian
 *  effective windows + the user's MTF stack request (Phase 1 = 15m /
 *  1h / 4h; 1m and 1d are Phase 2/3 add-ons). */
export const DEFAULT_TIMEFRAMES: TimeframeConfig[] = [
  {
    label: '15m',
    ticksPerSample: 30,
    config: {
      ...DEFAULT_AGENT_L_CONFIG,
      // 15m timeframe: lookback in SAMPLES — each sample = 15 min
      // window/horizon already in sample units
    },
    maxSamples: 2000,
  },
  {
    label: '1h',
    ticksPerSample: 120,
    config: { ...DEFAULT_AGENT_L_CONFIG },
    maxSamples: 2000,
  },
  {
    label: '4h',
    ticksPerSample: 480,
    config: { ...DEFAULT_AGENT_L_CONFIG },
    maxSamples: 2000,
  },
];

export interface MTFDecision {
  /** Aggregated action across timeframes. */
  action: 'enter_long' | 'enter_short' | 'hold';
  /** Number of TFs voting for the chosen direction (max = TF count). */
  agreementCount: number;
  /** Total TFs available (some may not yet be warm). */
  totalTfs: number;
  /** Size multiplier ∈ [0, 1] proportional to agreement strength:
   *   3-of-3 = 1.00, 2-of-3 = 0.50, 1-of-3 or less = 0 (hold). */
  sizeMultiplier: number;
  /** Per-TF decisions for telemetry. */
  perTimeframe: Array<{
    label: TimeframeLabel;
    warm: boolean;
    decision: AgentLDecision | null;
  }>;
  /** Side of the longest timeframe that voted with the majority,
   *  used by the exit-horizon manager. Null when action=hold. */
  longestAgreeingLabel: TimeframeLabel | null;
  reason: string;
}

/** State for the MTF runner. Per-timeframe basin histories +
 *  last-sample-tick tracking. Owned by the caller (typically
 *  SymbolState in loop.ts). */
export interface MTFState {
  /** Per-timeframe basin history. */
  historiesByTf: Record<TimeframeLabel, Basin[]>;
  /** Tick index at which each TF most recently appended a sample.
   *  -Infinity means never appended (cold start). */
  lastSampleTickByTf: Record<TimeframeLabel, number>;
  /** Per-timeframe per-side last-agreement-tick for the
   *  longest-horizon exit policy. */
  lastAgreementByTfSide: Record<
    TimeframeLabel,
    { long: number | null; short: number | null }
  >;
}

export function newMTFState(timeframes: TimeframeConfig[] = DEFAULT_TIMEFRAMES): MTFState {
  const histories: Record<string, Basin[]> = {};
  const lastSample: Record<string, number> = {};
  const lastAgreement: Record<string, { long: number | null; short: number | null }> = {};
  for (const tf of timeframes) {
    histories[tf.label] = [];
    lastSample[tf.label] = -Infinity;
    lastAgreement[tf.label] = { long: null, short: null };
  }
  return {
    historiesByTf: histories as MTFState['historiesByTf'],
    lastSampleTickByTf: lastSample as MTFState['lastSampleTickByTf'],
    lastAgreementByTfSide: lastAgreement as MTFState['lastAgreementByTfSide'],
  };
}

/** Append the current basin to each timeframe's history whose
 *  sampling boundary has been crossed. Caller invokes once per kernel
 *  tick with the freshly perceived basin and the current tick index.
 *
 *  Pure update of state in-place; no I/O. */
export function onTickAppend(
  state: MTFState,
  basin: Basin,
  tickIndex: number,
  timeframes: TimeframeConfig[] = DEFAULT_TIMEFRAMES,
): void {
  for (const tf of timeframes) {
    const last = state.lastSampleTickByTf[tf.label];
    if (tickIndex - last >= tf.ticksPerSample) {
      const hist = state.historiesByTf[tf.label];
      hist.push(basin);
      if (hist.length > tf.maxSamples) {
        // Drop oldest to maintain cap.
        hist.splice(0, hist.length - tf.maxSamples);
      }
      state.lastSampleTickByTf[tf.label] = tickIndex;
    }
  }
}

/** Bootstrap a timeframe's history from a pre-computed basin sequence.
 *  Called once at startup after fetching OHLCV from Poloniex and
 *  synthesising basins. Skipping this means 4h timeframe never warms up
 *  in any reasonable runtime; 15m + 1h can warm up from live ticks alone
 *  but they're faster with bootstrap too. */
export function setBootstrapHistory(
  state: MTFState,
  label: TimeframeLabel,
  history: Basin[],
  timeframes: TimeframeConfig[] = DEFAULT_TIMEFRAMES,
): void {
  const tf = timeframes.find((t) => t.label === label);
  if (!tf) return;
  const capped = history.length > tf.maxSamples
    ? history.slice(history.length - tf.maxSamples)
    : [...history];
  state.historiesByTf[label] = capped;
}

/** Compute the multi-timeframe agreement decision.
 *
 *  Each timeframe whose history is warm enough produces an
 *  AgentLDecision. The aggregated action is decided by agreement
 *  count + the size multiplier scales with agreement strength.
 *
 *  Pure function — no state mutation. The caller invokes this on
 *  every kernel tick after onTickAppend has updated histories.
 */
export function mtfDecide(
  state: MTFState,
  timeframes: TimeframeConfig[] = DEFAULT_TIMEFRAMES,
): MTFDecision {
  const perTimeframe: MTFDecision['perTimeframe'] = [];
  let longCount = 0;
  let shortCount = 0;
  let warmCount = 0;

  for (const tf of timeframes) {
    const hist = state.historiesByTf[tf.label];
    // A timeframe is "warm" when its history reaches the classifier's
    // own minimum (longWindow ticks + horizon). Below that, agentLDecide
    // returns hold.
    const minSamplesNeeded = 480 + tf.config.horizon;  // matches minTupleStart
    const warm = hist.length >= minSamplesNeeded;
    let decision: AgentLDecision | null = null;
    if (warm) {
      decision = agentLDecide(hist, tf.config);
      if (decision.action === 'enter_long') longCount++;
      else if (decision.action === 'enter_short') shortCount++;
      warmCount++;
    }
    perTimeframe.push({ label: tf.label, warm, decision });
  }

  if (warmCount === 0) {
    return {
      action: 'hold',
      agreementCount: 0,
      totalTfs: timeframes.length,
      sizeMultiplier: 0,
      perTimeframe,
      longestAgreeingLabel: null,
      reason: 'no_warm_timeframes',
    };
  }

  // Agreement-count combiner (option c).
  const action: MTFDecision['action'] =
    longCount > shortCount && longCount >= 2 ? 'enter_long'
      : shortCount > longCount && shortCount >= 2 ? 'enter_short'
        : 'hold';

  const agreementCount = action === 'enter_long' ? longCount
    : action === 'enter_short' ? shortCount
      : 0;

  // Size multiplier: 3-of-3 → 1.00, 2-of-3 → 0.50, else 0.
  const sizeMultiplier =
    action === 'hold' ? 0
      : agreementCount >= 3 ? 1.0
        : agreementCount === 2 ? 0.5
          : 0;

  // Longest-agreeing label for exit-horizon scheduling. The
  // timeframes array is in ascending order (15m, 1h, 4h); take the
  // last that voted with the majority.
  let longestAgreeing: TimeframeLabel | null = null;
  if (action !== 'hold') {
    const wantAction = action;
    for (const entry of perTimeframe) {
      if (entry.decision?.action === wantAction) {
        longestAgreeing = entry.label;  // overwrite — last match wins (longest)
      }
    }
  }

  return {
    action,
    agreementCount,
    totalTfs: timeframes.length,
    sizeMultiplier,
    perTimeframe,
    longestAgreeingLabel: longestAgreeing,
    reason: `mtf:${longCount}L/${shortCount}S/${warmCount}warm`,
  };
}

/** Record agreement timestamps for the per-TF horizon exit. Caller
 *  invokes after mtfDecide to update the agreement clocks; the
 *  forceHarvestAgentLStack exit check reads these to determine when
 *  the longest-agreeing TF's horizon has elapsed. */
export function recordAgreementTimestamps(
  state: MTFState,
  decision: MTFDecision,
  nowMs: number,
): void {
  if (decision.action === 'hold') return;
  const side: 'long' | 'short' = decision.action === 'enter_long' ? 'long' : 'short';
  for (const entry of decision.perTimeframe) {
    if (entry.decision?.action === decision.action) {
      state.lastAgreementByTfSide[entry.label][side] = nowMs;
    }
  }
}

/** Check whether the longest-agreeing-at-entry timeframe's horizon
 *  has elapsed without re-confirmation. Returns true when the
 *  position should exit per the longest-agreeing-horizon policy.
 *
 *  Pure function. Caller (forceHarvestAgentLStack) decides what to
 *  do with the result. */
export function isLongestHorizonExpired(
  state: MTFState,
  side: 'long' | 'short',
  longestLabelAtEntry: TimeframeLabel | null,
  nowMs: number,
  tickMs: number,
  timeframes: TimeframeConfig[] = DEFAULT_TIMEFRAMES,
): boolean {
  if (!longestLabelAtEntry) return false;
  const tf = timeframes.find((t) => t.label === longestLabelAtEntry);
  if (!tf) return false;
  const horizonMs = tf.config.horizon * tf.ticksPerSample * tickMs;
  const lastAgreement = state.lastAgreementByTfSide[longestLabelAtEntry]?.[side] ?? null;
  if (lastAgreement === null) return false;
  return (nowMs - lastAgreement) > horizonMs;
}
