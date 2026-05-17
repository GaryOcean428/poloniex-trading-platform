import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeBtcBeacon,
  observeBtcBeacon,
  _resetBtcBeacon,
  _peekBtcBeacon,
} from '../btc_beacon.js';

describe('computeBtcBeacon — pure derivation', () => {
  it('returns warmup with neutral values on empty input', () => {
    const r = computeBtcBeacon([], []);
    expect(r.warmup).toBe(true);
    expect(r.correlation).toBe(0);
    expect(r.btcDirection).toBe(0);
    expect(r.suppressionMagnitude).toBe(0);
  });

  it('returns warmup when n < MIN_SAMPLES (8)', () => {
    const r = computeBtcBeacon([1, 2, 3], [10, 20, 30]);
    expect(r.warmup).toBe(true);
  });

  it('correlation +1 for perfectly synchronised moves', () => {
    const eth = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const btc = [50_000, 50_100, 50_200, 50_300, 50_400, 50_500, 50_600, 50_700, 50_800, 50_900];
    const r = computeBtcBeacon(eth, btc);
    expect(r.warmup).toBe(false);
    expect(r.correlation).toBeCloseTo(1.0, 6);
    expect(r.btcDirection).toBeGreaterThan(0);
  });

  it('correlation −1 for perfectly opposing moves', () => {
    const eth = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    const btc = [50_000, 50_100, 50_200, 50_300, 50_400, 50_500, 50_600, 50_700, 50_800, 50_900];
    const r = computeBtcBeacon(eth, btc);
    expect(r.correlation).toBeCloseTo(-1.0, 6);
  });

  it('correlation 0 when one side is flat (zero variance)', () => {
    const eth = [100, 100, 100, 100, 100, 100, 100, 100];
    const btc = [50_000, 50_100, 50_200, 50_300, 50_400, 50_500, 50_600, 50_700];
    const r = computeBtcBeacon(eth, btc);
    expect(r.correlation).toBe(0);
  });

  it('btcDirection sign tracks the latest-vs-first delta', () => {
    const eth = [100, 100, 100, 100, 100, 100, 100, 100];
    const btcUp = [50_000, 50_100, 50_200, 50_300, 50_400, 50_500, 50_600, 50_700];
    const btcDown = [50_000, 49_900, 49_800, 49_700, 49_600, 49_500, 49_400, 49_300];
    expect(computeBtcBeacon(eth, btcUp).btcDirection).toBeGreaterThan(0);
    expect(computeBtcBeacon(eth, btcDown).btcDirection).toBeLessThan(0);
  });

  it('suppressionMagnitude in [0, 1]', () => {
    const eth = [100, 99, 98, 97, 96, 95, 94, 93];
    const btc = [50_000, 49_900, 49_800, 49_700, 49_600, 49_500, 49_400, 49_300];
    const r = computeBtcBeacon(eth, btc);
    expect(r.suppressionMagnitude).toBeGreaterThanOrEqual(0);
    expect(r.suppressionMagnitude).toBeLessThanOrEqual(1);
  });

  it('window cap respected — only trailing N samples used', () => {
    const long = Array.from({ length: 200 }, (_, i) => 100 + i);
    const btcLong = Array.from({ length: 200 }, (_, i) => 50_000 + i * 50);
    const last30Eth = long.slice(-30);
    const last30Btc = btcLong.slice(-30);
    const fromFull = computeBtcBeacon(long, btcLong, 30);
    const fromSlice = computeBtcBeacon(last30Eth, last30Btc, 30);
    expect(fromFull.correlation).toBeCloseTo(fromSlice.correlation, 9);
    expect(fromFull.n).toBe(30);
  });
});

describe('observeBtcBeacon — per-symbol rolling buffer', () => {
  beforeEach(() => _resetBtcBeacon());

  it('per-symbol state is independent', () => {
    observeBtcBeacon('ETH_USDT_PERP', 2000, 50_000);
    observeBtcBeacon('SOL_USDT_PERP', 150, 50_000);
    expect(_peekBtcBeacon('ETH_USDT_PERP').symbolPrices).toEqual([2000]);
    expect(_peekBtcBeacon('SOL_USDT_PERP').symbolPrices).toEqual([150]);
  });

  it('warms up to a non-trivial reading after MIN_SAMPLES', () => {
    let r: ReturnType<typeof observeBtcBeacon> | null = null;
    for (let i = 0; i < 10; i++) {
      r = observeBtcBeacon('ETH_USDT_PERP', 2000 + i, 50_000 + i * 25);
    }
    expect(r!.warmup).toBe(false);
    expect(r!.correlation).toBeCloseTo(1.0, 4);  // synchronised up
    expect(r!.btcDirection).toBeGreaterThan(0);
  });

  it('reset clears state for a single symbol or all', () => {
    observeBtcBeacon('A', 1, 1);
    observeBtcBeacon('B', 1, 1);
    _resetBtcBeacon('A');
    expect(_peekBtcBeacon('A').symbolPrices).toHaveLength(0);
    expect(_peekBtcBeacon('B').symbolPrices).toHaveLength(1);
    _resetBtcBeacon();
    expect(_peekBtcBeacon('B').symbolPrices).toHaveLength(0);
  });
});

describe('SENSE-2 reference scenario — BTC-dump suppresses alt-long', () => {
  beforeEach(() => _resetBtcBeacon());

  it('strong negative correlation + strong BTC down produces high suppression magnitude', () => {
    // ETH holds while BTC dumps — they ARE correlated in reality but
    // this test simulates strong opposite move which still produces
    // high suppression-magnitude via |corr| × |btcDir|.
    const eth = [2000, 2002, 2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018];
    const btc = [80_000, 79_500, 79_000, 78_500, 78_000, 77_500, 77_000, 76_500, 76_000, 75_500];
    const r = computeBtcBeacon(eth, btc);
    expect(r.correlation).toBeLessThan(-0.9);  // strong opposing
    expect(r.btcDirection).toBeLessThan(0);    // BTC trending down
    expect(r.suppressionMagnitude).toBeGreaterThan(0.5);  // high enough to trigger downstream gating
  });

  it('synchronised mild moves produce low suppression magnitude (normal regime)', () => {
    // Both moving slowly in the same direction — normal market;
    // no special suppression needed.
    const eth = [2000, 2001, 2001, 2002, 2002, 2003, 2003, 2004];
    const btc = [50_000, 50_010, 50_010, 50_020, 50_020, 50_030, 50_030, 50_040];
    const r = computeBtcBeacon(eth, btc);
    expect(r.correlation).toBeGreaterThan(0);
    expect(Math.abs(r.btcDirection)).toBeLessThan(0.001);  // tiny move
    expect(r.suppressionMagnitude).toBeLessThan(0.5);
  });
});
