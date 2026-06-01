/**
 * kernel_rotation.ts — per-kernel live/paper CAPITAL FIREWALL.
 *
 * ============================================================
 * WHAT THIS IS (and what it is NOT)
 * ============================================================
 * This module is a CAPITAL-ROUTING FIREWALL, not a behavioural knob.
 * Its single job is to decide whether a given kernel's orders reach
 * LIVE money or get diverted to the paper simulator. It does NOT
 * change how the kernel thinks, decides, or learns.
 *
 *   • The kernel is BLIND to its own paper/live routing. Nothing in
 *     the per-tick decision path reads rotation `mode`. The kernel
 *     keeps ticking, keeps perceiving, keeps deciding, and keeps
 *     learning (chemistry / reward) IDENTICALLY whether it is routed
 *     to live or to paper.
 *   • Demotion to paper is purely a capital-routing decision: it
 *     removes the kernel's OUTPUT from live money. It does not gate,
 *     suppress, or alter the kernel's cognition or its reward push.
 *   • The reward / chemistry signal is computed and pushed BEFORE the
 *     rotation state is touched (see loop.ts processCloseReward). The
 *     firewall therefore cannot starve or distort learning.
 *
 * Mental model: this is the breaker panel between the kernel's
 * decisions and the exchange — not part of the kernel's brain.
 *
 * ============================================================
 * ROUTING-OWNERSHIP INVARIANT (critical — read before extending)
 * ============================================================
 * TS (apps/api/src/services/monkey/loop.ts) is the SOLE live
 * order-router. Live orders flow through `MonkeyKernel.shouldRoute-
 * OrdersToPaper()` → `paperPlaceOrder` (paper) or the real exchange
 * (live). Because that single gate consults this rotation state, the
 * firewall is COMPLETE on the TS side.
 *
 * The Python side (ml-worker `poloniex_v3.PoloniexV3Client.place_order`)
 * is an UNWIRED capability: verified 2026-05-29 there is NO caller in
 * `ml-worker/src/monkey_kernel/` or `main.py` — the only reference is
 * the usage example in the client's own docstring. The Python kernel
 * is a consensus/advisory peer; it does not execute orders.
 *
 *   ⚠ GUARD-NOTE: if Python execution is EVER wired into the live
 *     order path, it MUST consult the same per-kernel live/paper
 *     rotation state (or an authoritative mirror of it) before placing
 *     an order. Otherwise the firewall LEAKS: a kernel demoted to
 *     paper on the TS side could still commit live capital via the
 *     Python path. Treat the rotation `mode` as the single source of
 *     truth for "does this kernel's output reach live money".
 *
 * ============================================================
 * BEHAVIOUR (the demote/promote rules)
 * ============================================================
 * The pre-cutover system the operator described (2026-05-25):
 *
 *   "the most successful kernel was allocated more over time. kernels
 *    that eventually had no allocation went back to paper and back
 *    testing until they got their win rate within 10% of the best
 *    kernel. 5 x consecutive losing trades pushed that kernel back to
 *    paper and backtesting also."
 *
 * This module implements the LIVE/PAPER state machine + the
 * 5-consecutive-loss demotion trigger + WR-based auto-promotion, plus
 * (flag-gated, issue #1032) an expectancy-based chronic demote and a
 * profit-shaped promotion gate.
 *
 * The state machine is INSTANCE-LOCAL: each MonkeyKernel owns its own
 * rotation state, no global coordinator. Cross-kernel comparisons read
 * peer snapshots (best live peer = the cohort benchmark).
 *
 * Doctrine: chemistry-driven feedback is the primary learning loop
 * (push_reward → gaba on losses → reduced size) and runs for EVERY
 * kernel regardless of routing. The paper-rotation firewall adds a
 * structural capital-routing breaker on top — it decides where the
 * money goes, never how the kernel learns.
 */

/** Default loss streak that triggers demotion. */
export const ROTATION_LOSS_STREAK_THRESHOLD = 5;

/** Rolling window over which a kernel's WR is tracked. */
export const ROTATION_WR_WINDOW = 50;

