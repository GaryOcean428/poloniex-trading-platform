/**
 * staleBleedStop.ts — TS-only stale-position time stop.
 *
 * The TS hot path's conviction gate is currently dormant: ``loop.ts``
 * passes ``NEUTRAL_EMOTIONS`` (all zeros) into the rejustification
 * evaluator until Layer 2B emotion stack gets ported from Python.
 * That collapses the conviction comparator to ``0 > 0 = false`` on
 * every tick, so emotion-driven exits never fire on this path.
 *
 * Live tape evidence 2026-05-01: monkey-* scalp_exits average
 * 62-96 seconds; positions held longer almost always resolve via
 * exchange-side reconciliation rather than a clean kernel exit.
 * The `position not found` reason has ~16-27 minute average duration
 * — those are stale rows the kernel never closed itself.
 *
 * This module fills the gap with a deterministic, geometry-free
 * stop: when a position has been held longer than ``holdMs`` AND
 * its price-level move is inside ``priceBand``, force a close. It is
 * deliberately a coarse safety bound, not a tuned signal — once
 * Layer 2B ports, the conviction gate reactivates and this stop
 * should rarely if ever bind.
 *
 * Bit 6 in the exitTypeBit space (1 take_profit, -1 stop_loss,
 * 2 trailing_harvest, 3 trend_flip_harvest, 5 rejustification).
 */

/**
 * Per-lane hold thresholds calibrated against live tape 2026-05-01.
 * Last-hour ``trailing_harvest`` exits averaged ~47.5 minutes — swing
 * positions legitimately need that long to develop. Setting the
 * threshold below that would prematurely kill profitable winners.
 *
 * Threshold rule of thumb: 1.5× the lane's median legit-exit duration.
 * Reconciliation noise events (``position not found on exchange``)
 * averaged ~16-27 minutes — these are the actual targets.
 */
export const STALE_BLEED_HOLD_MS_BY_LANE: Record<string, number> = {
  scalp: 10 * 60_000,    // 10 min — scalp exits average <2min, anything > 10m is anomalous
  swing: 75 * 60_000,    // 75 min — 1.5× the live trailing_harvest avg (47.5m)
  trend: 180 * 60_000,   // 3h — trend lane operates on a much longer horizon
};
export const STALE_BLEED_HOLD_MS_FALLBACK = 60 * 60_000;     // unknown-lane safety
export const STALE_BLEED_PRICE_BAND_DEFAULT = 0.003;         // ±0.3% on notional

export interface StaleBleedInput {
  lastEntryAtMs: number | null;
  positionNotional: number;
  unrealizedPnl: number;
  nowMs: number;
  lane: string;
}

export interface StaleBleedOptions {
  /** Override the hold threshold entirely (useful in tests). */
  holdMs?: number;
  /** Override the per-lane hold map (useful for registry-driven tuning). */
  holdMsByLane?: Record<string, number>;
  priceBand?: number;
}

export interface StaleBleedResult {
  fire: boolean;
  reason: string;
  derivation: {
    holdMs: number;
    holdMinutes: number;
    priceMoveFrac: number;
    holdMsThreshold: number;
    priceBand: number;
    lane: string;
    armed: boolean;
  };
}

/**
 * Decide whether to fire the stale-bleed time stop.
 *
 * Returns ``fire: false`` when the position is fresh, the inputs
 * are degenerate (zero/negative notional, null entry timestamp),
 * or the position is making real price progress in either
 * direction — only chronic-flat positions qualify.
 */
export function shouldStaleBleedExit(
  input: StaleBleedInput,
  opts: StaleBleedOptions = {},
): StaleBleedResult {
  const holdMap = opts.holdMsByLane ?? STALE_BLEED_HOLD_MS_BY_LANE;
  const laneThreshold = holdMap[input.lane] ?? STALE_BLEED_HOLD_MS_FALLBACK;
  const holdMsThreshold = opts.holdMs ?? laneThreshold;
  const priceBand = opts.priceBand ?? STALE_BLEED_PRICE_BAND_DEFAULT;

  const armed =
    input.lastEntryAtMs !== null &&
    Number.isFinite(input.lastEntryAtMs) &&
    input.positionNotional > 0 &&
    Number.isFinite(input.unrealizedPnl);

  if (!armed) {
    return {
      fire: false,
      reason: '',
      derivation: {
        holdMs: 0, holdMinutes: 0, priceMoveFrac: 0,
        holdMsThreshold, priceBand, lane: input.lane, armed: false,
      },
    };
  }

  const holdMs = Math.max(0, input.nowMs - (input.lastEntryAtMs as number));
  const priceMoveFrac = input.unrealizedPnl / input.positionNotional;
  const holdMinutes = holdMs / 60_000;

  const fire = holdMs > holdMsThreshold && Math.abs(priceMoveFrac) < priceBand;

  return {
    fire,
    reason: fire
      ? `stale_bleed_stop hold=${holdMinutes.toFixed(1)}m price_move=${(priceMoveFrac * 100).toFixed(3)}% lane=${input.lane}`
      : '',
    derivation: {
      holdMs, holdMinutes, priceMoveFrac,
      holdMsThreshold, priceBand, lane: input.lane, armed: true,
    },
  };
}
