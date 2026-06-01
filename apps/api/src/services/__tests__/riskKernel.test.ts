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
  checkMarginHeadroom,
  checkPerSymbolExposure,
  checkSelfMatch,
  checkSymbolMaxLeverage,
  checkUnrealizedDrawdown,
  evaluatePreTradeVetoes,
  explicitMinMarginHeadroomPct,
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
  it(`allows an order when total notional stays under the ${PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER}× cap`, () => {
    // equity 100 × 5 = 500 cap; 100 + 10 = 110 ≪ 500 → allowed
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'BTC_USDT_PERP', side: 'long', notional: 100 }],
    };
    expect(checkPerSymbolExposure({ ...btcOrder, notional: 10 }, state).allowed).toBe(true);
  });

  it('2026-05-25 strip — no longer blocks over the prior 5× cap; exchange enforces structural cap', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [{ symbol: 'BTC_USDT_PERP', side: 'long', notional: 495 }],
    };
    const decision = checkPerSymbolExposure({ ...btcOrder, notional: 10 }, state);
    expect(decision.allowed).toBe(true);
  });

  it('2026-05-25 strip — same-symbol long+short exposure no longer summed and capped', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      equityUsdt: 100,
      openPositions: [
        { symbol: 'BTC_USDT_PERP', side: 'long', notional: 300 },
        { symbol: 'BTC_USDT_PERP', side: 'short', notional: 200 },
      ],
    };
    expect(checkPerSymbolExposure({ ...btcOrder, notional: 20 }, state).allowed).toBe(true);
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

  it('2026-05-25 strip — no longer blocks at -15% drawdown; chemistry learns from losses', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      unrealizedPnlUsdt: -16,
    };
    const decision = checkUnrealizedDrawdown(state);
    expect(decision.allowed).toBe(true);
  });

  it('handles zero equity gracefully', () => {
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 0 };
    expect(checkUnrealizedDrawdown(state).allowed).toBe(true);
  });

  it('threshold constant is -Infinity sentinel (auto-kill stripped)', () => {
    expect(UNREALIZED_DRAWDOWN_KILL_THRESHOLD).toBe(Number.NEGATIVE_INFINITY);
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

  // 2026-06-01 — paper_only MANDATE. The caller (loop.ts) MUST set
  // context.isLive = !shouldRouteOrdersToPaper() (the order's REAL routing),
  // NOT `mode === 'auto'`. The prior circular wiring made isLive always
  // false under paper_only, so this veto never fired and the kernel kept
  // opening LIVE positions while the operator's UI said paper.
  it('blocks a LIVE order under paper_only (operator MANDATE)', () => {
    const livePaperOnly: KernelContext = { isLive: true, mode: 'paper_only', symbolMaxLeverage: BTC_MAX_LEV };
    const decision = evaluatePreTradeVetoes(btcOrder, emptyAccount, livePaperOnly);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('execution_mode_paper_only_blocks_live');
  });

  it('passes a PAPER-routed order under paper_only (paper continues)', () => {
    const paperPaperOnly: KernelContext = { isLive: false, mode: 'paper_only', symbolMaxLeverage: BTC_MAX_LEV };
    expect(evaluatePreTradeVetoes(btcOrder, emptyAccount, paperPaperOnly).allowed).toBe(true);
  });

  it('passes a clean short order', () => {
    expect(
      evaluatePreTradeVetoes({ ...btcOrder, side: 'short' }, emptyAccount, autoContext).allowed,
    ).toBe(true);
  });

  it('2026-05-25 strip — unrealised-drawdown veto removed; -20% PnL no longer halts entries', () => {
    const state: KernelAccountState = {
      ...emptyAccount,
      unrealizedPnlUsdt: -20,
      openPositions: [{ symbol: 'BTC_USDT_PERP', side: 'long', notional: 500 }],
      restingOrders: [{ symbol: 'BTC_USDT_PERP', side: 'sell', price: 69_000 }],
    };
    const decision = evaluatePreTradeVetoes({ ...btcOrder, side: 'buy' }, state, autoContext);
    // Drawdown auto-kill stripped; only manual execution-mode pause halts.
    // Self-match check still applies here — sell at 69k vs buy → veto.
    expect(decision.code).not.toBe('unrealized_drawdown_kill_switch');
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

describe('checkMarginHeadroom (v0.8.8)', () => {
  it('disabled by default — pct=0 → no-op, allowed', () => {
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 99 };
    expect(checkMarginHeadroom(btcOrder, state, 0).allowed).toBe(true);
  });

  it('zero equity passes the divide-guard', () => {
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 0, usedMarginUsdt: 0 };
    expect(checkMarginHeadroom(btcOrder, state, 0.25).allowed).toBe(true);
  });

  it('exactly at reserve passes', () => {
    // equity=100, used=70, new_margin=50/10=5 → projected=75 → 25% free → at threshold
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 70 };
    const order: KernelOrder = { ...btcOrder, notional: 50, leverage: 10 };
    expect(checkMarginHeadroom(order, state, 0.25).allowed).toBe(true);
  });

  it('one-dollar below reserve blocks', () => {
    // equity=100, used=70, new_margin=60/10=6 → projected=76 → 24% free < 25%
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 70 };
    const order: KernelOrder = { ...btcOrder, notional: 60, leverage: 10 };
    const r = checkMarginHeadroom(order, state, 0.25);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('margin_headroom');
  });

  it('high leverage / low margin commit passes within reserve', () => {
    // equity=100, used=50, new_margin=200/20=10 → projected=60 → 40% free
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 50 };
    const order: KernelOrder = { ...btcOrder, notional: 200, leverage: 20 };
    expect(checkMarginHeadroom(order, state, 0.25).allowed).toBe(true);
  });

  it('used alone past reserve blocks even tiny new entry', () => {
    // equity=100, used=80 (already 20% free) → any new entry pushes below 25%
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 80 };
    const order: KernelOrder = { ...btcOrder, notional: 10, leverage: 10 };
    expect(checkMarginHeadroom(order, state, 0.25).allowed).toBe(false);
  });

  it('back-compat — usedMarginUsdt undefined treats as 0', () => {
    // No usedMarginUsdt field. equity=100, new_margin=50/10=5 → projected=5 → 95% free
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100 };
    const order: KernelOrder = { ...btcOrder, notional: 50, leverage: 10 };
    expect(checkMarginHeadroom(order, state, 0.25).allowed).toBe(true);
  });

  it('out-of-range env value fails OPEN (no veto)', () => {
    // pct=1.5 (>1) → veto disabled, allowed
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 99 };
    expect(checkMarginHeadroom(btcOrder, state, 1.5).allowed).toBe(true);
  });
});

