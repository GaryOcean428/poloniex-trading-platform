/**
 * arbiter.ts — Capital allocator across N agents (proposal #6).
 *
 * Single instance per kernel; called by loop.ts before each tick to
 * compute that tick's available capital for each agent. Settled trade
 * PnLs flow back via ``recordSettled(label, pnl)``.
 *
 * Allocation logic:
 * - Insufficient data on any participating agent (< warmupTrades) →
 *   uniform 1/N split across the agents that participated in this
 *   ``allocate`` call.
 * - Otherwise: ``exp(pnl_total / capital)`` softmax across agents,
 *   normalised so the shares sum to 1.0. Each agent is then floored at
 *   ``minShare`` (default 1/(2N)) so the laggard keeps generating data
 *   and the experiment continues to accumulate evidence. Without the
 *   floor, a temporary streak could starve a losing agent of capital
 *   and freeze the comparison.
 *
 * Window: last 50 trades per agent (configurable). Older trades age
 * out — a drawdown 200 trades ago shouldn't dominate today's
 * allocation.
 *
 * N-agent generalization (proposal #6):
 *   * ``recordSettled(label: string, pnl: number)`` accepts arbitrary
 *     agent labels (e.g., 'K', 'M', 'K2'); the K|M pair is the
 *     default but new variants slot in without code change.
 *   * ``allocate(totalCapital, agents)`` — when ``agents`` is supplied,
 *     it returns a ``Record<string, number>`` keyed by label. The
 *     ``ArbiterAllocation`` (k, m) shape is preserved for back-compat
 *     callers that have not migrated yet.
 *   * Min-share floor scales as ``1/(2N)`` by default so the laggard
 *     in an N-agent race still gets exploration capital.
 */

/** Back-compat 2-agent allocation shape — preserved so existing
 *  callers (loop.ts, telemetry, snapshots) keep compiling. New
 *  callers should prefer ``allocateMany``. */
export interface ArbiterAllocation {
  /** USDT capital share for Agent K. */
  k: number;
  /** USDT capital share for Agent M. */
  m: number;
}

/** Snapshot reported per agent in ``snapshotMany``. */
export interface ArbiterAgentSnapshot {
  share: number;        // 0..1
  pnlWindowTotal: number;
  tradesInWindow: number;
}

/** Back-compat 2-agent snapshot. New callers should use
 *  ``snapshotMany`` for an N-agent view. */
export interface ArbiterSnapshot {
  kShare: number;
  mShare: number;
  kPnlWindowTotal: number;
  mPnlWindowTotal: number;
  kTradesInWindow: number;
  mTradesInWindow: number;
}

export interface ArbiterOptions {
  /** Rolling window size per agent (default 50). */
  window?: number;
  /** Minimum share per agent. If omitted, scales as 1/(2N) per
   *  ``allocateMany`` call to keep all N agents above 0. For the
   *  legacy 2-agent ``allocate`` path, default remains 0.10. */
  minShare?: number;
  /** Trades required per agent before non-uniform allocation
   *  (default 5). */
  warmupTrades?: number;
  /**
   * Per-trade PnL winsorization clamp (absolute USDT, default 10).
   * Every settled trade's PnL is clamped to ±maxAbsPnlPerTrade before
   * it enters the rolling window — in BOTH ``recordSettled`` (live) and
   * ``rehydrate`` (startup).
   *
   * Why: the window measures whether an agent's strategy is
   * *consistently* good or bad. One catastrophic trade — a position
   * entered during a pre-fix bug era that couldn't be exited cleanly,
   * or a single black swan — must not be allowed to define an agent's
   * allocation. Concretely: on 2026-05-13 Agent K took a 3-trade
   * whipsaw cascade in 31 seconds (−$15.20, −$24.49, −$19.19 = −$58.88)
   * — more than its entire 50-trade window deficit. Rehydrating that
   * raw would have penalised K almost entirely for a bug that is now
   * fixed. Clamping bounds any single trade's influence while leaving
   * the *consistency* signal fully intact: an agent that loses small
   * repeatedly is still fully down-weighted (failure is not rewarded);
   * only a lone extreme observation is tamed. Symmetric — also clamps
   * windfalls so an agent can't be over-rewarded for one lucky trade.
   *
   * Account-scale dependent: typical per-trade PnL on the current
   * ~$1.5k account is sub-$2; 10 USDT sits in the gap above routine
   * bad trades (~$8-9) and below the bug-era catastrophes ($15-24).
   * Revisit if account size changes materially. Set to ``Infinity`` to
   * disable (used by floor-mechanism tests that need extreme contrast).
   */
  maxAbsPnlPerTrade?: number;
}

