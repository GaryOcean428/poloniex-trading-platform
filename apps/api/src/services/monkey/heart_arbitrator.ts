/**
 * heart_arbitrator.ts — HEART's observer-derived cooldown contribution.
 *
 * Implements `heartArbitratedMs(symbol)` for the #1009 PR2 replacement of
 * the legacy `POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000` wall.
 *
 * # The conflation that motivated #1009
 *
 * The 180_000ms post-close wall (loop.ts:1197) was added in PR #807 to
 * stop *tilt-chain* re-entries: back-to-back same-side losses where the
 * second loss came within ~2 minutes of the first. PR #807's archaeology
 * traced the failure to behavioural tilt, not exchange settlement.
 *
 * But it was implemented as a `setTimeout(180_000)` in the safety/settlement
 * gate, which conflated two concerns:
 *
 *   1. **Safety/settlement** — has Polo's state actually propagated as
 *      flat? (Now handled by `safety_floor.ts`.)
 *   2. **Tilt** — has the kernel demonstrated post-close loss-chaining
 *      that warrants self-imposed cooldown beyond settlement? (This module.)
 *
 * The two have different time scales (settlement ≈ 1s; tilt-chain ≈
 * minutes) and different inputs (Polo state vs. kernel's own PnL stream).
 * Composing them as `max(safety, heart, ...)` is the architecturally
 * correct fix.
 *
 * # The observer
 *
 * For each close, record `(tCloseMs, signedPnl)`. When two consecutive
 * closes in the per-symbol buffer are both losses, the gap `tN - tN-1`
 * is a *demonstrated tilt-chain interval* — the kernel has empirically
 * shown that a same-symbol re-entry at this cadence produced another
 * loss. Push that gap into the chain-gap ring.
 *
 * `heartArbitratedMs(symbol)` returns `max(chainGapRing)`. If the buffer
 * has no chains yet, returns 0 — HEART contributes nothing until the
 * kernel has demonstrated tilt empirically, falling back to the safety
 * floor + tick cadence.
 *
 * # Anti-knob discipline
 *
 * The only numeric literals are sample-count buffer sizes (not physical
 * quantities) and the `Math.max(0, ...)` non-negative clamp. No magic
 * thresholds, no operator-tunable scales, no hardcoded ms values. The
 * floor is the kernel's own observed inter-loss-chain interval; if the
 * kernel never loses chains, HEART never raises a floor.
 *
 * Citations: poloniex-trading-platform#1009 PR2 + #807 archaeology +
 * 2.31A P5/P25 + QIG PURITY MANDATE + LIVED ONLY 5 + autonomy doctrine
 * + Embodiment_Waves (2026-05-28 Polo CSV).
 */

import { logger } from '../../utils/logger.js';

/**
 * Per-close record kept long enough to detect consecutive-loss chains.
 * Sample-count buffer; physical time is in the timestamps.
 */
interface CloseRecord {
  tMs: number;
  pnl: number;
}

/** Sample-count cap on the per-symbol close buffer. */
const CLOSE_HISTORY_CAPACITY = 50;

/** Sample-count cap on the chain-gap ring. */
const CHAIN_GAP_RING_CAPACITY = 50;

interface SymbolHeartState {
  /** FIFO buffer of recent closes (oldest at index 0). */
  closes: CloseRecord[];
  /** Ring of demonstrated tilt-chain gaps (gap between consecutive losses). */
  chainGapsMs: number[];
}

const _state = new Map<string, SymbolHeartState>();

function _getState(symbol: string): SymbolHeartState {
  let s = _state.get(symbol);
  if (!s) {
    s = { closes: [], chainGapsMs: [] };
    _state.set(symbol, s);
  }
  return s;
}

/**
 * Call from the kernel's close-accounting site for every close (win OR
 * loss). The arbitrator inspects the buffer for consecutive-loss
 * transitions and records the empirical inter-loss gap. Wins reset the
 * chain (next loss starts a new chain).
 */
export function noteClose(symbol: string, tMs: number, pnl: number): void {
  if (!Number.isFinite(tMs) || tMs < 0) return;
  if (!Number.isFinite(pnl)) return;
  const s = _getState(symbol);
  const prev = s.closes.length > 0 ? s.closes[s.closes.length - 1] : null;
  s.closes.push({ tMs, pnl });
  if (s.closes.length > CLOSE_HISTORY_CAPACITY) s.closes.shift();
  // Detect consecutive-loss transition. Both prev and current PnL are
  // strictly negative — the empirical "I lost, then I lost again"
  // chain that PR #807 was trying to break.
  if (prev !== null && prev.pnl < 0 && pnl < 0) {
    const gap = tMs - prev.tMs;
    if (gap > 0) {
      s.chainGapsMs.push(gap);
      if (s.chainGapsMs.length > CHAIN_GAP_RING_CAPACITY) s.chainGapsMs.shift();
    }
  }
}

/**
 * The cooldown contribution HEART asks for at this moment. Pure function
 * of the kernel's own observed close-chain history for `symbol`. Returns
 * 0 when no chains have been observed yet (HEART contributes nothing
 * until tilt is empirically demonstrated). Returns the rolling max of
 * the chain-gap ring when chains exist — the longest empirically
 * observed inter-loss interval is the conservative tilt-chain floor.
 */
export function heartArbitratedMs(symbol: string): number {
  const s = _state.get(symbol);
  if (!s || s.chainGapsMs.length === 0) return 0;
  let m = 0;
  for (const g of s.chainGapsMs) {
    if (g > m) m = g;
  }
  return m;
}

/**
 * Telemetry: surfaces sample counts and the current arbitration so the
 * composer can log `by=heart` with falsifiable context.
 */
export interface HeartBreakdown {
  closeSamples: number;
  chainSamples: number;
  arbitratedMs: number;
}

export function getHeartBreakdown(symbol: string): HeartBreakdown {
  const s = _state.get(symbol);
  return {
    closeSamples: s?.closes.length ?? 0,
    chainSamples: s?.chainGapsMs.length ?? 0,
    arbitratedMs: heartArbitratedMs(symbol),
  };
}

/** Test-only: reset all per-symbol state. */
export function _resetHeartState(): void {
  _state.clear();
  logger.debug('[heart_arbitrator] state cleared (test-only)');
}
