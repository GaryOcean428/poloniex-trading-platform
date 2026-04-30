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
import { PHI_GOLDEN_FLOOR_RATIO } from './topology_constants.js';

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
  if (regimeAtOpen === undefined || phiAtOpen === undefined) {
    return { checked: false, fired: null, reason: '', phiFloor: null };
  }
  const phiFloor = phiAtOpen / PHI_GOLDEN_FLOOR_RATIO;

  if (regimeNow !== regimeAtOpen) {
    return {
      checked: true,
      fired: 'regime_change',
      reason: `regime_change: opened in ${regimeAtOpen}, now ${regimeNow}`,
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
