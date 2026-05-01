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

// ── CHOP regime entry suppression (issue #623) ───────────────────
//
// Conservative defaults; registry-overridable via propose_change().
// Thresholds live in monkey_parameters as:
//   regime.chop_suppress.trend_confidence  (default 0.70)
//   regime.chop_suppress.swing_confidence  (default 0.85)
//
// Scalp is the chop strategy by definition — never suppressed.
// Only new entries are affected; held-position re-justification
// (#619) owns those exits independently.

export const CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT = 0.70;
export const CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT = 0.85;

export interface ChopSuppressionResult {
  regime: string;
  confidence: number;
  lane: string;
  suppressed: boolean;
  suppressReason: string | null;
}

/**
 * Evaluate whether a new entry should be suppressed based on the
 * current regime reading and the chosen execution lane.
 *
 * Rules:
 *   - scalp lane: never suppress (chop is the scalp environment)
 *   - trend lane: suppress when regime==CHOP and confidence >= trendThr
 *   - swing lane: suppress when regime==CHOP and confidence >= swingThr
 *   - TREND_UP / TREND_DOWN regimes: never suppress any lane
 *
 * Thresholds default to the constants above and may be overridden
 * by the caller (read from the parameter registry).
 */
export function chopSuppressEntry(
  reading: RegimeReading,
  lane: string,
  opts: {
    trendConfidenceThreshold?: number;
    swingConfidenceThreshold?: number;
  } = {},
): ChopSuppressionResult {
  const trendThr = opts.trendConfidenceThreshold ?? CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT;
  const swingThr = opts.swingConfidenceThreshold ?? CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT;

  const base: Omit<ChopSuppressionResult, 'suppressed' | 'suppressReason'> = {
    regime: reading.regime,
    confidence: reading.confidence,
    lane,
  };

  // Only CHOP regime triggers suppression.
  if (reading.regime !== 'CHOP') {
    return { ...base, suppressed: false, suppressReason: null };
  }

  // Scalp: chop is its home regime — never suspend.
  if (lane === 'scalp') {
    return { ...base, suppressed: false, suppressReason: null };
  }

  if (lane === 'trend' && reading.confidence >= trendThr) {
    return {
      ...base,
      suppressed: true,
      suppressReason: `regime_suppress: chop confidence ${reading.confidence.toFixed(3)}, lane trend`,
    };
  }

  if (lane === 'swing' && reading.confidence >= swingThr) {
    return {
      ...base,
      suppressed: true,
      suppressReason: `regime_suppress: chop confidence ${reading.confidence.toFixed(3)}, lane swing`,
    };
  }

  return { ...base, suppressed: false, suppressReason: null };
}
