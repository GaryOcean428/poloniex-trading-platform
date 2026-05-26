/**
 * kernel_rotation.ts — per-kernel live/paper state machine.
 *
 * The pre-cutover system the operator described (2026-05-25):
 *
 *   "the most successful kernel was allocated more over time. kernels
 *    that eventually had no allocation went back to paper and back
 *    testing until they got their win rate within 10% of the best
 *    kernel. 5 x consecutive losing trades pushed that kernel back to
 *    paper and backtesting also."
 *
 * This module implements the LIVE/PAPER state machine + the
 * 5-consecutive-loss demotion trigger. Auto-promotion (paper WR within
 * 10% of best live kernel) is queued for the follow-up PR — it
 * requires virtual position simulation so a paper-mode kernel can
 * accumulate simulated closes to compare against the live registry.
 * Until that lands, paper-mode kernels can be manually re-promoted via
 * `MonkeyKernel.promoteToLive()`.
 *
 * The state machine is INSTANCE-LOCAL: each MonkeyKernel owns its own
 * rotation state, no global coordinator. Cross-kernel comparisons
 * (best WR registry) become relevant in the auto-promotion PR.
 *
 * Doctrine: chemistry-driven feedback is the primary learning loop
 * (push_reward → gaba on losses → reduced size). The paper-rotation
 * adds a structural circuit-breaker for losing streaks that the
 * chemistry alone hasn't pulled the kernel out of fast enough.
 * Paper-mode kernels still TICK and still UPDATE chemistry from any
 * outcomes that reach them — they just don't commit capital.
 */

/** Default loss streak that triggers demotion. */
export const ROTATION_LOSS_STREAK_THRESHOLD = 5;

/** Rolling window over which a kernel's WR is tracked. */
export const ROTATION_WR_WINDOW = 50;

/** Minimum WR sample count before a kernel's rolling WR is considered
 *  authoritative — used by the auto-promotion gate so a paper kernel
 *  can't promote on a single lucky close. */
export const ROTATION_WR_MIN_SAMPLES = 10;

/** Auto-promotion gap: paper kernel's WR must be within this many
 *  percentage points of the best live kernel's WR to graduate back
 *  to live. The operator's pre-cutover spec was "within 10%". */
export const ROTATION_PROMOTION_WR_GAP = 0.10;

export type KernelOperationalMode = 'live' | 'paper';

export interface RotationState {
  /** Current operational mode. Defaults to 'live'. */
  mode: KernelOperationalMode;
  /** Consecutive losing-trade count. Resets on any win. */
  consecutiveLosses: number;
  /** Rolling per-trade PnLs over the last ROTATION_WR_WINDOW closes.
   *  Used for win-rate calculation in the auto-promotion PR. */
  rollingPnls: number[];
  /** ms timestamp of last demotion (null if never demoted). For audit
   *  and to throttle re-demotion churn in the future. */
  lastDemotionAtMs: number | null;
  /** Reason string for the last state transition, for logs/telemetry. */
  lastTransitionReason: string | null;
}

export function makeRotationState(): RotationState {
  return {
    mode: 'live',
    consecutiveLosses: 0,
    rollingPnls: [],
    lastDemotionAtMs: null,
    lastTransitionReason: null,
  };
}

/**
 * Record a closed-trade outcome. Updates the rolling PnL window and
 * the consecutive-loss counter. Returns true iff the close triggered
 * a state transition (live → paper).
 *
 * Pure with respect to the input state object — mutates state in
 * place; caller owns the lifecycle. PnL sign convention: positive =
 * win, zero or negative = loss for streak-counting.
 */
export function recordClose(
  state: RotationState,
  realizedPnlUsdt: number,
  nowMs: number = Date.now(),
): { demoted: boolean; reason: string | null } {
  state.rollingPnls.push(realizedPnlUsdt);
  if (state.rollingPnls.length > ROTATION_WR_WINDOW) {
    state.rollingPnls.shift();
  }

  // Win-streak vs loss-streak. A zero-pnl close counts as a loss for
  // streak purposes — chemistry already treats zero/negative as
  // not-a-win (see neurochemistry.ts dopamine block), so the streak
  // semantic stays consistent.
  if (realizedPnlUsdt > 0) {
    state.consecutiveLosses = 0;
    return { demoted: false, reason: null };
  }

  state.consecutiveLosses += 1;

  if (
    state.mode === 'live'
    && state.consecutiveLosses >= ROTATION_LOSS_STREAK_THRESHOLD
  ) {
    const reason =
      `${state.consecutiveLosses} consecutive losing trades — demoted to paper`;
    state.mode = 'paper';
    state.lastDemotionAtMs = nowMs;
    state.lastTransitionReason = reason;
    return { demoted: true, reason };
  }

  return { demoted: false, reason: null };
}

