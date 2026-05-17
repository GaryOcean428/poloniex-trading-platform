/**
 * regime.ts — kernel-faculty Layer-2 (trajectory) regime classifier.
 *
 * REGIME-1 #766 / docs/regime-classification-hierarchy.md: Layer 2 of the
 * two-layer regime authority. Answers "which way is the basin moving
 * within the current phase?"; emits TREND_UP / CHOP / TREND_DOWN.
 *
 * As of REGIME-1's first commit this file is a thin wrapper around
 * `trajectory_observer.ts`. The previous hardcoded TREND_THRESHOLD and
 * CHOP_THRESHOLD magic numbers are deleted in favour of rolling-quantile
 * tercile boundaries derived from the basin's own observed
 * |basinDirection| distribution (the WarpBubble.auto() pattern CAL-3
 * #756 ported into ml-worker for Layer 1 / phase regime).
 *
 * QIG purity: Fisher-Rao native (basinDirection is the projection used)
 * AND P25-pure (no operator-tunable thresholds; warmup constants are
 * SAFETY_BOUND fall-through to preserve pre-observer behaviour during
 * the first WARMUP_TICKS ticks per process).
 */

import {
  observeAndClassifyFromHistory,
  type TrajectoryReading,
} from './trajectory_observer.js';
import type { Basin } from './basin.js';

export type RegimeLabel = 'TREND_UP' | 'CHOP' | 'TREND_DOWN';

export interface RegimeReading {
  regime: RegimeLabel;
  confidence: number;       // 0..1
  trendStrength: number;    // -1..+1
  chopScore: number;        // 0..1
}

/** Options retained for back-compat with existing call sites. As of
 *  REGIME-1 the optional `trendThreshold` / `chopThreshold` overrides are
 *  ignored — the observer derives them. Kept in the type so callers don't
 *  need a recompile; documented as deprecated.
 *  @deprecated Per-call threshold overrides ignored post-REGIME-1 (#766);
 *              the observer derives boundaries from rolling quantiles. */
export interface ClassifyRegimeOptions {
  /** @deprecated ignored — kept for back-compat. */
  lookback?: number;
  /** @deprecated ignored — boundaries are observer-derived. */
  trendThreshold?: number;
  /** @deprecated ignored — boundaries are observer-derived. */
  chopThreshold?: number;
}

/** Pre-REGIME-1 default; only used by callers that pass through to the
 *  raw observer for backwards compatibility. The observer maintains its
 *  own larger rolling window (500 ticks) independently. */
export const DEFAULT_LOOKBACK = 16;

/**
 * Classify the trajectory regime from a basin history window.
 *
 * Delegates to `trajectory_observer.observeAndClassifyFromHistory` which
 * seeds the symbol's per-symbol rolling buffer from the supplied window
 * and classifies via observer-derived tercile boundaries. During warmup
 * (< 30 ticks per symbol per process), falls through to the pre-REGIME-1
 * hardcoded thresholds for bit-for-bit-identical behaviour during the
 * first WARMUP_TICKS ticks for that symbol.
 *
 * `symbol` is required so each symbol's tercile boundaries derive from
 * that symbol's own |basinDirection| distribution. Pooling across
 * symbols would cross-contaminate the boundaries (basinDirection is
 * per-symbol; h/J in CAL-3's Layer-1 observer is market-wide — the two
 * substrates differ in their natural granularity).
 *
 * The returned `RegimeReading` keeps the legacy field shape so all
 * existing executive call sites work unchanged.
 */
export function classifyRegime(
  symbol: string,
  basinHistory: readonly Basin[],
  _opts: ClassifyRegimeOptions = {},
): RegimeReading {
  if (basinHistory.length < 3) {
    return {
      regime: 'CHOP',
      confidence: 0.33,
      trendStrength: 0,
      chopScore: 1.0,
    };
  }
  const t: TrajectoryReading = observeAndClassifyFromHistory(symbol, basinHistory);
  return {
    regime: t.regime,
    confidence: t.confidence,
    trendStrength: t.trendStrength,
    chopScore: t.chopScore,
  };
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
