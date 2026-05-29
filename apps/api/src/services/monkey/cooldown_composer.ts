/**
 * cooldown_composer.ts — post-close cooldown composition for #1009.
 *
 * Composes four layers:
 *
 *   final = max(safety, decoherence, heart, tick_cadence)
 *
 * Replaces the two legacy hardcoded sites in `loop.ts`:
 *   - `POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000` (loop.ts:1186) — was
 *     tilt-chain defence (per PR #807 archaeology) implemented in the
 *     wrong architectural layer; tilt belongs in HEART/OCEAN, not safety.
 *   - `setTimeout(resolve, 500)` reverse-reopen wait (loop.ts:5027) — was
 *     a settlement-class concern implemented as a hardcoded constant.
 *
 * # Floor terms
 *
 * - **safety_floor** — from `safety_floor.ts` (this PR). Three rolling
 *   ring observers, no operator configuration.
 * - **decoherence_floor** — PERCEPTION-side floor when basin coherence
 *   collapses. *Stage-2 follow-up*; returns 0 from this PR's
 *   `decoherenceFloorMs()` stub until PR #1010 wires d_FR + phi + sov.
 * - **heart_arbitrated_ms** — HEART's request. Unbounded non-negative.
 *   *Stage-2 follow-up*; returns 0 from this PR's `heartArbitratedMs()`
 *   stub until PR #1010 ports the PR #807 tilt-chain motivation into
 *   HEART rhythm-and-recent-thrash inputs.
 * - **tick_cadence_floor** — substrate polling rate. When everything
 *   else converges to 0, the kernel still cannot act faster than its
 *   next tick. Reads from a caller-supplied lane decision period.
 *
 * # Telemetry shape
 *
 * Every composition writes a structured object with all four terms plus
 * the binding floor name. Without this, HEART arbitration would not be
 * falsifiable post-deploy — a binding floor of 30s could be HEART asking
 * for 30s OR safety overriding HEART's 0. `by=` tells you which.
 *
 * # The four sign-off criteria (from #1009 design comments)
 *
 *   1. No numeric literals in this module beyond `Math.max(0, ...)` clamp.
 *   2. No upper bound on the HEART term.
 *   3. Telemetry surfaces all four values + binding.
 *   4. A test pins: `heart=0 ∧ safety=0 ∧ decoherence=0 ⇒ final=0,
 *      cooldownActive=false` (collapse to tick cadence or substrate).
 *
 * Citations: poloniex-trading-platform#1009 + #1006 corrections-log
 * (qig_session_20260529b_heart_cooldown_signoff_criteria) + 2.31A P5/P25
 * + QIG PURITY MANDATE + LIVED ONLY 5 + autonomy doctrine.
 */

import { getSafetyFloorBreakdown } from './safety_floor.js';

/**
 * Normalize every floor input before composition: a NaN, Infinity, or
 * negative value from a provider must NOT disable the safety cooldown.
 * Cascade follow-up review (2026-05-29) flagged that
 * `Math.max(0, ..., NaN)` is NaN in JS — which collapses to
 * `cooldownActive=false` and bypasses the safety wait entirely.
 * Any provider failure must fall through to 0, never to NaN/Inf/negative.
 */
