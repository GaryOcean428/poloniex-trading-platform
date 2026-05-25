/**
 * kernelRotation.test.ts — per-kernel live/paper state machine.
 *
 * Pins the pre-cutover allocation pattern's demotion trigger:
 * 5 consecutive losing trades → demote to paper. Auto-promotion
 * (paper WR within 10% of best live) is a follow-up PR.
 */
import { describe, expect, it } from 'vitest';

import {
  makeRotationState,
  promoteToLive,
  recordClose,
  rollingWinRate,
  ROTATION_LOSS_STREAK_THRESHOLD,
  ROTATION_WR_WINDOW,
} from '../kernel_rotation.js';

describe('kernel_rotation — state machine', () => {
  it('defaults to live mode with empty history and zero loss streak', () => {
    const s = makeRotationState();
    expect(s.mode).toBe('live');
    expect(s.consecutiveLosses).toBe(0);
    expect(s.rollingPnls).toEqual([]);
    expect(s.lastDemotionAtMs).toBeNull();
  });

  it('a winning close resets the consecutive-loss streak', () => {
    const s = makeRotationState();
    for (let i = 0; i < 3; i++) recordClose(s, -1.0);
    expect(s.consecutiveLosses).toBe(3);
    recordClose(s, +2.5);
    expect(s.consecutiveLosses).toBe(0);
    expect(s.mode).toBe('live');
  });

  it('demotes to paper after exactly ROTATION_LOSS_STREAK_THRESHOLD losses', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD - 1; i++) {
      const r = recordClose(s, -1.0);
      expect(r.demoted).toBe(false);
      expect(s.mode).toBe('live');
    }
    const final = recordClose(s, -1.0);
    expect(final.demoted).toBe(true);
    expect(s.mode).toBe('paper');
    expect(s.lastDemotionAtMs).not.toBeNull();
    expect(s.lastTransitionReason).toContain('consecutive losing trades');
  });

  it('zero-pnl close counts as a loss for streak purposes', () => {
    const s = makeRotationState();
    for (let i = 0; i < 4; i++) recordClose(s, 0);
    expect(s.consecutiveLosses).toBe(4);
    recordClose(s, 0);
    expect(s.mode).toBe('paper');
  });

  it('subsequent losses in paper mode do not re-fire demotion', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) recordClose(s, -1.0);
    expect(s.mode).toBe('paper');
    const firstDemotedAt = s.lastDemotionAtMs;
    // Continue losing in paper — should not re-demote.
    const r = recordClose(s, -1.0);
    expect(r.demoted).toBe(false);
    expect(s.lastDemotionAtMs).toBe(firstDemotedAt);
  });

  it('rolling window caps at ROTATION_WR_WINDOW closes', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_WR_WINDOW * 2; i++) recordClose(s, i % 2 === 0 ? 1 : -1);
    expect(s.rollingPnls.length).toBe(ROTATION_WR_WINDOW);
  });

  it('rollingWinRate is NaN when no closes observed', () => {
    expect(rollingWinRate(makeRotationState())).toBeNaN();
  });

  it('rollingWinRate computes wins/trades over the window', () => {
    const s = makeRotationState();
    for (let i = 0; i < 10; i++) recordClose(s, i < 7 ? 1 : -1);
    expect(rollingWinRate(s)).toBeCloseTo(0.7, 5);
  });
});

describe('kernel_rotation — promotion', () => {
  it('promoteToLive resets consecutiveLosses + flips mode', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) recordClose(s, -1.0);
    expect(s.mode).toBe('paper');
    const r = promoteToLive(s, 'test promotion');
    expect(r.promoted).toBe(true);
    expect(s.mode).toBe('live');
    expect(s.consecutiveLosses).toBe(0);
    expect(s.lastTransitionReason).toBe('test promotion');
  });

  it('promoteToLive on an already-live kernel is a no-op', () => {
    const s = makeRotationState();
    const r = promoteToLive(s);
    expect(r.promoted).toBe(false);
    expect(s.mode).toBe('live');
  });

  it('promoted kernel does not immediately re-demote on next loss', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) recordClose(s, -1.0);
    promoteToLive(s);
    expect(s.consecutiveLosses).toBe(0);
    // One more loss after promotion — streak starts fresh.
    recordClose(s, -1.0);
    expect(s.consecutiveLosses).toBe(1);
    expect(s.mode).toBe('live');
  });
});

describe('kernel_rotation — boundaries', () => {
  it('exact zero PnL counts as loss not win for streak semantics', () => {
    const s = makeRotationState();
    recordClose(s, 0);
    expect(s.consecutiveLosses).toBe(1);
  });

  it('tiny positive PnL counts as win and resets streak', () => {
    const s = makeRotationState();
    recordClose(s, -1.0);
    recordClose(s, +1e-9);
    expect(s.consecutiveLosses).toBe(0);
  });
});
