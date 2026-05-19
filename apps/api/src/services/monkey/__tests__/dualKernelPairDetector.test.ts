import { describe, it, expect, beforeEach } from 'vitest';
import { getKernelBus, BusEventType } from '../kernel_bus.js';
import {
  attachDualKernelPairDetector,
  getPairStats,
  _resetDualKernelPairDetector,
} from '../dual_kernel_pair_detector.js';

describe('dual_kernel_pair_detector — opposing-side pair governance', () => {
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    _resetDualKernelPairDetector();
    if (unsub) unsub();
    const bus = getKernelBus();
    unsub = attachDualKernelPairDetector(bus);
  });

  function publishEntry(
    instanceId: string,
    symbol: string,
    side: 'long' | 'short',
    orderId: string,
    notional: number = 100,
  ): void {
    getKernelBus().publish({
      type: BusEventType.ENTRY_EXECUTED,
      source: instanceId,
      symbol,
      payload: { side, orderId, notional },
    });
  }

  function publishExit(orderId: string, pnl: number, symbol: string = 'BTC_USDT_PERP'): void {
    getKernelBus().publish({
      type: BusEventType.EXIT_TRIGGERED,
      source: 'reconciler',
      symbol,
      payload: { orderId, pnl },
    });
  }

  it('detects opposing-side pair from different instances', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'short', 'order-2');
    const stats = getPairStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it('does NOT pair same-instance entries (e.g., DCA add)', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'short', 'order-2');
    expect(getPairStats().total).toBe(0);
  });

  it('does NOT pair same-side entries', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'long', 'order-2');
    expect(getPairStats().total).toBe(0);
  });

  it('does NOT pair different-symbol entries', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'ETH_USDT_PERP', 'short', 'order-2');
    expect(getPairStats().total).toBe(0);
  });

  it('classifies both_won when both close profitable', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'short', 'order-2');
    publishExit('order-1', 0.05);
    publishExit('order-2', 0.03);
    const stats = getPairStats();
    expect(stats.bothWon).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it('classifies both_lost when both close negative', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'short', 'order-2');
    publishExit('order-1', -0.05);
    publishExit('order-2', -0.03);
    expect(getPairStats().bothLost).toBe(1);
  });

  it('classifies mixed_balanced when loss is within 1.5× of win', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'short', 'order-2');
    publishExit('order-1', 0.10);   // win
    publishExit('order-2', -0.13);  // loss × 1.3 of win, within 1.5
    expect(getPairStats().mixedBalanced).toBe(1);
    expect(getPairStats().mixedOverrun).toBe(0);
  });

  it('classifies mixed_overrun when loss > 1.5× of win', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'short', 'order-2');
    publishExit('order-1', 0.10);   // win
    publishExit('order-2', -0.20);  // loss × 2.0 of win → overrun
    const stats = getPairStats();
    expect(stats.mixedOverrun).toBe(1);
    expect(stats.recentOverruns).toHaveLength(1);
  });

  it('pair evaluation only fires when BOTH sides have exited', () => {
    publishEntry('monkey-position', 'BTC_USDT_PERP', 'long', 'order-1');
    publishEntry('monkey-swing', 'BTC_USDT_PERP', 'short', 'order-2');
    publishExit('order-1', 0.05);
    // order-2 still open
    expect(getPairStats().pending).toBe(1);
    expect(getPairStats().bothWon).toBe(0);
    publishExit('order-2', 0.03);
    expect(getPairStats().bothWon).toBe(1);
    expect(getPairStats().pending).toBe(0);
  });
});
