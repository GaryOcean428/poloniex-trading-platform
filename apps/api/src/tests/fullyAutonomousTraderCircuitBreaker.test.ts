/**
 * Unit tests for the FullyAutonomousTrader circuit breaker and
 * drawdown-adjusted position sizing.
 *
 * These tests exercise the logic directly by casting the private methods via
 * `(trader as any)`, keeping the source code clean while still enabling full
 * coverage of the circuit-breaker behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heavy dependencies so the class constructor doesn't touch the DB ──
vi.mock('../db/connection.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] })
  }
}));

vi.mock('../services/poloniexFuturesService.js', () => ({ default: {} }));
vi.mock('../services/riskService.js', () => ({ default: {} }));
vi.mock('../services/mlPredictionService.js', () => ({ default: {} }));
vi.mock('../services/apiCredentialsService.js', () => ({ apiCredentialsService: {} }));
vi.mock('../utils/marketDataValidator.js', () => ({ validateMarketData: vi.fn() }));
vi.mock('../services/marketCatalog.js', () => ({ getPrecisions: vi.fn() }));

import { FullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convenience alias to call private methods without TypeScript errors. */
function priv(trader: FullyAutonomousTrader) {
  return trader as any;
}

const USER = 'test-user-cb';
const CAPITAL = 10_000;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FullyAutonomousTrader – circuit breaker', () => {
  let trader: FullyAutonomousTrader;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
  });

  // ── 1. Initial state ────────────────────────────────────────────────────

  it('starts with circuit breaker not tripped', () => {
    const status = trader.getCircuitBreakerStatus(USER);
    expect(status.isTripped).toBe(false);
    expect(status.consecutiveLosses).toBe(0);
    expect(status.dailyLossPercent).toBe(0);
    expect(status.cooldownRemaining).toBeUndefined();
  });

  // ── 2. Consecutive-loss tripping ────────────────────────────────────────

  it('trips after MAX_CONSECUTIVE_LOSSES (5) consecutive losses', () => {
    for (let i = 0; i < 5; i++) {
      priv(trader).recordTradeResult(USER, -50, CAPITAL);
    }
    const status = trader.getCircuitBreakerStatus(USER);
    expect(status.isTripped).toBe(true);
    expect(status.consecutiveLosses).toBe(5);
    expect(status.reason).toMatch(/consecutive losses/i);
  });

  it('does NOT trip after fewer than 5 consecutive losses', () => {
    for (let i = 0; i < 4; i++) {
      priv(trader).recordTradeResult(USER, -50, CAPITAL);
    }
    expect(trader.getCircuitBreakerStatus(USER).isTripped).toBe(false);
  });

  it('resets consecutive loss count after a winning trade', () => {
    for (let i = 0; i < 3; i++) {
      priv(trader).recordTradeResult(USER, -50, CAPITAL);
    }
    priv(trader).recordTradeResult(USER, +200, CAPITAL); // win resets streak
    priv(trader).recordTradeResult(USER, -50, CAPITAL); // only 1 loss now
    const status = trader.getCircuitBreakerStatus(USER);
    expect(status.isTripped).toBe(false);
    expect(status.consecutiveLosses).toBe(1);
  });

  // ── 3. Daily loss limit ──────────────────────────────────────────────────

  it('trips when daily loss reaches 3% of capital', () => {
    // 3% of 10 000 = 300 USDT
    priv(trader).recordTradeResult(USER, -301, CAPITAL);
    const status = trader.getCircuitBreakerStatus(USER);
    expect(status.isTripped).toBe(true);
    expect(status.reason).toMatch(/daily loss/i);
  });

  it('does NOT trip when daily loss is just below 3% of capital', () => {
    priv(trader).recordTradeResult(USER, -299, CAPITAL);
    expect(trader.getCircuitBreakerStatus(USER).isTripped).toBe(false);
  });

  // ── 4. checkCircuitBreaker blocks trading when tripped ──────────────────

  it('checkCircuitBreaker returns allowed=false when tripped', () => {
    for (let i = 0; i < 5; i++) {
      priv(trader).recordTradeResult(USER, -100, CAPITAL);
    }
    const result = priv(trader).checkCircuitBreaker(USER);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('checkCircuitBreaker returns allowed=true when not tripped', () => {
    const result = priv(trader).checkCircuitBreaker(USER);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // ── 5. Cooldown auto-reset ───────────────────────────────────────────────

  it('auto-resets after the 1-hour cooldown elapses', () => {
    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      priv(trader).recordTradeResult(USER, -100, CAPITAL);
    }
    expect(trader.getCircuitBreakerStatus(USER).isTripped).toBe(true);

    // Backdate trippedAt so the cooldown appears to have elapsed
    const cb = priv(trader).getCircuitBreaker(USER);
    cb.trippedAt = new Date(Date.now() - 61 * 60 * 1000); // 61 minutes ago

    // checkCircuitBreaker should auto-reset
    const result = priv(trader).checkCircuitBreaker(USER);
    expect(result.allowed).toBe(true);
    expect(trader.getCircuitBreakerStatus(USER).isTripped).toBe(false);
  });

  it('does NOT reset before the cooldown elapses', () => {
    for (let i = 0; i < 5; i++) {
      priv(trader).recordTradeResult(USER, -100, CAPITAL);
    }

    // Only 30 minutes have passed
    const cb = priv(trader).getCircuitBreaker(USER);
    cb.trippedAt = new Date(Date.now() - 30 * 60 * 1000);

    expect(priv(trader).checkCircuitBreaker(USER).allowed).toBe(false);
  });

  // ── 6. cooldownRemaining field ───────────────────────────────────────────

  it('reports positive cooldownRemaining while tripped', () => {
    for (let i = 0; i < 5; i++) {
      priv(trader).recordTradeResult(USER, -100, CAPITAL);
    }
    const status = trader.getCircuitBreakerStatus(USER);
    expect(status.cooldownRemaining).toBeGreaterThan(0);
  });
});

// ── 7. Drawdown-adjusted position sizing ────────────────────────────────────

describe('FullyAutonomousTrader – drawdown-adjusted position sizing', () => {
  let trader: FullyAutonomousTrader;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
  });

  it('returns full size below 10% drawdown', () => {
    expect(priv(trader).getDrawdownAdjustedPositionSize(1000, 0)).toBe(1000);
    expect(priv(trader).getDrawdownAdjustedPositionSize(1000, 5)).toBe(1000);
    expect(priv(trader).getDrawdownAdjustedPositionSize(1000, 10)).toBe(1000);
  });

  it('returns 0 at or above 20% drawdown', () => {
    expect(priv(trader).getDrawdownAdjustedPositionSize(1000, 20)).toBe(0);
    expect(priv(trader).getDrawdownAdjustedPositionSize(1000, 25)).toBe(0);
  });

  it('linearly scales between 10% and 20% drawdown', () => {
    // At 15% drawdown (midpoint) → 50% of base size
    const mid = priv(trader).getDrawdownAdjustedPositionSize(1000, 15);
    expect(mid).toBeCloseTo(500, 1);

    // At 12% → 80% of base size
    const at12 = priv(trader).getDrawdownAdjustedPositionSize(1000, 12);
    expect(at12).toBeCloseTo(800, 1);

    // At 19% → 10% of base size
    const at19 = priv(trader).getDrawdownAdjustedPositionSize(1000, 19);
    expect(at19).toBeCloseTo(100, 1);
  });

  it('never returns a negative size', () => {
    expect(priv(trader).getDrawdownAdjustedPositionSize(1000, 50)).toBeGreaterThanOrEqual(0);
  });
});
