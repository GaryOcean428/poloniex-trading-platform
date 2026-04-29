/**
 * arbiter — capital allocation between Agent K (kernel) and Agent M (ml).
 *
 * Single instance per service. Each tick the loop calls allocate() to
 * read this tick's split, then runs K and M against their respective
 * shares. Closed-trade outcomes are fed back via recordSettled() so
 * future allocations skew toward the winner.
 *
 * Allocation formula (from the agent-separation directive):
 *   k_score = exp(k_total_pnl / max(1, totalCapital))
 *   m_score = exp(m_total_pnl / max(1, totalCapital))
 *   k_share = k_score / (k_score + m_score)   clamped to [minShare, 1−minShare]
 *
 * Floor at 10 % keeps the loser alive long enough to recover. Window
 * of 50 closed trades per agent is enough to drown out single-trade
 * variance without inheriting stale-regime bias.
 *
 * Why exponential weighting on total PnL (not Sharpe / win-rate):
 *   - PnL is what the user cares about; weighting it directly is
 *     honest.
 *   - exp() amplifies separation when both totals are small (early
 *     in the window) and saturates gracefully as totals grow large.
 *   - Dividing by totalCapital is the natural scale (returns in
 *     equity-units), and the max(1, ...) guard handles a freshly-
 *     funded account before the first trade.
 *
 * Bootstrap: with fewer than 5 closed trades on either side, default
 * to a 50/50 split. Both agents need a minimum sample to get a fair
 * read.
 */

const DEFAULT_WINDOW = 50;
const DEFAULT_MIN_SHARE = 0.10;
const BOOTSTRAP_MIN_TRADES = 5;

export type AgentLabel = 'K' | 'M';

export interface AllocationResult {
  /** USDT allocated to Agent K this tick. */
  k: number;
  /** USDT allocated to Agent M this tick. */
  m: number;
}

export interface ArbiterTelemetry {
  k_share: number;
  m_share: number;
  k_pnl_window_total: number;
  m_pnl_window_total: number;
  k_trades_in_window: number;
  m_trades_in_window: number;
}

export interface ArbiterOptions {
  window?: number;
  minShare?: number;
}

export class Arbiter {
  private readonly k_pnl_recent: number[] = [];
  private readonly m_pnl_recent: number[] = [];
  private readonly window: number;
  private readonly minShare: number;

  constructor(opts: ArbiterOptions = {}) {
    this.window = opts.window ?? DEFAULT_WINDOW;
    this.minShare = opts.minShare ?? DEFAULT_MIN_SHARE;
  }

  /** Append a closed-trade pnl to the requested agent's window. */
  recordSettled(agent: AgentLabel, pnl: number): void {
    if (!Number.isFinite(pnl)) return;
    const buf = agent === 'K' ? this.k_pnl_recent : this.m_pnl_recent;
    buf.push(pnl);
    while (buf.length > this.window) buf.shift();
  }

  /**
   * Compute allocation for the current tick.
   *
   * @param totalCapitalUsdt total available equity (post-risk-kernel reservation).
   */
  allocate(totalCapitalUsdt: number): AllocationResult {
    const cap = Math.max(0, totalCapitalUsdt);
    if (
      this.k_pnl_recent.length < BOOTSTRAP_MIN_TRADES ||
      this.m_pnl_recent.length < BOOTSTRAP_MIN_TRADES
    ) {
      return { k: cap * 0.5, m: cap * 0.5 };
    }
    const k_total = this.k_pnl_recent.reduce((s, p) => s + p, 0);
    const m_total = this.m_pnl_recent.reduce((s, p) => s + p, 0);
    const denom = Math.max(1, cap);
    const k_score = Math.exp(k_total / denom);
    const m_score = Math.exp(m_total / denom);
    const sum = k_score + m_score;
    let k_share = sum > 0 ? k_score / sum : 0.5;
    k_share = Math.max(this.minShare, Math.min(1 - this.minShare, k_share));
    return {
      k: cap * k_share,
      m: cap * (1 - k_share),
    };
  }

  /** Snapshot for telemetry / arbiter_allocation row writes. */
  snapshot(totalCapitalUsdt: number): ArbiterTelemetry {
    const alloc = this.allocate(totalCapitalUsdt);
    const cap = Math.max(0, totalCapitalUsdt);
    const k_share = cap > 0 ? alloc.k / cap : 0.5;
    const m_share = cap > 0 ? alloc.m / cap : 0.5;
    return {
      k_share,
      m_share,
      k_pnl_window_total: this.k_pnl_recent.reduce((s, p) => s + p, 0),
      m_pnl_window_total: this.m_pnl_recent.reduce((s, p) => s + p, 0),
      k_trades_in_window: this.k_pnl_recent.length,
      m_trades_in_window: this.m_pnl_recent.length,
    };
  }

  /** Window length getter (for tests). */
  get windowSize(): number {
    return this.window;
  }
}

/** Module-level singleton. The loop should reuse this across ticks. */
let _instance: Arbiter | null = null;
export function getArbiter(): Arbiter {
  if (_instance === null) _instance = new Arbiter();
  return _instance;
}

/** Test seam — reset the singleton (vitest cleanup). */
export function _resetArbiterForTest(): void {
  _instance = null;
}
