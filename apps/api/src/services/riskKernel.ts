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

export interface KernelStrategyMeta {
  /** 0 = paper/recalibrating, 1-5 = live tiers with increasing capital cap */
  liveTier: number;
}

export interface KernelDecision {
  allowed: boolean;
  reason?: string;
  code?: KernelVetoCode;
}

export type KernelVetoCode =
  | 'per_symbol_exposure_cap'
  | 'self_match'
  | 'unrealized_drawdown_kill_switch'
  | 'strategy_leverage_cap'
  | 'symbol_not_allowed_at_equity';

// ───────── Thresholds (shipping defaults) ─────────
export const PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER = 1.5;           // 1.5× equity per symbol
export const UNREALIZED_DRAWDOWN_KILL_THRESHOLD = -0.15;         // −15% of equity
export const STRATEGY_LEVERAGE_CAP_BY_TIER: Record<number, number> = {
  0: 1,  // paper/recalibrating
  1: 3,
  2: 5,
  3: 10,
  4: 15,
  5: 20,
};
export const DEFAULT_UNPROVEN_LEVERAGE_CAP = 5;
export const MIN_EQUITY_FOR_ETH_USDT = 100;
export const BTC_SYMBOL_ALIASES = ['BTC-USDT', 'BTCUSDT', 'BTC_USDT', 'BTC-USDT-PERP'];

export function isBtcSymbol(symbol: string): boolean {
  return BTC_SYMBOL_ALIASES.includes(symbol.toUpperCase());
}

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

// ───────── Check 4: Strategy-tier leverage cap ─────────

export function checkStrategyLeverageCap(
  order: KernelOrder,
  strategy: KernelStrategyMeta,
): KernelDecision {
  const cap =
    STRATEGY_LEVERAGE_CAP_BY_TIER[strategy.liveTier] ?? DEFAULT_UNPROVEN_LEVERAGE_CAP;
  if (order.leverage > cap) {
    return {
      allowed: false,
      code: 'strategy_leverage_cap',
      reason: `Leverage ${order.leverage}× exceeds tier ${strategy.liveTier} cap of ${cap}×. Strategy must earn higher tiers via profitable live trades.`,
    };
  }
  return { allowed: true };
}

// ───────── Check 5: Symbol allowed at current equity ─────────

export function checkSymbolAllowedAtEquity(
  order: KernelOrder,
  state: KernelAccountState,
): KernelDecision {
  if (isBtcSymbol(order.symbol)) return { allowed: true };
  if (state.equityUsdt < MIN_EQUITY_FOR_ETH_USDT) {
    return {
      allowed: false,
      code: 'symbol_not_allowed_at_equity',
      reason: `${order.symbol} requires account equity ≥ $${MIN_EQUITY_FOR_ETH_USDT} (current $${state.equityUsdt.toFixed(2)}). ETH perp min contract ~$35 notional — not viable at tiny sizes.`,
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
 *   1. Unrealised-drawdown kill-switch (global, highest priority —
 *      blocks even position-flattening orders if we ever route those
 *      through the kernel, which we don't).
 *   2. Self-match (legal compliance).
 *   3. Per-symbol exposure (correlated-stack blast door).
 *   4. Strategy leverage cap (per-strategy earn-your-size gating).
 *   5. Symbol-allowed-at-equity (capital adequacy).
 */
export function evaluatePreTradeVetoes(
  order: KernelOrder,
  state: KernelAccountState,
  strategy: KernelStrategyMeta,
): KernelDecision {
  const checks: KernelDecision[] = [
    checkUnrealizedDrawdown(state),
    checkSelfMatch(order, state),
    checkPerSymbolExposure(order, state),
    checkStrategyLeverageCap(order, strategy),
    checkSymbolAllowedAtEquity(order, state),
  ];
  for (const d of checks) {
    if (!d.allowed) return d;
  }
  return { allowed: true };
}
