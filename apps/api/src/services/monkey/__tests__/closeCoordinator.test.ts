import { describe, it, expect, beforeEach } from 'vitest';
import {
  tryAcquireClose, releaseClose, isLikelyRaceLoss, _resetCloseCoordinator, _peekCloseCoordinator,
} from '../close_coordinator.js';

describe('close_coordinator', () => {
  beforeEach(() => {
    _resetCloseCoordinator();
  });

  it('grants the lock to the first caller and blocks a sibling kernel', () => {
    const t0 = 1_700_000_000_000;
    const first = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    expect(first).toEqual({ ok: true });

    const sibling = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 50);
    expect(sibling).toEqual({
      ok: false,
      reason: 'in_flight',
      heldBy: 'monkey-position',
      ageMs: 50,
    });
  });

  it('lets the same instance re-acquire (defensive against self-collision)', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    const reentry = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0 + 100);
    expect(reentry).toEqual({ ok: true });
  });

  it('arms the cooldown after a successful close and blocks siblings', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', /*success*/ true, t0 + 200);

    // 500ms later — sibling tries: should be blocked by recently-closed cooldown
    const sibling = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 700);
    expect(sibling).toEqual({
      ok: false,
      reason: 'recently_closed',
      heldBy: 'monkey-position',
      ageMs: 500,
    });
  });

  it('does not arm the cooldown when the close failed', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', /*success*/ false, t0 + 200);

    const sibling = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 300);
    expect(sibling).toEqual({ ok: true });
  });

  it('lifts the cooldown once it expires (60s default window)', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', true, t0 + 100);

    // Just after the 60_000ms cooldown (was 2_000ms — bumped to 60s in
    // 2026-05-19 after 4-min cross-kernel close race went unhandled).
    const sibling = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 60_500);
    expect(sibling).toEqual({ ok: true });
  });

  it('serializes per (symbol, side) — different sides are independent', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    const otherSide = tryAcquireClose('ETH_USDT_PERP', 'short', 'monkey-position', t0);
    expect(otherSide).toEqual({ ok: true });
  });

  it('serializes per (symbol, side) — different symbols are independent', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    const otherSymbol = tryAcquireClose('BTC_USDT_PERP', 'long', 'monkey-position', t0);
    expect(otherSymbol).toEqual({ ok: true });
  });

  it('steals a stale in-flight lock after 30s', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);

    // Position kernel crashed mid-close; 31s later swing tries.
    const sibling = tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 31_000);
    expect(sibling).toEqual({ ok: true });

    // And the lock is now held by swing.
    const peek = _peekCloseCoordinator();
    expect(peek.inFlight).toHaveLength(1);
    expect(peek.inFlight[0]!.holder).toBe('monkey-swing');
  });

  it('isLikelyRaceLoss flags closes within cooldown by another instance', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', true, t0 + 200);

    const race = isLikelyRaceLoss('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 500);
    expect(race).toEqual({ raced: true, siblingId: 'monkey-position', ageMs: 300 });
  });

  it('isLikelyRaceLoss does NOT flag self', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', true, t0 + 200);

    const race = isLikelyRaceLoss('ETH_USDT_PERP', 'long', 'monkey-position', t0 + 500);
    expect(race).toEqual({ raced: false });
  });

  it('isLikelyRaceLoss does NOT flag once cooldown expires (60s default)', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', true, t0 + 100);

    // 60_001ms after release — just past the 60s cooldown.
    const race = isLikelyRaceLoss('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 60_500);
    expect(race).toEqual({ raced: false });
  });

  it('isLikelyRaceLoss flags closes up to 60s after sibling close (was 2s)', () => {
    const t0 = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'long', 'monkey-position', t0);
    releaseClose('ETH_USDT_PERP', 'long', 'monkey-position', true, t0 + 100);

    // 45s after release — this was the failure mode in the 07:07/07:11
    // BTC retry storm. Pre-fix this returned raced=false → bot logged
    // close_exchange_rejected and kept retrying for 4 min.
    const race = isLikelyRaceLoss('ETH_USDT_PERP', 'long', 'monkey-swing', t0 + 45_000);
    expect(race).toEqual({ raced: true, siblingId: 'monkey-position', ageMs: 44_900 });
  });

  it('release without holding the lock is a no-op (does not crash)', () => {
    const t0 = 1_700_000_000_000;
    // monkey-swing never held the lock; release should silently no-op.
    expect(() => releaseClose('ETH_USDT_PERP', 'long', 'monkey-swing', true, t0)).not.toThrow();
    const peek = _peekCloseCoordinator();
    // The success-flagged release still arms the cooldown — that's documented
    // behavior: the caller asserts the close happened.
    expect(peek.recentlyClosed).toHaveLength(1);
  });

  it('reproduces the observed prod race window (280ms swing-vs-position)', () => {
    // Live observation at 2026-05-17T00:59:40Z:
    //   00:59:40.658  Swing close SUCCESS
    //   00:59:40.937  Position close → code=21002 "Position not enough"
    // The coordinator should treat the second as race_lost not error.
    const swingClose = 1_700_000_000_000;
    tryAcquireClose('ETH_USDT_PERP', 'short', 'monkey-swing', swingClose - 100);
    releaseClose('ETH_USDT_PERP', 'short', 'monkey-swing', true, swingClose);

    const positionAttempt = tryAcquireClose(
      'ETH_USDT_PERP', 'short', 'monkey-position',
      swingClose + 279,
    );
    expect(positionAttempt.ok).toBe(false);
    expect((positionAttempt as { reason: string }).reason).toBe('recently_closed');
  });
});