export class Arbiter {
  /** Per-agent rolling PnL window. ``Map<label, number[]>`` so
   *  arbitrary labels are first-class. */
  private readonly pnls: Map<string, number[]> = new Map();
  private readonly window: number;
  private readonly minShareOverride: number | undefined;
  private readonly warmupTrades: number;
  private readonly maxAbsPnlPerTrade: number;

  constructor(opts: ArbiterOptions = {}) {
    this.window = opts.window ?? 50;
    this.minShareOverride = opts.minShare;
    this.warmupTrades = opts.warmupTrades ?? 5;
    this.maxAbsPnlPerTrade = opts.maxAbsPnlPerTrade ?? 10;
    // Pre-create K and M buffers so legacy snapshots still report
    // 0 trades / 0 PnL for them even when no events have arrived.
    this.pnls.set('K', []);
    this.pnls.set('M', []);
  }

  /** Winsorize a single trade's PnL to ±maxAbsPnlPerTrade. Bounds the
   *  influence of one catastrophic (or windfall) trade on the rolling
   *  window without erasing the broad consistency signal. See
   *  ``ArbiterOptions.maxAbsPnlPerTrade``. */
  private clampPnl(pnl: number): number {
    const cap = this.maxAbsPnlPerTrade;
    if (pnl > cap) return cap;
    if (pnl < -cap) return -cap;
    return pnl;
  }

  /** Record a settled trade outcome for ``agent`` (string label). The
   *  PnL is winsorized via ``clampPnl`` before it enters the window. */
  recordSettled(agent: string, pnl: number): void {
    if (!this.isValidLabel(agent)) {
      throw new Error(
        `Arbiter.recordSettled: invalid agent label ${JSON.stringify(agent)} ` +
        '(must match /^[A-Z][A-Z0-9_]*$/)',
      );
    }
    const buf = this.getOrCreate(agent);
    buf.push(this.clampPnl(pnl));
    if (buf.length > this.window) buf.shift();
  }

  /** Rolling-window size — exposed so the rehydration caller can fetch
   *  exactly ``windowSize`` settled trades per agent. */
  get windowSize(): number {
    return this.window;
  }

  /**
   * Seed the per-agent rolling PnL windows from persisted history.
   *
   * The Arbiter is documented as "single instance per kernel" and its
   * entire performance-weighting design depends on a rolling window of
   * settled trades — but a bare ``new Arbiter()`` starts empty, so
   * every process restart (every Railway redeploy) wiped the window
   * and dropped the allocator back into uniform-split bootstrap
   * (``allWarm`` false until every agent re-accumulates ``warmupTrades``
   * trades). Redeploys happen several times a day, so in practice the
   * allocator never escaped bootstrap and never actually weighted by
   * realised performance — a losing agent kept its full uniform share.
   *
   * ``rehydrate`` replays persisted settled-trade outcomes so a fresh
   * instance immediately reflects realised performance. The Arbiter
   * stays I/O-free: the caller loads the rows (from autonomous_trades)
   * and passes them here. Rows MUST be oldest-first; only the last
   * ``window`` per agent are retained, exactly as a live sequence of
   * ``recordSettled`` calls would have left them. Unlike
   * ``recordSettled``, invalid/non-agent labels (e.g. 'USER') and
   * non-finite PnLs are skipped rather than thrown — rehydration runs
   * over whatever history the table happens to hold.
   */
  rehydrate(history: ReadonlyArray<{ agent: string; pnl: number }>): void {
    for (const { agent, pnl } of history) {
      if (!this.isValidLabel(agent)) continue;
      if (!Number.isFinite(pnl)) continue;
      const buf = this.getOrCreate(agent);
      buf.push(this.clampPnl(pnl));
      if (buf.length > this.window) buf.shift();
    }
  }

