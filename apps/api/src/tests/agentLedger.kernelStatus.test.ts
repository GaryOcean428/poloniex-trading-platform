import { describe, it, expect } from 'vitest';
import { deriveKernelTradingStatus } from '../services/agentLedger.js';

/**
 * deriveKernelTradingStatus — the /api/agent/status badge logic.
 *
 * Background (PR6): the badge used to read `strategyLearningEngine.isRunning`
 * — the SLE strategy-GENERATION loop — NOT whether the Monkey kernel is
 * actually trading. So the badge said "stopped" while the kernel actively
 * placed live orders. The badge must reflect REAL kernel trading activity,
 * derived from the autonomous_trades ledger:
 *
 *   - 'active'  — the kernel has open live positions, OR placed a live
 *                 trade within the recent window.
 *   - 'idle'    — the kernel is alive but currently flat and quiet (no
 *                 recent live trade, no open positions).
 *   - 'paused'  — execution-mode override 'pause' is set; this wins over
 *                 any ledger activity (the operator kill/pause switch).
 */
describe('deriveKernelTradingStatus — kernel on/off badge', () => {
  it("'paused' wins over open positions and recent trades", () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'pause',
        openLivePositions: 5,
        recentLiveTrades: 3,
      }),
    ).toBe('paused');
  });

  it("'paused' wins even when the kernel is completely idle", () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'pause',
        openLivePositions: 0,
        recentLiveTrades: 0,
      }),
    ).toBe('paused');
  });

  it("'active' when there are open live positions", () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'auto',
        openLivePositions: 2,
        recentLiveTrades: 0,
      }),
    ).toBe('active');
  });

  it("'active' when a live trade was placed within the recent window", () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'auto',
        openLivePositions: 0,
        recentLiveTrades: 1,
      }),
    ).toBe('active');
  });

  it("'idle' when the kernel is flat and quiet (no positions, no recent trades)", () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'auto',
        openLivePositions: 0,
        recentLiveTrades: 0,
      }),
    ).toBe('idle');
  });

  it("treats 'paper_only' and a null execution mode as non-override (ledger decides)", () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'paper_only',
        openLivePositions: 1,
        recentLiveTrades: 0,
      }),
    ).toBe('active');
    expect(
      deriveKernelTradingStatus({
        executionMode: null,
        openLivePositions: 0,
        recentLiveTrades: 0,
      }),
    ).toBe('idle');
  });

  it('clamps negative / NaN counts to zero (fail-soft on bad query rows)', () => {
    expect(
      deriveKernelTradingStatus({
        executionMode: 'auto',
        openLivePositions: Number.NaN,
        recentLiveTrades: -3,
      }),
    ).toBe('idle');
  });
});
