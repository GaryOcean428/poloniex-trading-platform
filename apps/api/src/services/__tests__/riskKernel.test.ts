/**
 * Commit 4 — Risk Kernel tests.
 *
 * Every veto is exercised with both an allowing input and a blocking
 * input so a future refactor can't silently disable a guard. The red
 * team called this the "blast door" — these tests are the door's
 * hinges.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNPROVEN_LEVERAGE_CAP,
  MIN_EQUITY_FOR_ETH_USDT,
  PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER,
  UNREALIZED_DRAWDOWN_KILL_THRESHOLD,
  checkPerSymbolExposure,
  checkSelfMatch,
  checkStrategyLeverageCap,
  checkSymbolAllowedAtEquity,
  checkUnrealizedDrawdown,
  evaluatePreTradeVetoes,
  type KernelAccountState,
  type KernelOrder,
  type KernelStrategyMeta,
} from '../riskKernel.js';

const btcOrder: KernelOrder = {
  symbol: 'BTC-USDT',
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

const provenStrategy: KernelStrategyMeta = { liveTier: 3 };
const unprovenStrategy: KernelStrategyMeta = { liveTier: 0 };

describe('checkPerSymbolExposure', () => {
  it('allows an order when total notional stays under the 1.5× cap', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'BTC-USDT', side: 'long', notional: 100 }],
    };
    // Cap = 150. Existing 100 + new 10 = 110 → allowed.
    expect(checkPerSymbolExposure({ ...btcOrder, notional: 10 }, state).allowed).toBe(true);
  });

  it('blocks an order that would push same-symbol notional over the cap', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'BTC-USDT', side: 'long', notional: 145 }],
    };
    const decision = checkPerSymbolExposure({ ...btcOrder, notional: 10 }, state);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('per_symbol_exposure_cap');
  });

  it('ignores positions on a different symbol', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'ETH-USDT', side: 'long', notional: 500 }],
    };
    expect(checkPerSymbolExposure(btcOrder, state).allowed).toBe(true);
  });

  it(`uses the ${PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER}× multiplier`, () => {
    // Constant must not drift below 1.5× without a deliberate change + test update.
    expect(PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER).toBeGreaterThanOrEqual(1.5);
  });
});

describe('checkSelfMatch', () => {
  it('allows an order when there is no resting cross', () => {
    expect(checkSelfMatch(btcOrder, emptyAccount).allowed).toBe(true);
  });

  it('blocks a buy that would lift the account\'s own sell', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      restingOrders: [{ symbol: 'BTC-USDT', side: 'sell', price: 69_900 }],
    };
    const decision = checkSelfMatch({ ...btcOrder, side: 'buy', price: 70_000 }, state);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('self_match');
    expect(decision.reason).toContain('s.1041B');
  });

  it('blocks a sell that would hit the account\'s own buy', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      restingOrders: [{ symbol: 'BTC-USDT', side: 'buy', price: 70_100 }],
    };
    const decision = checkSelfMatch({ ...btcOrder, side: 'sell', price: 70_000 }, state);
    expect(decision.allowed).toBe(false);
  });

  it('ignores resting orders on a different symbol', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      restingOrders: [{ symbol: 'ETH-USDT', side: 'sell', price: 69_000 }],
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

describe('checkStrategyLeverageCap', () => {
  it('allows 3× for a proven tier-3 strategy', () => {
    expect(
      checkStrategyLeverageCap({ ...btcOrder, leverage: 3 }, provenStrategy).allowed,
    ).toBe(true);
  });

  it('blocks 20× on a brand-new strategy (tier 0)', () => {
    const decision = checkStrategyLeverageCap(
      { ...btcOrder, leverage: 20 },
      unprovenStrategy,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('strategy_leverage_cap');
  });

  it(`falls back to ${DEFAULT_UNPROVEN_LEVERAGE_CAP}× for unrecognised tiers`, () => {
    const decision = checkStrategyLeverageCap(
      { ...btcOrder, leverage: 10 },
      { liveTier: 99 },
    );
    expect(decision.allowed).toBe(false);
  });
});

describe('checkSymbolAllowedAtEquity', () => {
  it('allows BTC at any equity level', () => {
    const state = { ...emptyAccount, equityUsdt: 5 };
    expect(checkSymbolAllowedAtEquity(btcOrder, state).allowed).toBe(true);
  });

  it(`blocks non-BTC symbols when equity < $${MIN_EQUITY_FOR_ETH_USDT}`, () => {
    const ethOrder: KernelOrder = { ...btcOrder, symbol: 'ETH-USDT' };
    const state = { ...emptyAccount, equityUsdt: 27.15 };
    const decision = checkSymbolAllowedAtEquity(ethOrder, state);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('symbol_not_allowed_at_equity');
  });

  it('allows ETH once equity clears the threshold', () => {
    const ethOrder: KernelOrder = { ...btcOrder, symbol: 'ETH-USDT' };
    const state = { ...emptyAccount, equityUsdt: 150 };
    expect(checkSymbolAllowedAtEquity(ethOrder, state).allowed).toBe(true);
  });

  it('recognises common BTC symbol aliases', () => {
    const state = { ...emptyAccount, equityUsdt: 10 };
    for (const alias of ['BTC-USDT', 'BTCUSDT', 'BTC_USDT', 'BTC-USDT-PERP']) {
      expect(checkSymbolAllowedAtEquity({ ...btcOrder, symbol: alias }, state).allowed).toBe(true);
    }
  });
});

describe('evaluatePreTradeVetoes composition', () => {
  it('passes a clean order', () => {
    expect(evaluatePreTradeVetoes(btcOrder, emptyAccount, provenStrategy).allowed).toBe(true);
  });

  it('surfaces the unrealised-drawdown veto before any other', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      unrealizedPnlUsdt: -20,
      // Also has a self-match opportunity AND exposure breach, but
      // drawdown kill-switch fires first per documented priority.
      openPositions: [{ symbol: 'BTC-USDT', side: 'long', notional: 500 }],
      restingOrders: [{ symbol: 'BTC-USDT', side: 'sell', price: 69_000 }],
    };
    const decision = evaluatePreTradeVetoes(
      { ...btcOrder, side: 'buy' },
      state,
      provenStrategy,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('unrealized_drawdown_kill_switch');
  });

  it('falls through to leverage cap when earlier checks pass', () => {
    const decision = evaluatePreTradeVetoes(
      { ...btcOrder, leverage: 20 },
      emptyAccount,
      unprovenStrategy,
    );
    expect(decision.code).toBe('strategy_leverage_cap');
  });
});
