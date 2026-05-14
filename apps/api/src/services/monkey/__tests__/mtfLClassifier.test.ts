/**
 * mtfLClassifier.test.ts — verify per-timeframe down-sampling and
 * agreement-count combiner logic.
 */
import { describe, it, expect } from 'vitest';
import {
  newMTFState,
  onTickAppend,
  setBootstrapHistory,
  mtfDecide,
  recordAgreementTimestamps,
  isLongestHorizonExpired,
  DEFAULT_TIMEFRAMES,
  type TimeframeConfig,
} from '../mtfLClassifier.js';
import { uniformBasin } from '../basin.js';
import type { Basin } from '../basin.js';

const BASIN_DIM = 64;

describe('newMTFState', () => {
  it('initializes empty histories + sentinel last-sample ticks', () => {
    const s = newMTFState();
    expect(s.historiesByTf['15m']).toEqual([]);
    expect(s.historiesByTf['1h']).toEqual([]);
    expect(s.historiesByTf['4h']).toEqual([]);
    expect(s.lastSampleTickByTf['15m']).toBe(-Infinity);
    expect(s.lastAgreementByTfSide['1h'].long).toBe(null);
  });
});

describe('onTickAppend (down-sampling)', () => {
  it('appends to 15m every 30 ticks', () => {
    const s = newMTFState();
    const b = uniformBasin(BASIN_DIM);
    // First tick: appends to all (boundary always crossed from -Infinity).
    onTickAppend(s, b, 0);
    expect(s.historiesByTf['15m'].length).toBe(1);
    expect(s.historiesByTf['1h'].length).toBe(1);
    expect(s.historiesByTf['4h'].length).toBe(1);
    // Tick 29: still within 15m boundary (30-tick spacing).
    onTickAppend(s, b, 29);
    expect(s.historiesByTf['15m'].length).toBe(1);
    // Tick 30: 15m boundary crossed.
    onTickAppend(s, b, 30);
    expect(s.historiesByTf['15m'].length).toBe(2);
    expect(s.historiesByTf['1h'].length).toBe(1);  // still within 1h boundary
  });

  it('appends to 1h every 120 ticks', () => {
    const s = newMTFState();
    const b = uniformBasin(BASIN_DIM);
    onTickAppend(s, b, 0);
    expect(s.historiesByTf['1h'].length).toBe(1);
    onTickAppend(s, b, 60);
    expect(s.historiesByTf['1h'].length).toBe(1);  // not yet
    onTickAppend(s, b, 120);
    expect(s.historiesByTf['1h'].length).toBe(2);
  });

  it('caps history at maxSamples', () => {
    // Use tiny maxSamples for the test.
    const tfs: TimeframeConfig[] = [{
      label: '15m', ticksPerSample: 1, maxSamples: 3,
      config: DEFAULT_TIMEFRAMES[0].config,
    }];
    const s = newMTFState(tfs);
    for (let i = 0; i < 10; i++) onTickAppend(s, uniformBasin(BASIN_DIM), i, tfs);
    expect(s.historiesByTf['15m'].length).toBe(3);
  });
});

describe('setBootstrapHistory', () => {
  it('replaces the history for a timeframe', () => {
    const s = newMTFState();
    const bootstrap: Basin[] = [];
    for (let i = 0; i < 100; i++) bootstrap.push(uniformBasin(BASIN_DIM));
    setBootstrapHistory(s, '4h', bootstrap);
    expect(s.historiesByTf['4h'].length).toBe(100);
  });

  it('caps bootstrap at maxSamples', () => {
    const s = newMTFState();
    const bootstrap: Basin[] = [];
    for (let i = 0; i < 3000; i++) bootstrap.push(uniformBasin(BASIN_DIM));
    setBootstrapHistory(s, '4h', bootstrap);
    expect(s.historiesByTf['4h'].length).toBe(2000);  // capped at maxSamples
  });
});