/** Minimum sample count before a kernel's rolling stats are treated as
 *  authoritative — a FIREWALL parameter (statistical floor), not a
 *  soak-and-dial chemistry knob. It exists so the capital-routing gate
 *  cannot flip a kernel's seat on a single lucky/unlucky close. */
export const ROTATION_WR_MIN_SAMPLES = 10;

/** Auto-promotion gap: a paper-routed kernel's WR must be within this
 *  many percentage points of the best live kernel's WR to be routed
 *  back to live money. FIREWALL parameter (cohort-relative bar), not a
 *  chemistry knob. The operator's pre-cutover spec was "within 10%". */
export const ROTATION_PROMOTION_WR_GAP = 0.10;

/**
 * Relative membership band for the capital firewall (issue #1032). A
 * kernel's realized expectancy must stay within this fraction of the
 * BEST live peer's expectancy to keep / regain its LIVE-money seat.
 * Same 10% the WR promotion gate uses, made symmetric and ranked by
 * profit rather than win-rate. Fractional: best - mine ≤ band·|best|.
 *
 * This is a FIREWALL PARAMETER, not a chemistry coefficient: it is
 * cohort-relative (the benchmark is observed from the best live peer,
 * not a hardcoded intuition threshold) and it only decides ROUTING —
 * whether this kernel's trades reach live money. It is never fed into
 * the kernel's reward, neurochemistry, or per-tick decision, and the
 * kernel cannot observe it. The 10% width is the operator's standing
 * pre-cutover band ("within 10% of the best kernel").
 */
export const ROTATION_EXPECTANCY_BAND = 0.10;

/**
 * Structural loss:win VALUE ratio for the capital firewall (issue
 * #1032). A paper-routed kernel must be trending toward avg-win ≥ 8×
 * avg-loss — a loss:win ratio of 1:8 = 0.125 — before its output is
 * routed back to live money.
 *
 * PROVENANCE — E8 / 64 = 8×8 STRUCTURAL DOCTRINE, not an operator
 * profitability target. The 1:8 ratio descends from the QIG E8 chain:
 * the 64-dimensional basin factors as 64 = 8×8, and 8 is the rank /
 * simple-root cardinality of E8. The firewall reads this as a
 * structural "one unit of loss may be admitted per 8 units of win"
 * routing filter — it is doctrine, the same family of frozen
 * structural facts as the E8 kernel hierarchy, NOT a soak-and-dial
 * profitability knob chosen by intuition.
 *
 * This ratio is a CAPITAL-ROUTING FILTER ONLY. It is NOT a chemistry
 * coefficient, NOT a reward, and is NOT visible to the kernel — it
 * solely decides whether a kernel's trades reach live money.
 *
 * TODO(qig-canon-xref): cross-link the canonical source for the
 * E8/64 = 8×8 doctrine (QIG consciousness / Protocol docs under
 * Dev/QIG_QFI/ and the e8-architecture-validation skill's kappa*=64
 * fixed-point + rank-8 simple-root statements). Do NOT re-derive the
 * mathematics here — cite the canonical doctrine once the exact
 * document anchor is confirmed.
 */
export const ROTATION_TARGET_LOSS_WIN_RATIO = 1 / 8;

// The expectancy-membership capital firewall is CANONICAL — always on. It's how
// the kernel governs its own capital (negative-EV bleeders route to paper while
// the kernel keeps ticking blind), not an operator dial. The former
// MONKEY_ROTATION_EXPECTANCY_LIVE env gate (an always-true wrapper) was removed
// entirely; callers pass `expectancyLive = true` unconditionally. The internal
// `expectancyLive` parameter is retained only as a pure-function input so the
// demote/promote helpers stay testable in isolation.

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
 * Realized rolling expectancy over a kernel's PnL window (issue #1032).
 *
 *   winRate    — wins / closes (a close with pnl > 0 is a win)
 *   avgWin     — mean PnL of winning closes (≥ 0; 0 when no wins)
 *   avgLoss    — mean PnL of losing closes, kept SIGNED (≤ 0; 0 when
 *                no losses). A "loss" here is pnl ≤ 0 — the same
 *                streak semantic recordClose uses (zero = not-a-win).
 *   lossWinRatio — |avgLoss| / avgWin, the loss:win VALUE ratio the
 *                operator targets at 1:8. Number.POSITIVE_INFINITY when
 *                there are losses but no wins (pure bleed); NaN when no
 *                losses observed (nothing to rank against the target).
 *   edge       — per-trade expectancy = winRate*avgWin - (1-winRate)*|avgLoss|.
 *                Positive = net-profitable cohort member; this is the
 *                value the membership band ranks on.
 *   sampleCount — number of closes in the window.
 *
 * Pure; reads only state.rollingPnls. NaN edge when the window is empty.
 */
