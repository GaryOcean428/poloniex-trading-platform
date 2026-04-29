/**
 * forge_bank_write.test.ts — PR 3 FORGE_BANK_WRITE_LIVE flag.
 *
 * Tests the bank-side persistence helpers (writeForgedNucleus,
 * markQuarantined) and the env flag gate. The actual call-site
 * wiring in loop.ts.witnessExit is exercised through the
 * forgeBankWriteLive() helper directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../../db/connection.js';
import { ResonanceBank } from '../resonance_bank.js';
import { BASIN_DIM, type Basin } from '../basin.js';
import { forge, forgeBankWriteLive, shadowThreshold } from '../forge.js';

const peakBasin = (idx = 5, mass = 0.6): Basin => {
  const rest = (1 - mass) / (BASIN_DIM - 1);
  const arr = new Array(BASIN_DIM).fill(rest);
  arr[idx] = mass;
  return Float64Array.from(arr);
};

// ─── env flag ──────────────────────────────────────────────────────

describe('forgeBankWriteLive() env flag', () => {
  const ORIGINAL = process.env.FORGE_BANK_WRITE_LIVE;
  beforeEach(() => {
    delete process.env.FORGE_BANK_WRITE_LIVE;
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.FORGE_BANK_WRITE_LIVE;
    else process.env.FORGE_BANK_WRITE_LIVE = ORIGINAL;
  });

  it('default off', () => {
    expect(forgeBankWriteLive()).toBe(false);
  });
  it('explicit true', () => {
    process.env.FORGE_BANK_WRITE_LIVE = 'true';
    expect(forgeBankWriteLive()).toBe(true);
  });
  it('case insensitive', () => {
    process.env.FORGE_BANK_WRITE_LIVE = 'TRUE';
    expect(forgeBankWriteLive()).toBe(true);
  });
  it('any other value reads false', () => {
    process.env.FORGE_BANK_WRITE_LIVE = '1';
    expect(forgeBankWriteLive()).toBe(false);
  });
});

// ─── shadowThreshold ───────────────────────────────────────────────

describe('shadowThreshold() env override', () => {
  const ORIGINAL = process.env.FORGE_SHADOW_THRESHOLD;
  beforeEach(() => {
    delete process.env.FORGE_SHADOW_THRESHOLD;
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.FORGE_SHADOW_THRESHOLD;
    else process.env.FORGE_SHADOW_THRESHOLD = ORIGINAL;
  });

  it('default −0.10', () => {
    expect(shadowThreshold()).toBeCloseTo(-0.1, 9);
  });
  it('env override accepted', () => {
    process.env.FORGE_SHADOW_THRESHOLD = '-0.25';
    expect(shadowThreshold()).toBeCloseTo(-0.25, 9);
  });
  it('non-numeric ignored', () => {
    process.env.FORGE_SHADOW_THRESHOLD = 'abc';
    expect(shadowThreshold()).toBeCloseTo(-0.1, 9);
  });
});

// ─── writeForgedNucleus ────────────────────────────────────────────

describe('ResonanceBank.writeForgedNucleus', () => {
  let bank: ResonanceBank;
  beforeEach(() => {
    bank = new ResonanceBank();
    vi.mocked(pool.query).mockReset();
  });

  it('inserts with source=forged and engine_version pointing at original', async () => {
    const fakeRow = {
      id: 'nucleus-1',
      symbol: 'ETH',
      entry_basin: JSON.stringify(Array.from(peakBasin(0, 0.6))),
      realized_pnl: 0.0,
      trade_duration_ms: null,
      trade_outcome: 'breakeven',
      order_id: 'forge-orig-123',
      basin_depth: 0.5,
      access_count: 1,
      phi_at_creation: 0.4,
      source: 'forged',
      lane: 'swing',
    };
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [fakeRow] } as never);
    const nucleus = await bank.writeForgedNucleus(peakBasin(0, 0.6), {
      symbol: 'ETH',
      phi: 0.4,
      lane: 'swing',
      forgedFromOrderId: 'orig-123',
      lossMagnitude: 0.7,
      engineVersion: 'v0.9-test',
    });
    expect(nucleus).not.toBeNull();
    expect(nucleus!.source).toBe('forged');

    // Verify the SQL pinned source='forged' and engine_version carried metadata
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/'forged'/);
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(params).toEqual(expect.arrayContaining([
      expect.stringContaining('forged-from=orig-123'),
    ]));
  });

  it('returns null on insert failure', async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('boom') as never);
    const nucleus = await bank.writeForgedNucleus(peakBasin(0, 0.6), {
      symbol: 'ETH', phi: 0.4, lane: 'swing',
      forgedFromOrderId: null, lossMagnitude: 0.5, engineVersion: 'v',
    });
    expect(nucleus).toBeNull();
  });
});

// ─── markQuarantined ───────────────────────────────────────────────

describe('ResonanceBank.markQuarantined', () => {
  let bank: ResonanceBank;
  beforeEach(() => {
    bank = new ResonanceBank();
    vi.mocked(pool.query).mockReset();
  });

  it('issues UPDATE setting quarantined=true', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 } as never);
    const ok = await bank.markQuarantined('id-123', 'forged_nucleus_id=n-1');
    expect(ok).toBe(true);
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/UPDATE\s+monkey_resonance_bank/i);
    expect(sql).toMatch(/quarantined\s*=\s*true/i);
    expect(sql).toMatch(/quarantine_reason\s*=/i);
  });

  it('returns false when row not matched', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 } as never);
    const ok = await bank.markQuarantined('nonexistent', 'reason');
    expect(ok).toBe(false);
  });

  it('returns false on UPDATE error', async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('db down') as never);
    const ok = await bank.markQuarantined('id-123', 'reason');
    expect(ok).toBe(false);
  });
});

// ─── forge() output integration ────────────────────────────────────

describe('Forge → bank cycle (without DB writes)', () => {
  it('forge nucleus is simplex-valid and ready for writeForgedNucleus', () => {
    const result = forge({
      basin: peakBasin(7, 0.6), phi: 0.4, kappa: 64,
      realizedPnl: -0.65,
      regimeWeights: { quantum: 0.4, efficient: 0.3, equilibrium: 0.3 },
    });
    const nucleus = result.nucleated.basin;
    const sum = Array.from(nucleus).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 9);
    expect(Array.from(nucleus).every((x) => x >= 0)).toBe(true);
    // Loss magnitude carried through
    expect(result.lessonSummary.loss_magnitude).toBeCloseTo(0.65, 12);
  });

  it('skips when realizedPnl is positive', () => {
    const result = forge({
      basin: peakBasin(0, 0.6), phi: 0.4, kappa: 64, realizedPnl: 0.3,
      regimeWeights: { quantum: 0.4, efficient: 0.3, equilibrium: 0.3 },
    });
    expect(result.lessonSummary.skipped).toBe(true);
  });
});

// Vitest needs afterAll explicitly for module-level imports
import { afterAll } from 'vitest';