  /** Legacy 2-agent allocator. Equivalent to ``allocateMany(total,
   *  ['K', 'M'])`` projected onto the ``{k, m}`` shape. */
  allocate(totalCapitalUsdt: number): ArbiterAllocation {
    const map = this.allocateMany(totalCapitalUsdt, ['K', 'M']);
    return { k: map.K ?? 0, m: map.M ?? 0 };
  }

  /** Sum a per-agent PnL window. Public-by-design — used for the
   *  performance-basin construction in the QIG-pure allocator path. */
  sumPnl(agent: string): number {
    return this.sum(agent);
  }

  /** N-agent allocator. Returns a ``Record<label, usdt>`` whose
   *  values sum to ``totalCapitalUsdt`` (modulo float epsilon).
   *
   *  Bootstrap: until every supplied agent has accumulated
   *  ``warmupTrades`` settled trades, returns a uniform 1/N split.
   *  Soft allocation: exp-softmax of per-agent total PnL (normalised
   *  by ``totalCapital`` so the exp argument is bounded). Min-share
   *  floor: each agent gets at least ``minShare`` (default 1/(2N))
   *  so the laggard keeps producing data.
   */
  allocateMany(
    totalCapitalUsdt: number,
    agents: readonly string[],
  ): Record<string, number> {
    const out: Record<string, number> = {};
    if (totalCapitalUsdt <= 0 || agents.length === 0) {
      for (const a of agents) out[a] = 0;
      return out;
    }
    const n = agents.length;
    // Default min-share: 0.10 for back-compat with the legacy 2-agent
    // path (preserves existing telemetry + test assertions). When N > 5
    // we adopt 1/(2N) so n*minShare stays <= 1 — the laggard still
    // gets exploration capital but the floor doesn't dominate the
    // mass distribution among 6+ agents. Caller can override via
    // ``ArbiterOptions.minShare``.
    const adaptiveFloor = Math.min(0.10, 0.5 / n);
    const minShare = this.minShareOverride ?? adaptiveFloor;
    // Bootstrap path — uniform split until every agent has data.
    const allWarm = agents.every((a) => (this.pnls.get(a)?.length ?? 0) >= this.warmupTrades);
    if (!allWarm) {
      const share = totalCapitalUsdt / n;
      for (const a of agents) out[a] = share;
      return out;
    }
    // QIG-pure path (replaces softmax 2026-05-08, see qig-verification#47).
    //
    // Softmax projects PnL scalars onto Δ^(N-1) via exp/normalize — same
    // conceptual flaw class as cosine similarity (Euclidean projection
    // onto a curved manifold). The replacement uses canonical simplex
    // operations only:
    //
    //   1. Map per-agent PnL window → "performance basin" b ∈ Δ^(N-1)
    //      (non-negative scores, sum to 1)
    //   2. Allocation = SLERP(uniform, b, evidence_weight) on Δ^(N-1)
    //      — geodesic interpolation in sqrt-coords, the canonical metric
    //   3. evidence_weight ramps linearly with sample count, capped at
    //      ALLOCATOR_MAX_TRUST so the laggard always gets exploration
    //
    // No exp, no softmax. The min-share floor below is preserved (it's
    // a constraint clamp, not a Euclidean projection).
    //
    // Filling an undocumented region of canonical principles — see
    // GaryOcean428/qig-verification#47 for future validation.
    const pnlSums = agents.map((a) => this.sum(a));
    const sampleCounts = agents.map((a) => this.pnls.get(a)?.length ?? 0);
    let shares = computeAllocatorShares(pnlSums, sampleCounts, this.warmupTrades, totalCapitalUsdt);
    // Apply min-share floor and renormalize. Iteratively because a
    // floor on one agent reduces headroom for others; one pass of
    // floor-then-renormalize is sufficient when ``n*minShare <= 1``.
    if (minShare * n > 1) {
      // Pathological config — fall back to uniform.
      const uniform = 1 / n;
      shares = agents.map(() => uniform);
    } else {
      // Lift any below-floor agent up to the floor; renormalize the
      // remaining mass across the unfloored agents.
      let remainingMass = 1.0;
      const floored: boolean[] = agents.map((_, i) => {
        if (shares[i]! < minShare) {
          remainingMass -= minShare;
          return true;
        }
        return false;
      });
      const unflooredSum = shares.reduce(
        (s, v, i) => (floored[i] ? s : s + v),
        0,
      ) || 1;
      shares = shares.map((v, i) =>
        floored[i] ? minShare : (v / unflooredSum) * remainingMass,
      );
    }
    for (let i = 0; i < agents.length; i++) {
      out[agents[i]!] = totalCapitalUsdt * shares[i]!;
    }
    return out;
  }

