/**
 * per_agent_bus.test.ts — cross-agent observation context tests.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCrossAgentContext,
  convictionDampenerFromBus,
  DEFAULT_BUS_WINDOW_TICKS,
} from '../per_agent_bus.js';
import { BusEventType, type BusEvent } from '../kernel_bus.js';

function entryEvent(agent: 'K' | 'M' | 'T' | 'L', side: 'long' | 'short'): BusEvent {
  return {
    type: BusEventType.ENTRY_EXECUTED,
    source: 'monkey-test',
    symbol: 'BTC_USDT_PERP',
    payload: { agent, side, orderId: 'test-' + agent },
  };
}

describe('buildCrossAgentContext', () => {
  it('returns neutral on empty events', () => {
    const ctx = buildCrossAgentContext([], 'M', 100);
    expect(ctx.recentEntryByOtherAgent).toBeNull();
    expect(ctx.recentVetoCount).toBe(0);
    expect(ctx.recentExits).toEqual([]);
    expect(ctx.recentAnomalies).toBe(0);
  });

  it('captures another agent\'s recent entry', () => {
    const ctx = buildCrossAgentContext([entryEvent('K', 'long')], 'M', 100);
    expect(ctx.recentEntryByOtherAgent).not.toBeNull();
    expect(ctx.recentEntryByOtherAgent!.agent).toBe('K');
    expect(ctx.recentEntryByOtherAgent!.side).toBe('long');
  });

  it("ignores the viewer's own entries", () => {
    const ctx = buildCrossAgentContext([entryEvent('M', 'long')], 'M', 100);
    expect(ctx.recentEntryByOtherAgent).toBeNull();
  });

  it('counts vetoes and anomalies', () => {
    const events: BusEvent[] = [
      { type: BusEventType.KERNEL_VETO, source: 'k', symbol: 'BTC', payload: {} },
      { type: BusEventType.KERNEL_VETO, source: 'k', symbol: 'BTC', payload: {} },
      { type: BusEventType.ANOMALY, source: 'k', symbol: 'BTC', payload: {} },
    ];
    const ctx = buildCrossAgentContext(events, 'M', 100);
    expect(ctx.recentVetoCount).toBe(2);
    expect(ctx.recentAnomalies).toBe(1);
  });

  it('captures exit events from other agents', () => {
    const events: BusEvent[] = [
      { type: BusEventType.EXIT_TRIGGERED, source: 'k', symbol: 'BTC', payload: { agent: 'K' } },
      { type: BusEventType.EXIT_TRIGGERED, source: 'k', symbol: 'BTC', payload: { agent: 'T' } },
    ];
    const ctx = buildCrossAgentContext(events, 'M', 100);
    expect(ctx.recentExits).toContain('K');
    expect(ctx.recentExits).toContain('T');
  });
});

describe('convictionDampenerFromBus', () => {
  it('returns 1.0 when no recent entry', () => {
    const ctx = buildCrossAgentContext([], 'M', 100);
    expect(convictionDampenerFromBus(ctx, 'long')).toBe(1.0);
  });

  it('returns 1.0 on same-side recent entry', () => {
    const ctx = buildCrossAgentContext([entryEvent('K', 'long')], 'M', 100);
    expect(convictionDampenerFromBus(ctx, 'long')).toBe(1.0);
  });

  it('dampens on opposite-side recent entry', () => {
    const ctx = buildCrossAgentContext([entryEvent('K', 'short')], 'M', 100);
    const d = convictionDampenerFromBus(ctx, 'long');
    expect(d).toBeLessThan(1.0);
    expect(d).toBeGreaterThanOrEqual(0.3);
  });

  it('dampener within [0.3, 1.0] bounds', () => {
    const ctx = buildCrossAgentContext([entryEvent('K', 'short')], 'M', 100);
    const d = convictionDampenerFromBus(ctx, 'long');
    expect(d).toBeGreaterThanOrEqual(0.3);
    expect(d).toBeLessThanOrEqual(1.0);
  });
});
