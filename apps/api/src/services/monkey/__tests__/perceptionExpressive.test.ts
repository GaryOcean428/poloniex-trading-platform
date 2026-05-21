/**
 * B1 — expressive momentum basin + B1.1 noise-anchored neutral.
 *
 * The pre-B1 norm01 sigmoid crushed the momentum band into [0.45,0.55]
 * on the realized log-return distribution → near-uniform basin →
 * |basinDirection| pinned < 0.05 → the magnitude gates (M-agent +
 * FAST_ADVERSE_EXIT @ 0.10) could never fire. B1.1 then fixed the
 * neutral skew (#880's `8·peerMean` biased the sign +).
 *
 * These run the real perceive() → basinDirection() production path:
 * expressive momentum + the noise-floor-anchored neutral (which
 * engages automatically on a genuine perceive() basin).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { perceive, basinDirection, type OHLCVCandle, type PerceptionInputs } from '../perception.js';

/** Geometric trend series — `perBarReturn` per 15m bar. */
function trendSeries(n: number, perBarReturn: number): OHLCVCandle[] {
  const out: OHLCVCandle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const prev = close;
    close = close * (1 + perBarReturn);
    out.push({
      timestamp: i * 900_000,
      open: prev,
      high: Math.max(prev, close) * 1.0005,
      low: Math.min(prev, close) * 0.9995,
      close,
      volume: 1000,
    });
  }
  return out;
}

const inputs = (ohlcv: OHLCVCandle[]): PerceptionInputs => ({
  ohlcv,
  equityFraction: 0.5,
  marginFraction: 0.1,
  openPositions: 0,
  sessionAgeTicks: 100,
});

describe('B1 — expressive momentum basin', () => {
  afterEach(() => { delete process.env.MONKEY_PERCEPTION_EXPRESSIVE_LIVE; });

  it('uptrend → basinDirection reaches the 0.10 magnitude gate', () => {
    expect(basinDirection(perceive(inputs(trendSeries(160, 0.003))))).toBeGreaterThan(0.10);
  });

  it('downtrend → basinDirection clearly negative past −0.10', () => {
    expect(basinDirection(perceive(inputs(trendSeries(160, -0.003))))).toBeLessThan(-0.10);
  });

  it('flat market → basinDirection stays near zero', () => {
    expect(Math.abs(basinDirection(perceive(inputs(trendSeries(160, 0)))))).toBeLessThan(0.05);
  });

  it('legacy sigmoid (flag off) is strictly less expressive on the same uptrend', () => {
    process.env.MONKEY_PERCEPTION_EXPRESSIVE_LIVE = 'false';
    const legacy = basinDirection(perceive(inputs(trendSeries(160, 0.003))));
    delete process.env.MONKEY_PERCEPTION_EXPRESSIVE_LIVE;
    const expressive = basinDirection(perceive(inputs(trendSeries(160, 0.003))));
    expect(expressive).toBeGreaterThan(legacy);
  });

  // B1.1 — noise-floor-anchored neutral. The pre-B1.1 `8·peerMean`
  // neutral skewed low (the volume/volatility peer bands are not
  // 0.5-centred) → basinDir was sign-pinned positive even on flat /
  // mildly-down markets. The noise anchor makes the neutral exact.
  it('neutral is unbiased — flat market reads ≈ 0 (not sign-pinned +)', () => {
    expect(Math.abs(basinDirection(perceive(inputs(trendSeries(160, 0)))))).toBeLessThan(0.02);
  });

  it('neutral is unbiased — a mild down-drift reads negative', () => {
    expect(basinDirection(perceive(inputs(trendSeries(160, -0.0006))))).toBeLessThan(0);
  });
});
