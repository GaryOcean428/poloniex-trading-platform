import { describe, expect, it } from 'vitest';

import {
  cellHasMinSamples,
  getCellWR,
  parseRegimeFromReason,
  type RegimeMatrix,
} from '../wr_matrix.js';

describe('parseRegimeFromReason', () => {
  it('extracts creator', () => {
    expect(parseRegimeFromReason('regime=creator strategy=breakout dir=bullish')).toBe('creator');
  });
  it('extracts preserver', () => {
    expect(parseRegimeFromReason('preserver mode entry — regime=preserver')).toBe('preserver');
  });
  it('extracts dissolver', () => {
    expect(parseRegimeFromReason('regime=dissolver strategy=cash dir=neutral')).toBe('dissolver');
  });
  it('case-insensitive on key', () => {
    expect(parseRegimeFromReason('Regime=Creator')).toBe('creator');
  });
  it('returns unknown for unrecognized regime name', () => {
    expect(parseRegimeFromReason('regime=foobar')).toBe('unknown');
  });
  it('returns unknown when missing', () => {
    expect(parseRegimeFromReason('no regime token here')).toBe('unknown');
    expect(parseRegimeFromReason('')).toBe('unknown');
    expect(parseRegimeFromReason(null)).toBe('unknown');
    expect(parseRegimeFromReason(undefined)).toBe('unknown');
  });
});

describe('getCellWR + cellHasMinSamples', () => {
  const matrix: RegimeMatrix = {
    'monkey-k': {
      creator: { wins: 6, losses: 4, total: 10, wr: 0.6 },
      preserver: { wins: 2, losses: 1, total: 3, wr: 2 / 3 },
      dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
      unknown: { wins: 1, losses: 1, total: 2, wr: 0.5 },
    },
    'monkey-py-shadow': {
      creator: { wins: 0, losses: 0, total: 0, wr: 0 },
      preserver: { wins: 0, losses: 0, total: 0, wr: 0 },
      dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
      unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
    },
  };

  it('returns the cell WR', () => {
    expect(getCellWR(matrix, 'monkey-k', 'creator')).toBe(0.6);
    expect(getCellWR(matrix, 'monkey-k', 'dissolver')).toBe(0);
  });

  it('returns 0 for missing engine or regime', () => {
    expect(getCellWR(matrix, 'monkey-missing', 'creator')).toBe(0);
    // RegimeLabel is typed-narrowed; runtime safety only — cast through any
    expect(getCellWR(matrix, 'monkey-k', 'creator')).toBeGreaterThan(0);
  });

  it('cellHasMinSamples respects threshold', () => {
    expect(cellHasMinSamples(matrix, 'monkey-k', 'creator', 5)).toBe(true);
    expect(cellHasMinSamples(matrix, 'monkey-k', 'preserver', 5)).toBe(false);
    expect(cellHasMinSamples(matrix, 'monkey-k', 'creator', 10)).toBe(true);
    expect(cellHasMinSamples(matrix, 'monkey-k', 'creator', 11)).toBe(false);
  });

  it('cold-start: all cells return 0 WR + fail min-samples', () => {
    expect(getCellWR(matrix, 'monkey-py-shadow', 'creator')).toBe(0);
    expect(cellHasMinSamples(matrix, 'monkey-py-shadow', 'creator', 1)).toBe(false);
  });
});
