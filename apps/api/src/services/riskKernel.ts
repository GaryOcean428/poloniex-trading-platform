/**
 * Risk Kernel — pre-trade blast door.
 *
 * The existing riskService handles leverage caps, daily loss limits, max
 * open trades, and kill-switch. The kernel adds the red-team-mandated
 * guards that the existing service did not cover:
 *
 *   1. Per-symbol gross exposure cap (max 1.5× account equity notional
 *      across ALL strategies on one symbol). Prevents correlated
 *      long-BTC stacks from liquidating on a single adverse candle.
 *
 *   2. Self-match prevention. Rejects any order that would cross a
 *      resting order from the same account. Corporations Act s.1041B
 *      (false trading) compliance for the 10-concurrent-strategies design.
 *
 *   3. Unrealised-drawdown kill-switch. Total unrealised P&L ≤ -15% of
 *      equity → flatten all, pause 24h. The existing daily-loss cap is
 *      on REALISED P&L; a flash wick can blow through it while no trade
 *      has closed.
 *
 *   4. Strategy-tier leverage cap. 5× until a strategy has cleared
 *      live-tier 3. Only battle-tested strategies re-enable 20×.
 *
 *   5. Symbol gate. BTC-USDT only until account equity ≥ $100 (ETH
 *      perp contract minimum is ~$35 notional — not viable at $2
 *      position size).
 *
 * All functions are pure (input → decision object). The
 * `evaluatePreTradeVetoes` composer is what the riskService calls.
 */

export interface KernelOrder {
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  notional: number;          // position notional in quote currency (e.g. USDT)
  leverage: number;
  price: number;             // entry/limit price
}

export interface KernelOpenPosition {
  symbol: string;
  side: 'long' | 'short';
  notional: number;
}

export interface KernelRestingOrder {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
}

export interface KernelAccountState {
  equityUsdt: number;
  unrealizedPnlUsdt: number;
  openPositions: KernelOpenPosition[];
  restingOrders: KernelRestingOrder[];
  /** v0.8.8: cumulative margin currently committed across all open
   *  positions (cross-margin sum). Caller computes from balance feed
   *  — kernel stays pure sync. Optional with default 0 to keep
   *  back-compat for callers not yet threaded with margin telemetry. */
  usedMarginUsdt?: number;
}

/**
 * Per-symbol max leverage sourced from the Poloniex catalog
 * (see marketCatalog.getMaxLeverage). BTC/ETH perps advertise up to
 * 100x; alts vary between 20x and 75x. Callers look up the value for
 * the order's symbol and pass it in — kernel stays pure sync.
 */
export type SymbolMaxLeverage = number;

export interface KernelDecision {
  allowed: boolean;
  reason?: string;
  code?: KernelVetoCode;
}

export type KernelVetoCode =
  | 'per_symbol_exposure_cap'
  | 'self_match'
  | 'unrealized_drawdown_kill_switch'
  | 'symbol_max_leverage'
  | 'execution_mode_paused'
  | 'execution_mode_paper_only_blocks_live'
  | 'margin_headroom';

export type ExecutionMode = 'auto' | 'paper_only' | 'pause';

// ───────── Thresholds ─────────
// 2026-05-25 strip — code-side caps removed per operator autonomy
// doctrine. The exchange's per-symbol maxLeverage (Poloniex enforces)
// is the structural per-symbol notional cap (notional ≤ equity ×
// exchangeMaxLev). Auto-drawdown kill is also removed; the kernel's
// own chemistry feedback (push_reward → gaba on losses) is the
// learning restraint, and the manual kill switch
// (/api/agent/execution-mode) is the only operator MANDATE that
// halts entries.
// Constants retained as no-op sentinels so callers reading the export
// don't crash; the check functions return allowed:true unconditionally.
export const PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER = Number.POSITIVE_INFINITY;
export const UNREALIZED_DRAWDOWN_KILL_THRESHOLD = Number.NEGATIVE_INFINITY;

function isLong(side: KernelOrder['side']): boolean {
  return side === 'long' || side === 'buy';
}

// ───────── Check 1: Per-symbol gross exposure ─────────

export function checkPerSymbolExposure(
  _order: KernelOrder,
  _state: KernelAccountState,
): KernelDecision {
  // 2026-05-25 strip — 5× per-symbol exposure cap removed. Exchange
  // enforces the real structural cap (notional ≤ equity ×
  // exchangeMaxLev). Function retained for the composer call site
  // and downstream telemetry; always returns allowed:true.
  return { allowed: true };
}

// ───────── Check 2: Self-match prevention ─────────

