/**
 * turtle_agent/decide.ts — Agent T decision logic (Turtle System 1).
 *
 * Pure Donchian / ATR / pyramid logic. NO basin, NO ml, NO kernel
 * state. The agent sees only (symbol, ohlcv, account, allocation,
 * its own held units).
 *
 * Constants are explicit literals here. They're Agent T's tuning
 * surface. They are NOT QIG-derived (Agent T is the classical-TA
 * control arm — non-QIG-pure by design) and NOT registry-backed
 * (the ml_agent precedent is to keep control-arm parameters in code
 * so the experiment is reproducible from git history).
 *
 * The one runtime-configurable parameter is the equity activation
 * threshold: ``arbiter.turtle.min_equity_usdt`` (env override
 * ``TURTLE_MIN_EQUITY_USDT``, default 150). This is NOT a flag —
 * T returns 'hold' below threshold by construction; the arbiter
 * also excludes T from allocation below threshold so its 1/N share
 * doesn't get stranded.
 *
 * Reference: Way of the Turtle (Curtis Faith, 2007). System 1
 * parameters: 20-bar Donchian entry, 10-bar opposite Donchian
 * exit, 2× ATR(20) stop, 0.5× ATR pyramid step, max 4 units per
 * market.
 */

import { latestAtr } from './atr.js';
import { latestDonchianHigh, latestDonchianLow } from './donchian.js';
import {
  lastUnitEntry,
  turtleHeldSide,
  type TurtleAccount,
  type TurtleOHLCV,
  type TurtleState,
  type TurtleUnit,
} from './state.js';

// ===== TUNING SURFACE =====

/** Donchian period for entry signals. */
export const TURTLE_ENTRY_PERIOD = 20;
/** Donchian period for opposite-side exit signals. */
export const TURTLE_EXIT_PERIOD = 10;
/** ATR period (Wilder). */
export const TURTLE_ATR_PERIOD = 20;
/** Stop distance in multiples of ATR(20) at unit entry. */
export const TURTLE_STOP_ATR_MULT = 2.0;
/** Pyramid step in multiples of ATR(20) — every favorable move of
 *  this magnitude past the most recent unit's entry adds one more. */
export const TURTLE_PYRAMID_STEP_ATR_MULT = 0.5;
/** Max units in a pyramid — Turtle classic. */
export const TURTLE_MAX_UNITS = 4;
/** Per-trade risk fraction of allocated capital — Turtle "1 unit" =
 *  1 % of account, but Agent T sizes against its arbiter allocation
 *  not absolute equity, so ``unit risk × allocated`` here. The 1 %
 *  preserves the original Turtle volatility-targeting behavior:
 *  unit margin = (allocation × 1 %) / (2 × ATR × leverage) so a
 *  full 2× ATR adverse move loses ~1 % of T's allocation per unit. */
export const TURTLE_UNIT_RISK_FRACTION = 0.01;
/** Fixed leverage for Agent T entries. Configurable below; the
 *  Turtle reference is unleveraged but that produces unworkable
 *  notionals on a $50–$200 perp account. 8× matches Agent M's
 *  base leverage so the three agents enter the experiment with
 *  comparable position sizing constants. */
export const TURTLE_DEFAULT_LEVERAGE = 8;
/** Minimum account equity (USDT) for T to be active. Below this,
 *  T sits flat by construction and returns 'hold' regardless of
 *  signal. */
export const TURTLE_MIN_EQUITY_USDT_DEFAULT = 150;

/** Resolve the equity-gate threshold from env or fall back to the
 *  default. Read each call (cheap, allows operators to redeploy
 *  with TURTLE_MIN_EQUITY_USDT=200 without code change). */
export function turtleMinEquityUsdt(): number {
  const raw = process.env.TURTLE_MIN_EQUITY_USDT;
  if (raw === undefined || raw === null || raw === '') {
    return TURTLE_MIN_EQUITY_USDT_DEFAULT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TURTLE_MIN_EQUITY_USDT_DEFAULT;
  }
  return parsed;
}

// ===== DECISION TYPES =====

export type TurtleAction =
  | 'hold'
  | 'enter_long'
  | 'enter_short'
  | 'pyramid_long'
  | 'pyramid_short'
  | 'exit_donchian'
  | 'exit_stop';

export interface TurtleAgentInputs {
  symbol: string;
  ohlcv: readonly TurtleOHLCV[];
  account: TurtleAccount;
  /** Capital share allocated by the arbiter for this tick. Zero
   *  when arbiter excludes T (sub-threshold equity, or N-agent
   *  allocation outvoting T to floor). */
  allocatedCapitalUsdt: number;
  /** T's own per-symbol state. The wall is here: this is T's state,
   *  not K's basin, not M's ml_signal. */
  state: TurtleState;
}

