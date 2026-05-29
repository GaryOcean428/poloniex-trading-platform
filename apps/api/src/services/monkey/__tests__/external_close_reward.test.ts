/**
 * external_close_reward.test.ts — money-path policy tests for the
 * "operator-close hole" reward decision (#1033).
 *
 * The reconciler does the DB/Polo I/O + bus publish; the testable policy
 * lives in `decideExternalCloseReward`. These tests pin the four required
 * behaviours from the spec:
 *
 *   1. Flag ON + external close + agent + authoritative bills magnitude
 *      → fires exactly one reward with the correct (bills) magnitude.
 *   2. A kernel-own close (ghostReason='reconciled_post_close_race') is NOT
 *      double-rewarded — it is declined regardless of flag/magnitude.
 *   3. Flag OFF → declined (`flag_off`) → byte-identical to today
 *      (bookkeeping-only; no reward).
 *   4. Authoritative-only magnitude: no PNL bill rows → declined
 *      (`no_bills_pnl`) rather than rewarding a guessed value.
 *
 * The reward magnitude fed downstream is the bills-authoritative realized
 * PnL (the SAME `/v3/account/bills` type=PNL surface the kernel's own close
 * path consumes), NOT the lossy ±90s position-history match.
 */
import { describe, expect, it } from 'vitest';
import { decideExternalCloseReward } from '../polo_reward_ledger.js';

describe('decideExternalCloseReward (operator-close hole #1033)', () => {
  // ── Guard 3: flag OFF → byte-identical to today (regression pin) ──────────
  it('declines when the flag is OFF (flag_off) regardless of inputs', () => {
    const out = decideExternalCloseReward({
      enabled: false,
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('flag_off');
  });

  // ── Happy path: flag ON + external close + agent + authoritative magnitude ─
  it('fires exactly one reward with the bills-authoritative magnitude', () => {
    const out = decideExternalCloseReward({
      enabled: true,
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
    });
    expect(out.eligible).toBe(true);
    if (out.eligible) {
      // The magnitude is the bills realized PnL, not a synthetic/history value.
      expect(out.realizedPnl).toBeCloseTo(-4.2499, 6);
      expect(out.pnlSource).toBe('polo_bills_external_close');
    }
  });

  it('fires for a positive (winning) external/CC exemplar close', () => {
    const out = decideExternalCloseReward({
      enabled: true,
      ghostReason: 'manual_close_user',
      agent: 'M',
      billsRealizedPnl: 3.14,
      pnlBillRowCount: 2,
    });
    expect(out.eligible).toBe(true);
    if (out.eligible) expect(out.realizedPnl).toBeCloseTo(3.14, 6);
  });

  // ── Guard 1: NO double-count vs the kernel's own close path ───────────────
  it('declines a kernel-own late-landing close (reconciled_post_close_race)', () => {
    const out = decideExternalCloseReward({
      enabled: true,
      ghostReason: 'reconciled_post_close_race',
      agent: 'K',
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('not_external_close');
  });

  it('declines any non-external ghost reason', () => {
    for (const reason of ['reconciled', 'kernel_adopted', 'unknown', '']) {
      const out = decideExternalCloseReward({
        enabled: true,
        ghostReason: reason,
        agent: 'T',
        billsRealizedPnl: -1.0,
        pnlBillRowCount: 3,
      });
      expect(out.eligible).toBe(false);
      if (!out.eligible) expect(out.reason).toBe('not_external_close');
    }
  });

  // ── Guard 4: must attribute to an agent's chemistry ───────────────────────
  it('declines an unattributed (null-agent) external close', () => {
    const out = decideExternalCloseReward({
      enabled: true,
      ghostReason: 'manual_close_user',
      agent: null,
      billsRealizedPnl: -2.0,
      pnlBillRowCount: 4,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('no_agent');
  });

  // ── Guard 3: authoritative-only magnitude ─────────────────────────────────
  it('declines when no PNL bill rows matched (no_bills_pnl) — never guesses', () => {
    const out = decideExternalCloseReward({
      enabled: true,
      ghostReason: 'manual_close_user',
      agent: 'K',
      billsRealizedPnl: 0,
      pnlBillRowCount: 0,
    });
    expect(out.eligible).toBe(false);
    if (!out.eligible) expect(out.reason).toBe('no_bills_pnl');
  });

  it('declines a non-finite magnitude (defensive)', () => {
    const out = decideExternalCloseReward({
      enabled: true,
      ghostReason: 'manual_close_user',
      agent: 'L',
      billsRealizedPnl: Number.NaN,
      pnlBillRowCount: 2,
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
      enabled: true,
      ghostReason: 'manual_close_user',
      agent: 'K' as const,
      billsRealizedPnl: -4.2499,
      pnlBillRowCount: 8,
    };
    const a = decideExternalCloseReward(input);
    const b = decideExternalCloseReward(input);
    expect(a).toEqual(b);
  });
});
