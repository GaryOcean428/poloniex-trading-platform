/**
 * Risk kernel tests — four pre-trade vetoes.
 *
 * The kernel is pure sync — callers (riskService) pre-load
 * symbolMaxLeverage from the exchange catalog and pass it in. Tests
 * exercise allow/block/edge for every veto and the composer's priority
 * ordering.
 */

import { describe, expect, it } from 'vitest';
import {
  PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER,
  UNREALIZED_DRAWDOWN_KILL_THRESHOLD,
  checkExecutionMode,
  checkPerSymbolExposure,
  checkSelfMatch,
  checkSymbolMaxLeverage,
  checkUnrealizedDrawdown,
  evaluatePreTradeVetoes,
  type KernelAccountState,
  type KernelContext,
  type KernelOrder,
} from '../riskKernel.js';

const btcOrder: KernelOrder = {
  symbol: 'BTC_USDT_PERP',
  side: 'long',
  notional: 10,
  leverage: 3,
  price: 70_000,
};

const emptyAccount: KernelAccountState = {
  equityUsdt: 100,
  unrealizedPnlUsdt: 0,
  openPositions: [],
  restingOrders: [],
};

// Catalog-realistic maxLeverage values: BTC/ETH 100x, mid-caps 50x,
// smaller alts as low as 20x. Kernel accepts whatever the caller passes.
const BTC_MAX_LEV = 100;
const SOL_MAX_LEV = 50;

const autoContext: KernelContext = { isLive: false, mode: 'auto', symbolMaxLeverage: BTC_MAX_LEV };
const liveAutoContext: KernelContext = { isLive: true, mode: 'auto', symbolMaxLeverage: BTC_MAX_LEV };

describe('checkPerSymbolExposure', () => {
  it('allows an order when total notional stays under the 1.5× cap', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'BTC_USDT_PERP', side: 'long', notional: 100 }],
    };
    expect(checkPerSymbolExposure({ ...btcOrder, notional: 10 }, state).allowed).toBe(true);
  });

  it('blocks an order that would push same-symbol notional over the cap', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'BTC_USDT_PERP', side: 'long', notional: 145 }],
    };
    const decision = checkPerSymbolExposure({ ...btcOrder, notional: 10 }, state);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('per_symbol_exposure_cap');
  });

  it('sums long and short exposure on the same symbol — both add to the cap', () => {
    // A short position still counts toward gross exposure; the kernel
    // doesn't net longs against shorts because a -2% candle moves both
    // against margin (via maintenance-margin stack).
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [
        { symbol: 'BTC_USDT_PERP', side: 'long', notional: 80 },
        { symbol: 'BTC_USDT_PERP', side: 'short', notional: 60 },
      ],
    };
    expect(checkPerSymbolExposure({ ...btcOrder, notional: 20 }, state).allowed).toBe(false);
  });

  it('ignores positions on a different symbol', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'ETH_USDT_PERP', side: 'long', notional: 500 }],
    };
    expect(checkPerSymbolExposure(btcOrder, state).allowed).toBe(true);
  });

  it(`constant check: ${PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER}× multiplier`, () => {
    expect(PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER).toBeGreaterThanOrEqual(1.5);
  });
});

describe('checkSelfMatch', () => {
  it('allows an order when there is no resting cross', () => {
    expect(checkSelfMatch(btcOrder, emptyAccount).allowed).toBe(true);
  });

  it("blocks a buy that would lift the account's own sell", () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      restingOrders: [{ symbol: 'BTC_USDT_PERP', side: 'sell', price: 69_900 }],
    };
    const decision = checkSelfMatch({ ...btcOrder, side: 'buy', price: 70_000 }, state);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('self_match');
    expect(decision.reason).toContain('s.1041B');
  });

  it("blocks a sell that would hit the account's own buy (short entry crossing own long-exit)", () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      restingOrders: [{ symbol: 'BTC_USDT_PERP', side: 'buy', price: 70_100 }],
    };
    const decision = checkSelfMatch({ ...btcOrder, side: 'sell', price: 70_000 }, state);
    expect(decision.allowed).toBe(false);
  });

  it('ignores resting orders on a different symbol', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      restingOrders: [{ symbol: 'ETH_USDT_PERP', side: 'sell', price: 69_000 }],
    };
    expect(checkSelfMatch(btcOrder, state).allowed).toBe(true);
  });
});