export function checkSelfMatch(
  order: KernelOrder,
  state: KernelAccountState,
): KernelDecision {
  // A buy would self-match with a same-account sell at-or-below the buy price.
  // A sell would self-match with a same-account buy at-or-above the sell price.
  const orderIsBuy = isLong(order.side);
  const conflict = state.restingOrders.find((resting) => {
    if (resting.symbol !== order.symbol) return false;
    const restingIsBuy = resting.side === 'buy';
    if (orderIsBuy === restingIsBuy) return false;
    return orderIsBuy ? resting.price <= order.price : resting.price >= order.price;
  });
  if (conflict) {
    return {
      allowed: false,
      code: 'self_match',
      reason: `Self-match with account's own resting ${conflict.side} @ ${conflict.price} on ${conflict.symbol}. Blocked per Corporations Act s.1041B.`,
    };
  }
  return { allowed: true };
}

// ───────── Check 3: Unrealised-drawdown kill-switch ─────────

export function checkUnrealizedDrawdown(
  _state: KernelAccountState,
): KernelDecision {
  // 2026-05-25 strip — auto −15% drawdown kill switch removed per
  // operator autonomy doctrine. Manual kill switch
  // (/api/agent/execution-mode) is the only operator MANDATE that
  // halts entries. Kernel chemistry (push_reward → gaba on losses)
  // is the learning restraint. Function retained for composer call
  // site; always returns allowed:true.
  return { allowed: true };
}

// ───────── Check 4: Execution-mode global override ─────────

/**
 * Global operator-controlled safety override. `pause` blocks ALL
 * orders; `paper_only` blocks live orders but allows paper; `auto`
 * lets everything through. Read from the agent_execution_mode
 * singleton table (see executionModeService).
 */
export function checkExecutionMode(
  isLiveOrder: boolean,
  mode: ExecutionMode,
): KernelDecision {
  if (mode === 'pause') {
    return {
      allowed: false,
      code: 'execution_mode_paused',
      reason: 'Execution Mode is Pause — no new orders at any stage.',
    };
  }
  if (mode === 'paper_only' && isLiveOrder) {
    return {
      allowed: false,
      code: 'execution_mode_paper_only_blocks_live',
      reason: 'Execution Mode is Paper-Only — live order blocked; route to paper instead.',
    };
  }
  return { allowed: true };
}

// ───────── Check 5: Per-symbol max leverage from exchange catalog ─────────

/**
 * Enforces the exchange's per-symbol maxLeverage (BTC/ETH up to 100×,
 * alts 20-75×). Callers read `marketCatalog.getMaxLeverage(symbol)`
 * and pass it in — kernel stays pure sync.
 *
 * This is the exchange ceiling; the per-symbol exposure cap (see
 * PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER, currently 3.0× equity notional)
 * typically binds first at tiny account sizes.
 */
export function checkSymbolMaxLeverage(
  order: KernelOrder,
  symbolMaxLeverage: SymbolMaxLeverage,
): KernelDecision {
  if (order.leverage > symbolMaxLeverage) {
    return {
      allowed: false,
      code: 'symbol_max_leverage',
      reason: `Leverage ${order.leverage}× exceeds ${order.symbol} exchange max of ${symbolMaxLeverage}×.`,
    };
  }
  return { allowed: true };
}

// ───────── Check 6: Margin headroom reserve (v0.8.8) ─────────

/**
 * Reserve N% of equity as uncommitted margin so closes / reverses /
 * counter-positions always have room. Without this, Monkey can keep
 * entering tick-after-tick when basin direction stays strong, until
 * available margin → 0. At that point Poloniex rejects new orders
 * (incl. reverses' fresh-open leg) and the kernel hangs in a loop.
 *
 * 2026-05-08 incident: 6 short entries in 2min, margin shrinking
 * 17→13→8 USDT per entry, eventually couldn't open counter-positions.
 *
 * Reads ``MONKEY_MIN_MARGIN_HEADROOM_PCT`` env var (0.0-1.0). Default
 * 0.0 = no-op (back-compat). Operators opt in via env (e.g. 0.25 for
 * a 25% reserve). Out-of-range values fail OPEN (allow trading) so an
 * env typo doesn't silently freeze the kernel.
 */
// 2026-05-25 strip — all margin-headroom defaults set to 0 per operator
// autonomy doctrine. The kernel's own chemistry (gaba on
// margin-starvation pain via push_reward) is the learning restraint;
// the exchange's maintenance margin is the structural boundary.
// Functions retained so call sites don't break; all return 0 / null.
export const DEFAULT_MIN_MARGIN_HEADROOM_PCT = 0.0;

