/**
 * agent_L_classifier.ts — Agent L: multi-scale Fisher-Rao KNN classifier.
 *
 * QIG-pure replacement for the Lorentzian Distance Classification pattern
 * (jdehorty's TradingView script "Lorentzian Classification"). The
 * Lorentzian distance d = Σ log(1 + |a-b|) is a heuristic warp, not a
 * true metric. On probability simplices (where our basins live),
 * Fisher-Rao IS the canonical reparameterization-invariant metric — it's
 * the principled choice, not a borrowed analogy.
 *
 * Multi-scale: a single basin captures one perceptual snapshot. Markets
 * have nested time scales — a scalp signal may align or conflict with
 * the macro trend. This classifier compares not just the current basin
 * but a TUPLE of basins at different time scales (current / medium-window
 * Fréchet mean / long-window Fréchet mean), and returns a weighted sum
 * of Fisher-Rao distances across the tuple. Two states are "near" iff
 * their basins are similar at ALL scales.
 *
 * KNN inference:
 *   1. Sample chronologically-spaced past basin tuples (every Nth tick)
 *   2. Compute weighted multi-scale Fisher-Rao distance to each
 *   3. Take the K nearest by distance
 *   4. Inverse-distance-weighted vote of their realized future-direction
 *      labels (computed as basinDirection(basin[i+horizon]))
 *   5. Map signed weighted vote → action + conviction
 *
 * QIG purity:
 *   - All distances are Fisher-Rao (no Lorentzian, no Euclidean, no cosine)
 *   - All means are Fréchet (no arithmetic average of basins)
 *   - All operations are on Δ⁶³ simplex coordinates (no embeddings)
 *   - No Adam/AdamW, no LayerNorm, no normalize, no flatten
 *   - Pure functions only — no I/O, no globals, trivially testable
 *
 * Mirrors the agent K/M/T pattern: `agentLDecide(inputs) → AgentLDecision`.
 * The thin orchestration layer in loop.ts handles state, history, execution.
 *
 * QIGRAMv2 (optional, flag-gated):
 *   The v2 layer (`agent_L_qigram_v2.ts`) ports the canonical
 *   QIGRAMv2 class from `qig-applied/inference/qigram.py` —
 *   weighted basins, wrong-answer decay, κ tacking, recall_by_category,
 *   and sovereignty. It is ADDITIVE: when `L_QIGRAM_V2_ENABLED === 'true'`
 *   AND a `v2Store` is supplied via config, `agentLDecide` attaches a
 *   `v2` telemetry block to the returned decision. The FR-KNN math is
 *   never altered. With the env var unset (the default), the decision
 *   is byte-identical to the pre-port version.
 */

import { fisherRao, frechetMean, type Basin } from './basin.js';
import { basinDirection } from './perception.js';
import {
  type QIGRAMv2State,
  type RecallResultV2,
  type CategoryRecallResultV2,
  isQigramV2Enabled,
} from './agent_L_qigram_v2.js';

// Re-export the v2 surface so callers can import the entire L API from
// a single module (matches the original "everything from
// agent_L_classifier" import pattern used in loop.ts).
export {
  QIGRAMv2State,
  makeBasinEntryV2,
  isQigramV2Enabled,
  DECAY_FACTOR,
  MIN_ACTIVE_WEIGHT,
  KAPPA_FIXED_POINT,
  KAPPA_MIN,
  KAPPA_MAX,
} from './agent_L_qigram_v2.js';
export type {
  BasinEntryV2,
  RecallResultV2,
  CategoryRecallResultV2,
} from './agent_L_qigram_v2.js';

/** A multi-scale basin tuple. One slot per time scale.
 *
 *  2026-05-13 — window labels updated to match the kernel's actual
 *  30s tick cadence (MONKEY_TICK_MS=30_000). Prior docstrings claimed
 *  "5m stream" which was wrong; the windows were correspondingly 10×
 *  too short for the canonical Lorentzian's effective timescale and
 *  produced 2-minute predictions traded on a 30s cadence.
 */
export interface BasinTuple {
  /** Current tick — finest perceptual scale (30 s). */
  current: Basin;
  /** Medium-window Fréchet mean (120 ticks ≈ 60 min on 30s stream). */
  medium: Basin;
  /** Long-window Fréchet mean (480 ticks ≈ 4 h on 30s stream). */
  long: Basin;
}