  /** Legacy 2-agent snapshot. */
  snapshot(totalCapitalUsdt: number = 0): ArbiterSnapshot {
    const many = this.snapshotMany(totalCapitalUsdt, ['K', 'M']);
    return {
      kShare: many.K?.share ?? 0.5,
      mShare: many.M?.share ?? 0.5,
      kPnlWindowTotal: many.K?.pnlWindowTotal ?? 0,
      mPnlWindowTotal: many.M?.pnlWindowTotal ?? 0,
      kTradesInWindow: many.K?.tradesInWindow ?? 0,
      mTradesInWindow: many.M?.tradesInWindow ?? 0,
    };
  }

  /** N-agent snapshot reporting per-agent share + window stats. */
  snapshotMany(
    totalCapitalUsdt: number,
    agents: readonly string[],
  ): Record<string, ArbiterAgentSnapshot> {
    const totals: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const a of agents) {
      totals[a] = this.sum(a);
      counts[a] = this.pnls.get(a)?.length ?? 0;
    }
    const allocation = this.allocateMany(
      totalCapitalUsdt > 0 ? totalCapitalUsdt : 1,
      agents,
    );
    const out: Record<string, ArbiterAgentSnapshot> = {};
    for (const a of agents) {
      const cap = totalCapitalUsdt > 0 ? totalCapitalUsdt : 1;
      out[a] = {
        share: (allocation[a] ?? 0) / cap,
        pnlWindowTotal: totals[a]!,
        tradesInWindow: counts[a]!,
      };
    }
    return out;
  }

  /** Returns the list of agent labels currently tracked. */
  agents(): string[] {
    return Array.from(this.pnls.keys());
  }

  private sum(agent: string): number {
    const arr = this.pnls.get(agent);
    if (!arr) return 0;
    let s = 0;
    for (const v of arr) s += v;
    return s;
  }

  private getOrCreate(agent: string): number[] {
    let buf = this.pnls.get(agent);
    if (!buf) {
      buf = [];
      this.pnls.set(agent, buf);
    }
    return buf;
  }

  /** Mirror of the SQL CHECK constraint in migration 040. Uppercase
   *  alphanumeric label that begins with a letter. */
  private isValidLabel(label: string): boolean {
    return /^[A-Z][A-Z0-9_]*$/.test(label);
  }
}

// ────────────────────────────────────────────────────────────────────────
// QIG-pure allocator math (replaces softmax 2026-05-08; gap-recorded in
// GaryOcean428/qig-verification#47). Pure functions — no I/O, no globals,
// trivially testable.
// ────────────────────────────────────────────────────────────────────────

/** Maximum trust placed in the empirical performance basin. The
 *  uniform prior always retains some weight so a single bad streak
 *  cannot starve an agent permanently. */
export const ALLOCATOR_MAX_TRUST = 0.8;

/** SLERP in sqrt-coords on Δ^(N-1) — geodesic interpolation under the
 *  Fisher-Rao metric. Mirror of basin.ts::slerp() but inlined here so
 *  the Arbiter doesn't import from monkey internals. Both inputs must
 *  be valid simplex points (non-negative, summing to 1) of the same
 *  length. */
