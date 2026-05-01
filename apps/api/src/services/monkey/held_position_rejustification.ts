/**
 * held_position_rejustification.ts — three internal exit checks that
 * fire when the kernel's own state contradicts what justified entry.
 *
 *   1. REGIME CHECK    — current mode != mode at open → exit
 *   2. PHI CHECK       — current Φ < phi_at_open / PHI_GOLDEN_FLOOR_RATIO → exit
 *   3. CONVICTION      — confidence < anxiety + confusion → exit
 *
 * All three are geometric: regime classifier output, Φ integration
 * measure, Layer 2B emotion stack. No streak counting, no hysteresis,
 * no time-based stops.
 *
 * Used inline by loop.ts::processSymbol for TS parity with the Python
 * tick path (`monkey_kernel/tick.py::_decide_with_position`).
 *
 * Extracted into a module so TS tests can exercise the gate logic
 * directly — the inline call site in loop.ts is mirrored bit-for-bit.
 */

import type { MonkeyMode } from './modes.js';
import {
  PHI_GOLDEN_FLOOR_RATIO,
  PI_STRUCT_BOUNDARY_R_SQUARED,
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
  /** Layer 2B emotion stack — TS uses NEUTRAL_EMOTIONS until ported. */
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
}

export type RejustificationFire =
  | 'regime_change'
  | 'phi_collapse'
  | 'conviction_failed';

export interface RejustificationResult {
  /** Whether anchors were available to check at all. */
  checked: boolean;
  /** Which check fired, if any. */
  fired: RejustificationFire | null;
  /** Human-readable reason for the exit decision (empty if no fire). */
  reason: string;
  /** Φ floor under the golden-ratio coherence test. */
  phiFloor: number | null;
}

/**
 * Run the three internal exit checks. Returns which (if any) fired.
 *
 * Order: regime → phi → conviction. The first to fire wins. No streak,
 * no hysteresis: a single tick where state contradicts entry exits the
 * position.
 */
export function evaluateRejustification(
  input: RejustificationInput,
): RejustificationResult {
  const { regimeAtOpen, phiAtOpen, regimeNow, phiNow, emotions } = input;
  const regimeConfidence = input.regimeConfidence ?? 1.0;
  if (regimeAtOpen === undefined || phiAtOpen === undefined) {
    return { checked: false, fired: null, reason: '', phiFloor: null };
  }
  const phiFloor = phiAtOpen / PHI_GOLDEN_FLOOR_RATIO;

  // 1. REGIME CHECK — regime label diverged from open AND classifier's
  // own confidence is past the canonical coherence floor. Gating on the
  // classifier's self-belief (rather than a synthesized streak counter)
  // preserves PR #619's "single-tick exit, current state IS the truth"
  // framing while skipping flicker events where the classifier itself
  // isn't sure. Threshold is PI_STRUCT_BOUNDARY_R_SQUARED (1/φ ≈ 0.618),
  // the canonical "boundary R²" from EXP-004b. Strict >: a confidence
  // exactly at the floor is not yet load-bearing.
  if (
    regimeNow !== regimeAtOpen &&
    regimeConfidence > PI_STRUCT_BOUNDARY_R_SQUARED
  ) {
    return {
      checked: true,
      fired: 'regime_change',
      reason:
        `regime_change: opened in ${regimeAtOpen}, now ${regimeNow} ` +
        `(confidence ${regimeConfidence.toFixed(3)} > 1/φ)`,
      phiFloor,
    };
  }
  if (phiNow < phiFloor) {
    return {
      checked: true,
      fired: 'phi_collapse',
      reason: `phi_collapse: open Φ=${phiAtOpen.toFixed(3)} → now ${phiNow.toFixed(3)} < floor ${phiFloor.toFixed(3)}`,
      phiFloor,
    };
  }
  if (emotions.confidence < emotions.anxiety + emotions.confusion) {
    return {
      checked: true,
      fired: 'conviction_failed',
      reason: `conviction_failed: conf=${emotions.confidence.toFixed(3)} < anxiety+confusion=${(emotions.anxiety + emotions.confusion).toFixed(3)}`,
      phiFloor,
    };
  }
  return { checked: true, fired: null, reason: '', phiFloor };
}
