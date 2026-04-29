/**
 * arbiter.ts — Capital allocator between Agent K (kernel) and Agent M (ml).
 *
 * Single instance per kernel; called by loop.ts before each tick to
 * compute that tick's available capital for K and M. Settled trade
 * PnLs flow back via recordSettled('K' | 'M', pnl).
 *
 * Allocation logic:
 * - Insufficient data (< 5 settled trades each) → 50/50 split.
 * - Otherwise: exp(pnl_total / capital) ratio with 10% floor each.
 *   Floor ensures the loser keeps generating data so the experiment
 *   continues to accumulate evidence. Without it, a temporary streak
 *   could starve one agent of capital and freeze the comparison.
 *
 * Window: last 50 trades per agent. Older trades age out — a drawdown
 * 200 trades ago shouldn't dominate today's allocation.
 */

export interface ArbiterAllocation {
  /** USDT capital share for Agent K. */
  k: number;
  /** USDT capital share for Agent M. */
  m: number;
}

export interface ArbiterSnapshot {
  kShare: number;       // 0..1
  mShare: number;       // 0..1
  kPnlWindowTotal: number;
  mPnlWindowTotal: number;
  kTradesInWindow: number;
  mTradesInWindow: number;
}

export interface ArbiterOptions {
  /** Rolling window size per agent (default 50). */
  window?: number;
  /** Minimum share per agent (default 0.10). */
  minShare?: number;
  /** Trades required per agent before non-50/50 allocation (default 5). */
  warmupTrades?: number;
}

export class Arbiter {
  private readonly kPnl: number[] = [];
  private readonly mPnl: number[] = [];
  private readonly window: number;
  private readonly minShare: number;
  private readonly warmupTrades: number;

  constructor(opts: ArbiterOptions = {}) {
    this.window = opts.window ?? 50;
    this.minShare = opts.minShare ?? 0.10;
    this.warmupTrades = opts.warmupTrades ?? 5;
  }

  recordSettled(agent: 'K' | 'M', pnl: number): void {
    const buf = agent === 'K' ? this.kPnl : this.mPnl;
    buf.push(pnl);
    if (buf.length > this.window) buf.shift();
  }

  allocate(totalCapitalUsdt: number): ArbiterAllocation {
    if (totalCapitalUsdt <= 0) {
      return { k: 0, m: 0 };
    }
    if (
      this.kPnl.length < this.warmupTrades
      || this.mPnl.length < this.warmupTrades
    ) {
      return {
        k: totalCapitalUsdt * 0.5,
        m: totalCapitalUsdt * 0.5,
      };
    }
    const kTotal = this.sum(this.kPnl);
    const mTotal = this.sum(this.mPnl);
    // Normalise by totalCapital so exp arg is bounded — prevents
    // floating-point overflow when one agent runs +$1000 while the
    // total capital is only $50.
    const denom = Math.max(1, totalCapitalUsdt);
    const kScore = Math.exp(kTotal / denom);
    const mScore = Math.exp(mTotal / denom);
    let kShare = kScore / (kScore + mScore);
    kShare = Math.max(this.minShare, Math.min(1 - this.minShare, kShare));
    return {
      k: totalCapitalUsdt * kShare,
      m: totalCapitalUsdt * (1 - kShare),
    };
  }

  snapshot(totalCapitalUsdt: number = 0): ArbiterSnapshot {
    const kTotal = this.sum(this.kPnl);
    const mTotal = this.sum(this.mPnl);
    let kShare = 0.5;
    if (
      this.kPnl.length >= this.warmupTrades
      && this.mPnl.length >= this.warmupTrades
    ) {
      const denom = Math.max(1, totalCapitalUsdt);
      const kScore = Math.exp(kTotal / denom);
      const mScore = Math.exp(mTotal / denom);
      kShare = Math.max(this.minShare, Math.min(1 - this.minShare, kScore / (kScore + mScore)));
    }
    return {
      kShare,
      mShare: 1 - kShare,
      kPnlWindowTotal: kTotal,
      mPnlWindowTotal: mTotal,
      kTradesInWindow: this.kPnl.length,
      mTradesInWindow: this.mPnl.length,
    };
  }

  private sum(arr: readonly number[]): number {
    let s = 0;
    for (const v of arr) s += v;
    return s;
  }
}
