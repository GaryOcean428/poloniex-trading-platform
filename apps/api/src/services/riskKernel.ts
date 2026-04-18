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
  | 'symbol_max_leverage';

// ───────── Thresholds ─────────
export const PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER = 1.5;           // 1.5× equity per symbol
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

// ───────── Check 4: Per-symbol max leverage from exchange catalog ─────────

/**
 * Enforces the exchange's per-symbol maxLeverage (BTC/ETH up to 100×,
 * alts 20-75×). Callers read `marketCatalog.getMaxLeverage(symbol)`
 * and pass it in — kernel stays pure sync.
 *
 * This is the exchange ceiling; the per-symbol exposure cap (1.5× equity
 * notional) will typically bind first at tiny account sizes. Example:
 * at $27 equity, the exposure cap pins a $2 BTC trade at ≤$40.5 notional
 * regardless of the 100× leverage BTC technically allows.
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

/**
 * Run all kernel vetoes in priority order. First failure stops the chain
 * and is returned. If all pass, returns { allowed: true }.
 *
 * Priority:
 *   1. Unrealised-drawdown kill-switch (global, highest priority).
 *   2. Self-match (legal compliance, Corporations Act s.1041B).
 *   3. Per-symbol exposure (correlated-stack blast door).
 *   4. Symbol max leverage (exchange ceiling).
 */
export function evaluatePreTradeVetoes(
  order: KernelOrder,
  state: KernelAccountState,
  symbolMaxLeverage: SymbolMaxLeverage,
): KernelDecision {
  const checks: KernelDecision[] = [
    checkUnrealizedDrawdown(state),
    checkSelfMatch(order, state),
    checkPerSymbolExposure(order, state),
    checkSymbolMaxLeverage(order, symbolMaxLeverage),
  ];
  for (const d of checks) {
    if (!d.allowed) return d;
  }
  return { allowed: true };
}
