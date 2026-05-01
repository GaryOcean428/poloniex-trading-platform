/**
 * held_position_rejustification.ts — four internal exit checks that
 * fire when the kernel's own state contradicts what justified entry.
 *
 *   1. REGIME CHECK    — current mode != mode at open AND streak ≥ N
 *                        AND basin moved by FR > 1/π → exit
 *                        (hysteresis added 2026-05-01 to mirror the
 *                        Python kernel's PR #631 behaviour; prevents
 *                        single-tick mode flicker churn)
 *   2. PHI CHECK       — current Φ < phi_at_open / PHI_GOLDEN_FLOOR_RATIO → exit
 *   3. CONVICTION      — confidence < anxiety + confusion → exit
 *                        (LIVE on TS path as of 2026-05-01: Layer 2B
 *                        computeEmotions wired into loop.ts; when the
 *                        kernel's geometric self-read says hesitation
 *                        > conviction, the position closes)
 *   4. STALE_BLEED     — duration ≥ N seconds AND ROI ≤ -X% → exit
 *                        (belt-and-braces guard alongside conviction.
 *                        Catches the edge case where conviction stays
 *                        marginally positive but price has been
 *                        adverse for an extended window. Likely
 *                        retired once we observe how often conviction
 *                        catches the same cases in production)
 *
 * Order: regime → phi → conviction → stale_bleed. First to fire wins.
 *
 * Used inline by loop.ts::processSymbol for TS parity with the Python
 * tick path (`monkey_kernel/tick.py::_decide_with_position`).
 *
 * Extracted into a module so TS tests can exercise the gate logic
 * directly — the inline call site in loop.ts is mirrored bit-for-bit.
 */

import { fisherRao, type Basin } from './basin.js';
import type { MonkeyMode } from './modes.js';
import {
  PHI_GOLDEN_FLOOR_RATIO,
  PI_STRUCT_BOUNDARY_R_SQUARED,
  PI_STRUCT_GRAVITATING_FRACTION,
} from './topology_constants.js';

export interface RejustificationEmotions {
  confidence: number;
  anxiety: number;
  confusion: number;
}

export interface RejustificationInput {
  /** Mode the position opened in. Undefined = no anchor recorded. */
  regimeAtOpen: MonkeyMode | undefined;
  /** Φ measured at entry. Undefined = no anchor recorded. */
  phiAtOpen: number | undefined;
  /** Mode this tick. */
  regimeNow: MonkeyMode;
  /** Φ this tick. */
  phiNow: number;
  /** Layer 2B emotion stack — Python: compute_emotions; TS:
   *  computeEmotions (both wired into their respective tick paths
   *  as of 2026-05-01). The conviction gate uses confidence,
   *  anxiety, confusion to decide whether to exit. */
  emotions: RejustificationEmotions;
  /**
   * Regime classifier's confidence ∈ [0, 1] for ``regimeNow`` (see
   * regime.ts::RegimeReading). Used by the regime check below to gate
   * exit on the classifier's own self-belief rather than a synthesized
   * streak counter. Defaults to 1.0 so callers that do not (yet) plumb
   * the classifier output behave as in PR #619 (always-fire on label
   * divergence).
   */
  regimeConfidence?: number;
  /**
   * v0.8.7 regime-hysteresis triple-AND gate. The regime exit fires only
   * when ALL of:
   *   (a) regimeNow != regimeAtOpen   (single-tick label divergence)
   *   (b) regimeChangeStreak >= regimeStabilityTicksRequired
   *   (c) fisherRao(basinNow, basinAtOpen) > 1/π
   * AND the classifier's confidence still > 1/φ from PR #629.
   *
   * Why all three? Live tape 2026-05-01 16:11-16:17: every close was
   * regime_change, 22% win rate, $97 account chewing through positions
   * because a single-tick mode flicker was enough to flip the gate when
   * the kernel's own basin had barely moved. The streak filter rejects
   * single-tick flicker; the FR-distance filter rejects label changes
   * where the basin geometry is still consonant with entry.
   */
  regimeChangeStreak?: number;
  regimeStabilityTicksRequired?: number;
  basinNow?: Basin;
  basinAtOpen?: Basin;
  /**
   * Held duration in seconds for the stale-bleed gate. Undefined
   * disables the stale-bleed check (legacy callers / no entry timestamp).
   */
  heldDurationS?: number;
  /**
   * Current ROI on margin (signed fraction; -0.02 = -2% loss). Used
   * by the stale-bleed gate. Undefined disables the check.
   */
  currentRoi?: number;
}

export type RejustificationFire =
  | 'regime_change'
  | 'phi_collapse'
  | 'conviction_failed'
  | 'stale_bleed';

export interface RejustificationResult {
  /** Whether anchors were available to check at all. */
  checked: boolean;
  /** Which check fired, if any. */
  fired: RejustificationFire | null;
  /** Human-readable reason for the exit decision (empty if no fire). */
  reason: string;
  /** Φ floor under the golden-ratio coherence test. */
  phiFloor: number | null;
  /** FR distance from basinAtOpen → basinNow when both anchors present. */
  frDistance: number | null;
  /** FR-distance threshold (1/π) the regime gate compares against. */
  frThreshold: number;
  /** Streak of consecutive ticks where regimeNow != regimeAtOpen. */
  regimeChangeStreak: number;
  /** Required streak length before the regime exit fires. */
  regimeStabilityTicksRequired: number;
}

