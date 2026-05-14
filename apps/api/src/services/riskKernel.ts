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
/**
 * Per-symbol gross notional cap as multiple of equity. Notional-based,
 * not margin-based — at high leverage the effective margin commit per
 * unit of notional is small. Poloniex BTC perp's structural min is
 * 0.001 lot × spot-price-USDT per contract. At current prices (~$75k
 * BTC), that's ~$75 per single lot. As equity shrinks, even a 3× cap
 * fails: on $19 equity, 3× = $56.78, below the $75 floor. Raised to
 * 5× ($94.65 here) so 1 BTC lot fits with headroom while still
 * preventing stacked correlated positions. At 16× leverage a single
 * $75 lot commits $4.70 margin (~25 % of equity) — within prudence.
 * TODO: migrate to a margin-based cap when the risk kernel gets its
 * next iteration.
 */
export const PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER = 5.0;
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
export const DEFAULT_MIN_MARGIN_HEADROOM_PCT = 0.0;

function getMinMarginHeadroomPct(): number {
  const raw = Number(process.env.MONKEY_MIN_MARGIN_HEADROOM_PCT ?? '');
  if (!Number.isFinite(raw) || raw < 0 || raw >= 1) return DEFAULT_MIN_MARGIN_HEADROOM_PCT;
  return raw;
}

/** 2026-05-13 — mode-conditional headroom reserves.
 *
 * EXPLORATION (flat / fast scalp): need MORE headroom because each
 *   scalp cycle reserves and releases margin rapidly; can't get stuck
 *   without room to enter the next opportunity.
 * INTEGRATION (slow trend): need LESS headroom — one big slow
 *   position is fine with most margin committed.
 *
 * Returns null if no monkeyMode supplied (caller falls back to env). */
export function modeMarginHeadroomPct(mode?: string): number | null {
  if (!mode) return null;
  switch (mode) {
    case 'exploration': return 0.35;
    case 'investigation': return 0.25;
    case 'integration': return 0.15;
    case 'drift': return 0.50;
    default: return null;
  }
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
  // 2026-05-13 — mode-conditional headroom override. When the kernel
  // supplies monkeyMode (cognitive mode), use that to pick the reserve
  // pct. Otherwise fall through to env default.
  const headroomPct = modeMarginHeadroomPct(context.monkeyMode) ?? undefined;
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
