/**
 * phi_gate.test.ts — TS parity for Tier 6 Φ-gate selection.
 *
 * Mirrors test_phi_gate.py 1:1 with the same parity rows. Tie-breaking
 * in both implementations: first key in iteration order (CHAIN, GRAPH,
 * FORESIGHT, LIGHTNING) wins on equal activations. Parity rows avoid
 * exact ties so the chosen gate is unambiguous on either side.
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, type Basin } from '../basin.js';
import type { ForesightResult } from '../foresight.js';
import { selectPhiGate } from '../phi_gate.js';

const fr = (weight = 0, confidence = 0): ForesightResult => ({
  predictedBasin: new Float64Array(BASIN_DIM) as Basin,
  confidence,
  weight,
  horizonMs: 0,
});

// ─── Argmax behaviour ──────────────────────────────────────────────

describe('Regimes', () => {
  it('low Φ, no foresight → CHAIN', () => {
    expect(selectPhiGate(0.05, fr()).chosen).toBe('CHAIN');
  });
  it('high Φ, no foresight → GRAPH', () => {
    expect(selectPhiGate(0.9, fr()).chosen).toBe('GRAPH');
  });
  it('high foresight (weight × confidence dominant) → FORESIGHT', () => {
    expect(selectPhiGate(0.6, fr(0.7, 1.0)).chosen).toBe('FORESIGHT');
  });
  it('synthetic LIGHTNING dominant → LIGHTNING', () => {
    expect(selectPhiGate(0.5, fr(0.5, 0.5), 1.0).chosen).toBe('LIGHTNING');
  });
});

// ─── LIGHTNING placeholder safety ──────────────────────────────────

describe('LIGHTNING placeholder (P9 unimplemented)', () => {
  it('LIGHTNING=0 default never wins when other modes have positive scores', () => {
    for (const phi of [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
      for (const fw of [0.0, 0.2, 0.5, 0.7]) {
        for (const fc of [0.0, 0.5, 1.0]) {
          const r = selectPhiGate(phi, fr(fw, fc));
          if (r.chosen === 'LIGHTNING') {
            // Allowed only if every other activation is also ≤ 0
            const others: Array<keyof typeof r.activations> = ['CHAIN', 'GRAPH', 'FORESIGHT'];
            for (const k of others) expect(r.activations[k]).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});

// ─── Telemetry shape ───────────────────────────────────────────────

describe('Telemetry', () => {
  it('all four activations present in result', () => {
    const r = selectPhiGate(0.5, fr(0.3, 0.5));
    expect(Object.keys(r.activations).sort()).toEqual(
      ['CHAIN', 'FORESIGHT', 'GRAPH', 'LIGHTNING'],
    );
  });
  it('CHAIN score = 1 − phi', () => {
    const r = selectPhiGate(0.42, fr());
    expect(r.activations.CHAIN).toBeCloseTo(1 - 0.42, 12);
  });
});

// ─── Parity snapshot — IDENTICAL rows to test_phi_gate.py ─────────

const PARITY_ROWS: Array<[number, number, number, number, string]> = [
  [0.05, 0.0, 0.0, 0.0, 'CHAIN'],
  [0.95, 0.0, 0.0, 0.0, 'GRAPH'],
  [0.50, 0.8, 1.0, 0.0, 'FORESIGHT'],
  [0.50, 0.0, 0.0, 1.0, 'LIGHTNING'],
  [0.60, 0.0, 0.0, 0.0, 'GRAPH'],
  [0.70, 0.3, 0.5, 0.0, 'GRAPH'],
  [0.50, 0.9, 1.0, 0.0, 'FORESIGHT'],
  [1.00, 0.0, 0.0, 0.0, 'GRAPH'],
];

describe('Parity snapshot — 8 rows match Python suite identically', () => {
  PARITY_ROWS.forEach(([phi, w, c, l, expected], idx) => {
    it(`row ${idx} chooses ${expected}`, () => {
      const r = selectPhiGate(phi, fr(w, c), l);
      expect(r.chosen).toBe(expected);
    });
  });
});
