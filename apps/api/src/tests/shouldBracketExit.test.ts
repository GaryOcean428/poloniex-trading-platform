/**
 * Tests for shouldBracketExit — the Phase B2 mechanical synthetic-bracket
 * exit gate. Given a committed TP/SL bracket and the live mark price,
 * the gate fires when price has crossed a level. No discretion.
 */

import { describe, it, expect } from 'vitest';
import { shouldBracketExit } from '../services/monkey/executive.js';

describe('shouldBracketExit — no bracket', () => {
  it('both levels null → no_bracket, value false', () => {
    const r = shouldBracketExit(100, 'long', null, null);
    expect(r.value).toBe(false);
    expect(r.reason).toBe('no_bracket');
  });
});

describe('shouldBracketExit — LONG (TP above, SL below)', () => {
  // entry ~100, TP 110, SL 95
  it('fires bracket_tp when mark ≥ TP', () => {
    const r = shouldBracketExit(110, 'long', 110, 95);
    expect(r.value).toBe(true);
    expect(r.reason).toContain('bracket_tp');
    expect(r.derivation.exitTypeBit).toBe(11);
  });

  it('fires bracket_tp when mark above TP', () => {
    expect(shouldBracketExit(112, 'long', 110, 95).value).toBe(true);
  });

  it('fires bracket_sl when mark ≤ SL', () => {
    const r = shouldBracketExit(95, 'long', 110, 95);
    expect(r.value).toBe(true);
    expect(r.reason).toContain('bracket_sl');
    expect(r.derivation.exitTypeBit).toBe(12);
  });

  it('does NOT fire while mark is inside the bracket', () => {
    const r = shouldBracketExit(102, 'long', 110, 95);
    expect(r.value).toBe(false);
    expect(r.reason).toBe('within_bracket');
  });
});

describe('shouldBracketExit — SHORT (TP below, SL above)', () => {
  // entry ~100, TP 90, SL 105
  it('fires bracket_tp when mark ≤ TP', () => {
    const r = shouldBracketExit(90, 'short', 90, 105);
    expect(r.value).toBe(true);
    expect(r.reason).toContain('bracket_tp');
    expect(r.derivation.exitTypeBit).toBe(11);
  });

  it('fires bracket_sl when mark ≥ SL', () => {
    const r = shouldBracketExit(105, 'short', 90, 105);
    expect(r.value).toBe(true);
    expect(r.reason).toContain('bracket_sl');
    expect(r.derivation.exitTypeBit).toBe(12);
  });

  it('does NOT fire while mark is inside the bracket', () => {
    const r = shouldBracketExit(98, 'short', 90, 105);
    expect(r.value).toBe(false);
    expect(r.reason).toBe('within_bracket');
  });
});

describe('shouldBracketExit — partial bracket (one level null)', () => {
  it('TP-only LONG: fires on TP, ignores missing SL', () => {
    expect(shouldBracketExit(110, 'long', 110, null).value).toBe(true);
    expect(shouldBracketExit(50, 'long', 110, null).value).toBe(false);
  });

  it('SL-only LONG: fires on SL, ignores missing TP', () => {
    expect(shouldBracketExit(95, 'long', null, 95).value).toBe(true);
    expect(shouldBracketExit(200, 'long', null, 95).value).toBe(false);
  });

  it('SL-only SHORT: fires on SL', () => {
    expect(shouldBracketExit(105, 'short', null, 105).value).toBe(true);
  });
});

describe('shouldBracketExit — TP takes precedence when both crossed', () => {
  it('LONG: degenerate bracket where mark satisfies both → TP wins', () => {
    // TP 100, SL 100, mark 100 — TP checked first.
    const r = shouldBracketExit(100, 'long', 100, 100);
    expect(r.value).toBe(true);
    expect(r.reason).toContain('bracket_tp');
  });
});