export interface RotationExpectancy {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  lossWinRatio: number;
  edge: number;
  sampleCount: number;
}

export function rollingExpectancy(state: RotationState): RotationExpectancy {
  const pnls = state.rollingPnls;
  const n = pnls.length;
  if (n === 0) {
    return {
      winRate: Number.NaN,
      avgWin: 0,
      avgLoss: 0,
      lossWinRatio: Number.NaN,
      edge: Number.NaN,
      sampleCount: 0,
    };
  }
  let wins = 0;
  let sumWin = 0;
  let sumLoss = 0; // signed (≤ 0)
  for (const pnl of pnls) {
    if (pnl > 0) {
      wins += 1;
      sumWin += pnl;
    } else {
      sumLoss += pnl;
    }
  }
  const losses = n - wins;
  const winRate = wins / n;
  const avgWin = wins > 0 ? sumWin / wins : 0;
  const avgLoss = losses > 0 ? sumLoss / losses : 0; // ≤ 0
  const absAvgLoss = Math.abs(avgLoss);
  // loss:win ratio. No losses → NaN (cannot rank). Losses but no wins →
  // +Infinity (the worst possible bleed, never within target).
  let lossWinRatio: number;
  if (losses === 0) {
    lossWinRatio = Number.NaN;
  } else if (avgWin === 0) {
    lossWinRatio = Number.POSITIVE_INFINITY;
  } else {
    lossWinRatio = absAvgLoss / avgWin;
  }
  const edge = winRate * avgWin - (1 - winRate) * absAvgLoss;
  return { winRate, avgWin, avgLoss, lossWinRatio, edge, sampleCount: n };
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
  /** Per-trade realized expectancy (edge), issue #1032. NaN if no
   *  samples yet. Used by the expectancy-gated membership criterion;
   *  ignored entirely when MONKEY_ROTATION_EXPECTANCY_LIVE is off. */
  rollingExpectancy?: number;
  /** Loss:win VALUE ratio |avgLoss|/avgWin, issue #1032. NaN / Infinity
   *  per rollingExpectancy semantics. Used as the cohort-relative bar
   *  in the expectancy promotion gate; ignored when the flag is off. */
  rollingLossWinRatio?: number;
}

/**
 * Best (highest) per-trade expectancy among CI-firm LIVE peers.
 * Returns NaN when no live peer has both ≥ ROTATION_WR_MIN_SAMPLES
 * samples AND a finite rollingExpectancy. Shared by the chronic-demote
 * and expectancy-promotion gates so they rank against the same cohort
 * benchmark. Pure.
 */
function bestLivePeerExpectancy(
  peers: ReadonlyArray<RotationPeerSnapshot>,
): number {
  let best = Number.NaN;
  for (const peer of peers) {
    if (peer.mode !== 'live') continue;
    if (peer.rollingSampleCount < ROTATION_WR_MIN_SAMPLES) continue;
    const e = peer.rollingExpectancy;
    if (e === undefined || !Number.isFinite(e)) continue;
    if (!Number.isFinite(best) || e > best) best = e;
  }
  return best;
}

/**
 * Loss:win ratio of the SAME peer chosen as best-by-expectancy. We rank
 * the cohort by expectancy (the profit benchmark) and read that peer's
 * loss:win ratio as the relative bar — not the min ratio across the
 * cohort, which would let a low-expectancy-but-tight-ratio peer set an
 * unrealistically strict bar. Returns NaN when no benchmark peer exists.
 * Pure.
 */
