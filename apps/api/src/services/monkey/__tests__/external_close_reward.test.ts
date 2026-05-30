/**
 * external_close_reward.test.ts — money-path policy tests for the
 * "operator-close hole" reward decision (#1033).
 *
 * The reconciler does the DB/Polo I/O + bus publish; the testable policy
 * lives in `decideExternalCloseReward`. External (CC/operator) closes always
 * feed the kernel's reward chemistry — it is CANONICAL, not gated. These tests
 * pin the required behaviours from the spec:
 *
 *   1. External close + agent + authoritative bills magnitude → fires exactly
 *      one reward with the correct (bills) magnitude.
 *   2. A kernel-own close (ghostReason='reconciled_post_close_race') is NOT
 *      double-rewarded — it is declined regardless of magnitude.
 *   3. Authoritative-only magnitude: no PNL bill rows → declined
 *      (`no_bills_pnl`) rather than rewarding a guessed value.
 *
 * The reward magnitude fed downstream is the bills-authoritative realized
 * PnL (the SAME `/v3/account/bills` type=PNL surface the kernel's own close
 * path consumes), NOT the lossy ±90s position-history match.
 */
import { describe, expect, it } from 'vitest';
import { decideExternalCloseReward } from '../polo_reward_ledger.js';

describe('decideExternalCloseReward (operator-close hole #1033)', () => {
  // ── Happy path: external close + agent + authoritative magnitude ───────────
  it('fires exactly one reward with the bills-authoritative magnitude + real margin', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
      marginUsdt: 12.5,
    });
    expect(out.eligible).toBe(true);
    if (out.eligible) {
      // The magnitude is the bills realized PnL, not a synthetic/history value.
      expect(out.realizedPnl).toBeCloseTo(-4.2499, 6);
      // The scale is the REAL position margin, not the retired synthetic 5.
      expect(out.marginUsdt).toBeCloseTo(12.5, 6);
      expect(out.pnlSource).toBe('polo_bills_external_close');
    }
  });

  it('fires for a positive (winning) external/CC exemplar close', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: 'M',
      billsRealizedPnl: 3.14,
      pnlBillRowCount: 2,
      marginUsdt: 8.0,
    });
    expect(out.eligible).toBe(true);
    if (out.eligible) expect(out.realizedPnl).toBeCloseTo(3.14, 6);
  });

  // ── Guard 5 (the reviewed knob fix): REAL margin scaling, not /5 ──────────
  it('carries the REAL position margin so pnl_fraction = pnl / actual_margin (not /5)', () => {
    // A small position: $0.50 margin (e.g. $8 notional at 16×). The retired
    // knob would have scaled this loss by /5 (pnl_fraction = -0.50/5 = -0.10),
    // hugely understating the lesson. With the real margin the fraction is
    // -0.50/0.50 = -1.0 — the position lost a full margin's worth.
    const realizedPnl = -0.50;
    const realMargin = 0.50;
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: realizedPnl,
      pnlBillRowCount: 4,
      marginUsdt: realMargin,
    });
    expect(out.eligible).toBe(true);
    if (out.eligible) {
      const realFraction = out.realizedPnl / out.marginUsdt;
      const syntheticFraction = out.realizedPnl / 5;
      expect(realFraction).toBeCloseTo(-1.0, 6);
      expect(syntheticFraction).toBeCloseTo(-0.10, 6);
      // The real lesson is 10× the magnitude the synthetic /5 knob taught.
      expect(Math.abs(realFraction)).toBeGreaterThan(Math.abs(syntheticFraction));
    }
  });

  // ── Guard 5: decline when the real margin is unavailable (decline-over-guess) ─
  it.each([
    ['null margin', null],
    ['zero margin', 0],
    ['negative margin', -3.2],
    ['NaN margin', Number.NaN],
    ['Infinity margin', Number.POSITIVE_INFINITY],
  ] as Array<[string, number | null]>)(
    'declines (no_real_margin) when margin is unavailable: %s',
    (_label, margin) => {
      const out = decideExternalCloseReward({
        ghostReason: 'manual_close_user',
        agent: 'K',
        billsRealizedPnl: -4.2499,
        pnlBillRowCount: 8,
        marginUsdt: margin,
      });
      expect(out.eligible).toBe(false);
      if (!out.eligible) expect(out.reason).toBe('no_real_margin');
    },
  );

  // ── Guard 1: NO double-count vs the kernel's own close path ───────────────
  it('declines a kernel-own late-landing close (reconciled_post_close_race)', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'reconciled_post_close_race',
      agent: 'K',
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
      marginUsdt: 12.5,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('not_external_close');
  });

  it('declines any non-external ghost reason', () => {
    for (const reason of ['reconciled', 'kernel_adopted', 'unknown', '']) {
      const out = decideExternalCloseReward({
        ghostReason: reason,
        agent: 'T',
        billsRealizedPnl: -1.0,
        pnlBillRowCount: 3,
        marginUsdt: 5.0,
      });
      expect(out.eligible).toBe(false);
      if (!out.eligible) expect(out.reason).toBe('not_external_close');
    }
  });

  // ── Guard 4: must attribute to an agent's chemistry ───────────────────────
  it('declines an unattributed (null-agent) external close', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: null,
      billsRealizedPnl: -2.0,
      pnlBillRowCount: 4,
      marginUsdt: 5.0,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('no_agent');
  });

  // ── Guard 3: authoritative-only magnitude ─────────────────────────────────
  it('declines when no PNL bill rows matched (no_bills_pnl) — never guesses', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: 0,
      pnlBillRowCount: 0,
      marginUsdt: 5.0,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('no_bills_pnl');
  });

  it('declines a non-finite magnitude (defensive)', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: 'L',
      billsRealizedPnl: Number.NaN,
      pnlBillRowCount: 2,
      marginUsdt: 5.0,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('non_finite_pnl');
  });

  // Guard ordering: pnl is checked before margin, so a non-finite pnl AND a
  // bad margin reports the pnl reason (the lesson is undefined either way).
  it('reports non_finite_pnl before no_real_margin when both are bad', () => {
    const out = decideExternalCloseReward({
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: Number.NaN,
      pnlBillRowCount: 2,
      marginUsdt: null,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('non_finite_pnl');
  });

  // ── Dedup intent: the decision is a pure function of its inputs, so a
  // second identical call yields the same eligibility. The reconciler's
  // status='open' UPDATE guard ensures the PUBLISH happens at most once per
  // row; this pins that the policy itself is deterministic (no hidden state
  // that could let a second tick re-reward).
  it('is a pure deterministic decision (same inputs → same output)', () => {
    const input = {
      ghostReason: 'manual_close_user',
      agent: 'K' as const,
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
      marginUsdt: 12.5,
    };
    const a = decideExternalCloseReward(input);
    const b = decideExternalCloseReward(input);
    expect(a).toEqual(b);
  });
});
