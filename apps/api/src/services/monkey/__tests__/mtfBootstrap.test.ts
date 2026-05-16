/**
 * mtfBootstrap.test.ts — MTF L bootstrap status reporting.
 *
 * Pre-2026-05-16 the bootstrap was fire-and-forget at the caller and
 * swallowed silent failures (live logs showed `[MTF-L] decision
 * agreement: 0/3, perTf: cold,cold,cold` across whole sessions). The
 * fix returns a per-TF status report so the caller can retry the
 * cold timeframes on a later tick.
 *
 * These tests use a stub poloniexFuturesService via vi.doMock so we
 * exercise the status-reporting paths without an exchange round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STUB_CANDLE_RAW = {
  open: '100',
  high: '101',
  low: '99',
  close: '100.5',
  volume: '10',
};

function repeatCandles(n: number, start = 0): Array<typeof STUB_CANDLE_RAW & { timestamp: number }> {
  return Array.from({ length: n }, (_, i) => ({
    ...STUB_CANDLE_RAW,
    timestamp: 1_700_000_000_000 + (start + i) * 60_000,
  }));
}

describe('bootstrapMTFForSymbol — status reporting', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('../../poloniexFuturesService.js');
  });

  it('reports success for all three TFs when candles are sufficient', async () => {
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: vi.fn().mockResolvedValue(repeatCandles(700)) },
    }));
    const { bootstrapMTFForSymbol } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const status = await bootstrapMTFForSymbol('BTC_USDT_PERP', state);
    expect(status.allSucceeded).toBe(true);
    expect(status.perTimeframe.map((p) => p.label)).toEqual(['15m', '1h', '4h']);
    expect(status.perTimeframe.every((p) => p.status === 'success')).toBe(true);
    expect(status.perTimeframe.every((p) => p.basinsPopulated > 0)).toBe(true);
  });

  it('reports insufficient_candles when exchange returns below warm threshold', async () => {
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: vi.fn().mockResolvedValue(repeatCandles(200)) },
    }));
    const { bootstrapMTFForSymbol, bootstrapMinCandlesNeeded } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const status = await bootstrapMTFForSymbol('BTC_USDT_PERP', state);
    const need15m = bootstrapMinCandlesNeeded('15m');
    expect(status.allSucceeded).toBe(false);
    expect(status.perTimeframe.every((p) => p.status === 'insufficient_candles')).toBe(true);
    expect(status.perTimeframe[0]!.errorMessage).toContain('got 200 candles');
    expect(status.perTimeframe[0]!.errorMessage).toContain(`need ≥ ${need15m}`);
  });

  it('reports fetch_failed when getHistoricalData throws', async () => {
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: vi.fn().mockRejectedValue(new Error('429 rate limited')) },
    }));
    const { bootstrapMTFForSymbol } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const status = await bootstrapMTFForSymbol('BTC_USDT_PERP', state);
    expect(status.allSucceeded).toBe(false);
    expect(status.perTimeframe.every((p) => p.status === 'fetch_failed')).toBe(true);
    expect(status.perTimeframe[0]!.errorMessage).toContain('429');
  });

  it('reports partial state — one TF success, others fetch_failed', async () => {
    const stub = vi.fn();
    // 15m succeeds; 1h + 4h throw.
    stub.mockResolvedValueOnce(repeatCandles(700));
    stub.mockRejectedValueOnce(new Error('1h unavailable'));
    stub.mockRejectedValueOnce(new Error('4h unavailable'));
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: stub },
    }));
    const { bootstrapMTFForSymbol } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const status = await bootstrapMTFForSymbol('BTC_USDT_PERP', state);
    expect(status.allSucceeded).toBe(false);
    expect(status.perTimeframe[0]!.status).toBe('success');
    expect(status.perTimeframe[1]!.status).toBe('fetch_failed');
    expect(status.perTimeframe[2]!.status).toBe('fetch_failed');
    expect(status.perTimeframe[0]!.basinsPopulated).toBeGreaterThan(0);
    expect(status.perTimeframe[1]!.basinsPopulated).toBe(0);
  });

  it('startedAtMs and finishedAtMs bracket the call', async () => {
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: vi.fn().mockResolvedValue(repeatCandles(700)) },
    }));
    const { bootstrapMTFForSymbol } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const before = Date.now();
    const status = await bootstrapMTFForSymbol('BTC_USDT_PERP', state);
    const after = Date.now();
    expect(status.startedAtMs).toBeGreaterThanOrEqual(before);
    expect(status.finishedAtMs).toBeLessThanOrEqual(after);
    expect(status.finishedAtMs).toBeGreaterThanOrEqual(status.startedAtMs);
  });

  it('bootstraps only requested timeframes when labels filter is provided', async () => {
    const stub = vi.fn().mockResolvedValue(repeatCandles(700));
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: stub },
    }));
    const { bootstrapMTFForSymbol } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const status = await bootstrapMTFForSymbol('BTC_USDT_PERP', state, ['1h']);
    expect(status.perTimeframe).toHaveLength(1);
    expect(status.perTimeframe[0]!.label).toBe('1h');
    expect(status.perTimeframe[0]!.status).toBe('success');
    expect(stub).toHaveBeenCalledTimes(1);
    // 4th arg is the opts object containing startTime so the service's
    // chunked-loop pagination actually returns the requested count
    // (otherwise the 500-per-call cap silently truncates → MTF L cold).
    expect(stub).toHaveBeenCalledWith(
      'BTC_USDT_PERP',
      '1h',
      700,
      expect.objectContaining({ startTime: expect.any(Number) }),
    );
  });

  it('passes a startTime opt so getHistoricalData paginates past the 500-per-call cap', async () => {
    // Regression for the 2026-05-16 scalp-spiral root cause: bootstrap
    // demanded 700 candles, exchange capped each single-call response at
    // 500, mtfBootstrap was NOT supplying opts.startTime so the service
    // never engaged its loop → 500 returned < 650 bootstrapMinCandlesNeeded
    // ('15m') → marked insufficient_candles → MTF L permanently cold →
    // no 3-of-3 agreement gate on K's entries → scalp-spiral.
    const stub = vi.fn().mockResolvedValue(repeatCandles(700));
    vi.doMock('../../poloniexFuturesService.js', () => ({
      default: { getHistoricalData: stub },
    }));
    const { bootstrapMTFForSymbol } = await import('../mtfBootstrap.js');
    const { newMTFState } = await import('../mtfLClassifier.js');
    const state = newMTFState();
    const beforeMs = Date.now();
    await bootstrapMTFForSymbol('BTC_USDT_PERP', state, ['15m', '1h', '4h']);
    // 15m: 700 candles × 15min = ~7.3 days back
    const callFor = (label: '15m' | '1h' | '4h') => {
      const expectedIntervalMs = label === '15m' ? 900_000 : label === '1h' ? 3_600_000 : 14_400_000;
      const c = stub.mock.calls.find((args) => args[1] === label);
      expect(c, `expected one call for ${label}`).toBeTruthy();
      const opts = c![3] as { startTime: number };
      expect(opts).toBeDefined();
      expect(typeof opts.startTime).toBe('number');
      // startTime must be back by approximately BOOTSTRAP_CANDLE_COUNT (700)
      // × intervalMs from "now" — tolerate small drift from the test
      // setup wall-clock.
      const expectedStart = beforeMs - expectedIntervalMs * 700;
      expect(opts.startTime).toBeGreaterThan(expectedStart - 60_000);
      expect(opts.startTime).toBeLessThan(expectedStart + 60_000);
    };
    callFor('15m');
    callFor('1h');
    callFor('4h');
  });
});
