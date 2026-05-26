/**
 * Tests for shouldExtendBracket — the Phase C bracket-revision decision.
 * Both edits must be strictly monotonic in the position's favour: TP
 * only ever moves further out, SL only ever trails toward profit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldExtendBracket } from '../services/monkey/executive.js';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  delete process.env.MONKEY_BRACKET_EXTEND_CONV;
  delete process.env.MONKEY_BRACKET_TRAIL_MIN_ROI;
  delete process.env.MONKEY_BRACKET_TRAIL_MIN_PROFIT_USDT;
});
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('shouldExtendBracket — TP extension (LONG)', () => {
  // entry 100, currentTp 110, in profit, high conviction
  it('extends TP outward when fresh distance projects further', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5, // fresh TP → 120 > 110
      conviction: 0.8, currentRoiFrac: 0.08, currentPnlUsdt: 0,
    });
    expect(r.changed).toBe(true);
    expect(r.newTp).toBeCloseTo(120, 6);
  });

  it('does NOT pull TP in when fresh distance is shorter', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 5, // fresh TP → 105 < 110
      conviction: 0.8, currentRoiFrac: 0.08, currentPnlUsdt: 0,
    });
    expect(r.newTp).toBeNull();
  });

  it('Phase 4 (2026-05-26) — extends TP on ANY positive conviction (threshold removed)', () => {
    // Pre-Phase-4: conviction 0.3 < 0.5 default → no extension.
    // Post-Phase-4: convThreshold = 0; kernel extends on any positive
    // conviction. Chemistry learns via push_reward whether aggressive
    // extension protects or over-tightens.
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.3, currentRoiFrac: 0.08, currentPnlUsdt: 0,
    });
    expect(r.newTp).toBe(120);  // entry 100 + freshTpDistance 20
  });

  it('does NOT extend TP on a losing position', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 96,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.9, currentRoiFrac: -0.04, currentPnlUsdt: -0.4, // red
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
      conviction: 0.1, currentRoiFrac: 0.08, currentPnlUsdt: 1, // low conv → only SL moves
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
      conviction: 0.1, currentRoiFrac: 0.02, currentPnlUsdt: 1,
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
      conviction: 0.8, currentRoiFrac: 0.08, currentPnlUsdt: 0,
    });
    expect(r.newTp).toBeCloseTo(80, 6);
  });

  it('trails SL down toward profit for a short', () => {
    // mark 92, freshSlDistance 5 → candidate 97 < currentSl 105 → trail
    const r = shouldExtendBracket({
      heldSide: 'short', entryPrice: 100, markPrice: 92,
      currentTp: 90, currentSl: 105,
      freshTpDistance: 5, freshSlDistance: 5,
      conviction: 0.1, currentRoiFrac: 0.08, currentPnlUsdt: 1,
    });
    expect(r.newSl).toBeCloseTo(97, 6);
  });
});

describe('shouldExtendBracket — env override + edge cases', () => {
  it('Phase 4 (2026-05-26) — MONKEY_BRACKET_EXTEND_CONV env knob removed; no env override', () => {
    // Pre-Phase-4: env override of 0.9 gated 0.8 conviction → no TP.
    // Post-Phase-4: convThreshold = 0 unconditionally. The env knob is
    // removed; setting it has no effect; kernel extends on any positive
    // conviction.
    process.env.MONKEY_BRACKET_EXTEND_CONV = '0.9';
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.8, currentRoiFrac: 0.08, currentPnlUsdt: 0,
    });
    expect(r.newTp).toBe(120);  // env knob is dead; extension fires
    delete process.env.MONKEY_BRACKET_EXTEND_CONV;
  });

  it('null currentTp → no TP extension attempted', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 108,
      currentTp: null, currentSl: 95,
      freshTpDistance: 20, freshSlDistance: 5,
      conviction: 0.9, currentRoiFrac: 0.08, currentPnlUsdt: 1,
    });
    expect(r.newTp).toBeNull();
    expect(r.newSl).not.toBeNull(); // SL side still trails
  });

  it('no favourable revision → changed false, bracket_hold reason', () => {
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 96,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 5,
      conviction: 0.9, currentRoiFrac: -0.04, currentPnlUsdt: -0.4,
    });
    expect(r.changed).toBe(false);
    expect(r.reason).toContain('bracket_hold');
  });

  it('honours zero meaningful-profit trail overrides', () => {
    process.env.MONKEY_BRACKET_TRAIL_MIN_ROI = '0';
    process.env.MONKEY_BRACKET_TRAIL_MIN_PROFIT_USDT = '0';
    const r = shouldExtendBracket({
      heldSide: 'long', entryPrice: 100, markPrice: 100.01,
      currentTp: 110, currentSl: 95,
      freshTpDistance: 5, freshSlDistance: 1,
      conviction: 0.1, currentRoiFrac: 0.0001, currentPnlUsdt: 0,
    });
    expect(r.newSl).toBeCloseTo(99.01, 6);
  });

});
