/**
 * canonicalInvariant.test.ts — schema-pin tests for the Matrix tier-4
 * Phase A canonical 8-field invariant.
 *
 * The doctrine says: adding fields requires geometric justification;
 * removing requires showing no information loss. These tests pin the
 * exact field set so silent drift is impossible.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCanonicalInvariant,
  doctrineFieldCount,
  type CanonicalInvariant,
} from '../canonical_invariant.js';

function basin64(): number[] {
  const v = new Array(64).fill(1 / 64);
  return v;
}

function validInvariant(overrides: Partial<CanonicalInvariant> = {}): CanonicalInvariant {
  return {
    instance_id: 'monkey-primary',
    symbol: 'BTC-USDT-PERP',
    tick_id: 'tick-001',
    at_ms: Date.now(),
    engine_version: 'v0.9.0-tier4-a',
    basin_signature: basin64(),
    chemistry_vector: {
      dopamine: 0.5,
      serotonin: 0.5,
      norepinephrine: 0.5,
      gaba: 0.5,
      endorphins: 0.5,
      acetylcholine: 0.5,
    },
    ocean_phase: 'awake',
    loop_count: 3,
    sovereignty: 0.7,
    regime_label: 'CHOP',
    phi: 0.4,
    kappa_with_channel: { value: 65, channel: 'B' },
    ...overrides,
  };
}

describe('doctrineFieldCount', () => {
  it('is exactly 8 — the canonical invariant set is fixed', () => {
    expect(doctrineFieldCount()).toBe(8);
  });
});

describe('validateCanonicalInvariant — accepts well-formed payloads', () => {
  it('accepts a fully-populated valid invariant', () => {
    expect(validateCanonicalInvariant(validInvariant())).toBeNull();
  });

  it('accepts ocean_phase=sleep', () => {
    expect(validateCanonicalInvariant(validInvariant({ ocean_phase: 'sleep' }))).toBeNull();
  });

  it('accepts kappa channel A1 (frozen physics)', () => {
    const inv = validInvariant({ kappa_with_channel: { value: 64, channel: 'A1' } });
    expect(validateCanonicalInvariant(inv)).toBeNull();
  });

  it('accepts loop_count=0 (cold tick before convergence loop)', () => {
    expect(validateCanonicalInvariant(validInvariant({ loop_count: 0 }))).toBeNull();
  });
});

describe('validateCanonicalInvariant — envelope rejection', () => {
  it('rejects non-object payload', () => {
    expect(validateCanonicalInvariant(null)).toBe('payload is not an object');
    expect(validateCanonicalInvariant('string')).toBe('payload is not an object');
    expect(validateCanonicalInvariant(42)).toBe('payload is not an object');
  });

  it('rejects missing instance_id', () => {
    const x = { ...validInvariant() } as Record<string, unknown>;
    delete x.instance_id;
    expect(validateCanonicalInvariant(x)).toContain('instance_id');
  });

  it('rejects missing at_ms', () => {
    const x = { ...validInvariant() } as Record<string, unknown>;
    delete x.at_ms;
    expect(validateCanonicalInvariant(x)).toContain('at_ms');
  });
});

describe('validateCanonicalInvariant — basin_signature shape', () => {
  it('rejects non-array basin', () => {
    const inv = validInvariant({ basin_signature: 'not-an-array' as unknown as number[] });
    expect(validateCanonicalInvariant(inv)).toContain('basin_signature');
  });

  it('rejects basin with length != 64 (Δ⁶³ structural constraint)', () => {
    expect(validateCanonicalInvariant(validInvariant({ basin_signature: new Array(32).fill(0) })))
      .toContain('expected 64');
    expect(validateCanonicalInvariant(validInvariant({ basin_signature: new Array(128).fill(0) })))
      .toContain('expected 64');
  });

  it('rejects basin with NaN entry', () => {
    const b = basin64();
    b[3] = NaN;
    expect(validateCanonicalInvariant(validInvariant({ basin_signature: b })))
      .toContain('non-finite');
  });
});

describe('validateCanonicalInvariant — chemistry_vector exactly 6 chemicals', () => {
  it('rejects missing chemical', () => {
    const cv = { dopamine: 0.5, serotonin: 0.5, norepinephrine: 0.5, gaba: 0.5, endorphins: 0.5 };
    expect(validateCanonicalInvariant(validInvariant({ chemistry_vector: cv as unknown as CanonicalInvariant['chemistry_vector'] })))
      .toContain('acetylcholine');
  });

  it('rejects extra chemical (drift prevention)', () => {
    const cv = {
      dopamine: 0.5, serotonin: 0.5, norepinephrine: 0.5,
      gaba: 0.5, endorphins: 0.5, acetylcholine: 0.5,
      cortisol: 0.5, // not in the canonical six
    };
    expect(validateCanonicalInvariant(validInvariant({ chemistry_vector: cv as unknown as CanonicalInvariant['chemistry_vector'] })))
      .toContain('expected exactly 6');
  });

  it('rejects non-finite chemical', () => {
    const cv = {
      dopamine: 0.5, serotonin: NaN, norepinephrine: 0.5,
      gaba: 0.5, endorphins: 0.5, acetylcholine: 0.5,
    };
    expect(validateCanonicalInvariant(validInvariant({ chemistry_vector: cv })))
      .toContain('serotonin');
  });
});

describe('validateCanonicalInvariant — enum fields', () => {
  it('rejects ocean_phase not in {awake, sleep}', () => {
    const inv = validInvariant({ ocean_phase: 'dream' as unknown as 'awake' });
    expect(validateCanonicalInvariant(inv)).toContain('expected');
  });

  it('rejects kappa channel not in {A1, B}', () => {
    const inv = validInvariant({ kappa_with_channel: { value: 64, channel: 'C' as unknown as 'A1' } });
    expect(validateCanonicalInvariant(inv)).toContain("'A1' | 'B'");
  });
});

describe('validateCanonicalInvariant — type rejection', () => {
  it('rejects non-integer loop_count', () => {
    expect(validateCanonicalInvariant(validInvariant({ loop_count: 2.5 })))
      .toContain('integer');
  });

  it('rejects negative loop_count', () => {
    expect(validateCanonicalInvariant(validInvariant({ loop_count: -1 })))
      .toContain('negative');
  });

  it('rejects non-finite phi', () => {
    expect(validateCanonicalInvariant(validInvariant({ phi: Infinity })))
      .toContain('phi');
  });

  it('rejects non-finite sovereignty', () => {
    expect(validateCanonicalInvariant(validInvariant({ sovereignty: NaN })))
      .toContain('sovereignty');
  });

  it('rejects non-finite kappa.value', () => {
    expect(validateCanonicalInvariant(validInvariant({ kappa_with_channel: { value: NaN, channel: 'B' } })))
      .toContain('kappa_with_channel.value');
  });
});
