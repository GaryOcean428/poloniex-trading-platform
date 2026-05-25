/**
 * qigramV2PerSymbolPartition.test.ts — per-symbol sovereignty signal.
 *
 * Topology audit (post-#912): each MonkeyKernel handles DEFAULT_SYMBOLS
 * = ['BTC_USDT_PERP', 'ETH_USDT_PERP'] through ONE shared QIGRAMv2State.
 * With LRU-at-HISTORY_MAX (100) and 2 inserts per tick, the oldest entry
 * in a shared store has been decayed at most ~49 times (0.95^49 ≈ 0.081)
 * — never below MIN_ACTIVE_WEIGHT (0.01). So sov pins at 1.0 in steady
 * state, identical pathology to PR906's per-tick consolidate via a
 * different mechanism.
 *
 * Fix: partition the store by symbol. Each symbol gets its own
 * QIGRAMv2State; LRU and decay then cover ~100 ticks per symbol
 * (≥ the 90-tick decay-to-threshold). Per-symbol sov is also more
 * informative than the conflated aggregate, mirroring the per-symbol
 * SelfObservation asymmetry surfaced by PR #911.
 */
import { describe, test, expect } from 'vitest';
import {
  QIGRAMv2Partition,
  QIGRAMV2_HISTORY_MAX,
} from '../agent_L_qigram_v2.js';
import { uniformBasin } from '../basin.js';

const B = uniformBasin();
const BTC = 'BTC_USDT_PERP';
const ETH = 'ETH_USDT_PERP';

describe('QIGRAMv2Partition (per-symbol store)', () => {
  test('integrate routes by symbol — BTC inserts do not displace ETH entries', () => {
    const part = new QIGRAMv2Partition();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      part.integrate(ETH, `eth|${i}`, B, { weight: 1.0, correct: true });
    }
    // Now flood BTC — ETH partition must be untouched.
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX * 3; i++) {
      part.integrate(BTC, `btc|${i}`, B, { weight: 1.0, correct: true });
    }
    expect(part.totalEntries(ETH)).toBe(QIGRAMV2_HISTORY_MAX);
    expect(part.totalEntries(BTC)).toBe(QIGRAMV2_HISTORY_MAX);
    // Each partition LRU-evicted only within its own bucket.
    const ethIds = part.activeEntries(ETH).map((e) => e.id);
    expect(ethIds).toContain('eth|0');  // ETH's oldest survived the BTC flood
  });

  test('decayAll(symbol) decays only that symbol — sovereignties diverge', () => {
    const part = new QIGRAMv2Partition();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      part.integrate(BTC, `tick|${i}`, B, { weight: 1.0, correct: true });
      part.integrate(ETH, `tick|${i}`, B, { weight: 1.0, correct: true });
    }
    // Decay only ETH past the threshold.
    for (let t = 0; t < 100; t++) part.decayAll(ETH);
    expect(part.sovereignty(BTC)).toBe(1.0);
    expect(part.sovereignty(ETH)).toBeCloseTo(0, 6);
  });

  test('sovereignty(symbol) is not pinned at 1.0 in steady state — ranges meaningfully per partition', () => {
    // Per-symbol partition restores the bounded-window guarantee even
    // with 2 symbols ticking. Each store covers HISTORY_MAX ticks ≥
    // decay-to-threshold (90), so the oldest live entry can age below
    // MIN_ACTIVE_WEIGHT before LRU evicts it.
    const part = new QIGRAMv2Partition();
    const TICKS = QIGRAMV2_HISTORY_MAX * 2;
    for (let i = 0; i < TICKS; i++) {
      part.integrate(BTC, `tick|${i}`, B, { weight: 1.0, correct: true });
      part.integrate(ETH, `tick|${i}`, B, { weight: 1.0, correct: true });
      part.decayAll(BTC);
      part.decayAll(ETH);
    }
    const sovBtc = part.sovereignty(BTC);
    const sovEth = part.sovereignty(ETH);
    expect(sovBtc).toBeGreaterThan(0.5);
    expect(sovBtc).toBeLessThan(1.0);
    expect(sovEth).toBeGreaterThan(0.5);
    expect(sovEth).toBeLessThan(1.0);
    expect(part.totalEntries(BTC)).toBe(QIGRAMV2_HISTORY_MAX);
    expect(part.totalEntries(ETH)).toBe(QIGRAMV2_HISTORY_MAX);
  });

  test('sovereignty(symbol) is 1.0 (or 0 with no entries) when partition is empty', () => {
    const part = new QIGRAMv2Partition();
    // Empty partition: no information — caller treats as "no signal yet".
    expect(part.totalEntries('UNKNOWN_PERP')).toBe(0);
    expect(part.activeEntries('UNKNOWN_PERP')).toEqual([]);
    expect(part.sovereignty('UNKNOWN_PERP')).toBe(1.0);
  });

  test('recall and recallByCategory are partition-scoped', () => {
    const part = new QIGRAMv2Partition();
    part.integrate(BTC, 'btc|a', B, { weight: 1.0, correct: true, category: 'CREATOR_TREND_UP' });
    part.integrate(ETH, 'eth|a', B, { weight: 1.0, correct: true, category: 'DISSOLVER_CHOP' });
    // BTC partition recall hits BTC ids only.
    const btcHit = part.recallByCategory(BTC, 'CREATOR_TREND_UP');
    expect(btcHit?.source).toBe('btc|a');
    const btcMiss = part.recallByCategory(BTC, 'DISSOLVER_CHOP');
    expect(btcMiss).toBeNull();
    // ETH partition is independent.
    const ethHit = part.recallByCategory(ETH, 'DISSOLVER_CHOP');
    expect(ethHit?.source).toBe('eth|a');
  });

  test('recordOutcome routes by symbol — wrong outcome on BTC does not affect ETH sov', () => {
    const part = new QIGRAMv2Partition();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      part.integrate(BTC, `tick|${i}`, B, { weight: 1.0, correct: true });
      part.integrate(ETH, `tick|${i}`, B, { weight: 1.0, correct: true });
    }
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX / 2; i++) {
      part.recordOutcome(BTC, `tick|${i}`, false);
    }
    expect(part.sovereignty(BTC)).toBeCloseTo(0.5, 6);
    expect(part.sovereignty(ETH)).toBe(1.0);
  });
});