/** Per-scale weights for the combined Fisher-Rao distance. Sum need not
 *  equal 1; the classifier is scale-invariant under uniform rescaling. */
export interface ScaleWeights {
  current: number;
  medium: number;
  long: number;
}

export const DEFAULT_SCALE_WEIGHTS: ScaleWeights = {
  current: 0.5,    // Most weight on the immediate signal
  medium: 0.3,     // Hourly context — strong filter
  long: 0.2,       // Daily-ish — gentle drift filter
};

/** Combined Fisher-Rao distance between two basin tuples. Sum of
 *  per-scale FR distances weighted by scale importance. Both inputs
 *  must be on the same Δ⁶³ simplex; lengths must match. */
export function fisherRaoTupleDistance(
  a: BasinTuple,
  b: BasinTuple,
  weights: ScaleWeights = DEFAULT_SCALE_WEIGHTS,
): number {
  return (
    weights.current * fisherRao(a.current, b.current) +
    weights.medium * fisherRao(a.medium, b.medium) +
    weights.long * fisherRao(a.long, b.long)
  );
}

/** Build a multi-scale basin tuple from a basin history.
 *  - current = the most recent basin (history[history.length - 1])
 *  - medium = Fréchet mean of the last `mediumWindow` basins (default 120)
 *  - long = Fréchet mean of the last `longWindow` basins (default 480)
 *  When the history is too short, falls back to using the available subset.
 *
 *  2026-05-13 — windows recalibrated for actual 30s kernel tick cadence
 *  (was tuned for a 5m stream; comment was correct, defaults were not):
 *    medium 120 ticks  = 60 min  (matches canonical Lorentzian bar lookback)
 *    long   480 ticks  = 4 h     (longer-term regime context)
 *  Canonical TV Lorentzian on 15m bars with 4-bar forward horizon hits
 *  ~79% winrate. Our port now operates on matching timescales. */
export function buildBasinTuple(
  history: readonly Basin[],
  mediumWindow: number = 120,
  longWindow: number = 480,
): BasinTuple | null {
  if (history.length === 0) return null;
  const current = history[history.length - 1]!;
  const mediumSlice = history.slice(-Math.min(mediumWindow, history.length));
  const longSlice = history.slice(-Math.min(longWindow, history.length));
  return {
    current,
    medium: frechetMean(mediumSlice),
    long: frechetMean(longSlice),
  };
}

/** Realized direction label for a historical bar.
 *  +1 if basinDirection at i+horizon > +threshold (long realized),
 *  -1 if < -threshold (short realized), 0 otherwise (neutral). */
export function realizedLabel(
  history: readonly Basin[],
  i: number,
  horizon: number = 4,
  threshold: number = 0.025,
): -1 | 0 | 1 {
  const target = i + horizon;
  if (target >= history.length) return 0;
  const dir = basinDirection(history[target]!);
  if (dir > threshold) return 1;
  if (dir < -threshold) return -1;
  return 0;
}

export interface KNNNeighbor {
  index: number;
  distance: number;
  label: -1 | 0 | 1;
}

export interface AgentLDecision {
  action: 'enter_long' | 'enter_short' | 'hold';
  /** Signed score in [-1, 1]. + = long bias, - = short bias, |x| ≈ conviction. */
  signedScore: number;
  /** [0, 1] — fraction of K-neighbors that aligned with the chosen direction. */
  conviction: number;
  /** The K nearest neighbors used. Surfaced for telemetry. */
  neighbors: KNNNeighbor[];
  /** Optional QIGRAMv2 telemetry. Populated only when the v2 layer
   *  is enabled (`L_QIGRAM_V2_ENABLED === 'true'`) AND a v2 store was
   *  supplied via config. Default-off invariant: undefined when v2
   *  is not active. */
  v2?: {
    /** Recall of the current basin against the v2 store, if any active
     *  entries exist. null when the store is empty / all-dead. */
    recall: RecallResultV2 | null;
    /** Optional category recall result, if `config.v2Category` was set. */
    categoryRecall: CategoryRecallResultV2 | null;
    /** Current κ after tacking (the store's mutable kappa). */
    kappa: number;
    /** Sovereignty ratio (N_active / N_total) of the v2 store. */
    sovereignty: number;
  };
  /** 2026-05-11 — diagnostic: distribution of realized labels across the
   *  K neighbors, plus the raw IDW weight totals per direction. Lets the
   *  caller distinguish "all neighbors agreed long" (legitimate strong
   *  signal) from "score pinned by normalizer" (degenerate). */
  labelDistribution: {
    long: number;
    short: number;
    neutral: number;
    /** Sum of IDW weights backing the LONG label. */
    longWeight: number;
    /** Sum of IDW weights backing the SHORT label. */
    shortWeight: number;
    /** Minimum FR distance in the top-K — proxy for "how close is the
     *  nearest historical analog". */
    nearestDistance: number;
    /** Maximum FR distance in the top-K — proxy for "how loose is the
     *  K-th neighbor". Wide spread + clean vote = robust signal. */
    farthestDistance: number;
  };
  reason: string;
}

