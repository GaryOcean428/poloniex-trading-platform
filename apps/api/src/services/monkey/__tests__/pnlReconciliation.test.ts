/**
 * pnlReconciliation.test.ts — pin the row-level pnl divergence guard
 * that catches phantom values within one tick (#932).
 *
 * Companion to safePnlSql.test.ts. The SAFE_PNL_FROM_ROW SQL fragment
 * is the primary fix (#931) — it makes the formula correct at the DB
 * boundary. This module is the safety net: if any future code path
 * regresses and writes a phantom, reconcilePnl flags it immediately.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { reconcilePnl, safePnlForChemistry } from '../pnlReconciliation.js';

const baseInput = {
  rowId: 'test-row-1',
  symbol: 'BTC_USDT_PERP',
  exitReason: 'scalp_exit',
};

describe('reconcilePnl — divergence detection', () => {
  it('clean within-tolerance write is not flagged', () => {
    const r = reconcilePnl({
      ...baseInput,
      writtenPnl: 5.0,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 0.5,
      side: 'long',
    });
    expect(r.diverged).toBe(false);
    expect(r.isPhantomCandidate).toBe(false);
    expect(r.calculatedPnl).toBeCloseTo(5.0, 6);
    expect(r.divergenceAbs).toBeCloseTo(0, 6);
  });

  it('small drift > $0.50 flags diverged but not phantom', () => {
    const r = reconcilePnl({
      ...baseInput,
      writtenPnl: 5.6,  // calc = 5.0; drift = $0.6
      entryPrice: 100,
      exitPrice: 110,
      quantity: 0.5,
      side: 'long',
    });
    expect(r.diverged).toBe(true);
    expect(r.isPhantomCandidate).toBe(false);
  });

  it('phantom-class divergence (> $5) flags both', () => {
    // Reproduce #931 phantom 1: BTC buy 0.018 @ 77584.55 → 77527.12
    const r = reconcilePnl({
      ...baseInput,
      writtenPnl: 315.21,  // The recorded phantom value
      entryPrice: 77584.55,
      exitPrice: 77527.12,
      quantity: 0.018,
      side: 'buy',
    });
    expect(r.diverged).toBe(true);
    expect(r.isPhantomCandidate).toBe(true);
    expect(r.calculatedPnl).toBeCloseTo(-1.034, 3);
    expect(r.divergenceAbs).toBeCloseTo(316.24, 1);
  });

  it('detects sign flip even when magnitude is similar', () => {
    // Same magnitude, opposite sign — still a phantom because the
    // chemistry consumer treats sign as load-bearing.
    const r = reconcilePnl({
      ...baseInput,
      writtenPnl: +6,
      entryPrice: 100,
      exitPrice: 90,
      quantity: 0.6,
      side: 'long',  // calc = -6
    });
    expect(r.isPhantomCandidate).toBe(true);
    expect(r.divergenceAbs).toBeCloseTo(12, 6);
  });

  it('handles short side correctly', () => {
    const r = reconcilePnl({
      ...baseInput,
      writtenPnl: 5.0,
      entryPrice: 110,
      exitPrice: 100,
      quantity: 0.5,
      side: 'short',  // calc = 5 (short profits on price drop)
    });
    expect(r.diverged).toBe(false);
  });
});

describe('safePnlForChemistry — defense in depth', () => {
  it('returns written value when no phantom', () => {
    const v = safePnlForChemistry({
      ...baseInput,
      writtenPnl: 5.6,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 0.5,
      side: 'long',  // calc = 5.0; drift = 0.6
    });
    expect(v).toBeCloseTo(5.6, 6);  // small drift accepted
  });

  it('returns calculated value when phantom detected', () => {
    // Simulates the scenario: future bug writes phantom +$315 to DB,
    // but chemistry still receives the safe -$1.03.
    const v = safePnlForChemistry({
      ...baseInput,
      writtenPnl: 315.21,
      entryPrice: 77584.55,
      exitPrice: 77527.12,
      quantity: 0.018,
      side: 'buy',
    });
    expect(v).toBeCloseTo(-1.034, 3);  // calculated, not written
  });

  it('returns calculated for both production phantoms', () => {
    const p1 = safePnlForChemistry({
      ...baseInput,
      writtenPnl: 374.12,
      entryPrice: 76799.97,
      exitPrice: 76802.55,
      quantity: 0.001,
      side: 'buy',
    });
    expect(p1).toBeCloseTo(0.00258, 5);

    const p2 = safePnlForChemistry({
      ...baseInput,
      writtenPnl: 315.21,
      entryPrice: 77584.55,
      exitPrice: 77527.12,
      quantity: 0.018,
      side: 'buy',
    });
    expect(p2).toBeCloseTo(-1.034, 3);
  });
});

describe('reconcilePnl — logging side effects', () => {
  let errorSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { logger } = await import('../../../utils/logger.js');
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined) as unknown as ReturnType<typeof vi.fn>;
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('phantom triggers ERROR-level log with full context', () => {
    reconcilePnl({
      ...baseInput,
      writtenPnl: 315.21,
      entryPrice: 77584.55,
      exitPrice: 77527.12,
      quantity: 0.018,
      side: 'buy',
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    const call = errorSpy.mock.calls[0]!;
    expect(call[0]).toBe('[pnl_reconciliation] PHANTOM detected');
    const payload = call[1] as Record<string, unknown>;
    expect(payload.writtenPnl).toBe(315.21);
    expect(payload.calculatedPnl).toBeCloseTo(-1.034, 3);
    expect(payload.symbol).toBe('BTC_USDT_PERP');
  });

  it('drift triggers WARN-level log (not ERROR)', () => {
    reconcilePnl({
      ...baseInput,
      writtenPnl: 5.6,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 0.5,
      side: 'long',
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('clean writes produce no logs', () => {
    reconcilePnl({
      ...baseInput,
      writtenPnl: 5.0,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 0.5,
      side: 'long',
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
