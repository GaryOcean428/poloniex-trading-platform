/**
 * featureFlagsService — DB-backed operator on/off control plane tests.
 *
 * DB is mocked so every branch (cache hit, absent flag, DB error fail-soft,
 * upsert + readback) runs without a real database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/connection.js';
import {
  __resetFeatureFlagsCache,
  getBoolFlag,
  getNumberFlag,
  getStringFlag,
  setFlag,
} from '../featureFlagsService.js';

const mockedQuery = vi.mocked(query);

function rows(r: unknown[]) {
  return { rows: r } as unknown as Awaited<ReturnType<typeof query>>;
}

describe('featureFlagsService', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    __resetFeatureFlagsCache();
  });
  afterEach(() => {
    __resetFeatureFlagsCache();
  });

  it('getBoolFlag returns the stored value when present', async () => {
    mockedQuery.mockResolvedValueOnce(rows([
      { flag_key: 'MONKEY_SHORTS_LIVE', value: 'true' },
      { flag_key: 'MONKEY_MAKER_CLOSE_LIVE', value: 'false' },
    ]));
    expect(await getBoolFlag('MONKEY_SHORTS_LIVE', false)).toBe(true);
    // cached — no second query
    expect(await getBoolFlag('MONKEY_MAKER_CLOSE_LIVE', true)).toBe(false);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('coalesces a concurrent cold-cache stampede onto ONE DB read', async () => {
    // The kernel refreshes all flags per tick via Promise.all of ~14
    // getBoolFlag calls. On a cold/expired cache these race in together; the
    // in-flight latch must funnel them onto a single SELECT, not one per caller.
    let resolveQuery!: (v: Awaited<ReturnType<typeof query>>) => void;
    mockedQuery.mockImplementationOnce(
      () => new Promise((res) => { resolveQuery = res; }),
    );
    const keys = [
      'MONKEY_SHORTS_LIVE', 'MONKEY_MARKET_INTEL_LIVE', 'MONKEY_FUNDING_GATE_LIVE',
      'MONKEY_MAKER_CLOSE_LIVE', 'L_VETO_OVER_K_ENABLED', 'MONKEY_BRACKET_EXIT_LIVE',
      'MONKEY_BRACKET_EXTEND_LIVE', 'MONKEY_SLOW_BLEED_LIVE', 'MONKEY_FAST_ADVERSE_LIVE',
      'MONKEY_TAPE_OVERRIDE_LIVE', 'REGIME_COMPOSITIONAL_LIVE', 'REGIME_HELD_EXIT_LIVE',
      'SCALP_LIMIT_MAKER_LIVE', 'SCALP_LIMIT_MAKER_BROAD',
    ];
    const inFlightReads = Promise.all(keys.map((k) => getBoolFlag(k, false)));
    resolveQuery(rows([{ flag_key: 'MONKEY_SHORTS_LIVE', value: 'true' }]));
    const results = await inFlightReads;
    expect(mockedQuery).toHaveBeenCalledTimes(1); // not 14
    expect(results[0]).toBe(true);                // shorts present
    expect(results[1]).toBe(false);               // absent → safe default
  });

  it('getBoolFlag returns the SAFE default when the flag is absent', async () => {
    mockedQuery.mockResolvedValueOnce(rows([{ flag_key: 'OTHER', value: 'true' }]));
    expect(await getBoolFlag('MONKEY_SHORTS_LIVE', false)).toBe(false);
  });

  it('getBoolFlag returns the safe default for a malformed (non-boolean) value', async () => {
    mockedQuery.mockResolvedValueOnce(rows([
      { flag_key: 'MONKEY_BRACKET_EXIT_LIVE', value: 'yes' },   // garbage
      { flag_key: 'MONKEY_SHORTS_LIVE', value: '1' },           // garbage
    ]));
    // protective exit safe default is true — a 'yes' must NOT silently disable it
    expect(await getBoolFlag('MONKEY_BRACKET_EXIT_LIVE', true)).toBe(true);
    // shorts safe default is false
    expect(await getBoolFlag('MONKEY_SHORTS_LIVE', false)).toBe(false);
  });

  it('getBoolFlag fails SOFT to the safe default on DB error', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db down'));
    // shorts → false is the safe default (no shorts when unknown)
    expect(await getBoolFlag('MONKEY_SHORTS_LIVE', false)).toBe(false);
    // protective exit → true is its safe default
    __resetFeatureFlagsCache();
    mockedQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await getBoolFlag('MONKEY_BRACKET_EXIT_LIVE', true)).toBe(true);
  });

  it('getNumberFlag parses numbers and falls back on garbage', async () => {
    mockedQuery.mockResolvedValueOnce(rows([
      { flag_key: 'N', value: '42' },
      { flag_key: 'BAD', value: 'not-a-number' },
    ]));
    expect(await getNumberFlag('N', 7)).toBe(42);
    expect(await getNumberFlag('BAD', 7)).toBe(7);
    expect(await getNumberFlag('MISSING', 7)).toBe(7);
  });

  it('getStringFlag returns value or default', async () => {
    mockedQuery.mockResolvedValueOnce(rows([{ flag_key: 'CSV', value: 'K,M,T' }]));
    expect(await getStringFlag('CSV', 'K')).toBe('K,M,T');
    expect(await getStringFlag('MISSING', 'K')).toBe('K');
  });

  it('setFlag upserts then reads back the row', async () => {
    mockedQuery
      .mockResolvedValueOnce(rows([])) // INSERT ... ON CONFLICT
      .mockResolvedValueOnce(rows([
        { flag_key: 'MONKEY_SHORTS_LIVE', value: 'false', updated_by: 'op@x', updated_at: '2026-06-01T00:00:00Z' },
      ]));
    const rec = await setFlag('MONKEY_SHORTS_LIVE', 'false', 'op@x');
    expect(rec.value).toBe('false');
    expect(rec.updatedBy).toBe('op@x');
  });
});
