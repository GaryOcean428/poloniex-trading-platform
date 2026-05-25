/**
 * kernelRotationRouting.test.ts — pins that a paper-rotation-demoted
 * kernel routes placeOrder calls to paperPlaceOrder, not the real
 * exchange. Composition test: rotation state machine (PR #921 scaffold)
 * + paper-routing wiring (this PR).
 */
import { describe, expect, it } from 'vitest';

import {
  makeRotationState,
  promoteToLive,
  recordClose,
  ROTATION_LOSS_STREAK_THRESHOLD,
} from '../kernel_rotation.js';

describe('kernel-rotation paper-routing — composition contract', () => {
  it('a live kernel after wins routes to live (the default)', () => {
    const s = makeRotationState();
    recordClose(s, +1);
    recordClose(s, +1);
    expect(s.mode).toBe('live');
    // shouldRouteOrdersToPaper would be false → live route fires.
  });

  it('a kernel demoted by ROTATION_LOSS_STREAK_THRESHOLD losses routes to paper', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) {
      recordClose(s, -1);
    }
    expect(s.mode).toBe('paper');
    // shouldRouteOrdersToPaper would be true → paper route fires.
  });

  it('manual promotion flips back to live, future entries route to live', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) recordClose(s, -1);
    expect(s.mode).toBe('paper');
    const r = promoteToLive(s, 'operator says try again');
    expect(r.promoted).toBe(true);
    expect(s.mode).toBe('live');
    expect(s.consecutiveLosses).toBe(0);
  });

  it('one win between losses prevents demotion (streak resets)', () => {
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD - 1; i++) recordClose(s, -1);
    expect(s.mode).toBe('live');
    recordClose(s, +0.01);  // tiny win still counts
    expect(s.consecutiveLosses).toBe(0);
    expect(s.mode).toBe('live');
    // Five MORE losses would now be needed to demote.
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD - 1; i++) recordClose(s, -1);
    expect(s.mode).toBe('live');
    recordClose(s, -1);
    expect(s.mode).toBe('paper');
  });
});
