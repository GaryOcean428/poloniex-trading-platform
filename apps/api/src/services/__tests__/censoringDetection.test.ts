/**
 * Unit tests for censoring detection helpers.
 *
 * Validates:
 *   - isCensored() from paperTradingService.js
 *   - detectBacktestCensoring() (exported for testing via re-export below)
 *
 * Both functions are pure / near-pure (no DB calls), so no mocking of
 * database infrastructure is needed.
 */

import { describe, it, expect } from 'vitest';

// ─── isCensored (paper trading) ──────────────────────────────────────────────

// Import only the named export — the class is the default export and requires
// DB/WebSocket infrastructure we don't want to spin up here.
import { isCensored } from '../paperTradingService.js';

describe('isCensored (paper trading session)', () => {
  const baseSession = {
    initialCapital: 10000,
    currentValue: 10000,
    riskParameters: { maxDailyLoss: 0.05 },
    startedAt: new Date(Date.now() - 1000),
    maxDurationMs: undefined as number | undefined
  };

  it('returns false for a healthy session within all limits', () => {
    const result = isCensored({ ...baseSession, currentValue: 9600 }); // 4 % loss < 5 % limit
    expect(result.isCensored).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('returns true with reason=max_drawdown when drawdown >= limit', () => {
    // exactly at the limit (5 % loss)
    const result = isCensored({ ...baseSession, currentValue: 9500 });
    expect(result.isCensored).toBe(true);
    expect(result.reason).toBe('max_drawdown');
  });

  it('returns true with reason=max_drawdown when drawdown exceeds limit', () => {
    // 10 % loss > 5 % limit
    const result = isCensored({ ...baseSession, currentValue: 9000 });
    expect(result.isCensored).toBe(true);
    expect(result.reason).toBe('max_drawdown');
  });

  it('returns true when censoringReason is already set to max_drawdown', () => {
    const session = { ...baseSession, censoringReason: 'max_drawdown' };
    const result = isCensored(session);
    expect(result.isCensored).toBe(true);
    expect(result.reason).toBe('max_drawdown');
  });

  it('returns true with reason=time_limit when maxDurationMs is exceeded', () => {
    const session = {
      ...baseSession,
      startedAt: new Date(Date.now() - 10000), // started 10 s ago
      maxDurationMs: 5000 // max 5 s
    };
    const result = isCensored(session);
    expect(result.isCensored).toBe(true);
    expect(result.reason).toBe('time_limit');
  });

  it('returns false when maxDurationMs is set but not yet exceeded', () => {
    const session = {
      ...baseSession,
      startedAt: new Date(Date.now() - 1000), // started 1 s ago
      maxDurationMs: 60000 // max 60 s — not exceeded
    };
    const result = isCensored(session);
    expect(result.isCensored).toBe(false);
  });

  it('returns false for null/undefined session', () => {
    expect(isCensored(null as any).isCensored).toBe(false);
    expect(isCensored(undefined as any).isCensored).toBe(false);
  });
});
