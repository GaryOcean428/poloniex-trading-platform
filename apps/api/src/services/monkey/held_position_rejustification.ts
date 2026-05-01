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
import { PHI_GOLDEN_FLOOR_RATIO, PI_STRUCT_GRAVITATING_FRACTION } from './topology_constants.js';

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
   * Basin coordinate at entry. Undefined for legacy positions opened
   * before the basin-anchor snapshot was added; in that case the
   * regime hysteresis falls back to streak-only (basin gate skipped).
   */
  basinAtOpen?: Basin;
  /** Current basin this tick. Required when basinAtOpen is provided. */
  basinNow?: Basin;
  /**
   * Consecutive ticks where regimeNow has differed from regimeAtOpen.
   * Caller maintains this counter — increments when divergent, resets
   * to 0 when regimeNow returns to regimeAtOpen. Defaults to 0.
   */
  regimeChangeStreak?: number;
  /**
   * Minimum consecutive divergent ticks before regime exit fires.
   * Defaults to 3 to match the Python kernel's
   * executive.regime_stability_ticks_for_exit registry default.
   */
  regimeStreakRequired?: number;
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
  /** Streak observed (for telemetry). */
  regimeChangeStreak?: number;
  /** Basin FR move from open (for telemetry; null when no anchor). */
  basinFrMove?: number | null;
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
  const {
    regimeAtOpen, phiAtOpen, regimeNow, phiNow, emotions,
    basinAtOpen, basinNow,
    regimeChangeStreak = 0,
    regimeStreakRequired = 3,
    heldDurationS,
    currentRoi,
  } = input;
  if (regimeAtOpen === undefined || phiAtOpen === undefined) {
    return { checked: false, fired: null, reason: '', phiFloor: null };
  }
  const phiFloor = phiAtOpen / PHI_GOLDEN_FLOOR_RATIO;

  // 1. REGIME CHECK with hysteresis — match Python PR #631.
  //    Requires (a) regime != regime_at_open AND (b) streak ≥ required
  //    AND (c) basin moved by FR > 1/π from basin_at_open.
  //    Without basin anchor, fall back to streak-only (legacy positions
  //    opened before this PR).
  const regimeDiverged = regimeNow !== regimeAtOpen;
  let basinFrMove: number | null = null;
  if (basinAtOpen !== undefined && basinNow !== undefined) {
    try {
      basinFrMove = fisherRao(basinAtOpen, basinNow);
    } catch {
      basinFrMove = null;
    }
  }
  const basinGateClear =
    basinFrMove === null || basinFrMove > PI_STRUCT_GRAVITATING_FRACTION;
  if (
    regimeDiverged
    && regimeChangeStreak >= regimeStreakRequired
    && basinGateClear
  ) {
    const moveStr = basinFrMove === null
      ? '(no basin anchor)'
      : `basin moved FR=${basinFrMove.toFixed(3)} > ${PI_STRUCT_GRAVITATING_FRACTION.toFixed(3)}`;
    return {
      checked: true,
      fired: 'regime_change',
      reason:
        `regime_change: opened in ${regimeAtOpen}, now ${regimeNow} `
        + `(stable ${regimeChangeStreak} ticks, ${moveStr})`,
      phiFloor,
      regimeChangeStreak,
      basinFrMove,
    };
  }
  if (phiNow < phiFloor) {
    return {
      checked: true,
      fired: 'phi_collapse',
      reason: `phi_collapse: open Φ=${phiAtOpen.toFixed(3)} → now ${phiNow.toFixed(3)} < floor ${phiFloor.toFixed(3)}`,
      phiFloor,
      regimeChangeStreak,
      basinFrMove,
    };
  }
  if (emotions.confidence < emotions.anxiety + emotions.confusion) {
    return {
      checked: true,
      fired: 'conviction_failed',
      reason: `conviction_failed: conf=${emotions.confidence.toFixed(3)} < anxiety+confusion=${(emotions.anxiety + emotions.confusion).toFixed(3)}`,
      phiFloor,
      regimeChangeStreak,
      basinFrMove,
    };
  }
  // 4. STALE_BLEED — interim guard for dormant conviction gate.
  //    Fires only when both duration and ROI inputs are provided.
  if (
    heldDurationS !== undefined
    && currentRoi !== undefined
    && heldDurationS >= STALE_BLEED_MIN_DURATION_S
    && currentRoi <= STALE_BLEED_ROI_THRESHOLD
  ) {
    return {
      checked: true,
      fired: 'stale_bleed',
      reason:
        `stale_bleed: held ${Math.round(heldDurationS)}s `
        + `≥ ${STALE_BLEED_MIN_DURATION_S}s at ROI ${(currentRoi * 100).toFixed(2)}% `
        + `≤ ${(STALE_BLEED_ROI_THRESHOLD * 100).toFixed(2)}%`,
      phiFloor,
      regimeChangeStreak,
      basinFrMove,
    };
  }
  return {
    checked: true,
    fired: null,
    reason: '',
    phiFloor,
    regimeChangeStreak,
    basinFrMove,
  };
}
