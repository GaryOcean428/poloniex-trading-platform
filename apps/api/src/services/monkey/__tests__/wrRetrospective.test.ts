import { describe, expect, it } from 'vitest';

import { mergeRetrospective } from '../wr_retrospective.js';
import type { RegimeMatrix } from '../wr_matrix.js';

describe('mergeRetrospective', () => {
  const real: RegimeMatrix = {
    'monkey-k': {
      creator: { wins: 6, losses: 4, total: 10, wr: 0.6 },
      preserver: { wins: 1, losses: 1, total: 2, wr: 0.5 },
      dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
      unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
    },
  };

  it('adds retrospective engine without overwriting real engines', () => {
    const retro: RegimeMatrix = {
      'py-retrospective': {
        creator: { wins: 3, losses: 2, total: 5, wr: 0.6 },
        preserver: { wins: 0, losses: 0, total: 0, wr: 0 },
        dissolver: { wins: 1, losses: 4, total: 5, wr: 0.2 },
        unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
      },
    };
    const merged = mergeRetrospective(real, retro);
    expect(merged['monkey-k'].creator.wr).toBe(0.6);
    expect(merged['py-retrospective'].dissolver.wr).toBe(0.2);
    expect(Object.keys(merged).sort()).toEqual(['monkey-k', 'py-retrospective']);
  });

  it('retrospective entry overwrites prior retrospective entry (same label)', () => {
    const retro1: RegimeMatrix = {
      'py-retrospective': {
        creator: { wins: 1, losses: 0, total: 1, wr: 1 },
        preserver: { wins: 0, losses: 0, total: 0, wr: 0 },
        dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
        unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
      },
    };
    const retro2: RegimeMatrix = {
      'py-retrospective': {
        creator: { wins: 5, losses: 5, total: 10, wr: 0.5 },
        preserver: { wins: 0, losses: 0, total: 0, wr: 0 },
        dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
        unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
      },
    };
    const merged = mergeRetrospective(real, retro1);
    const merged2 = mergeRetrospective(merged, retro2);
    expect(merged2['py-retrospective'].creator.wr).toBe(0.5);
  });

  it('empty retrospective leaves real matrix unchanged', () => {
    const merged = mergeRetrospective(real, {});
    expect(merged).toEqual(real);
  });
});