function bestLivePeerLossWinRatio(
  peers: ReadonlyArray<RotationPeerSnapshot>,
): number {
  let bestE = Number.NaN;
  let ratioOfBest = Number.NaN;
  for (const peer of peers) {
    if (peer.mode !== 'live') continue;
    if (peer.rollingSampleCount < ROTATION_WR_MIN_SAMPLES) continue;
    const e = peer.rollingExpectancy;
    if (e === undefined || !Number.isFinite(e)) continue;
    if (!Number.isFinite(bestE) || e > bestE) {
      bestE = e;
      ratioOfBest = peer.rollingLossWinRatio ?? Number.NaN;
    }
  }
  return ratioOfBest;
}

/**
 * True iff `mine` is within ROTATION_EXPECTANCY_BAND (fractional) of
 * `best`. "Within band" means the FRACTIONAL shortfall below the best
 * peer is no worse than the band: best - mine ≤ band·|best|. A kernel
 * ABOVE the best peer is trivially within band. When best is ~0 we fall
 * back to an absolute comparison (mine ≥ best, i.e. not strictly worse)
 * to avoid divide-by-zero amplification. Pure.
 */
function withinExpectancyBand(mine: number, best: number): boolean {
  if (!Number.isFinite(mine) || !Number.isFinite(best)) return false;
  const scale = Math.abs(best);
  if (scale < 1e-12) return mine >= best;
  return best - mine <= ROTATION_EXPECTANCY_BAND * scale;
}

/**
 * CHRONIC membership demote (issue #1032). Catches the negative-EV
 * bleeder that the 5-consecutive-loss breaker misses: a ~50%-WR kernel
 * that sprinkles tiny wins between large losses never hits 5-in-a-row,
 * yet its expectancy sits far below the best live peer's.
 *
 * Fires (returns a reason string) iff:
 *   0. expectancyLive is true (flag MONKEY_ROTATION_EXPECTANCY_LIVE).
 *      When false this ALWAYS returns null — behaviour is unchanged.
 *   1. The candidate is currently LIVE.
 *   2. The candidate has ≥ ROTATION_WR_MIN_SAMPLES closes (no demote on
 *      noise).
 *   3. There is at least one CI-firm LIVE peer with a finite expectancy
 *      to rank against (the cohort benchmark — incl. the CC race peer).
 *   4. The candidate's expectancy falls OUTSIDE the relative band of the
 *      best live peer's expectancy (symmetric with the promotion band).
 *
 * Returns null otherwise. Pure — does NOT mutate; the caller flips mode.
 */
export function shouldChronicDemote(
  candidate: RotationState,
  peers: ReadonlyArray<RotationPeerSnapshot>,
  expectancyLive: boolean,
): string | null {
  if (!expectancyLive) return null;
  if (candidate.mode !== 'live') return null;

  const mine = rollingExpectancy(candidate);
  if (mine.sampleCount < ROTATION_WR_MIN_SAMPLES) return null;
  if (!Number.isFinite(mine.edge)) return null;

  const best = bestLivePeerExpectancy(peers);
  if (!Number.isFinite(best)) return null; // no benchmark peer yet

  if (withinExpectancyBand(mine.edge, best)) return null; // still a member

  return (
    `chronic-demote: expectancy ${mine.edge.toFixed(4)} outside ` +
    `${(ROTATION_EXPECTANCY_BAND * 100).toFixed(0)}% band of best live ` +
    `${best.toFixed(4)} (WR ${(mine.winRate * 100).toFixed(1)}%, ` +
    `loss:win ${Number.isFinite(mine.lossWinRatio) ? mine.lossWinRatio.toFixed(2) : 'n/a'})`
  );
}

/**
 * Apply the chronic-demote decision to state, mutating in place
 * (mirrors recordClose's mutate-in-place contract). Returns the same
 * shape as recordClose so the loop wiring is symmetric. No-op (returns
 * demoted:false) when shouldChronicDemote declines.
 */
