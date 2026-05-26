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
  shouldAutoPromote,
  ROTATION_LOSS_STREAK_THRESHOLD,
  ROTATION_PROMOTION_WR_GAP,
  ROTATION_WR_MIN_SAMPLES,
  ROTATION_WR_WINDOW,
  type RotationPeerSnapshot,
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

describe('kernel_rotation — auto-promotion gate', () => {
  function paperKernelWithWR(targetWR: number, n: number = ROTATION_WR_MIN_SAMPLES) {
    const s = makeRotationState();
    // First demote it: 5 consecutive losses.
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) recordClose(s, -1);
    // Clear the losses out of the rolling window by adding `n` more closes
    // with the desired WR. Demotion already fired; further closes don't
    // re-demote.
    s.rollingPnls = [];  // reset window so synthetic stats are clean
    const wins = Math.round(targetWR * n);
    for (let i = 0; i < wins; i++) s.rollingPnls.push(+1);
    for (let i = wins; i < n; i++) s.rollingPnls.push(-1);
    return s;
  }

  function liveKernelWithWR(targetWR: number, n: number = ROTATION_WR_MIN_SAMPLES): RotationPeerSnapshot {
    return {
      mode: 'live',
      rollingWinRate: targetWR,
      rollingSampleCount: n,
    };
  }

  it('does NOT promote when candidate is already live (only paper → live)', () => {
    const live = makeRotationState();
    for (let i = 0; i < ROTATION_WR_MIN_SAMPLES; i++) recordClose(live, +1);
    const reason = shouldAutoPromote(live, [liveKernelWithWR(0.50)]);
    expect(reason).toBeNull();
  });

  it('does NOT promote when candidate has < ROTATION_WR_MIN_SAMPLES closes', () => {
    const s = paperKernelWithWR(0.80, ROTATION_WR_MIN_SAMPLES - 1);
    const reason = shouldAutoPromote(s, [liveKernelWithWR(0.50)]);
    expect(reason).toBeNull();
  });

  it('does NOT promote when no live peer has informative stats', () => {
    const s = paperKernelWithWR(0.90);
    const reason = shouldAutoPromote(s, [
      { mode: 'paper', rollingWinRate: 0.50, rollingSampleCount: 50 },  // wrong mode
      { mode: 'live', rollingWinRate: 0.90, rollingSampleCount: ROTATION_WR_MIN_SAMPLES - 1 },  // not enough samples
    ]);
    expect(reason).toBeNull();
  });

  it('promotes when candidate WR matches the best live WR (gap = 0)', () => {
    const s = paperKernelWithWR(0.60);
    const reason = shouldAutoPromote(s, [liveKernelWithWR(0.60)]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('60.0%');
  });

  it('promotes when candidate WR is exactly at the gate (best - gap)', () => {
    // Best live = 0.50; gate = 0.50 - 0.10 = 0.40. Candidate at 0.40 promotes.
    const s = paperKernelWithWR(0.40);
    const reason = shouldAutoPromote(s, [liveKernelWithWR(0.50)]);
    expect(reason).not.toBeNull();
  });

  it('does NOT promote when candidate WR is just below the gate', () => {
    // Best live = 0.60; gate = 0.50. Candidate at 0.45 fails.
    // Use n=20 to make the 0.45 WR representable.
    const s = paperKernelWithWR(0.45, 20);
    const reason = shouldAutoPromote(s, [liveKernelWithWR(0.60, 20)]);
    expect(reason).toBeNull();
  });

  it('compares against the BEST live peer, not the average', () => {
    const s = paperKernelWithWR(0.55);
    // Best live is 0.80, gap=0.10 → gate at 0.70. Candidate at 0.55 fails
    // even though one live peer has only 0.40 (lower than candidate).
    const reason = shouldAutoPromote(s, [
      liveKernelWithWR(0.80),
      liveKernelWithWR(0.40),
    ]);
    expect(reason).toBeNull();
  });

  it('ROTATION_PROMOTION_WR_GAP is the documented 10pp', () => {
    expect(ROTATION_PROMOTION_WR_GAP).toBeCloseTo(0.10, 6);
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
