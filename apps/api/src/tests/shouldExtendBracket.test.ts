/**
 * Tests for shouldExtendBracket — the Phase C bracket-revision decision.
 * Both edits must be strictly monotonic in the position's favour: TP
 * only ever moves further out, SL only ever trails toward profit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldExtendBracket } from '../services/monkey/executive.js';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { delete process.env.MONKEY_BRACKET_EXTEND_CONV; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('shouldExtendBracket — TP extension (LONG)', () => {
  // entry 100, currentTp 110, in profit, high conviction
  it('extends TP outward when fresh distance projects further', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5, // fresh TP → 120 > 110
      conviction: 0.8, currentRoiFrac: 0.08,
    });
    expect(r.changed).toBe(true);
    expect(r.newTp).toBeCloseTo(120, 6);
  });

  it('does NOT pull TP in when fresh distance is shorter', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 5, // fresh TP → 105 < 110
      conviction: 0.8, currentRoiFrac: 0.08,
    });
    expect(r.newTp).toBeNull();
  });

  it('does NOT extend TP below the conviction threshold', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.3, currentRoiFrac: 0.08, // conv < 0.5 default
    });
    expect(r.newTp).toBeNull();
  });

  it('does NOT extend TP on a losing position', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 96,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.9, currentRoiFrac: -0.04, // red
    });
    expect(r.newTp).toBeNull();
    expect(r.newSl).toBeNull();
    expect(r.changed).toBe(false);
  });
});

describe('shouldExtendBracket — SL trail (LONG)', () => {
  it('trails SL up toward profit (ratchets favourable only)', () => {
    // mark 108, freshSlDistance 5 → candidate 103 > currentSl 95
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 5,
      conviction: 0.1, currentRoiFrac: 0.08, // low conv → only SL moves
    });
    expect(r.newSl).toBeCloseTo(103, 6);
    expect(r.newTp).toBeNull(); // low conviction blocks TP
  });

  it('does NOT widen SL (candidate worse than current)', () => {
    // mark 102, freshSlDistance 20 → candidate 82 < currentSl 95 → reject
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 102,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 20,
      conviction: 0.1, currentRoiFrac: 0.02,
    });
    expect(r.newSl).toBeNull();
  });
});

describe('shouldExtendBracket — SHORT mirror', () => {
  it('extends TP downward (further from entry) for a short', () => {
    // entry 100, currentTp 90, freshTpDistance 20 → 80 < 90 → extend
    const r = shouldExtendBracket({
      heldSide: 'short', entryPrice: 100, markPrice: 92,
      currentTp: 90, currentSl: 105,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.8, currentRoiFrac: 0.08,
    });
    expect(r.newTp).toBeCloseTo(80, 6);
  });

  it('trails SL down toward profit for a short', () => {
    // mark 92, freshSlDistance 5 → candidate 97 < currentSl 105 → trail
    const r = shouldExtendBracket({
      heldSide: 'short', entryPrice: 100, markPrice: 92,
      currentTp: 90, currentSl: 105,
      freshTpDistance: 5, freshSlDistance: 5,
      conviction: 0.1, currentRoiFrac: 0.08,
    });
    expect(r.newSl).toBeCloseTo(97, 6);
  });
});

describe('shouldExtendBracket — env override + edge cases', () => {
  it('honours MONKEY_BRACKET_EXTEND_CONV', () => {
    process.env.MONKEY_BRACKET_EXTEND_CONV = '0.9';
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.8, currentRoiFrac: 0.08, // 0.8 < 0.9 → no TP
    });
    expect(r.newTp).toBeNull();
  });

  it('null currentTp → no TP extension attempted', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: null, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.9, currentRoiFrac: 0.08,
    });
    expect(r.newTp).toBeNull();
    expect(r.newSl).not.toBeNull(); // SL side still trails
  });

  it('no favourable revision → changed false, bracket_hold reason', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 96,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 5,
      conviction: 0.9, currentRoiFrac: -0.04,
    });
    expect(r.changed).toBe(false);
    expect(r.reason).toContain('bracket_hold');
  });
});
