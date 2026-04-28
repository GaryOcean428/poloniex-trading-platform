/**
 * turning_signal.ts — #575 short-as-turning-signal trigger.
 *
 * ml-worker is structurally BUY-biased and never returns SELL. mlStrength
 * near zero is a "no confidence" read, not a long signal. The strict
 * OVERRIDE_REVERSE quorum (basin AND tape both ≤ -0.35) misses early
 * reversals.
 *
 * This softer trigger fires when:
 *   - ML signal is BUY (ml-worker's only positive emission)
 *   - mlStrength < ML_NO_CONFIDENCE (the model is essentially silent)
 *   - basinDir < TURN_BASIN_BEARISH (Monkey's geometric direction-read
 *     leans bearish — even mildly)
 *   - tapeTrend < TURN_TAPE_BEARISH (recent price action confirms)
 *
 * Captures the turning-point earlier than OVERRIDE_REVERSE without
 * retraining ml-worker for short prediction. Distinct purpose:
 * OVERRIDE_REVERSE = strong directional consensus reversal;
 * TURNING_SIGNAL = weak ML conviction + directional lean = short.
 *
 * Default off via MONKEY_SHORTS_LIVE=false. The caller is responsible
 * for the env-flag gate; this helper just classifies the signal.
 */

export const ML_NO_CONFIDENCE = 0.15;
export const TURN_BASIN_BEARISH = -0.15;
export const TURN_TAPE_BEARISH = -0.30;

export interface TurningSignalInput {
  /** Current sideCandidate after ML + OVERRIDE_REVERSE evaluation. */
  sideCandidate: 'long' | 'short';
  /** Whether OVERRIDE_REVERSE already flipped sideCandidate. */
  sideOverride: boolean;
  /** Raw ML signal label. */
  mlSignal: 'BUY' | 'SELL' | 'HOLD' | string;
  /** ML signal strength in [0, 1]. */
  mlStrength: number;
  /** Monkey's geometric direction read in [-1, 1]. */
  basinDir: number;
  /** Recent tape trend proxy in [-1, 1]. */
  tapeTrend: number;
}

/**
 * Returns true if the turning-signal condition is met. Caller flips
 * sideCandidate to 'short' and sets sideOverride=true on a true result.
 *
 * Refuses to fire when sideOverride is already true (don't compound on
 * top of OVERRIDE_REVERSE) or when sideCandidate is already 'short'
 * (no work to do).
 */
export function evaluateTurningSignal(input: TurningSignalInput): boolean {
  if (input.sideOverride) return false;
  if (input.sideCandidate !== 'long') return false;
  if (input.mlSignal !== 'BUY') return false;
  if (input.mlStrength >= ML_NO_CONFIDENCE) return false;
  if (input.basinDir >= TURN_BASIN_BEARISH) return false;
  if (input.tapeTrend >= TURN_TAPE_BEARISH) return false;
  return true;
}

/** Read the MONKEY_SHORTS_LIVE env flag. Default false. */
export function shortsLive(): boolean {
  return process.env.MONKEY_SHORTS_LIVE === 'true';
}
