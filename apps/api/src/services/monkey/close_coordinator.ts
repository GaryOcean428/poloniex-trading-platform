/**
 * close_coordinator.ts — per-symbol+side serialization for Monkey closes.
 *
 * Two Monkey kernels (`monkey-position` 15m + `monkey-swing` 5m) and the
 * agent-K/M/T/L decision arms inside each share the same Node.js process.
 * Each can independently decide to close ETH long (or BTC short, etc.)
 * within the same ~second when market conditions trigger conviction-failed
 * across the board.
 *
 * Poloniex futures HEDGE mode keeps ONE position per (symbol, side). Two
 * close orders submitted in parallel produce one of two pathological
 * outcomes:
 *
 *   1. Loser's `getPositions()` reads qty=0 after winner's close settles →
 *      logs `exchange_position_vanished` and bails (alarming but harmless).
 *   2. Loser's `getPositions()` reads pre-close qty before winner's order
 *      settles → loser submits a close → Poloniex returns
 *      `code=21002 Position not enough` (red ERROR in the prod log).
 *
 * This module coordinates closes across all in-process callers so:
 *   - Only one close per (symbol, side) is in flight at any time
 *   - After a successful close, a short cooldown blocks sibling attempts
 *     so the exchange-side reduction has time to settle in subsequent
 *     `getPositions()` reads
 *   - When a sibling kernel races us, we recognize the loss and emit a
 *     `race_lost_to_sibling` reason instead of attempting a close
 *
 * The cooldown is empirically sized: observed prod race window is
 * ~280ms (Swing close at 00:59:40.658 → Position attempt at 00:59:40.937
 * → 21002). 2000ms gives ~7× headroom while staying short enough that a
 * legitimate re-entry isn't blocked for a noticeable period.
 */

export type Side = 'long' | 'short';

interface InFlight {
  /** Kernel instanceId that holds the lock. */
  holder: string;
  /** Wall-clock ms when acquired. */
  at: number;
}

interface RecentClose {
  /** Kernel instanceId that performed the successful close. */
  holder: string;
  /** Wall-clock ms of release (close success). */
  at: number;
}

const inFlight = new Map<string, InFlight>();
const recentlyClosed = new Map<string, RecentClose>();

/** Cooldown window for treating a 21002 ("Position not enough") as a
 *  race-loss against a sibling close (rather than a real error).
 *
 *  Originally 2s — sized for the simultaneous-tick race. But 2026-05-19
 *  07:07/07:11 prod log showed a 4-min gap: monkey-position closed BTC
 *  successfully at 07:07:11, then monkey-swing's separate tick decided
 *  to close at 07:11:14 (its tracked DB row was still status='open',
 *  but the merged exchange position was already gone). The 21002 fell
 *  outside this 2s window so it was logged as a real error and the DB
 *  row stayed open for the reconciler to mop up — 4 minutes of bogus
 *  retry storms in between.
 *
 *  60s is long enough to cover normal cross-kernel decision lag (tick
 *  cadence + processing). Operator override:
 *  MONKEY_RECENT_CLOSE_COOLDOWN_MS. */
const RECENT_CLOSE_COOLDOWN_MS =
  Number(process.env.MONKEY_RECENT_CLOSE_COOLDOWN_MS) || 60_000;

/** Defensive max — an in-flight close should never take longer than this.
 *  If the lock holder crashes mid-close, the next caller after this window
 *  will steal the lock rather than blocking forever. */
const IN_FLIGHT_STALE_MS = 30_000;

function key(symbol: string, side: Side): string {
  return `${symbol}:${side}`;
}

/**
 * Try to acquire the close lock for (symbol, side).
 *
 * Returns:
 *   - `{ ok: true }` — lock acquired; caller must call `release` when done.
 *   - `{ ok: false, reason: 'in_flight', heldBy, ageMs }` — another caller is
 *     mid-close. Caller should treat as a race loss.
 *   - `{ ok: false, reason: 'recently_closed', heldBy, ageMs }` — another
 *     caller just closed this side within the cooldown window. Caller
 *     should treat as a race loss; the exchange position is already gone.
 *
 * Self-collision (same instanceId already holds the lock) returns `ok: true`
 * — the caller is re-entering (defensive; the regular call path should not
 * do this).
 */
export function tryAcquireClose(
  symbol: string,
  side: Side,
  instanceId: string,
  nowMs: number = Date.now(),
):
  | { ok: true }
  | { ok: false; reason: 'in_flight'; heldBy: string; ageMs: number }
  | { ok: false; reason: 'recently_closed'; heldBy: string; ageMs: number } {
  const k = key(symbol, side);

  const recent = recentlyClosed.get(k);
  if (recent) {
    const ageMs = nowMs - recent.at;
    if (ageMs >= 0 && ageMs < RECENT_CLOSE_COOLDOWN_MS && recent.holder !== instanceId) {
      return { ok: false, reason: 'recently_closed', heldBy: recent.holder, ageMs };
    }
    if (ageMs >= RECENT_CLOSE_COOLDOWN_MS) {
      recentlyClosed.delete(k);
    }
  }

  const cur = inFlight.get(k);
  if (cur) {
    const ageMs = nowMs - cur.at;
    if (cur.holder === instanceId) {
      return { ok: true };
    }
    if (ageMs < IN_FLIGHT_STALE_MS) {
      return { ok: false, reason: 'in_flight', heldBy: cur.holder, ageMs };
    }
    // Stale — previous holder crashed mid-close. Steal.
    inFlight.delete(k);
  }

  inFlight.set(k, { holder: instanceId, at: nowMs });
  return { ok: true };
}

/** Release the close lock and (optionally) record a recent successful close.
 *  Always call from a `finally`. The `success` flag controls whether the
 *  cooldown timer arms — failed closes leave no cooldown so the next caller
 *  can retry immediately. */
export function releaseClose(
  symbol: string,
  side: Side,
  instanceId: string,
  success: boolean,
  nowMs: number = Date.now(),
): void {
  const k = key(symbol, side);
  const cur = inFlight.get(k);
  if (cur && cur.holder === instanceId) {
    inFlight.delete(k);
  }
  if (success) {
    recentlyClosed.set(k, { holder: instanceId, at: nowMs });
  }
}

/** Check whether an exchange error (typically 21002 "Position not enough")
 *  is most likely a race-loss against a recent sibling close rather than a
 *  real failure. Used to demote the log level + clarify the message. */
export function isLikelyRaceLoss(
  symbol: string,
  side: Side,
  instanceId: string,
  nowMs: number = Date.now(),
): { raced: boolean; siblingId?: string; ageMs?: number } {
  const k = key(symbol, side);
  const recent = recentlyClosed.get(k);
  if (!recent) return { raced: false };
  const ageMs = nowMs - recent.at;
  if (ageMs < 0 || ageMs >= RECENT_CLOSE_COOLDOWN_MS) return { raced: false };
  if (recent.holder === instanceId) return { raced: false };
  return { raced: true, siblingId: recent.holder, ageMs };
}

/** Test-only — reset all coordinator state between tests. */
export function _resetCloseCoordinator(): void {
  inFlight.clear();
  recentlyClosed.clear();
}

/** Test-only — peek at current state. */
export function _peekCloseCoordinator(): {
  inFlight: Array<{ key: string; holder: string; at: number }>;
  recentlyClosed: Array<{ key: string; holder: string; at: number }>;
} {
  return {
    inFlight: Array.from(inFlight.entries()).map(([key, v]) => ({ key, ...v })),
    recentlyClosed: Array.from(recentlyClosed.entries()).map(([key, v]) => ({ key, ...v })),
  };
}