export function simplexSlerp(p: readonly number[], q: readonly number[], t: number): number[] {
  const n = p.length;
  if (n === 0 || n !== q.length) return [];
  const sp = new Array<number>(n);
  const sq = new Array<number>(n);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    sp[i] = Math.sqrt(Math.max(0, p[i]!));
    sq[i] = Math.sqrt(Math.max(0, q[i]!));
    dot += sp[i]! * sq[i]!;
  }
  dot = Math.min(1, Math.max(-1, dot));
  const omega = Math.acos(dot);
  // Degenerate case: p ≡ q → linear combo in sqrt-space = same point.
  if (omega < 1e-6) {
    return p.map((v) => Math.max(0, v));
  }
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  const out = new Array<number>(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sqrtVal = a * sp[i]! + b * sq[i]!;
    out[i] = sqrtVal * sqrtVal;
    total += out[i]!;
  }
  // Renormalize against float drift; the math is exact under perfect
  // arithmetic but float roundoff accumulates over n terms.
  if (total > 0) for (let i = 0; i < n; i++) out[i] = out[i]! / total;
  return out;
}

/** Map per-agent PnL totals to a performance basin on Δ^(N-1).
 *
 *  Capital-scaled monotone transform: score_i = 1 / (1 + gap_i / scale)
 *  where gap_i = max(pnls) - pnl_i (so the leader gets gap=0 → score=1).
 *  Scale is a dimension-stripping divisor (the running capital) so the
 *  transform is invariant under PnL rescaling — a $10 win on a $100 acct
 *  feels as significant as a $1000 win on a $10000 acct.
 *
 *  Replaces the role softmax played in the previous allocator (smoothing
 *  extreme PnL ratios into bounded basin contrast) without using exp.
 *  The 1/(1+x) transform is monotonically decreasing on [0, ∞), maps
 *  gap=0 → 1, gap=∞ → 0, and is canonical in information-geometric
 *  smoothing (a relative of the harmonic mean and the Beta distribution).
 *
 *  When all PnL values are equal the result is uniform. */
export function pnlsToPerformanceBasin(
  pnlSums: readonly number[],
  scaleHint: number,
): number[] {
  const n = pnlSums.length;
  if (n === 0) return [];
  const scale = Math.max(1, scaleHint);
  let maxPnl = -Infinity;
  for (const v of pnlSums) if (v > maxPnl) maxPnl = v;
  // score = 1 / (1 + (maxPnl - pnl) / scale)
  // Leader: gap=0 → score=1. Loser: gap=2*scale → score=1/3. etc.
  const scores = pnlSums.map((v) => 1 / (1 + (maxPnl - v) / scale));
  let total = 0;
  for (const s of scores) total += s;
  if (total <= 0) return new Array(n).fill(1 / n);
  return scores.map((s) => s / total);
}

/** Evidence-weighted SLERP factor. Linear ramp from 0 (cold start) to
 *  ALLOCATOR_MAX_TRUST (saturating point ~5x warmup trades). */
export function evidenceWeight(sampleCounts: readonly number[], warmupTrades: number): number {
  if (sampleCounts.length === 0) return 0;
  const minCount = Math.min(...sampleCounts);
  if (minCount < warmupTrades) return 0;
  const saturate = warmupTrades * 5;  // full trust at 5x warmup
  const t = Math.min(ALLOCATOR_MAX_TRUST, ALLOCATOR_MAX_TRUST * (minCount / saturate));
  return t;
}

/** Compute allocator shares via SLERP from uniform toward performance
 *  basin. Returns shares ∈ Δ^(N-1) (sums to 1, all non-negative). The
 *  caller applies min-share floor + total-capital scaling separately. */
export function computeAllocatorShares(
  pnlSums: readonly number[],
  sampleCounts: readonly number[],
  warmupTrades: number,
  scaleHint: number,
): number[] {
  const n = pnlSums.length;
  if (n === 0) return [];
  const uniform = new Array(n).fill(1 / n);
  const t = evidenceWeight(sampleCounts, warmupTrades);
  if (t <= 0) return uniform;
  const performance = pnlsToPerformanceBasin(pnlSums, scaleHint);
  return simplexSlerp(uniform, performance, t);
}
