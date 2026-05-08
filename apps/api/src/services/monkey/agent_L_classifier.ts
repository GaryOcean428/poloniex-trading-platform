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
 */

import { fisherRao, frechetMean, type Basin } from './basin.js';
import { basinDirection } from './perception.js';

/** A multi-scale basin tuple. One slot per time scale. */
export interface BasinTuple {
  /** Current tick — finest perceptual scale. */
  current: Basin;
  /** Medium-window Fréchet mean (~12 ticks ≈ 1h on 5m stream). */
  medium: Basin;
  /** Long-window Fréchet mean (~48 ticks ≈ 4h on 5m stream). */
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
 *  - medium = Fréchet mean of the last `mediumWindow` basins (default 12)
 *  - long = Fréchet mean of the last `longWindow` basins (default 48)
 *  When the history is too short, falls back to using the available subset. */
export function buildBasinTuple(
  history: readonly Basin[],
  mediumWindow: number = 12,
  longWindow: number = 48,
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
  reason: string;
}

export interface AgentLConfig {
  /** K nearest neighbors. Default 8. */
  k: number;
  /** Chronological spacing — only consider every Nth past basin tuple
   *  to ensure neighbors are chronologically distinct. Default 4. */
  spacing: number;
  /** Future-bar horizon for label computation. Default 4. */
  horizon: number;
  /** Threshold to call basinDirection a long/short realization. Default 0.025. */
  labelThreshold: number;
  /** Per-scale weights. Default DEFAULT_SCALE_WEIGHTS. */
  weights: ScaleWeights;
  /** Minimum signed-score magnitude to act (else hold). Default 0.20. */
  actionThreshold: number;
  /** Lookback cap on history. Default 2000 (matches Pine Script default). */
  maxLookback: number;
}

export const DEFAULT_AGENT_L_CONFIG: AgentLConfig = {
  k: 8,
  spacing: 4,
  horizon: 4,
  labelThreshold: 0.025,
  weights: DEFAULT_SCALE_WEIGHTS,
  actionThreshold: 0.20,
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
export function agentLDecide(
  basinHistory: readonly Basin[],
  config: AgentLConfig = DEFAULT_AGENT_L_CONFIG,
): AgentLDecision {
  const cur = buildBasinTuple(basinHistory);
  if (cur === null) {
    return {
      action: 'hold', signedScore: 0, conviction: 0, neighbors: [],
      reason: 'history empty',
    };
  }

  const lookback = Math.min(config.maxLookback, basinHistory.length);
  const startIdx = Math.max(0, basinHistory.length - lookback);
  const minTupleStart = 48;  // need at least longWindow ticks to build a tuple

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
      reason: `insufficient candidates (${candidates.length} < ${Math.ceil(config.k / 2)})`,
    };
  }

  // K nearest by FR distance.
  candidates.sort((a, b) => a.distance - b.distance);
  const topK = candidates.slice(0, config.k);

  // Inverse-distance-weighted signed vote.
  const eps = 1e-9;
  let weightSum = 0;
  let signedSum = 0;
  let alignCount = 0;
  for (const n of topK) {
    const w = 1 / (n.distance + eps);
    weightSum += w;
    signedSum += w * n.label;
  }
  const signedScore = weightSum > 0 ? signedSum / weightSum : 0;
  const direction = signedScore > 0 ? 1 : signedScore < 0 ? -1 : 0;
  for (const n of topK) {
    if (n.label === direction && direction !== 0) alignCount++;
  }
  const conviction = topK.length > 0 ? alignCount / topK.length : 0;

  if (Math.abs(signedScore) < config.actionThreshold) {
    return {
      action: 'hold', signedScore, conviction, neighbors: topK,
      reason: `signed score ${signedScore.toFixed(3)} below action threshold ${config.actionThreshold}`,
    };
  }

  return {
    action: signedScore > 0 ? 'enter_long' : 'enter_short',
    signedScore,
    conviction,
    neighbors: topK,
    reason: `FR-KNN k=${config.k} score=${signedScore.toFixed(3)} conviction=${conviction.toFixed(2)}`,
  };
}