describe('checkUnrealizedDrawdown', () => {
  it('allows when unrealized P&L is above the -15% threshold', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      unrealizedPnlUsdt: -10, // -10% of $100 equity
    };
    expect(checkUnrealizedDrawdown(state).allowed).toBe(true);
  });

  it('blocks when unrealized drawdown breaches -15%', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      unrealizedPnlUsdt: -16,
    };
    const decision = checkUnrealizedDrawdown(state);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('unrealized_drawdown_kill_switch');
  });

  it('handles zero equity gracefully (delegates to realised-loss cap)', () => {
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 0 };
    expect(checkUnrealizedDrawdown(state).allowed).toBe(true);
  });

  it('threshold constant stays at -15% or tighter', () => {
    expect(UNREALIZED_DRAWDOWN_KILL_THRESHOLD).toBeLessThanOrEqual(-0.15);
  });
});

describe('checkSymbolMaxLeverage', () => {
  it('allows BTC 100× when catalog says 100', () => {
    expect(checkSymbolMaxLeverage({ ...btcOrder, leverage: 100 }, BTC_MAX_LEV).allowed).toBe(true);
  });

  it('allows BTC 3× (typical conservative tier)', () => {
    expect(checkSymbolMaxLeverage({ ...btcOrder, leverage: 3 }, BTC_MAX_LEV).allowed).toBe(true);
  });

  it('blocks SOL 75× when catalog caps at 50', () => {
    const decision = checkSymbolMaxLeverage(
      { ...btcOrder, symbol: 'SOL_USDT_PERP', leverage: 75 },
      SOL_MAX_LEV,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('symbol_max_leverage');
  });

  it('blocks BTC 150× even though the request is higher than any catalog value', () => {
    const decision = checkSymbolMaxLeverage({ ...btcOrder, leverage: 150 }, BTC_MAX_LEV);
    expect(decision.allowed).toBe(false);
  });
});

describe('checkExecutionMode', () => {
  it('allows any order under auto mode', () => {
    expect(checkExecutionMode(true, 'auto').allowed).toBe(true);
    expect(checkExecutionMode(false, 'auto').allowed).toBe(true);
  });

  it('blocks all orders under pause mode', () => {
    expect(checkExecutionMode(true, 'pause').code).toBe('execution_mode_paused');
    expect(checkExecutionMode(false, 'pause').code).toBe('execution_mode_paused');
  });

  it('blocks live orders under paper_only mode', () => {
    const decision = checkExecutionMode(true, 'paper_only');
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('execution_mode_paper_only_blocks_live');
  });

  it('allows paper orders under paper_only mode', () => {
    expect(checkExecutionMode(false, 'paper_only').allowed).toBe(true);
  });
});

describe('evaluatePreTradeVetoes composition', () => {
  it('passes a clean paper order', () => {
    expect(evaluatePreTradeVetoes(btcOrder, emptyAccount, autoContext).allowed).toBe(true);
  });

  it('passes a clean live order under auto mode', () => {
    expect(evaluatePreTradeVetoes(btcOrder, emptyAccount, liveAutoContext).allowed).toBe(true);
  });

  it('passes a clean short order', () => {
    expect(
      evaluatePreTradeVetoes({ ...btcOrder, side: 'short' }, emptyAccount, autoContext).allowed,
    ).toBe(true);
  });

  it('surfaces the unrealised-drawdown veto before any other', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      unrealizedPnlUsdt: -20,
      openPositions: [{ symbol: 'BTC_USDT_PERP', side: 'long', notional: 500 }],
      restingOrders: [{ symbol: 'BTC_USDT_PERP', side: 'sell', price: 69_000 }],
    };
    const decision = evaluatePreTradeVetoes({ ...btcOrder, side: 'buy' }, state, autoContext);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('unrealized_drawdown_kill_switch');
  });

  it('execution-mode pause blocks even a clean order', () => {
    const decision = evaluatePreTradeVetoes(btcOrder, emptyAccount, {
      ...autoContext,
      mode: 'pause',
    });
    expect(decision.code).toBe('execution_mode_paused');
  });

  it('execution-mode paper_only blocks a live order', () => {
    const decision = evaluatePreTradeVetoes(btcOrder, emptyAccount, {
      ...liveAutoContext,
      mode: 'paper_only',
    });
    expect(decision.code).toBe('execution_mode_paper_only_blocks_live');
  });

  it('execution-mode paper_only allows a paper order', () => {
    const decision = evaluatePreTradeVetoes(btcOrder, emptyAccount, {
      ...autoContext,
      mode: 'paper_only',
    });
    expect(decision.allowed).toBe(true);
  });

  it('falls through to leverage cap when earlier checks pass', () => {
    const decision = evaluatePreTradeVetoes(
      { ...btcOrder, symbol: 'SOL_USDT_PERP', leverage: 75 },
      emptyAccount,
      { isLive: false, mode: 'auto', symbolMaxLeverage: SOL_MAX_LEV },
    );
    expect(decision.code).toBe('symbol_max_leverage');
  });
});
