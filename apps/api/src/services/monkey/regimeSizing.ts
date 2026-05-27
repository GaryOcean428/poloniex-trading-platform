/**
 * regimeSizing.ts — regime-conditioned position sizing.
 *
 * Maps the kernel's current QIG-derived regime score r ∈ [0, 1] onto
 * trade parameters (leverage, size fraction, hold horizon, stop bps).
 *
 *   r → 1  = FLAT regime (orbit, low FR velocity, low coherence, near-
 *            critical κ). High-frequency, high-leverage, small notional,
 *            short hold, tight stop.
 *
 *   r → 0  = TRENDING regime (geodesic traversal, high FR velocity,
 *            high coherence, far-from-critical κ). Low-frequency,
 *            lower leverage, large notional, long hold, wide stop.
 *
 * Risk-per-trade in DOLLAR terms stays roughly constant — the bot
 * participates in both market modes with comparable downside, just by
 * different mechanisms.
 *
 * QIG purity: composes existing basin.ts and perception.ts primitives
 * only (velocity, frechetMean, basinDirection). No banned ops, no
 * Euclidean shortcuts, no cosine, no Adam, no LayerNorm.
 *
 * Pure functions. The integration layer (loop.ts) calls these to get
 * sizing parameters per tick.
 */
import { fisherRao, frechetMean, velocity, type Basin, KAPPA_STAR } from './basin.js';
import { basinDirection } from './perception.js';

/** A composite regime score ∈ [0, 1].
 *  - 1.0 = unambiguously flat (range-bound, low velocity, low coherence)
 *  - 0.0 = unambiguously trending (one-direction traversal, high velocity)
 *  Values in between are mixed/uncertain. */
export type RegimeScore = number;

export interface RegimeReading {
  /** Composite score in [0, 1]. */
  r: RegimeScore;
  /** Component scores in [0, 1] for telemetry. */
  components: {
    /** Mean FR velocity over the window, normalized into [0, 1].
     *  HIGH velocity → score near 0 (trending);
     *  LOW velocity → score near 1 (flat). */
    velocityFlatness: number;
    /** Directional persistence — |mean(direction)| / mean(|direction|).
     *  HIGH persistence (near 1) → near 0 (trending);
     *  LOW persistence (near 0) → near 1 (chop). */
    directionalChop: number;
    /** Kappa criticality distance — how near to the critical band.
     *  Closer to critical κ (governed reference anchor per two-channel doctrine) → near 1 (flat);
     *  Further → near 0 (trending). Falls back to 0.5 when κ unavailable.
     *  (Historical κ*=64 retired; see basin.ts for citations.) */
    kappaCriticality: number;
  };
  /** Discrete label for log readability. */
  label: 'flat' | 'transitioning' | 'trending';
}

/** Hyperparameters for the regime score. Tunable but defaults are
 *  calibrated for the basin coordinates produced by perceive(). */
export interface RegimeConfig {
  /** Lookback window in ticks for velocity + direction history.
   *  Default 60 = 30 min on 30s ticks. */
  window: number;
  /** Velocity at which the score saturates to 0 (full trending).
   *  Default 0.10 — empirical for Δ⁶³ basins at 30s cadence.
   *  Anything above this means "kernel is racing." */
  velocitySaturate: number;
  /** Critical κ band. Within ±band of critical is "near-critical."
   *  Uses governed reference anchor (KAPPA_STAR from basin, 63.8 transition per two-channel
   *  doctrine 2026-04-13 + v6.7B + audit 20260527; retired universal κ*=64). */
  kappaCritical: number;
  kappaCriticalBandHalfWidth: number;
  /** Component weights — should sum to 1 for clean interpretation. */
  weights: { velocity: number; directional: number; kappa: number };
  /** Label thresholds. r ≥ flatAt → flat; r ≤ trendAt → trending. */
  flatAt: number;
  trendAt: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  window: 60,
  velocitySaturate: 0.10,
  kappaCritical: KAPPA_STAR,  // governed reference (63.8); two-channel doctrine (retired bare κ*=64)
  kappaCriticalBandHalfWidth: 16,
  weights: { velocity: 0.4, directional: 0.4, kappa: 0.2 },
  flatAt: 0.65,
  trendAt: 0.35,
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Compute the regime score from recent basin history + current κ.
 *
 *  Pure function. No allocations beyond intermediate arrays.
 *
 *  Returns null when there's insufficient history (< 2 basins; need
 *  at least one velocity sample). Caller should treat null as
 *  "regime unknown" and fall back to neutral sizing.
 */