describe('2026-05-25 strip — margin_headroom veto neutralised', () => {
  // Pre-strip: env var + mode-conditional table enforced a margin reserve
  // (15-50% depending on mode). Post-strip: both the env var and the
  // mode table return null/0. Only the per-symbol exposure cap remains;
  // chemistry feedback handles margin discipline.
  it('2026-05-25 strip — per-symbol exposure cap no longer fires (also stripped)', () => {
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 50 };
    const order: KernelOrder = { ...btcOrder, notional: 600, leverage: 10 };
    const r = evaluatePreTradeVetoes(order, state, autoContext);
    expect(r.allowed).toBe(true);
  });

  it('headroom no longer blocks even when reserve would have been < 25% pre-strip', () => {
    // used=70, new_margin=20 → projected=90 → 10% free. Pre-strip with
    // 25% reserve this blocked; post-strip the headroom veto is gone.
    const state: KernelAccountState = { ...emptyAccount, equityUsdt: 100, usedMarginUsdt: 70 };
    const order: KernelOrder = { ...btcOrder, notional: 200, leverage: 10 };
    const r = evaluatePreTradeVetoes(order, state, autoContext);
    expect(r.allowed).toBe(true);
  });

  it('explicitMinMarginHeadroomPct always returns null (env read stripped)', () => {
    process.env.MONKEY_MIN_MARGIN_HEADROOM_PCT = '0.15';
    try {
      expect(explicitMinMarginHeadroomPct()).toBeNull();
    } finally {
      delete process.env.MONKEY_MIN_MARGIN_HEADROOM_PCT;
    }
  });
});