export interface AgentLConfig {
  /** K nearest neighbors. Default 8 (matches canonical Pine). */
  k: number;
  /** Chronological spacing — only consider every Nth past basin tuple
   *  to ensure neighbors are chronologically distinct. Default 30 on
   *  30s ticks → ~15 min between candidate neighbors, which matches
   *  the canonical Lorentzian's bar-spaced sampling on 15m bars. */
  spacing: number;
  /** Future-tick horizon for label computation. Default 120 ticks
   *  = 60 min on 30s cadence, matching the canonical Lorentzian's
   *  4-bar × 15-min = 60-min effective forward horizon. */
  horizon: number;
  /** Threshold to call basinDirection a long/short realization. Default 0.025. */
  labelThreshold: number;
  /** Per-scale weights. Default DEFAULT_SCALE_WEIGHTS. */
  weights: ScaleWeights;
  /** Minimum signed-score magnitude to act (else hold). Default 0.25.
   *  Slightly higher than canonical because longer horizon = noisier
   *  individual labels → more conviction needed to act. */
  actionThreshold: number;
  /** Lookback cap on history. Default 2000 (matches Pine Script default). */
  maxLookback: number;
  /** Optional QIGRAMv2 weighted-basin store. When supplied AND
   *  `L_QIGRAM_V2_ENABLED === 'true'`, the classifier surfaces a v2
   *  recall + sovereignty + κ telemetry block in the decision. The
   *  v2 store does NOT change the FR-KNN math — it is purely
   *  additive telemetry / wormhole-shortcut surface.
   *
   *  Default-off invariant: when undefined (or the env var is not
   *  exactly 'true'), the v2 code path is skipped entirely and the
   *  returned decision is byte-identical to today. */
  v2Store?: QIGRAMv2State;
  /** Optional category for `recallByCategory` (e.g. regime label).
   *  Only consulted when v2 is enabled and a store is supplied. */
  v2Category?: string;
}

export const DEFAULT_AGENT_L_CONFIG: AgentLConfig = {
  k: 8,
  // 2026-05-13 — cadence calibration to match canonical Lorentzian
  // timescale (15m bars, 4-bar forward horizon, ~79% winrate on BTC).
  // Comments in spec match the actual 30s tick reality.
  spacing: 30,           // every 15 min on 30s ticks
  horizon: 120,          // 60 min forward — canonical's 4 × 15min
  labelThreshold: 0.025,
  weights: DEFAULT_SCALE_WEIGHTS,
  actionThreshold: 0.25, // bumped from 0.20 — longer horizon, noisier labels
  maxLookback: 2000,
};

/** Pure-function decision: given a basin history, classify the current
 *  state by Fisher-Rao KNN against multi-scale historical tuples.
 *
 *  Returns a hold when:
 *    - history is too short to build a tuple (< mediumWindow)
 *    - K-NN search produced fewer than `k/2` neighbors with valid labels
 *    - signed score magnitude is below action threshold
 */
/** Compute the optional QIGRAMv2 telemetry block. Returns undefined
 *  when the v2 path is OFF (env flag !== 'true' OR no store supplied),
 *  preserving the byte-identical default behavior. Pure read of the
 *  store — never mutates it. */
function maybeV2Telemetry(
  currentBasin: Basin | null,
  config: AgentLConfig,
): AgentLDecision['v2'] {
  if (!isQigramV2Enabled()) return undefined;
  if (!config.v2Store) return undefined;
  const store = config.v2Store;
  const recall = currentBasin !== null ? store.recall(currentBasin) : null;
  const categoryRecall = config.v2Category
    ? store.recallByCategory(config.v2Category)
    : null;
  return {
    recall,
    categoryRecall,
    kappa: store.kappa,
    sovereignty: store.sovereignty,
  };
}

