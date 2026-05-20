/**
 * Tests for fr_trade_params.ts — the Fisher-Rao → trade-parameter
 * port of the QIG_Fisher_Rao_Classification.pine P25 block.
 *
 * Expected values are hand-computed from the Pine formulas (L149-176)
 * so this suite is a regression fence against drift from the canonical
 * QIG indicator.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveFrTradeParams,
  frTradeTypeToLane,
  FR_MAX_LEV,
} from '../services/monkey/fr_trade_params.js';

describe('deriveFrTradeParams — trade type classification', () => {
  it('DISSOLVER → OBSERVE (no trade)', () => {
    const r = deriveFrTradeParams({
      regime: 'DISSOLVER', regimeChanged: false,
      phi: 0.5, rConf: 0.5, atr: 100,
      basinVelocity: 0.05, basinVelocityMedian: 0.05,
    });
    expect(r.tradeType).toBe('OBSERVE');
    expect(r.sugLeverage).toBe(1); // typeMult 0 → rawLev 1
  });

  it('regime just changed → BREAKOUT (overrides scalp/swing/trend)', () => {
    const r = deriveFrTradeParams({
      regime: 'CREATOR', regimeChanged: true,
      phi: 0.9, rConf: 1.0, atr: 100,
      basinVelocity: 0.08, basinVelocityMedian: 0.05,
    });
    expect(r.tradeType).toBe('BREAKOUT');
  });

  it('CREATOR + fast basin velocity → SCALP', () => {
    const r = deriveFrTradeParams({
      regime: 'CREATOR', regimeChanged: false,
      phi: 0.6, rConf: 0.5, atr: 50,
      basinVelocity: 0.1, basinVelocityMedian: 0.05, // bv > velMed
    });
    expect(r.tradeType).toBe('SCALP');
  });

  it('CREATOR but slow (bv ≤ velMed) → SWING', () => {
    const r = deriveFrTradeParams({
      regime: 'CREATOR', regimeChanged: false,
      phi: 0.6, rConf: 0.5, atr: 50,
      basinVelocity: 0.03, basinVelocityMedian: 0.05, // bv < velMed
    });
    expect(r.tradeType).toBe('SWING');
  });

  it('PRESERVER + very slow (bv < velMed×0.5) → TREND', () => {
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 0.8, rConf: 0.9, atr: 100,
      basinVelocity: 0.01, basinVelocityMedian: 0.05, // 0.01 < 0.025
    });
    expect(r.tradeType).toBe('TREND');
  });

  it('PRESERVER but not slow enough → SWING', () => {
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 0.7, rConf: 0.6, atr: 80,
      basinVelocity: 0.04, basinVelocityMedian: 0.05, // 0.04 > 0.025
    });
    expect(r.tradeType).toBe('SWING');
  });
});

describe('deriveFrTradeParams — leverage', () => {
  it('TREND high-conviction: rawLev 1 + 0.72×4 = 3.88 → floor 3', () => {
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 0.8, rConf: 0.9, atr: 100,
      basinVelocity: 0.01, basinVelocityMedian: 0.05,
    });
    expect(r.conviction).toBeCloseTo(0.72, 6);
    expect(r.sugLeverage).toBe(3);
  });

  it('max conviction TREND hits FR_MAX_LEV exactly: 1 + 1.0×4 = 5', () => {
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 1.0, rConf: 1.0, atr: 100,
      basinVelocity: 0.001, basinVelocityMedian: 0.05,
    });
    expect(r.sugLeverage).toBe(FR_MAX_LEV);
    expect(r.sugLeverage).toBe(5);
  });

  it('leverage never exceeds FR_MAX_LEV cap', () => {
    // Even with absurd inputs the floor+clamp holds at 5.
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 1.0, rConf: 1.0, atr: 1e6,
      basinVelocity: 0.0001, basinVelocityMedian: 1.0,
    });
    expect(r.sugLeverage).toBeLessThanOrEqual(FR_MAX_LEV);
  });

  it('leverage floors at 1 (OBSERVE, zero conviction)', () => {
    const r = deriveFrTradeParams({
      regime: 'DISSOLVER', regimeChanged: false,
      phi: 0.0, rConf: 0.0, atr: 100,
      basinVelocity: 0.05, basinVelocityMedian: 0.05,
    });
    expect(r.sugLeverage).toBe(1);
  });

  it('BREAKOUT: 1 + 0.9×1.5 = 2.35 → floor 2', () => {
    const r = deriveFrTradeParams({
      regime: 'CREATOR', regimeChanged: true,
      phi: 0.9, rConf: 1.0, atr: 100,
      basinVelocity: 0.08, basinVelocityMedian: 0.05,
    });
    expect(r.sugLeverage).toBe(2);
  });
});

describe('deriveFrTradeParams — TP/SL/range geometry', () => {
  it('TREND example: SL 125, TP 304, R:R 2.432', () => {
    // atr=100, phi=0.8, rConf=0.9
    // sl = 100 × (1/max(0.8,0.3)) = 100 × 1.25 = 125
    // tp = 100 × 0.8 × (1+0.9) × 2 = 304
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 0.8, rConf: 0.9, atr: 100,
      basinVelocity: 0.01, basinVelocityMedian: 0.05,
    });
    expect(r.slDistance).toBeCloseTo(125, 6);
    expect(r.tpDistance).toBeCloseTo(304, 6);
    expect(r.riskReward).toBeCloseTo(2.432, 4);
  });

  it('SL φ-floor: φ=0.1 clamps to 0.3 → SL = atr/0.3', () => {
    const r = deriveFrTradeParams({
      regime: 'CREATOR', regimeChanged: false,
      phi: 0.1, rConf: 0.5, atr: 90,
      basinVelocity: 0.1, basinVelocityMedian: 0.05,
    });
    expect(r.slDistance).toBeCloseTo(90 / 0.3, 6); // 300
  });

  it('predicted range: pct = bv×100×(1+rConf), abs = atr×(1+bv×10)', () => {
    const r = deriveFrTradeParams({
      regime: 'PRESERVER', regimeChanged: false,
      phi: 0.8, rConf: 0.9, atr: 100,
      basinVelocity: 0.01, basinVelocityMedian: 0.05,
    });
    expect(r.predRangePct).toBeCloseTo(0.01 * 100 * 1.9, 6); // 1.9
    expect(r.predRangeAbs).toBeCloseTo(100 * 1.1, 6);        // 110
  });

  it('DISSOLVER produces poor R:R (< 1) — geometry intent', () => {
    // φ=0.5, rConf=0.5 → SL=200, TP=150 → R:R 0.75
    const r = deriveFrTradeParams({
      regime: 'DISSOLVER', regimeChanged: false,
      phi: 0.5, rConf: 0.5, atr: 100,
      basinVelocity: 0.05, basinVelocityMedian: 0.05,
    });
    expect(r.riskReward).toBeLessThan(1);
  });
});

describe('frTradeTypeToLane', () => {
  it('OBSERVE → null (forces caller to handle no-trade)', () => {
    expect(frTradeTypeToLane('OBSERVE', 0.9)).toBeNull();
  });

  it('SCALP/SWING/TREND map 1:1 to lanes', () => {
    expect(frTradeTypeToLane('SCALP', 0.2)).toBe('scalp');
    expect(frTradeTypeToLane('SWING', 0.5)).toBe('swing');
    expect(frTradeTypeToLane('TREND', 0.9)).toBe('trend');
  });

  it('BREAKOUT routes by conviction: ≥0.5 → swing, <0.5 → scalp', () => {
    expect(frTradeTypeToLane('BREAKOUT', 0.6)).toBe('swing');
    expect(frTradeTypeToLane('BREAKOUT', 0.5)).toBe('swing');
    expect(frTradeTypeToLane('BREAKOUT', 0.3)).toBe('scalp');
  });
});