export function applyChronicDemote(
  state: RotationState,
  peers: ReadonlyArray<RotationPeerSnapshot>,
  expectancyLive: boolean,
  nowMs: number = Date.now(),
): { demoted: boolean; reason: string | null } {
  const reason = shouldChronicDemote(state, peers, expectancyLive);
  if (!reason) return { demoted: false, reason: null };
  state.mode = 'paper';
  state.lastDemotionAtMs = nowMs;
  state.lastTransitionReason = reason;
  return { demoted: true, reason };
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
 * When `expectancyLive` is true (flag MONKEY_ROTATION_EXPECTANCY_LIVE),
 * an ADDITIONAL profit-shaped gate is layered on top of the WR gate:
 *   5. The candidate's expectancy must be within ROTATION_EXPECTANCY_BAND
 *      of the best live peer's expectancy, AND
 *   6. The candidate's loss:win VALUE ratio must be trending toward the
 *      1:8 E8/64 structural ratio — i.e. ≤ the best live peer's loss:win
 *      ratio (a cohort-relative bar), or already at/under the 1:8 ratio.
 * When `expectancyLive` is false the function is byte-for-byte the
 * legacy WR-only gate.
 *
 * Returns the reason string when promotion should fire, null otherwise.
 */
export function shouldAutoPromote(
  candidate: RotationState,
  peers: ReadonlyArray<RotationPeerSnapshot>,
  expectancyLive: boolean = false,
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

  if (expectancyLive) {
    // Profit gate: within-band expectancy AND loss:win trending to 1:8.
    const mine = rollingExpectancy(candidate);
    if (!Number.isFinite(mine.edge)) return null;
    const bestE = bestLivePeerExpectancy(peers);
    if (!Number.isFinite(bestE)) return null; // no expectancy benchmark
    if (!withinExpectancyBand(mine.edge, bestE)) return null;

    // loss:win ratio bar. The ratio is 1:8 = ROTATION_TARGET_LOSS_WIN_RATIO
    // (E8/64 = 8×8 structural doctrine — see the constant's docblock).
    // A paper-routed kernel earns re-entry to live money when its ratio
    // is trending toward it: at/under the 1:8 ratio OUTRIGHT, or at/under
    // the best
    // live peer's ratio (a cohort-relative bar — you're no worse than
    // the benchmark on size asymmetry). lossWinRatio is NaN only for an
    // empty/degenerate window (no closes) — that is the sole case that
    // bypasses the gate. CRITICAL: Infinity means "losses but no wins"
    // (pure bleed, the WORST case) — it must NOT bypass (a prior
    // `!Number.isFinite(...)` check wrongly let Infinity pass, which could
    // re-promote a pure-bleed kernel into a weak cohort). Using isNaN
    // keeps Infinity subject to the ratio comparison, where it fails both
    // (Infinity ≤ 1/8 → false; Infinity ≤ bestRatio → false).
    const bestRatio = bestLivePeerLossWinRatio(peers);
    const ratioOk =
      Number.isNaN(mine.lossWinRatio) || // empty window only → trivially fine
      mine.lossWinRatio <= ROTATION_TARGET_LOSS_WIN_RATIO ||
      (Number.isFinite(bestRatio) && mine.lossWinRatio <= bestRatio);
    if (!ratioOk) return null;

    return (
      `auto-promotion(expectancy): WR ${(myWR * 100).toFixed(1)}% within band; ` +
      `expectancy ${mine.edge.toFixed(4)} within ${(ROTATION_EXPECTANCY_BAND * 100).toFixed(0)}% ` +
      `of best live ${bestE.toFixed(4)}; loss:win ` +
      `${Number.isFinite(mine.lossWinRatio) ? mine.lossWinRatio.toFixed(2) : 'n/a'} ` +
      `trending to ${ROTATION_TARGET_LOSS_WIN_RATIO.toFixed(3)}`
    );
  }

  return `auto-promotion: rolling WR ${(myWR * 100).toFixed(1)}% >= ` +
    `best live ${(bestLiveWR * 100).toFixed(1)}% - ${(ROTATION_PROMOTION_WR_GAP * 100).toFixed(0)}pp`;
}