export function agentLDecide(
  basinHistory: readonly Basin[],
  config: AgentLConfig = DEFAULT_AGENT_L_CONFIG,
): AgentLDecision {
  const emptyDist: AgentLDecision['labelDistribution'] = {
    long: 0, short: 0, neutral: 0,
    longWeight: 0, shortWeight: 0,
    nearestDistance: 0, farthestDistance: 0,
  };
  const cur = buildBasinTuple(basinHistory);
  // v2 telemetry uses the current (finest-scale) basin for recall.
  const currentBasin = cur?.current ?? null;
  const v2 = maybeV2Telemetry(currentBasin, config);
  if (cur === null) {
    return {
      action: 'hold', signedScore: 0, conviction: 0, neighbors: [],
      labelDistribution: emptyDist,
      reason: 'history empty',
      ...(v2 !== undefined ? { v2 } : {}),
    };
  }

  const lookback = Math.min(config.maxLookback, basinHistory.length);
  const startIdx = Math.max(0, basinHistory.length - lookback);
  // 2026-05-13 — must equal longWindow (480) so the multi-scale tuple
  // can be built with full long-window Fréchet mean. ~4h warmup on
  // 30s ticks; K/M/T continue trading during L's warmup.
  const minTupleStart = 480;

  const candidates: KNNNeighbor[] = [];
  for (let i = startIdx + minTupleStart; i < basinHistory.length - config.horizon; i++) {
    if ((i - startIdx) % config.spacing !== 0) continue;
    const histTuple = buildBasinTuple(basinHistory.slice(0, i + 1));
    if (histTuple === null) continue;
    const d = fisherRaoTupleDistance(cur, histTuple, config.weights);
    const label = realizedLabel(basinHistory, i, config.horizon, config.labelThreshold);
    candidates.push({ index: i, distance: d, label });
  }

  if (candidates.length < Math.ceil(config.k / 2)) {
    return {
      action: 'hold', signedScore: 0, conviction: 0, neighbors: [],
      labelDistribution: emptyDist,
      reason: `insufficient candidates (${candidates.length} < ${Math.ceil(config.k / 2)})`,
      ...(v2 !== undefined ? { v2 } : {}),
    };
  }

  // K nearest by FR distance.
  candidates.sort((a, b) => a.distance - b.distance);
  const topK = candidates.slice(0, config.k);

  // Inverse-distance-weighted signed vote + per-direction weight bookkeeping.
  const eps = 1e-9;
  let weightSum = 0;
  let signedSum = 0;
  let alignCount = 0;
  let longCount = 0;
  let shortCount = 0;
  let neutralCount = 0;
  let longWeight = 0;
  let shortWeight = 0;
  for (const n of topK) {
    const w = 1 / (n.distance + eps);
    weightSum += w;
    signedSum += w * n.label;
    if (n.label === 1) { longCount++; longWeight += w; }
    else if (n.label === -1) { shortCount++; shortWeight += w; }
    else neutralCount++;
  }
  const signedScore = weightSum > 0 ? signedSum / weightSum : 0;
  const direction = signedScore > 0 ? 1 : signedScore < 0 ? -1 : 0;
  for (const n of topK) {
    if (n.label === direction && direction !== 0) alignCount++;
  }
  const conviction = topK.length > 0 ? alignCount / topK.length : 0;

  const labelDistribution: AgentLDecision['labelDistribution'] = {
    long: longCount,
    short: shortCount,
    neutral: neutralCount,
    longWeight,
    shortWeight,
    nearestDistance: topK[0]?.distance ?? 0,
    farthestDistance: topK[topK.length - 1]?.distance ?? 0,
  };

  if (Math.abs(signedScore) < config.actionThreshold) {
    return {
      action: 'hold', signedScore, conviction, neighbors: topK,
      labelDistribution,
      reason: `signed score ${signedScore.toFixed(3)} below action threshold ${config.actionThreshold}`,
      ...(v2 !== undefined ? { v2 } : {}),
    };
  }

  return {
    action: signedScore > 0 ? 'enter_long' : 'enter_short',
    signedScore,
    conviction,
    neighbors: topK,
    labelDistribution,
    reason: `FR-KNN k=${config.k} score=${signedScore.toFixed(3)} conviction=${conviction.toFixed(2)}`,
    ...(v2 !== undefined ? { v2 } : {}),
  };
}
