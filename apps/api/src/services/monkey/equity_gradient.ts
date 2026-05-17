/**
 * equity_gradient.ts — SENSE-3 #769 (Phase 1, telemetry-only).
 *
 * Computes the kernel's awareness of equity trajectory: not just
 * "what's my drawdown level" (which it already knows via
 * autonomous_trading_configs.maxDrawdown) but "is the loss
 * accelerating, decelerating, or recovering?" The level tells you
 * where you are; the gradient tells you where you're heading.
 *
 * Per the QIG-pure framing: this is a derivation-only observer over
 * the equity series the trader already records (no new data source,
 * no hardcoded "drawdown threshold" — the value IS the signal, the
 * downstream executive decides what to do with it).
 *
 * Phase 1 (this module): pure computation + a per-session in-memory
 * rolling buffer. Telemetry-only — no decision path consumes it yet.
 *
 * Phase 2 (follow-up): wire into the entry-threshold modulator so an
 * accelerating loss tightens entry gating; a recovering equity loosens
 * it. Pattern: same as regimeEntryThresholdModifier — the modifier
 * scales the existing threshold, doesn't replace it.
 *
 * Phase 3 (later): expose as a basin dimension or motivator so the
 * kernel's own self-observation includes its own equity trajectory.
 */

/** Configuration — both values are SAFETY_BOUND sentinels, not
 *  operator-tunable thresholds. The window length sets the smoothing
 *  scale (smaller = more responsive, larger = less noisy); the
 *  min-samples is the minimum-evidence sentinel matching
 *  HISTORY_MIN_SAMPLES=2 elsewhere. */
const DEFAULT_WINDOW = 30;
const MIN_SAMPLES = 2;

export interface EquityGradientReading {
  /** d(equity)/dt scaled to a unit-less rate: change per sample
   *  divided by the most-recent equity value. Positive = recovering;
   *  negative = bleeding; zero = flat OR insufficient history. */
  gradient: number;
  /** Second-derivative — change in gradient between the second-half
   *  and first-half of the window. Negative = accelerating loss (the
   *  bleed is getting worse). Positive = decelerating (mean-reverting
   *  toward recovery). Zero = constant rate. */
  acceleration: number;
  /** Number of samples used in the computation. */
  n: number;
  /** True when n < MIN_SAMPLES — the observer has no signal yet and
   *  both gradient and acceleration are returned as 0 (fail-soft to
   *  neutral). */
  warmup: boolean;
}

/**
 * Compute the equity gradient + acceleration over a rolling window.
 *
 * Pure derivation: gradient = (last − first) / (first × samples);
 * acceleration = secondHalfGradient − firstHalfGradient.
 *
 * Cold-start: when fewer than MIN_SAMPLES entries are present, returns
 * warmup=true with both values 0 (downstream treats as neutral).
 *
 * Negative equity (margin call territory) is handled — gradient is
 * computed against |first| so the sign of the rate isn't flipped by
 * the denominator going negative.
 */
export function computeEquityGradient(
  equityHistory: readonly number[],
  window: number = DEFAULT_WINDOW,
): EquityGradientReading {
  if (equityHistory.length < MIN_SAMPLES) {
    return { gradient: 0, acceleration: 0, n: equityHistory.length, warmup: true };
  }
  const slice = equityHistory.slice(-window);
  const n = slice.length;
  const first = slice[0]!;
  const last = slice[n - 1]!;
  const denom = Math.max(Math.abs(first), 1e-9);
  const gradient = (last - first) / (denom * n);

  let acceleration = 0;
  if (n >= 4) {
    const mid = Math.floor(n / 2);
    const firstHalf = slice.slice(0, mid);
    const secondHalf = slice.slice(mid);
    const firstFirst = firstHalf[0]!;
    const firstLast = firstHalf[firstHalf.length - 1]!;
    const secondFirst = secondHalf[0]!;
    const secondLast = secondHalf[secondHalf.length - 1]!;
    const firstDenom = Math.max(Math.abs(firstFirst), 1e-9);
    const secondDenom = Math.max(Math.abs(secondFirst), 1e-9);
    const firstGradient = (firstLast - firstFirst) / (firstDenom * firstHalf.length);
    const secondGradient = (secondLast - secondFirst) / (secondDenom * secondHalf.length);
    acceleration = secondGradient - firstGradient;
  }

  return { gradient, acceleration, n, warmup: false };
}

/** Per-symbol or per-user rolling equity buffer. Singletons so the
 *  same observer state survives across kernel ticks within a process. */
const _buffers: Map<string, number[]> = new Map();
const MAX_BUFFER = 500;

/** Push a new equity sample into the rolling buffer for a tracker key,
 *  then return the current gradient reading. The key can be a userId,
 *  account name, or symbol — caller's choice. */
export function observeEquity(
  key: string,
  equity: number,
  window: number = DEFAULT_WINDOW,
): EquityGradientReading {
  let buf = _buffers.get(key);
  if (!buf) {
    buf = [];
    _buffers.set(key, buf);
  }
  buf.push(equity);
  if (buf.length > MAX_BUFFER) buf.shift();
  return computeEquityGradient(buf, window);
}

/** Test/diagnostic helper. */
export function _resetEquityGradient(key?: string): void {
  if (key === undefined) {
    _buffers.clear();
    return;
  }
  _buffers.delete(key);
}

/** Test/diagnostic helper. */
export function _peekEquityBuffer(key: string): readonly number[] {
  return _buffers.get(key) ?? [];
}