export function regimeScore(
  basinHistory: readonly Basin[],
  kappa: number | null,
  config: RegimeConfig = DEFAULT_REGIME_CONFIG,
): RegimeReading | null {
  if (basinHistory.length < 2) return null;

  const window = Math.min(config.window, basinHistory.length - 1);
  const recent = basinHistory.slice(-window - 1);  // need N+1 for N velocities

  // Component 1 — velocity flatness.
  // Mean FR velocity over recent window. Saturate at velocitySaturate.
  let velSum = 0;
  let velCount = 0;
  for (let i = 1; i < recent.length; i++) {
    velSum += velocity(recent[i - 1]!, recent[i]!);
    velCount++;
  }
  const meanVel = velCount > 0 ? velSum / velCount : 0;
  // High velocity → low flatness. Linear ramp, capped at 1.
  const velocityFlatness = clamp01(1 - meanVel / config.velocitySaturate);

  // Component 2 — directional chop.
  // |mean(direction)| / mean(|direction|) is the geodesic-coords ADX
  // analog: 1 = one-direction, 0 = pure chop.
  let sumSignedDir = 0;
  let sumAbsDir = 0;
  for (const basin of recent) {
    const d = basinDirection(basin);
    sumSignedDir += d;
    sumAbsDir += Math.abs(d);
  }
  const persistence = sumAbsDir > 0 ? Math.abs(sumSignedDir) / sumAbsDir : 0;
  // High persistence (1.0) → trending (chop=0); low persistence → chop (1.0).
  const directionalChop = clamp01(1 - persistence);

  // Component 3 — κ criticality.
  // Inside the critical band → near-critical (flat).
  // Outside → far-from-critical (trending).
  let kappaCriticality: number;
  if (kappa === null || !Number.isFinite(kappa)) {
    kappaCriticality = 0.5;  // neutral
  } else {
    const distFromCritical = Math.abs(kappa - config.kappaCritical);
    // Inside band: score = 1; at band edge: score = 0.5; far away: 0.
    kappaCriticality = clamp01(
      1 - distFromCritical / (2 * config.kappaCriticalBandHalfWidth),
    );
  }

  // Weighted combination.
  const w = config.weights;
  const wSum = w.velocity + w.directional + w.kappa;
  const r =
    (w.velocity * velocityFlatness +
      w.directional * directionalChop +
      w.kappa * kappaCriticality) / Math.max(wSum, 1e-9);

  const label: RegimeReading['label'] =
    r >= config.flatAt ? 'flat'
      : r <= config.trendAt ? 'trending'
        : 'transitioning';

  return {
    r,
    components: { velocityFlatness, directionalChop, kappaCriticality },
    label,
  };
}

/** Sizing parameters output by regimeSizing. */
export interface SizingResult {
  /** Leverage multiplier (1..maxLev). */
  leverage: number;
  /** Fraction of allocated capital to deploy as margin on this entry. */
  sizeFraction: number;
  /** Hold horizon in ms. Position should exit at this if no
   *  re-confirmation, regardless of PnL. */
  holdMs: number;
  /** Stop-loss in basis points of notional. 100 bps = 1%. */
  stopBps: number;
  /** Margin headroom floor (fraction of equity) to require before entry.
   *  Tighter floor on flat (need headroom for rapid scalp cycles);
   *  looser floor on trend (one slow large position is OK). */
  marginHeadroomFloor: number;
}

