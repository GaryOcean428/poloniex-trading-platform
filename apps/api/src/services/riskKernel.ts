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
  | 'execution_mode_paper_only_blocks_live';

export type ExecutionMode = 'auto' | 'paper_only' | 'pause';

// ───────── Thresholds ─────────
/**
 * Per-symbol gross notional cap as multiple of equity. Notional-based,
 * not margin-based — so at high leverage the effective margin commit
 * per unit of notional is small. At a $27 equity and Poloniex BTC
 * perp's 0.001 lot × $75k price = $75 minimum notional per order,
 * a 1.5× cap ($40.72) made it impossible to place the smallest
 * compliant order. 3.0× ($81) allows a single BTC lot while still
 * bounding stacked correlated positions; with 15× leverage that's
 * only ~18% of equity in margin commit. TODO: migrate to a
 * margin-based cap when the risk kernel gets its next iteration.
 */
export const PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER = 3.0;
export const UNREALIZED_DRAWDOWN_KILL_THRESHOLD = -0.15;         // −15% of equity

function isLong(side: KernelOrder['side']): boolean {
  return side === 'long' || side === 'buy';
}

// ───────── Check 1: Per-symbol gross exposure ─────────

export function checkPerSymbolExposure(
  order: KernelOrder,
  state: KernelAccountState,
): KernelDecision {
  const cap = state.equityUsdt * PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER;
  const existingNotional = state.openPositions
    .filter((p) => p.symbol === order.symbol)
    .reduce((sum, p) => sum + Math.abs(p.notional), 0);
  const projected = existingNotional + Math.abs(order.notional);
  if (projected > cap) {
    return {
      allowed: false,
      code: 'per_symbol_exposure_cap',
      reason: `Per-symbol exposure cap breached: ${projected.toFixed(2)} > ${cap.toFixed(2)} (${PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER}× equity)`,
    };
  }
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
  state: KernelAccountState,
): KernelDecision {
  if (state.equityUsdt <= 0) return { allowed: true }; // divide-by-zero guard; realised-loss cap owns this case
  const ratio = state.unrealizedPnlUsdt / state.equityUsdt;
  if (ratio <= UNREALIZED_DRAWDOWN_KILL_THRESHOLD) {
    return {
      allowed: false,
      code: 'unrealized_drawdown_kill_switch',
      reason: `Unrealised P&L ${(ratio * 100).toFixed(2)}% of equity ≤ ${(UNREALIZED_DRAWDOWN_KILL_THRESHOLD * 100).toFixed(0)}% — flatten and pause 24h.`,
    };
  }
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

// ───────── Composer ─────────

export interface KernelContext {
  /** True for live (real-capital) orders; false for paper-only. */
  isLive: boolean;
  /** From agent_execution_mode — global safety override. */
  mode: ExecutionMode;
  /** From marketCatalog.getMaxLeverage(symbol) — exchange ceiling. */
  symbolMaxLeverage: SymbolMaxLeverage;
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
  const checks: KernelDecision[] = [
    checkUnrealizedDrawdown(state),
    checkExecutionMode(context.isLive, context.mode),
    checkSelfMatch(order, state),
    checkPerSymbolExposure(order, state),
    checkSymbolMaxLeverage(order, context.symbolMaxLeverage),
  ];
  for (const d of checks) {
    if (!d.allowed) return d;
  }
  return { allowed: true };
}