function getMinMarginHeadroomPct(): number {
  return DEFAULT_MIN_MARGIN_HEADROOM_PCT;
}

/**
 * 2026-05-25 — env-explicit headroom override returns null after strip.
 * Callers fall through to the mode-conditional path (also null) and
 * then to the 0.0 default. No code-side reserve.
 */
export function explicitMinMarginHeadroomPct(): number | null {
  return null;
}

/**
 * 2026-05-25 strip — mode-conditional headroom reserves removed.
 * Kernel chemistry learns margin-starvation from outcomes; the
 * mode-conditional 0.35/0.25/0.15/0.50 magic numbers are gone.
 */
export function modeMarginHeadroomPct(_mode?: string): number | null {
  return null;
}

export function checkMarginHeadroom(
  order: KernelOrder,
  state: KernelAccountState,
  minHeadroomPct?: number,
): KernelDecision {
  const pct = minHeadroomPct ?? getMinMarginHeadroomPct();
  // Fail OPEN on degenerate inputs: out-of-range pct (negative or ≥ 1)
  // means an operator typo or programmer error — we don't want to
  // silently freeze the kernel. Pct == 0 is the "disabled" case.
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 1) return { allowed: true };
  if (state.equityUsdt <= 0) return { allowed: true };

  const used = state.usedMarginUsdt ?? 0;
  const newMargin = Math.abs(order.notional) / Math.max(order.leverage, 1);
  const projectedUsed = used + newMargin;
  const freePct = (state.equityUsdt - projectedUsed) / state.equityUsdt;

  if (freePct < pct) {
    return {
      allowed: false,
      code: 'margin_headroom',
      reason: `Margin headroom ${(freePct * 100).toFixed(1)}% below ${(pct * 100).toFixed(0)}% reserve (equity=${state.equityUsdt.toFixed(2)} used_after=${projectedUsed.toFixed(2)} new_margin=${newMargin.toFixed(2)})`,
    };
  }
  return { allowed: true };
}

// ───────── Composer ─────────

export interface KernelContext {
  /** True for live (real-capital) orders; false for paper-only. */
  isLive: boolean;
  /** From agent_execution_mode — global safety override. */
  mode: ExecutionMode;
  /** From marketCatalog.getMaxLeverage(symbol) — exchange ceiling. */
  symbolMaxLeverage: SymbolMaxLeverage;
  /** 2026-05-13 — Monkey cognitive mode for regime-conditional
   *  headroom. EXPLORATION gets tighter reserve (35% — fast cycles
   *  need room), INTEGRATION gets looser (15% — slow positions
   *  commit margin longer). Optional: if absent, env default
   *  (MONKEY_MIN_MARGIN_HEADROOM_PCT) applies. */
  monkeyMode?: string;
}

/**
 * Run all kernel vetoes in priority order. First failure stops the chain
 * and is returned. If all pass, returns { allowed: true }.
 *
 * Priority:
 *   1. Unrealised-drawdown kill-switch (account-saving).
 *   2. Execution-mode global override (operator kill-switch).
 *   3. Self-match (legal compliance, Corporations Act s.1041B).
 *   4. Per-symbol exposure (correlated-stack blast door).
 *   5. Symbol max leverage (exchange ceiling).
 */
export function evaluatePreTradeVetoes(
  order: KernelOrder,
  state: KernelAccountState,
  context: KernelContext,
): KernelDecision {
  // Headroom reserve precedence (2026-05-20):
  //   1. operator-explicit MONKEY_MIN_MARGIN_HEADROOM_PCT (wins always)
  //   2. mode-conditional default (exploration 35% … drift 50%)
  //   3. env default (0.0 = disabled)
  // Before 2026-05-20 the mode table (step 2) always overrode the env
  // var, because monkeyMode is set on every live tick — so the operator
  // could set MONKEY_MIN_MARGIN_HEADROOM_PCT and it did nothing. The
  // operator's explicit reserve is now authoritative; the mode table is
  // the default used only when the operator has not set the var.
  const explicitHeadroom = explicitMinMarginHeadroomPct();
  const headroomPct = explicitHeadroom
    ?? modeMarginHeadroomPct(context.monkeyMode)
    ?? undefined;
  const checks: KernelDecision[] = [
    checkUnrealizedDrawdown(state),
    checkExecutionMode(context.isLive, context.mode),
    checkSelfMatch(order, state),
    checkPerSymbolExposure(order, state),
    checkMarginHeadroom(order, state, headroomPct),
    checkSymbolMaxLeverage(order, context.symbolMaxLeverage),
  ];
  for (const d of checks) {
    if (!d.allowed) return d;
  }
  return { allowed: true };
}