export interface SizingConfig {
  /** Leverage rail. Default flat=50×, trend=8×. */
  flatLeverage: number;
  trendLeverage: number;
  /** Size fraction rail. Default flat=0.25, trend=0.85 (of allocation). */
  flatSizeFraction: number;
  trendSizeFraction: number;
  /** Hold horizon rail. Default flat=10min, trend=4h. */
  flatHoldMs: number;
  trendHoldMs: number;
  /** Stop-bps rail. Default flat=30bps (0.3%), trend=150bps (1.5%). */
  flatStopBps: number;
  trendStopBps: number;
  /** Margin headroom floor rail. Default flat=0.35 (need 35% free for
   *  rapid recycling), trend=0.15 (only 15% needed for slow positions). */
  flatHeadroomFloor: number;
  trendHeadroomFloor: number;
}

export const DEFAULT_SIZING_CONFIG: SizingConfig = {
  flatLeverage: 50,
  trendLeverage: 8,
  flatSizeFraction: 0.25,
  trendSizeFraction: 0.85,
  flatHoldMs: 10 * 60_000,
  trendHoldMs: 4 * 60 * 60_000,
  flatStopBps: 30,
  trendStopBps: 150,
  flatHeadroomFloor: 0.35,
  trendHeadroomFloor: 0.15,
};

/** Linear interpolation between flat (r=1) and trend (r=0) values.
 *  Pure function. */
function lerp(flatVal: number, trendVal: number, r: number): number {
  const t = clamp01(r);
  return trendVal + (flatVal - trendVal) * t;
}

/** Map a regime score to a sizing parameter bundle.
 *
 *  Continuous interpolation — there's no discrete "now flat / now
 *  trending" cliff. r=0.7 yields a leverage between flat and trend
 *  proportional to where 0.7 falls on the rail.
 *
 *  Pure function. Caller (loop.ts) takes the result and applies it
 *  to the entry order builder. The sizing decision is per-entry, not
 *  per-symbol-state — each entry recomputes against the current r. */
export function regimeSizing(
  r: RegimeScore,
  config: SizingConfig = DEFAULT_SIZING_CONFIG,
): SizingResult {
  return {
    leverage: Math.round(lerp(config.flatLeverage, config.trendLeverage, r)),
    sizeFraction: lerp(config.flatSizeFraction, config.trendSizeFraction, r),
    holdMs: lerp(config.flatHoldMs, config.trendHoldMs, r),
    stopBps: lerp(config.flatStopBps, config.trendStopBps, r),
    marginHeadroomFloor: lerp(config.flatHeadroomFloor, config.trendHeadroomFloor, r),
  };
}

/** Trailing-regime-stop check.
 *
 *  Held positions must exit on adverse regime transition. If the
 *  regime score has dropped (toward trending) by more than
 *  ``adverseDelta`` since position open, the regime no longer
 *  supports the high-leverage hold and the position is force-exited
 *  to avoid getting caught geared up into a real move.
 *
 *  Symmetric: a trending position should also exit if regime score
 *  RISES (toward flat) by more than adverseDelta — large notional in
 *  a slow market isn't broken, but the trend hypothesis that
 *  justified the size has ended.
 *
 *  Pure function. Returns true → caller should close the position.
 */
export function trailingRegimeStop(
  rAtEntry: RegimeScore,
  rNow: RegimeScore,
  adverseDelta: number = 0.30,
): boolean {
  return Math.abs(rAtEntry - rNow) > adverseDelta;
}

/** Utility — useful for cross-tf coherence. Returns the Fisher-Rao
 *  distance between the current basin and the Fréchet mean of a
 *  recent window. Low distance = "current state agrees with recent
 *  mean", high distance = "current state is an outlier."
 *
 *  Not used by regimeScore directly today, but exposed because it's
 *  useful for higher-order regime composition (e.g., MTF coherence
 *  in a later multi-timeframe build). */
export function basinAlignmentToWindow(
  current: Basin,
  window: readonly Basin[],
): number {
  if (window.length === 0) return 0;
  const mean = frechetMean([...window]);
  return fisherRao(current, mean);
}