/**
 * Stale-bleed defaults. A position held longer than 30 minutes at
 * worse than -1% ROI on margin is exited. This is an interim guard
 * for the dormant conviction gate; once Layer 2B emotions land in
 * TS, this can be revisited (likely tightened or removed).
 */
export const STALE_BLEED_MIN_DURATION_S = 30 * 60;     // 30 min
export const STALE_BLEED_ROI_THRESHOLD = -0.01;         // -1% on margin

/**
 * Run the four internal exit checks. Returns which (if any) fired.
 *
 * Order: regime → phi → conviction → stale_bleed. The first to fire
 * wins. The regime check carries hysteresis (streak + basin distance);
 * the others fire on first match.
 */
export function evaluateRejustification(
  input: RejustificationInput,
): RejustificationResult {
  const { regimeAtOpen, phiAtOpen, regimeNow, phiNow, emotions } = input;
  const regimeConfidence = input.regimeConfidence ?? 1.0;
  const regimeChangeStreak = input.regimeChangeStreak ?? 0;
  const regimeStabilityTicksRequired = input.regimeStabilityTicksRequired ?? 3;
  const frThreshold = PI_STRUCT_GRAVITATING_FRACTION;  // 1/π ≈ 0.318
  let frDistance: number | null = null;
  if (input.basinNow !== undefined && input.basinAtOpen !== undefined) {
    frDistance = fisherRao(input.basinAtOpen, input.basinNow);
  }
  if (regimeAtOpen === undefined || phiAtOpen === undefined) {
    return {
      checked: false, fired: null, reason: '', phiFloor: null,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
    };
  }
  const phiFloor = phiAtOpen / PHI_GOLDEN_FLOOR_RATIO;

  // 1. REGIME CHECK — triple-AND gate. All of:
  //   (a) regimeNow != regimeAtOpen   (label divergence)
  //   (b) regimeChangeStreak >= regimeStabilityTicksRequired (stable >= N ticks)
  //   (c) frDistance > 1/π            (basin geometry has actually moved)
  // PLUS the PR #629 confidence gate (regimeConfidence > 1/φ).
  //
  // Live tape 2026-05-01 16:11-16:17: every close was regime_change,
  // 22% win rate, $97 account torn through positions because a single
  // tick of mode flicker was enough to flip the gate. The streak filter
  // rejects single-tick noise; the FR filter rejects label changes
  // where the basin's geometry has barely moved (the kernel's
  // perception is still consonant with what justified entry).
  if (regimeNow !== regimeAtOpen) {
    const confidenceLoadBearing = regimeConfidence > PI_STRUCT_BOUNDARY_R_SQUARED;
    const streakSatisfied = regimeChangeStreak >= regimeStabilityTicksRequired;
    // FR-distance gate. When anchors are missing (basin not plumbed),
    // fall back to a strict-fail so the regime exit cannot fire purely
    // on label flicker — the geometric component must be measurable.
    const frFires = frDistance !== null && frDistance > frThreshold;
    if (confidenceLoadBearing && streakSatisfied && frFires) {
      const frStr = frDistance !== null ? frDistance.toFixed(3) : 'N/A';
      return {
        checked: true,
        fired: 'regime_change',
        reason:
          `regime_change: opened in ${regimeAtOpen} `
          + `(FR_dist ${frStr} > 1/π), now ${regimeNow} stable for `
          + `${regimeChangeStreak} ticks `
          + `(confidence ${regimeConfidence.toFixed(3)} > 1/φ)`,
        phiFloor,
        frDistance, frThreshold,
        regimeChangeStreak, regimeStabilityTicksRequired,
      };
    }
  }
  if (phiNow < phiFloor) {
    return {
      checked: true,
      fired: 'phi_collapse',
      reason: `phi_collapse: open Φ=${phiAtOpen.toFixed(3)} → now ${phiNow.toFixed(3)} < floor ${phiFloor.toFixed(3)}`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
    };
  }
  if (emotions.confidence < emotions.anxiety + emotions.confusion) {
    return {
      checked: true,
      fired: 'conviction_failed',
      reason: `conviction_failed: conf=${emotions.confidence.toFixed(3)} < anxiety+confusion=${(emotions.anxiety + emotions.confusion).toFixed(3)}`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
    };
  }
  // 4. STALE_BLEED — belt-and-braces guard.
  if (
    input.heldDurationS !== undefined
    && input.currentRoi !== undefined
    && input.heldDurationS >= STALE_BLEED_MIN_DURATION_S
    && input.currentRoi <= STALE_BLEED_ROI_THRESHOLD
  ) {
    return {
      checked: true,
      fired: 'stale_bleed',
      reason:
        `stale_bleed: held ${Math.round(input.heldDurationS)}s `
        + `≥ ${STALE_BLEED_MIN_DURATION_S}s at ROI ${(input.currentRoi * 100).toFixed(2)}% `
        + `≤ ${(STALE_BLEED_ROI_THRESHOLD * 100).toFixed(2)}%`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
    };
  }
  return {
    checked: true, fired: null, reason: '', phiFloor,
    frDistance, frThreshold,
    regimeChangeStreak, regimeStabilityTicksRequired,
  };
}