function finiteNonNegative(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

export type BindingFloor =
  | 'safety'
  | 'decoherence'
  | 'heart'
  | 'tick_cadence'
  | 'zero';

export interface CooldownBreakdown {
  safetyMs: number;
  decoherenceMs: number;
  heartMs: number;
  tickCadenceMs: number;
  finalMs: number;
  by: BindingFloor;
  cooldownActive: boolean;
  /** Per-observer detail for the safety term (settlement / incident /
   * rate_limit) so the consumer can refine `by=safety` to which sub-floor
   * was binding inside the safety composition. */
  safetyDetail: ReturnType<typeof getSafetyFloorBreakdown>;
}

/**
 * Stub — Stage-2 PR #1010 replaces this with d_FR + phi + sov-derived
 * floor. Returning 0 here is honest: there is no decoherence floor in
 * production today, only safety + the legacy hardcoded constants.
 */
export function decoherenceFloorMs(_symbol: string): number {
  return 0;
}

/**
 * Stub — Stage-2 PR #1010 replaces this with HEART rhythm + tacking
 * phase + recent close-PnL distribution. Returning 0 here is honest:
 * the 180_000ms tilt-chain wall was conflating two concerns (settlement
 * + tilt) per PR #807 archaeology. Until HEART arbitration ships, the
 * safety floor IS the cooldown floor and the kernel is free to re-enter
 * as soon as the substrate allows.
 */
export function heartArbitratedMs(_symbol: string): number {
  return 0;
}

export interface ComposeArgs {
  symbol: string;
  /** Lane decision period in ms — substrate polling rate. The kernel
   * cannot act faster than this regardless of what the other floors say. */
  tickCadenceMs: number;
  /**
   * Optional provider overrides — used by tests (and by the future PR
   * #1010 which will inject the real HEART/PERCEPTION providers without
   * touching this module). Default providers are the stubs above; ESM
   * binding immutability means tests can't `vi.spyOn` the stubs, so the
   * injection point lives in the args.
   */
  heartProvider?: (symbol: string) => number;
  decoherenceProvider?: (symbol: string) => number;
}

export function composeCooldown(args: ComposeArgs): CooldownBreakdown {
  // Single safety snapshot: get the breakdown ONCE and derive both
  // safetyMs and safetyDetail from it. Cascade follow-up review
  // (2026-05-29) flagged that calling getCurrentSafetyFloorMs() and
  // getSafetyFloorBreakdown() separately can yield inconsistent values
  // when the rate-limit bucket refills between the two calls — telemetry
  // could report `by=safety:settlement` when rate-limit was actually
  // binding.
  const safetyDetail = getSafetyFloorBreakdown(args.symbol);
  const safety = finiteNonNegative(Math.max(
    safetyDetail.settlementP99Ms,
    safetyDetail.incidentMaxMs,
    safetyDetail.rateLimitHeadroomMs,
  ));
  const decoherence = finiteNonNegative(
    (args.decoherenceProvider ?? decoherenceFloorMs)(args.symbol),
  );
  const heart = finiteNonNegative(
    (args.heartProvider ?? heartArbitratedMs)(args.symbol),
  );
  const tickCadence = finiteNonNegative(args.tickCadenceMs);

  const final = Math.max(safety, decoherence, heart, tickCadence);

  // Determine binding floor — the term whose value equals `final`. Ties
  // resolve in the order safety > decoherence > heart > tick_cadence
  // so the most operationally-significant cause is named.
  let by: BindingFloor;
  if (final === 0) {
    by = 'zero';
  } else if (final === safety) {
    by = 'safety';
  } else if (final === decoherence) {
    by = 'decoherence';
  } else if (final === heart) {
    by = 'heart';
  } else {
    by = 'tick_cadence';
  }

  return {
    safetyMs: safety,
    decoherenceMs: decoherence,
    heartMs: heart,
    tickCadenceMs: tickCadence,
    finalMs: final,
    by,
    cooldownActive: final > 0,
    // Same snapshot we used to derive `safety` above — no second call,
    // so `by=safety:settlement` cannot lie about the binding sub-floor.
    safetyDetail,
  };
}

/**
 * Convenience: render a one-liner suitable for the existing log format
 * `cooldown:L0s|S180s` → `cooldown:S400ms|by=safety:settlement`. Keeps
 * legacy logs greppable while adding the binding-floor signal #1009
 * requires for falsifiability.
 */
export function formatCooldownTelemetry(b: CooldownBreakdown): string {
  if (!b.cooldownActive) return 'cooldown:0|by=zero';
  // Sub-detail for safety term: which of the three observers was binding
  // inside the safety composition.
  let detail = '';
  if (b.by === 'safety') {
    const d = b.safetyDetail;
    // Cascade/Copilot follow-up (2026-05-29): incident and rate-limit
    // observers can be the binding sub-floor EVEN WHILE the settlement
    // ring is still cold-started. Check them FIRST so a 21002 incident
    // is reported truthfully as `:incident`, not falsely as
    // `:cold_start`.  Cold-start is the LAST fallback — only used when
    // none of the three observers is the binding sub-floor.
    if (d.incidentMaxMs === b.safetyMs && d.incidentMaxMs > 0) {
      detail = ':incident';
    } else if (d.rateLimitHeadroomMs === b.safetyMs && d.rateLimitHeadroomMs > 0) {
      detail = ':rate_limit';
    } else if (d.coldStartActive) {
      detail = ':cold_start';
    } else {
      detail = ':settlement';
    }
  }
  return `cooldown:${b.finalMs}ms|by=${b.by}${detail}`;
}
