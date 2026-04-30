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
}

export class Arbiter {
  /** Per-agent rolling PnL window. ``Map<label, number[]>`` so
   *  arbitrary labels are first-class. */
  private readonly pnls: Map<string, number[]> = new Map();
  private readonly window: number;
  private readonly minShareOverride: number | undefined;
  private readonly warmupTrades: number;

  constructor(opts: ArbiterOptions = {}) {
    this.window = opts.window ?? 50;
    this.minShareOverride = opts.minShare;
    this.warmupTrades = opts.warmupTrades ?? 5;
    // Pre-create K and M buffers so legacy snapshots still report
    // 0 trades / 0 PnL for them even when no events have arrived.
    this.pnls.set('K', []);
    this.pnls.set('M', []);
  }

  /** Record a settled trade outcome for ``agent`` (string label). */
  recordSettled(agent: string, pnl: number): void {
    if (!this.isValidLabel(agent)) {
      throw new Error(
        `Arbiter.recordSettled: invalid agent label ${JSON.stringify(agent)} ` +
        '(must match /^[A-Z][A-Z0-9_]*$/)',
      );
    }
    const buf = this.getOrCreate(agent);
    buf.push(pnl);
    if (buf.length > this.window) buf.shift();
  }

  /** Legacy 2-agent allocator. Equivalent to ``allocateMany(total,
   *  ['K', 'M'])`` projected onto the ``{k, m}`` shape. */
  allocate(totalCapitalUsdt: number): ArbiterAllocation {
    const map = this.allocateMany(totalCapitalUsdt, ['K', 'M']);
    return { k: map.K ?? 0, m: map.M ?? 0 };
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
    // Softmax path. Normalise exp arg by totalCapital so a +$1000
    // streak vs a $50 account doesn't blow up Math.exp. The score
    // is a relative ordering, not an absolute scale.
    const denom = Math.max(1, totalCapitalUsdt);
    const scores: number[] = agents.map((a) => Math.exp(this.sum(a) / denom));
    const sumScores = scores.reduce((s, v) => s + v, 0) || n;
    let shares = scores.map((s) => s / sumScores);
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
