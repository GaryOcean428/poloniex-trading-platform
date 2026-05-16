/**
 * kParityShadow.test.ts — covers the issue #689 Python K shadow fanout.
 *
 * Exercises the building blocks (not loop.ts itself — too much fixture
 * lift to spin a full processSymbol). What IS covered:
 *
 *   1. recordKParityRow writes one INSERT with the right column count
 *      and reads pyError when py response carries .error.
 *   2. recordKParityRow swallows DB failures (never throws).
 *   3. regimeToOrdinal maps both monkey-kernel and QIG-alias names.
 *   4. callKShadowTick honours the 1-second timeout via AbortController
 *      (resolves with { error: timeout_… }, never throws).
 *   5. callKShadowTick returns { error: 'fetch_error: ...' } on network
 *      failure — caller still gets a structured response for the
 *      parity row.
 *   6. callKShadowTick passes the response body through on a 200,
 *      preserving the slim shape { action, side, phi, kappa, M, Gamma,
 *      R, regime, mode, decided_at_ms }.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB pool before importing anything that uses it.
vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../../db/connection.js';
import {
  recordKParityRow,
  regimeToOrdinal,
  type TsKDecisionRow,
} from '../k_parity_log.js';
import { callKShadowTick } from '../kernel_client.js';

const baseTsRow = (): TsKDecisionRow => ({
  tickId: 'tick-uuid-aaaa-bbbb-cccc-dddddddddddd',
  symbol: 'BTC_USDT_PERP',
  symbolTimestamp: new Date('2026-05-16T00:00:00Z'),
  tsAction: 'enter_long',
  tsSide: 'long',
  tsPhi: 0.72,
  tsKappa: 64.1,
  tsM: null,
  tsGamma: 0.018,
  tsR: 1,
  tsRegime: 'preserver',
  tsDecisionMs: 12,
});

describe('regimeToOrdinal', () => {
  it('maps monkey-kernel labels', () => {
    expect(regimeToOrdinal('creator')).toBe(0);
    expect(regimeToOrdinal('preserver')).toBe(1);
    expect(regimeToOrdinal('dissolver')).toBe(2);
  });
  it('maps QIG aliases', () => {
    expect(regimeToOrdinal('quantum')).toBe(0);
    expect(regimeToOrdinal('equilibrium')).toBe(1);
    expect(regimeToOrdinal('efficient')).toBe(2);
  });
  it('is case-insensitive and whitespace-tolerant', () => {
    expect(regimeToOrdinal(' PRESERVER ')).toBe(1);
  });
  it('returns null on unknown / empty', () => {
    expect(regimeToOrdinal(null)).toBeNull();
    expect(regimeToOrdinal(undefined)).toBeNull();
    expect(regimeToOrdinal('')).toBeNull();
    expect(regimeToOrdinal('mystery_regime')).toBeNull();
  });
});

describe('recordKParityRow', () => {
  beforeEach(() => {
    (pool.query as ReturnType<typeof vi.fn>).mockReset();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
  });

  it('writes one INSERT with TS + Py columns when py response is healthy', async () => {
    const ts = baseTsRow();
    const py = {
      action: 'enter_long',
      side: 'long' as const,
      size_intent: 5.0,
      phi: 0.71,
      kappa: 63.8,
      M: 0.13,
      Gamma: 0.017,
      R: 1,
      regime: 'preserver',
      mode: 'integration',
      decided_at_ms: 1_700_000_000_000,
    };
    await recordKParityRow(ts, py);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO kernel_parity_log/);
    // 12 ts_* params + 10 py_* params = 22 columns (matches migration 051).
    expect(params).toHaveLength(22);
    // ts_action position 4, py_action position 13, py_error tail position 22.
    expect(params[3]).toBe('enter_long');
    expect(params[12]).toBe('enter_long');
    expect(params[21]).toBeNull();
  });

  it('writes py_error and leaves py_* metrics null when py response carries .error', async () => {
    const ts = baseTsRow();
    const py = { error: 'timeout_1000ms', decided_at_ms: 1_700_000_000_000 };
    await recordKParityRow(ts, py);
    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    // py_action..py_R should all be null when error is set.
    for (let idx = 12; idx <= 19; idx++) {
      expect(params[idx]).toBeNull();
    }
    // py_error column carries the string (truncated to 255).
    expect(params[21]).toBe('timeout_1000ms');
    // py_decision_ms still carries the timestamp.
    expect(params[20]).toBe(1_700_000_000_000);
  });

  it('swallows DB failures (never throws)', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connection terminated unexpectedly'),
    );
    // Must resolve, not throw.
    await expect(recordKParityRow(baseTsRow(), null)).resolves.toBeUndefined();
  });

  it('handles a null py response (shadow off / unreachable) — writes ts_* with all py_* null', async () => {
    const ts = baseTsRow();
    await recordKParityRow(ts, null);
    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    for (let idx = 12; idx <= 21; idx++) {
      expect(params[idx]).toBeNull();
    }
  });

  it('truncates oversize py_error strings to 255 chars', async () => {
    const huge = 'x'.repeat(500);
    await recordKParityRow(baseTsRow(), { error: huge, decided_at_ms: 1 });
    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((params[21] as string).length).toBe(255);
  });
});

describe('callKShadowTick', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
  });

  const requestBody = {
    instance_id: 'test',
    inputs: {
      symbol: 'BTC_USDT_PERP',
      ohlcv: [],
      account: {
        equity_fraction: 0,
        margin_fraction: 0,
        open_positions: 0,
        available_equity: 0,
      },
      bank_size: 0,
      sovereignty: 0,
      max_leverage: 10,
      min_notional: 5,
      size_fraction: 1,
    },
    prev_state: null,
  };

  it('passes the response body through on HTTP 200', async () => {
    const body = {
      action: 'hold',
      side: null,
      size_intent: 0,
      phi: 0.5,
      kappa: 64,
      M: null,
      Gamma: 0.0,
      R: 1,
      regime: 'preserver',
      mode: 'exploration',
      decided_at_ms: 9_999,
    };
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response);
    const got = await callKShadowTick(requestBody);
    expect(got.action).toBe('hold');
    expect(got.phi).toBe(0.5);
    expect(got.regime).toBe('preserver');
    expect(got.error).toBeUndefined();
  });

  it('returns { error: HTTP <status> } on non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'internal_explosion',
    } as unknown as Response);
    const got = await callKShadowTick(requestBody);
    expect(got.error).toMatch(/^HTTP 500/);
    expect(typeof got.decided_at_ms).toBe('number');
  });

  it('returns { error: fetch_error: ... } when fetch throws', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const got = await callKShadowTick(requestBody);
    expect(got.error).toMatch(/^fetch_error:/);
    expect(got.error).toContain('ECONNREFUSED');
  });

  it('returns { error: timeout_… } when AbortController fires', async () => {
    globalThis.fetch = vi.fn().mockImplementationOnce((_url, init) => {
      // Wait long enough for the 1s timeout to fire on the AbortSignal.
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });
    const got = await callKShadowTick(requestBody);
    expect(got.error).toMatch(/^timeout_/);
  }, 3000);
});