describe('mtfDecide (combiner)', () => {
  it('holds when no timeframes are warm', () => {
    const s = newMTFState();
    const d = mtfDecide(s);
    expect(d.action).toBe('hold');
    expect(d.agreementCount).toBe(0);
    expect(d.sizeMultiplier).toBe(0);
    expect(d.reason).toBe('no_warm_timeframes');
  });

  it('reports per-TF warm status', () => {
    const s = newMTFState();
    // Build a 200-basin history (insufficient — minSamplesNeeded = 480 + 120 = 600).
    for (let i = 0; i < 200; i++) {
      onTickAppend(s, uniformBasin(BASIN_DIM), i * 30);
    }
    const d = mtfDecide(s);
    // All TFs not warm yet.
    for (const entry of d.perTimeframe) {
      expect(entry.warm).toBe(false);
      expect(entry.decision).toBe(null);
    }
  });
});

describe('per-TF horizon expiry', () => {
  it('returns false when no agreement timestamp recorded', () => {
    const s = newMTFState();
    const expired = isLongestHorizonExpired(s, 'long', '1h', Date.now(), 30_000);
    expect(expired).toBe(false);
  });

  it('returns false when within horizon', () => {
    const s = newMTFState();
    // 1h config has horizon=120 ticks × 120 ticksPerSample × 30s tickMs
    // = 432_000_000ms = 5 days. Way longer than any reasonable test.
    // For test simplicity use a 1-tick-per-sample config.
    const tfs: TimeframeConfig[] = [{
      label: '1h', ticksPerSample: 1, maxSamples: 100,
      config: { ...DEFAULT_TIMEFRAMES[1].config, horizon: 60 },
    }];
    const state = newMTFState(tfs);
    state.lastAgreementByTfSide['1h'].long = Date.now() - 1000;  // 1s ago
    const expired = isLongestHorizonExpired(state, 'long', '1h', Date.now(), 30_000, tfs);
    // horizon = 60 * 1 * 30000 = 1,800,000ms, much greater than 1s elapsed.
    expect(expired).toBe(false);
  });

  it('returns true when horizon exceeded', () => {
    const tfs: TimeframeConfig[] = [{
      label: '15m', ticksPerSample: 1, maxSamples: 100,
      config: { ...DEFAULT_TIMEFRAMES[0].config, horizon: 1 },
    }];
    const state = newMTFState(tfs);
    state.lastAgreementByTfSide['15m'].long = Date.now() - 60_000;  // 60s ago
    // horizon = 1 * 1 * 30000 = 30s. 60s elapsed > 30s horizon → expired.
    const expired = isLongestHorizonExpired(state, 'long', '15m', Date.now(), 30_000, tfs);
    expect(expired).toBe(true);
  });
});

describe('recordAgreementTimestamps', () => {
  it('does nothing on hold', () => {
    const s = newMTFState();
    recordAgreementTimestamps(s, {
      action: 'hold', agreementCount: 0, totalTfs: 3, sizeMultiplier: 0,
      perTimeframe: [], longestAgreeingLabel: null, reason: 'test',
    }, Date.now());
    expect(s.lastAgreementByTfSide['15m'].long).toBe(null);
  });

  it('records on each TF that voted with majority', () => {
    const s = newMTFState();
    const now = Date.now();
    recordAgreementTimestamps(s, {
      action: 'enter_long',
      agreementCount: 2,
      totalTfs: 3,
      sizeMultiplier: 0.5,
      perTimeframe: [
        { label: '15m', warm: true, decision: { action: 'enter_long' } as never },
        { label: '1h', warm: true, decision: { action: 'enter_long' } as never },
        { label: '4h', warm: true, decision: { action: 'hold' } as never },
      ],
      longestAgreeingLabel: '1h',
      reason: 'test',
    }, now);
    expect(s.lastAgreementByTfSide['15m'].long).toBe(now);
    expect(s.lastAgreementByTfSide['1h'].long).toBe(now);
    expect(s.lastAgreementByTfSide['4h'].long).toBe(null);  // didn't vote long
    expect(s.lastAgreementByTfSide['15m'].short).toBe(null);
  });
});