/**
 * Manually promote a paper-mode kernel back to live. No-op if already
 * live. Until the auto-promotion PR lands, this is the only way out of
 * paper mode.
 *
 * Returns true iff a transition occurred. Resets the consecutive-loss
 * counter so the kernel doesn't immediately re-demote on its next
 * close.
 */
export function promoteToLive(
  state: RotationState,
  reason: string = 'manual operator promotion',
  nowMs: number = Date.now(),
): { promoted: boolean; reason: string | null } {
  void nowMs;
  if (state.mode === 'live') return { promoted: false, reason: null };
  state.mode = 'live';
  state.consecutiveLosses = 0;
  state.lastTransitionReason = reason;
  return { promoted: true, reason };
}

/** Rolling win-rate over the kernel's last N closes. NaN when the
 *  window is empty (no closes yet observed). */
export function rollingWinRate(state: RotationState): number {
  const n = state.rollingPnls.length;
  if (n === 0) return Number.NaN;
  let wins = 0;
  for (const pnl of state.rollingPnls) if (pnl > 0) wins += 1;
  return wins / n;
}

/**
 * Snapshot of the data a kernel exposes to peers for cross-kernel
 * auto-promotion. Decoupled from MonkeyKernel so this module stays
 * pure-state (no circular imports).
 */
export interface RotationPeerSnapshot {
  mode: KernelOperationalMode;
  rollingWinRate: number;        // NaN if no samples yet
  rollingSampleCount: number;
}

/**
 * Decide whether a paper-mode kernel has earned re-promotion to live.
 *
 * The rule (matches the pre-cutover spec the operator described):
 *
 *   1. The candidate must be in paper mode.
 *   2. The candidate must have at least ROTATION_WR_MIN_SAMPLES closes
 *      in its rolling window (no promotion on a single lucky close).
 *   3. There must exist at least one peer kernel in 'live' mode with
 *      a CI-firm rolling WR (≥ ROTATION_WR_MIN_SAMPLES samples). If no
 *      live peer has stats yet, the gate cannot fire — the system has
 *      no reference WR to compare against.
 *   4. The candidate's rolling WR must be within
 *      ROTATION_PROMOTION_WR_GAP of the BEST live peer's WR.
 *
 * Returns the reason string when promotion should fire, null otherwise.
 */
export function shouldAutoPromote(
  candidate: RotationState,
  peers: ReadonlyArray<RotationPeerSnapshot>,
): string | null {
  if (candidate.mode !== 'paper') return null;
  const myN = candidate.rollingPnls.length;
  if (myN < ROTATION_WR_MIN_SAMPLES) return null;

  let myWins = 0;
  for (const p of candidate.rollingPnls) if (p > 0) myWins += 1;
  const myWR = myWins / myN;

  let bestLiveWR = Number.NaN;
  for (const peer of peers) {
    if (peer.mode !== 'live') continue;
    if (peer.rollingSampleCount < ROTATION_WR_MIN_SAMPLES) continue;
    if (!Number.isFinite(peer.rollingWinRate)) continue;
    if (!Number.isFinite(bestLiveWR) || peer.rollingWinRate > bestLiveWR) {
      bestLiveWR = peer.rollingWinRate;
    }
  }

  if (!Number.isFinite(bestLiveWR)) return null;  // no informative live peer
  if (myWR < bestLiveWR - ROTATION_PROMOTION_WR_GAP) return null;

  return `auto-promotion: rolling WR ${(myWR * 100).toFixed(1)}% >= ` +
    `best live ${(bestLiveWR * 100).toFixed(1)}% - ${(ROTATION_PROMOTION_WR_GAP * 100).toFixed(0)}pp`;
}