export interface TurtleAgentDecision {
  action: TurtleAction;
  /** USDT margin to commit on the new unit (0 for holds / exits). */
  sizeUsdt: number;
  leverage: number;
  /** Stop price for the new unit (entry ± 2× ATR). 0 when not
   *  opening / pyramiding. */
  stopPrice: number;
  /** Human-readable reason — surfaces in derivation telemetry. */
  reason: string;
  /** Diagnostic block exposed for telemetry / tests. */
  derivation: {
    atr: number;
    donchianHigh: number;
    donchianLow: number;
    exitHigh: number;
    exitLow: number;
    lastClose: number;
    heldSide: 'long' | 'short' | null;
    unitsHeld: number;
    pyramidThresholdPrice: number | null;
    /** True when the equity gate blocked the decision. */
    equityGated: boolean;
  };
}

// ===== HELPERS =====

/** Compute unit margin: (allocation × 1 %) / (2 × ATR × leverage),
 *  clipped to a minimum of one currency unit so the executor's lot
 *  rounding has a chance to produce a tradable size. Returns 0 when
 *  any input is non-finite or non-positive — the executor will then
 *  reject below min-notional and the caller will log 'hold'. */
function unitMarginUsdt(
  allocatedCapitalUsdt: number,
  atr: number,
  leverage: number,
  entryPrice: number,
): number {
  if (!Number.isFinite(allocatedCapitalUsdt) || allocatedCapitalUsdt <= 0) return 0;
  if (!Number.isFinite(atr) || atr <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  // Volatility target: a 2× ATR adverse move on this unit's notional
  // should equal ~1 % of allocated capital. Solve for margin given
  // notional = margin × leverage and qty = notional / entryPrice.
  //   1 % allocated = qty × 2 × ATR
  //   1 % allocated = (margin × leverage / entryPrice) × 2 × ATR
  //   margin = (1 % allocated × entryPrice) / (2 × ATR × leverage)
  const target = TURTLE_UNIT_RISK_FRACTION * allocatedCapitalUsdt;
  const margin = (target * entryPrice) / (TURTLE_STOP_ATR_MULT * atr * leverage);
  // Cap at allocated capital — never overspend the arbiter share.
  return Math.max(0, Math.min(allocatedCapitalUsdt, margin));
}

function holdResult(
  reason: string,
  derivation: TurtleAgentDecision['derivation'],
): TurtleAgentDecision {
  return {
    action: 'hold',
    sizeUsdt: 0,
    leverage: 1,
    stopPrice: 0,
    reason,
    derivation,
  };
}

// ===== MAIN ENTRY =====

/**
 * Pure decision function. Given the latest OHLCV window, account,
 * arbiter allocation, and T's own state, return what T would do at
 * this tick.
 *
 * The function does NOT mutate ``inputs.state``. The caller (loop
 * integration) is responsible for applying the chosen action — i.e.
 * pushing a new ``TurtleUnit`` onto ``state.units`` after an
 * exchange-side fill, popping all units after an exit, etc.
 *
 * The decision priority order:
 *   1. Equity gate (account.equityUsdt < threshold) → hold
 *   2. Stop hit on any held unit (worst-side fill) → exit_stop
 *   3. 10-bar opposite Donchian against direction → exit_donchian
 *   4. 0.5× ATR favorable past last unit + room in pyramid → pyramid
 *   5. 20-bar Donchian breakout in either direction (only when flat
 *      and arbiter allocation > 0) → enter_long / enter_short
 *   6. Otherwise → hold
 */
export function turtleAgentDecide(
  inputs: TurtleAgentInputs,
): TurtleAgentDecision {
  const { ohlcv, account, allocatedCapitalUsdt, state } = inputs;
  const minEquity = turtleMinEquityUsdt();
  const lastClose = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1]!.close : NaN;
  const lastLow = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1]!.low : NaN;
  const lastHigh = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1]!.high : NaN;
  const atr = latestAtr(ohlcv, TURTLE_ATR_PERIOD);
  const dHigh = latestDonchianHigh(ohlcv, TURTLE_ENTRY_PERIOD);
  const dLow = latestDonchianLow(ohlcv, TURTLE_ENTRY_PERIOD);
  const exitHigh = latestDonchianHigh(ohlcv, TURTLE_EXIT_PERIOD);
  const exitLow = latestDonchianLow(ohlcv, TURTLE_EXIT_PERIOD);
  const heldSide = turtleHeldSide(state);
  const lastUnit = lastUnitEntry(state);
  const unitsHeld = state.units.length;
  const pyramidThresholdPrice = lastUnit
    ? lastUnit.side === 'long'
      ? lastUnit.entryPrice + TURTLE_PYRAMID_STEP_ATR_MULT * lastUnit.atrAtEntry
      : lastUnit.entryPrice - TURTLE_PYRAMID_STEP_ATR_MULT * lastUnit.atrAtEntry
    : null;

  const baseDerivation: TurtleAgentDecision['derivation'] = {
    atr: Number.isFinite(atr) ? atr : 0,
    donchianHigh: Number.isFinite(dHigh) ? dHigh : 0,
    donchianLow: Number.isFinite(dLow) ? dLow : 0,
    exitHigh: Number.isFinite(exitHigh) ? exitHigh : 0,
    exitLow: Number.isFinite(exitLow) ? exitLow : 0,
    lastClose: Number.isFinite(lastClose) ? lastClose : 0,
    heldSide,
    unitsHeld,
    pyramidThresholdPrice,
    equityGated: false,
  };

  // 1. EQUITY GATE — hard short-circuit. Below threshold T is flat by
  //    construction. If somehow units exist (operator ran T above
  //    threshold then equity dipped before exits cleared), let exit
  //    logic still run so the position can close cleanly — but no new
  //    entries / pyramids are allowed.
  const gated = account.equityUsdt < minEquity;
  if (gated && unitsHeld === 0) {
    return holdResult(
      `equity_gate: equity ${account.equityUsdt.toFixed(2)} < threshold ${minEquity.toFixed(2)}`,
      { ...baseDerivation, equityGated: true },
    );
  }

  // Insufficient OHLCV for any signal — hold quietly.
  if (
    !Number.isFinite(atr)
    || !Number.isFinite(dHigh)
    || !Number.isFinite(dLow)
    || !Number.isFinite(lastClose)
    || ohlcv.length < TURTLE_ENTRY_PERIOD + 1
  ) {
    return holdResult(
      `insufficient_data: bars=${ohlcv.length} need=${TURTLE_ENTRY_PERIOD + 1}`,
      { ...baseDerivation, equityGated: gated },
    );
  }

  // 2. STOP HIT — single bar's adverse low / high vs unit stop. Each
  //    unit has its own stop; if ANY unit's stop is breached we exit
  //    the whole pyramid (Turtle classic — the trade is over).
  if (heldSide === 'long' && Number.isFinite(lastLow)) {
    const worstStop = state.units.reduce(
      (mx, u) => Math.max(mx, u.stopPrice),
      -Infinity,
    );
    if (Number.isFinite(worstStop) && lastLow <= worstStop) {
      return {
        action: 'exit_stop',
        sizeUsdt: 0,
        leverage: 1,
        stopPrice: 0,
        reason: `stop_hit: low ${lastLow.toFixed(4)} <= stop ${worstStop.toFixed(4)}`,
        derivation: { ...baseDerivation, equityGated: gated },
      };
    }
  }
  if (heldSide === 'short' && Number.isFinite(lastHigh)) {
    const worstStop = state.units.reduce(
      (mn, u) => Math.min(mn, u.stopPrice),
      Infinity,
    );
    if (Number.isFinite(worstStop) && lastHigh >= worstStop) {
      return {
        action: 'exit_stop',
        sizeUsdt: 0,
        leverage: 1,
        stopPrice: 0,
        reason: `stop_hit: high ${lastHigh.toFixed(4)} >= stop ${worstStop.toFixed(4)}`,
        derivation: { ...baseDerivation, equityGated: gated },
      };
    }
  }

  // 3. DONCHIAN OPPOSITE EXIT — 10-bar reversal extreme. The Turtle
  //    reference uses a CLOSE through the opposite extreme; in
  //    practice on perp 15m bars we read it as the close of the most
  //    recent bar penetrating the channel.
  if (
    heldSide === 'long'
    && Number.isFinite(exitLow)
    && lastClose < exitLow
  ) {
    return {
      action: 'exit_donchian',
      sizeUsdt: 0,
      leverage: 1,
      stopPrice: 0,
      reason: `donchian_exit_long: close ${lastClose.toFixed(4)} < ${TURTLE_EXIT_PERIOD}-bar low ${exitLow.toFixed(4)}`,
      derivation: { ...baseDerivation, equityGated: gated },
    };
  }
  if (
    heldSide === 'short'
    && Number.isFinite(exitHigh)
    && lastClose > exitHigh
  ) {
    return {
      action: 'exit_donchian',
      sizeUsdt: 0,
      leverage: 1,
      stopPrice: 0,
      reason: `donchian_exit_short: close ${lastClose.toFixed(4)} > ${TURTLE_EXIT_PERIOD}-bar high ${exitHigh.toFixed(4)}`,
      derivation: { ...baseDerivation, equityGated: gated },
    };
  }

  // 4. PYRAMID — add a unit when price has moved 0.5× ATR favorable
  //    past the most recent unit's entry, capped at TURTLE_MAX_UNITS.
  //    Pyramid does NOT trigger when equity-gated (we don't add risk
  //    below the threshold even if the trade is winning).
  if (
    !gated
    && lastUnit
    && unitsHeld < TURTLE_MAX_UNITS
    && allocatedCapitalUsdt > 0
    && pyramidThresholdPrice !== null
  ) {
    const triggered =
      (lastUnit.side === 'long' && lastClose >= pyramidThresholdPrice)
      || (lastUnit.side === 'short' && lastClose <= pyramidThresholdPrice);
    if (triggered) {
      const action: TurtleAction =
        lastUnit.side === 'long' ? 'pyramid_long' : 'pyramid_short';
      const margin = unitMarginUsdt(
        allocatedCapitalUsdt,
        atr,
        TURTLE_DEFAULT_LEVERAGE,
        lastClose,
      );
      const stopPrice =
        lastUnit.side === 'long'
          ? lastClose - TURTLE_STOP_ATR_MULT * atr
          : lastClose + TURTLE_STOP_ATR_MULT * atr;
      if (margin > 0) {
        return {
          action,
          sizeUsdt: margin,
          leverage: TURTLE_DEFAULT_LEVERAGE,
          stopPrice,
          reason: `pyramid_${lastUnit.side}: close ${lastClose.toFixed(4)} past unit-${lastUnit.unitIndex + 1} step ${pyramidThresholdPrice.toFixed(4)} (n=${unitsHeld + 1}/${TURTLE_MAX_UNITS})`,
          derivation: { ...baseDerivation, equityGated: gated },
        };
      }
    }
  }

  // 5. ENTRY — flat AND arbiter > 0 AND breakout. Below allocation
  //    means the arbiter excluded T this tick (sub-threshold equity,
  //    or N-agent floor). Either way: hold.
  if (heldSide === null && allocatedCapitalUsdt > 0 && !gated) {
    if (lastClose > dHigh) {
      const margin = unitMarginUsdt(
        allocatedCapitalUsdt,
        atr,
        TURTLE_DEFAULT_LEVERAGE,
        lastClose,
      );
      const stopPrice = lastClose - TURTLE_STOP_ATR_MULT * atr;
      if (margin > 0) {
        return {
          action: 'enter_long',
          sizeUsdt: margin,
          leverage: TURTLE_DEFAULT_LEVERAGE,
          stopPrice,
          reason: `entry_long: close ${lastClose.toFixed(4)} > ${TURTLE_ENTRY_PERIOD}-bar high ${dHigh.toFixed(4)}`,
          derivation: { ...baseDerivation, equityGated: gated },
        };
      }
    }
    if (lastClose < dLow) {
      const margin = unitMarginUsdt(
        allocatedCapitalUsdt,
        atr,
        TURTLE_DEFAULT_LEVERAGE,
        lastClose,
      );
      const stopPrice = lastClose + TURTLE_STOP_ATR_MULT * atr;
      if (margin > 0) {
        return {
          action: 'enter_short',
          sizeUsdt: margin,
          leverage: TURTLE_DEFAULT_LEVERAGE,
          stopPrice,
          reason: `entry_short: close ${lastClose.toFixed(4)} < ${TURTLE_ENTRY_PERIOD}-bar low ${dLow.toFixed(4)}`,
          derivation: { ...baseDerivation, equityGated: gated },
        };
      }
    }
  }

  // 6. No-op.
  return holdResult(
    heldSide
      ? `holding_${heldSide} units=${unitsHeld}`
      : (gated ? 'equity_gated_with_open_units' : 'no_signal'),
    { ...baseDerivation, equityGated: gated },
  );
}

/**
 * Helper for the loop integration: after an entry / pyramid fill is
 * confirmed, push a new ``TurtleUnit`` onto state. Pure: returns a
 * fresh state object (callers are free to use it as immutable).
 */
export function appendUnit(
  state: TurtleState,
  unit: Omit<TurtleUnit, 'unitIndex'>,
): TurtleState {
  const unitIndex = state.units.length;
  return {
    units: [...state.units, { ...unit, unitIndex }],
    lastExitAtMs: state.lastExitAtMs,
    lastExitReason: state.lastExitReason,
  };
}

/**
 * Helper for the loop integration: after an exit fill clears all
 * units (Turtle closes the whole pyramid on stop or Donchian exit),
 * reset the units list and record the exit timestamp + reason.
 */
export function clearUnitsAfterExit(
  state: TurtleState,
  reason: string,
  atMs: number,
): TurtleState {
  return {
    units: [],
    lastExitAtMs: atMs,
    lastExitReason: reason,
  };
}
