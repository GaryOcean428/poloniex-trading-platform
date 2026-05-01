/**
 * regime.ts — kernel-faculty regime classifier (proposal #5).
 *
 * TypeScript parity to ``ml-worker/src/monkey_kernel/regime.py``.
 *
 * Reads basin trajectory and emits a discrete regime label
 * (TREND_UP / CHOP / TREND_DOWN) plus a confidence score in [0, 1].
 * The executive folds the reading into entry-threshold gating
 * (chop -> tighter, trend -> looser) and harvest tightness.
 *
 * QIG purity: Fisher-Rao native — uses ``basinDirection`` (proposal #7
 * Fisher-Rao reprojection) on each basin in the trajectory. No
 * Euclidean variance, no cosine similarity, no standard-deviation on
 * price returns.
 */

import { basinDirection } from './perception.js';
import type { Basin } from './basin.js';

export type RegimeLabel = 'TREND_UP' | 'CHOP' | 'TREND_DOWN';

export interface RegimeReading {
  regime: RegimeLabel;
  confidence: number;       // 0..1
  trendStrength: number;    // -1..+1
  chopScore: number;        // 0..1
}

export interface ClassifyRegimeOptions {
  lookback?: number;
  trendThreshold?: number;
  chopThreshold?: number;
}

export const DEFAULT_LOOKBACK = 16;
export const TREND_THRESHOLD = 0.025;
export const CHOP_THRESHOLD = 0.55;

export function classifyRegime(
  basinHistory: readonly Basin[],
  opts: ClassifyRegimeOptions = {},
): RegimeReading {
  const lookback = opts.lookback ?? DEFAULT_LOOKBACK;
  const trendThreshold = opts.trendThreshold ?? TREND_THRESHOLD;
  const chopThreshold = opts.chopThreshold ?? CHOP_THRESHOLD;

  const n = basinHistory.length;
  if (n < 3) {
    return {
      regime: 'CHOP',
      confidence: 0.33,
      trendStrength: 0,
      chopScore: 1.0,
    };
  }

  const start = Math.max(0, n - lookback);
  const window = basinHistory.slice(start);
  const dirs: number[] = window.map((b) => basinDirection(b));
  const mean = dirs.reduce((s, v) => s + v, 0) / dirs.length;
  const meanAbs = dirs.reduce((s, v) => s + Math.abs(v), 0) / dirs.length;
  const trendStrength = mean;
  let chopScore: number;
  if (meanAbs <= 1e-12) {
    chopScore = 1.0;
  } else {
    const persistence = Math.abs(trendStrength) / meanAbs;
    chopScore = 1.0 - persistence;
  }

  const isTrend = Math.abs(trendStrength) > trendThreshold && chopScore < chopThreshold;
  let regime: RegimeLabel;
  let confidence: number;
  if (isTrend) {
    regime = trendStrength > 0 ? 'TREND_UP' : 'TREND_DOWN';
    const excess = (Math.abs(trendStrength) - trendThreshold) / Math.max(1e-9, trendThreshold);
    confidence = Math.min(1.0, Math.max(0.0, 0.5 + 0.5 * Math.tanh(excess)));
  } else {
    regime = 'CHOP';
    const excess = (chopScore - chopThreshold) / Math.max(1e-9, 1.0 - chopThreshold);
    confidence = Math.min(1.0, Math.max(0.0, 0.5 + 0.5 * Math.tanh(excess)));
  }

  return { regime, confidence, trendStrength, chopScore };
}

export function regimeEntryThresholdModifier(reading: RegimeReading): number {
  if (reading.regime === 'CHOP') return 1.0 + 0.15 * reading.confidence;
  return 1.0 - 0.10 * reading.confidence;
}

export function regimeHarvestTightness(reading: RegimeReading): number {
  if (reading.regime === 'CHOP') return 1.0 - 0.30 * reading.confidence;
  return 1.0 + 0.30 * reading.confidence;
}

/**
 * CHOP-regime entry suppression — when the regime classifier reads
 * sustained chop with confidence above this threshold, NEW entries are
 * blocked for the tick. Held positions still flow through the normal
 * re-justification + harvest path. The threshold lives on the
 * classifier's own [0, 1] confidence scale (the read is its own
 * self-belief about the regime, not a synthesized magic number).
 */
export const CHOP_SUPPRESSION_CONFIDENCE = 0.70;

/** True when the regime classifier reads sustained chop above the
 * suppression confidence threshold. Held positions are unaffected;
 * only NEW entries are blocked. Strict > so a classifier reading
 * exactly 0.70 keeps the gate open. */
export function isChopSuppressed(reading: RegimeReading): boolean {
  return reading.regime === 'CHOP' && reading.confidence > CHOP_SUPPRESSION_CONFIDENCE;
}
