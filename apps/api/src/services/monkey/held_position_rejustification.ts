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
   * Streak of consecutive ticks where the conviction-failed condition
   * (confidence < anxiety + confusion) has been true. CALIB-1 (2026-05-17)
   * mirrors the regime_change streak gate at line 175 — same anti-noise
   * rationale (PR #629). Single-tick conviction noise was driving 60% of
   * losses in chop-zone observed via the 2026-05-17 CSV analysis. Caller
   * tracks the streak per-lane; observer-style reset to 0 on any tick
   * where the condition flips false. Undefined treats as 0 (fail-open;
   * no debounce — preserves pre-CALIB-1 behaviour for callers that
   * haven't migrated).
   */
  convictionFailedStreak?: number;
  /**
   * Required streak length before the conviction_failed exit fires.
   * Default 2 ticks — minimum-evidence sentinel (1 tick = noise; ≥ 2 =
   * signal). Same pattern as HISTORY_MIN_SAMPLES=2 in neurochemistry.
   */
  convictionFailedTicksRequired?: number;
  /**
   * CALIB-3 (2026-05-17): consecutive-tick counter for "current tick's
   * preferred side disagrees with held side". When the disagreement
   * persists, an EARLY exit fires regardless of current ROI — per
   * operator directive 2026-05-17: "better to close in positive than
   * wait and close in negative; if false positive, can re-enter
   * original direction." Faster than STALE_BLEED (30min + <-1% ROI)
   * and orthogonal to conviction-failed (which gates on emotion,
   * not direction). Live diagnostic showed swing-lane positions
   * sitting on wrong side for hours with no fast exit. Caller tracks
   * the streak per-lane; observer-style reset to 0 when sides agree.
   */
  directionalDisagreementStreak?: number;
  /**
   * Required streak before directional_disagreement fires. Default 4
   * ticks for scalp; caller should scale UP for swing (×3) and trend
   * (×10) per the operator's scalp=micro/swing=moderate/trend=macro
   * timescale doctrine — encoded in loop.ts DISAGREEMENT_LANE_MULTIPLIER.
   * NO ROI gate by design: the whole point is to exit before ROI
   * flips negative.
   */
  directionalDisagreementTicksRequired?: number;
  /**
   * Held duration in seconds for the stale-bleed gate. Undefined
   * disables the stale-bleed check (legacy callers / no entry timestamp).
   */
  heldDurationS?: number;
  /**
   * Current ROI on margin (signed fraction; -0.02 = -2% loss). Used
   * by the stale-bleed gate AND the CALIB-3 directional_disagreement
   * gate. Undefined disables both checks.
   */
  currentRoi?: number;
  /**
   * Commit 3 (Cascade brief 2026-05-27): position-origin distinction.
   * When `'adopted'`, the position was opened by an external sibling
   * kernel instance (monkey-position) or by the operator manually,
   * NOT by this kernel's own decision. Adopted positions skip the
   * regime / phi / conviction / stale-bleed checks because none of
   * those gates have the kernel's own basin context at entry — they
   * fire on noise. Adopted positions exit on TP / hard SL / basinDir-
   * flip (directional_disagreement) only. Defaults to `'own'` for
   * back-compat with callers that don't yet thread origin.
   */
  origin?: 'own' | 'adopted';
  /**
   * Hold-time floor 2026-05-28 (CC1, operator-selected fix):
   * Internal-coherence exits (regime_change, phi_collapse,
   * conviction_failed) are suppressed until the position has been held
   * at least `holdTimeFloorS` seconds. Now observer-derived
   * (#1009 cascading-knob-strip 2026-05-29): the lane's empirical
   * decision-change interval from `substrate_observer.ts` — the
   * legacy `LANE_DECISION_PERIOD_MS` table (scalp 60s, swing 180s,
   * trend 600s) was a designer's intuition embedded in code and has
   * been removed. Cold-start: 0 (no floor until the kernel has
   * observed its own decision cadence). Exiting before the observed
   * period elapses means the kernel hasn't given its own thesis room
   * to develop.
   *
   * The 2026-05-27 audit showed avg hold 8min on trend trades whose
   * lane decision-period is 600s (10 min). Wins capture 0.08% of
   * notional, losses 0.18%, loss/win ratio 2× — the textbook
   * wins-cut-short-losses-let-run pattern. This floor is the
   * structural cure.
   *
   * IMPORTANT: TP, hard SL, directional_disagreement (basinDir flip),
   * and stale_bleed are NEVER gated by this floor — they're safety
   * exits that must fire promptly regardless of time. Only the
   * internal-coherence checks are gated.
   *
   * Undefined disables the floor (legacy callers; back-compat).
   */
  holdTimeFloorS?: number;
}

export type RejustificationFire =
  | 'regime_change'
  | 'phi_collapse'
  | 'conviction_failed'
  | 'stale_bleed'
  | 'directional_disagreement';

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
  /** Streak of consecutive ticks where conviction-failed condition was
   *  true (CALIB-1 #778). 0 when the condition is currently false. */
  convictionFailedStreak: number;
  /** Required streak length before conviction_failed fires (CALIB-1). */
  convictionFailedTicksRequired: number;
  /** Streak of consecutive ticks where current-tick side disagrees with
   *  held side (CALIB-3). 0 when sides agree this tick. */
  directionalDisagreementStreak: number;
  /** Required streak length before directional_disagreement fires (CALIB-3). */
  directionalDisagreementTicksRequired: number;
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
  const origin = input.origin ?? 'own';
  const regimeConfidence = input.regimeConfidence ?? 1.0;
  const regimeChangeStreak = input.regimeChangeStreak ?? 0;
  const regimeStabilityTicksRequired = input.regimeStabilityTicksRequired ?? 3;
  const convictionFailedStreak = input.convictionFailedStreak ?? 0;
  const convictionFailedTicksRequired = input.convictionFailedTicksRequired ?? 2;
  const directionalDisagreementStreak = input.directionalDisagreementStreak ?? 0;
  const directionalDisagreementTicksRequired =
    input.directionalDisagreementTicksRequired ?? 4;
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
      convictionFailedStreak, convictionFailedTicksRequired,
      directionalDisagreementStreak, directionalDisagreementTicksRequired,
    };
  }
  const phiFloor = phiAtOpen / PHI_GOLDEN_FLOOR_RATIO;

  // Hold-time floor 2026-05-28 (CC1, operator-selected fix):
  // The 2026-05-27 audit showed avg hold 8 min on positions whose lane
  // decision period is 60-600s — wins get harvested before edges develop.
  // When the floor is supplied AND the position hasn't aged into it yet,
  // internal-coherence exits (regime/phi/conviction) are SUPPRESSED.
  // directional_disagreement is exempt (safety: basinDir flipped against
  // held side is decisive regardless of time).
  // stale_bleed runs at L350+ with its own 30min duration gate which is
  // strictly larger than any lane period, so the floor doesn't conflict.
  const heldS = input.heldDurationS ?? Infinity;  // Infinity = floor passes by default
  const floorS = input.holdTimeFloorS ?? 0;
  const beforeHoldTimeFloor = heldS < floorS;

  // Commit 3 (Cascade brief 2026-05-27): adopted positions skip the
  // regime / phi / conviction / stale_bleed checks. Those gates assume
  // the kernel's own basin context at entry — adopted positions never
  // had that context (operator or sibling kernel opened them). The
  // only kernel-view-driven close that still applies is the
  // directional_disagreement check ("basinDir flipped against held
  // side"), which doesn't depend on entry-basin anchoring. Adopted
  // positions otherwise exit on TP / hard SL only.
  if (origin === 'adopted') {
    // Still compute directional_disagreement (this gate compares the
    // kernel's CURRENT preferred side to the held side; no entry-basin
    // dependency). Order: directional_disagreement → no-fire.
    if (
      directionalDisagreementStreak >= directionalDisagreementTicksRequired
      && input.currentRoi !== undefined
    ) {
      return {
        checked: true,
        fired: 'directional_disagreement',
        reason:
          `directional_disagreement (adopted): held-side ≠ current preferred side `
          + `for ${directionalDisagreementStreak} ticks (≥ ${directionalDisagreementTicksRequired})`,
        phiFloor,
        frDistance, frThreshold,
        regimeChangeStreak, regimeStabilityTicksRequired,
        convictionFailedStreak, convictionFailedTicksRequired,
        directionalDisagreementStreak, directionalDisagreementTicksRequired,
      };
    }
    return {
      checked: true, fired: null,
      reason: `adopted_position: regime/phi/conviction/stale_bleed gates skipped (origin=adopted)`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
      convictionFailedStreak, convictionFailedTicksRequired,
      directionalDisagreementStreak, directionalDisagreementTicksRequired,
    };
  }

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
  if (regimeNow !== regimeAtOpen && !beforeHoldTimeFloor) {
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
        convictionFailedStreak, convictionFailedTicksRequired,
        directionalDisagreementStreak, directionalDisagreementTicksRequired,
        frDistance, frThreshold,
        regimeChangeStreak, regimeStabilityTicksRequired,
      };
    }
  }
  if (phiNow < phiFloor && !beforeHoldTimeFloor) {
    return {
      checked: true,
      fired: 'phi_collapse',
      reason: `phi_collapse: open Φ=${phiAtOpen.toFixed(3)} → now ${phiNow.toFixed(3)} < floor ${phiFloor.toFixed(3)}`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
      convictionFailedStreak, convictionFailedTicksRequired,
      directionalDisagreementStreak, directionalDisagreementTicksRequired,
    };
  }
  // CALIB-1 (2026-05-17): require convictionFailedStreak >= required ticks
  // before firing. Mirrors the regime_change streak gate above (rationale
  // PR #629 — single-tick noise drove 22% win rate in 2026-05-01 16:11
  // incident; same anti-noise logic applies here). 2026-05-17 CSV
  // analysis: 60% loss rate at $0.08 avg loss vs $0.10 avg win, dominated
  // by single-tick conviction-failed exits in chop-zone scalping. Default
  // requirement is 2 ticks — minimum-evidence sentinel, same pattern as
  // HISTORY_MIN_SAMPLES=2 in neurochemistry.
  if (
    emotions.confidence < emotions.anxiety + emotions.confusion
    && convictionFailedStreak >= convictionFailedTicksRequired
    && !beforeHoldTimeFloor
  ) {
    return {
      checked: true,
      fired: 'conviction_failed',
      reason:
        `conviction_failed: conf=${emotions.confidence.toFixed(3)} `
        + `< anxiety+confusion=${(emotions.anxiety + emotions.confusion).toFixed(3)} `
        + `for ${convictionFailedStreak} consecutive ticks `
        + `(≥ ${convictionFailedTicksRequired} required)`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
      convictionFailedStreak, convictionFailedTicksRequired,
      directionalDisagreementStreak, directionalDisagreementTicksRequired,
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
      convictionFailedStreak, convictionFailedTicksRequired,
      directionalDisagreementStreak, directionalDisagreementTicksRequired,
    };
  }
  // 5. CALIB-3 (2026-05-17): directional_disagreement — when the
  //    current tick's preferred side has disagreed with the held side
  //    for >= directionalDisagreementTicksRequired consecutive ticks,
  //    exit REGARDLESS of current ROI. Per operator directive 2026-05-17:
  //    "exit early so it doesn't wait until the switch in direction
  //    takes hold and the held position goes negative before the
  //    switch. Always better to close in positive than wait and close
  //    in the negative — if the switch is a false positive, can
  //    re-enter the original direction." Sits between the fast
  //    conviction-failed gate and the slow 30-min stale_bleed gate.
  //
  //    The streak requirement is lane-scaled by the caller — scalp
  //    lane gets a fast (4-tick) requirement; swing gets moderate;
  //    trend gets slow. Encoded by the caller passing the right
  //    `directionalDisagreementTicksRequired` value per lane (the
  //    user's scalp=micro/swing=moderate/trend=macro doctrine).
  //
  //    No ROI gate — by design. The whole point is to exit before ROI
  //    flips negative. currentRoi is included in the reason string for
  //    operator visibility only.
  if (directionalDisagreementStreak >= directionalDisagreementTicksRequired) {
    const roiStr = input.currentRoi !== undefined
      ? `${(input.currentRoi * 100).toFixed(2)}%`
      : 'unknown';
    return {
      checked: true,
      fired: 'directional_disagreement',
      reason:
        `directional_disagreement: held side opposed by current-tick `
        + `for ${directionalDisagreementStreak} consecutive ticks `
        + `(≥ ${directionalDisagreementTicksRequired} required, ROI ${roiStr}) `
        + `— exiting before ROI flips negative; can re-enter on false positive`,
      phiFloor,
      frDistance, frThreshold,
      regimeChangeStreak, regimeStabilityTicksRequired,
      convictionFailedStreak, convictionFailedTicksRequired,
      directionalDisagreementStreak, directionalDisagreementTicksRequired,
    };
  }
  return {
    checked: true, fired: null, reason: '', phiFloor,
    convictionFailedStreak, convictionFailedTicksRequired,
    directionalDisagreementStreak, directionalDisagreementTicksRequired,
    frDistance, frThreshold,
    regimeChangeStreak, regimeStabilityTicksRequired,
  };
}
