/**
 * regimeClassifierScores.test.ts — parseRegimeScores contract.
 *
 * The ml-worker's /regime/classify_prices now returns an optional
 * `regime_scores` triple (the CAL-3 soft observer). parseRegimeScores
 * is the validation gate: a partial / NaN / negative / all-zero
 * payload must yield null so perception falls back to the hard
 * one-hot label rather than encoding a poisoned continuous basin.
 */

import { describe, expect, it } from 'vitest';

import { parseRegimeScores } from '../regime_classifier_client.js';

describe('parseRegimeScores', () => {
  it('accepts a complete finite non-negative triple', () => {
    expect(parseRegimeScores({ creator: 0.5, preserver: 0.3, dissolver: 0.2 }))
      .toEqual({ creator: 0.5, preserver: 0.3, dissolver: 0.2 });
  });

  it('accepts a triple with a zero component (sum still > 0)', () => {
    expect(parseRegimeScores({ creator: 0, preserver: 1, dissolver: 0 }))
      .toEqual({ creator: 0, preserver: 1, dissolver: 0 });
  });

  it('rejects null / non-object (warmup → ml-worker sends null)', () => {
    expect(parseRegimeScores(null)).toBeNull();
    expect(parseRegimeScores(undefined)).toBeNull();
    expect(parseRegimeScores(42)).toBeNull();
  });

  it('rejects a partial triple (missing a component)', () => {
    expect(parseRegimeScores({ creator: 0.5, preserver: 0.5 })).toBeNull();
  });

  it('rejects NaN / non-finite components', () => {
    expect(parseRegimeScores({ creator: NaN, preserver: 0.5, dissolver: 0.5 })).toBeNull();
    expect(parseRegimeScores({ creator: Infinity, preserver: 0.5, dissolver: 0.5 })).toBeNull();
  });

  it('rejects negative components', () => {
    expect(parseRegimeScores({ creator: -0.1, preserver: 0.6, dissolver: 0.5 })).toBeNull();
  });

  it('rejects an all-zero triple (zero sum → divide-by-zero downstream)', () => {
    expect(parseRegimeScores({ creator: 0, preserver: 0, dissolver: 0 })).toBeNull();
  });
});
