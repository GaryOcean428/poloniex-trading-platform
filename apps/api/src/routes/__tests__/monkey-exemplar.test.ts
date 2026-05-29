/**
 * monkey-exemplar.test.ts — semantics of the exemplar decision normalizer
 * (#1033 PR1). Pins the key teaching rule: ABSTAIN is a first-class, deliberate
 * flat (side=null, is_abstain=true) — distinguishable from absence — and bad
 * input is rejected.
 */
import { describe, expect, it } from 'vitest';
import { normalizeExemplarDecision } from '../monkey-exemplar.js';

describe('normalizeExemplarDecision', () => {
  it('treats abstain as a first-class deliberate flat (side null, is_abstain true)', () => {
    const r = normalizeExemplarDecision({ action: 'abstain', symbol: 'BTC_USDT_PERP', side: 'short', regime: 'chop', reasoning: 'low-vol grind, no 8R' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toBe('abstain');
    expect(r.value.isAbstain).toBe(true);
    expect(r.value.side).toBeNull(); // abstain forces side null even if one was sent
    expect(r.value.regime).toBe('chop');
  });

  it('keeps side on a directional entry and flags is_abstain false', () => {
    const r = normalizeExemplarDecision({ action: 'enter', side: 'SHORT', conviction: 0.7, price: '73276.77' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toBe('enter');
    expect(r.value.isAbstain).toBe(false);
    expect(r.value.side).toBe('short');
    expect(r.value.conviction).toBe(0.7);
    expect(r.value.price).toBeCloseTo(73276.77, 2);
  });

  it('rejects an invalid action', () => {
    const r = normalizeExemplarDecision({ action: 'yolo' });
    expect(r.ok).toBe(false);
  });

  it('coerces non-finite numerics to null and defaults source', () => {
    const r = normalizeExemplarDecision({ action: 'hold', conviction: 'NaN', price: undefined });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.conviction).toBeNull();
    expect(r.value.price).toBeNull();
    expect(r.value.source).toBe('cc_bootstrap');
  });

  it('coerces an unknown side to null on non-abstain', () => {
    const r = normalizeExemplarDecision({ action: 'enter', side: 'sideways' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.side).toBeNull();
  });
});
