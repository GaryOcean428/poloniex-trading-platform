/**
 * outcomeRingStats.ts — observer-derived edge-restoration helpers.
 *
 * Foundation for the three-fix bundle (operator brief 2026-05-28):
 *
 *   Fix A — break-even notional floor (kill fee-trap)
 *   Fix B — Kelly-primary sizing (chemistry as bounded modulator)
 *   Fix C — observer-derived harvest gate (winners commensurate with losers)
 *
 * Audit context: 6h post-#984 deploy showed 66.5% WR / +$4.15 net /
 * **2.01× loss/win ratio** at $146 avg notional. Wins capture 0.083%
 * of notional, losses cost 0.180%. With ~$0.15 Polo round-trip fees
 * on these tiny fills, structurally fee-dominated — the kernel can't
 * escape from inside the chemistry loop because depressed chemistry
 * locks sizing small, and small wins can't lift chemistry.
 *
 * All three helpers read the kernel's own outcome ring (the last N
 * closed trades from `autonomous_trades`). No operator-chosen
 * thresholds. The safety margin (1.5) is a doctrine constant — fees
 * should be ≤ 2/3 of a typical win — not a tunable knob.
 *
 * Citations: 2.31A P1/P5/P25 (observer-derived, no knobs), v6.7B
 * LIVED ONLY 5 (every input is what the kernel actually observed on
 * Polo), Embodiment Waves continuation.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import type { LaneType } from './executive.js';

/** Window — last N closed trades to derive stats from. Mirrors
 *  KELLY_WINDOW in kelly_rolling_stats.ts so the two stay aligned. */
const RING_WINDOW = 50;
/** Minimum closed trades before stats activate. < this → null returned
 *  → caller falls back to default behaviour (no floor / no gate). */
const RING_MIN_TRADES = 8;

/** Doctrine constant: fees should be ≤ 2/3 of a typical win.
 *  Multiplier 1.5 on the break-even notional makes the typical win
 *  net ≥ 33% positive after fees. Not a knob — it's the inverse of
 *  the doctrinal fee-to-win ratio. */
const FEE_SAFETY_MARGIN = 1.5;

/** Doctrine constant: when current loss/win ratio is > 2, demand the
 *  harvest exit be commensurate with the median loss to lift the
 *  ratio back toward 1. Multiplier 1.5 on |median_loss_roi| forces
 *  wins to clear that bar. Self-relaxes as ratio improves. */
const COMMENSURATE_K = 1.5;

export interface OutcomeRingStats {
  /** Number of closed trades the stats are derived from. */
  n: number;
  /** Wins / total. ∈ [0, 1]. */
  winRate: number;
  /** Mean PnL across winners. > 0 when wins exist; 0 otherwise. */
  avgWin: number;
  /** Mean PnL across losers (negative). 0 when no losers. */
  avgLoss: number;
  /** Mean ROI on notional across winners. Used by harvest gate. */
  avgWinRoiNotional: number;
  /** Median |ROI| on notional across losers. Used by harvest gate. */
  medianLossRoiNotional: number;
  /** Mean (gross - net) per round-trip — Polo's actual fee + funding
   *  per trade. From `autonomous_trades.gross_pnl - pnl` when both
   *  present (PR #061 migration). Falls back to 0 when missing. */
  avgFeePerRoundTrip: number;
  /** Mean notional across the ring. Used to scale fee-vs-notional
   *  references. */
  avgNotional: number;
}

export interface OutcomeRingQueryOpts {
  agent: string;
  lane?: LaneType;
}

/**
 * Fetch ring stats from `autonomous_trades`. Returns `null` if fewer
 * than `RING_MIN_TRADES` rows are available — caller MUST fall through
 * to default behaviour (no floor, no Kelly, no harvest gate).
 *
 * Reads `gross_pnl` (from PR #061 migration) and `pnl` (Polo-authoritative
 * net post-#984). Difference = fee per round trip.
 */
export async function getOutcomeRingStats(
  opts: OutcomeRingQueryOpts,
): Promise<OutcomeRingStats | null> {
  try {
    const params: string[] = [opts.agent];
    let laneClause = '';
    if (opts.lane !== undefined) {
      params.push(opts.lane);
      laneClause = ` AND lane = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT
         pnl::float                                                AS pnl,
         gross_pnl::float                                          AS gross_pnl,
         (entry_price * quantity)::float                           AS notional
       FROM autonomous_trades
       WHERE status = 'closed'
         AND agent = $1
         AND reason LIKE 'monkey|%'
         AND pnl IS NOT NULL
         AND entry_price IS NOT NULL
         AND quantity IS NOT NULL${laneClause}
       ORDER BY exit_time DESC
       LIMIT ${RING_WINDOW}`,
      params,
    );
    const rows = (result.rows as Array<{ pnl: number; gross_pnl: number | null; notional: number }>);
    if (rows.length < RING_MIN_TRADES) return null;

    const wins: number[] = [];
    const losses: number[] = [];
    const winRoiNotional: number[] = [];
    const lossRoiNotional: number[] = [];
    const fees: number[] = [];
    let notionalSum = 0;
    for (const r of rows) {
      const pnl = r.pnl;
      const notional = r.notional;
      if (!Number.isFinite(pnl) || !Number.isFinite(notional) || notional <= 0) continue;
      notionalSum += notional;
      if (pnl > 0) {
        wins.push(pnl);
        winRoiNotional.push(pnl / notional);
      } else if (pnl < 0) {
        losses.push(pnl);
        lossRoiNotional.push(Math.abs(pnl / notional));
      }
      if (r.gross_pnl !== null && Number.isFinite(r.gross_pnl)) {
        const fee = r.gross_pnl - pnl;
        if (Number.isFinite(fee) && fee >= 0) fees.push(fee);
      }
    }
    const total = wins.length + losses.length;
    if (total < RING_MIN_TRADES) return null;

    const mean = (xs: number[]): number =>
      xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
    const median = (xs: number[]): number => {
      if (xs.length === 0) return 0;
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2
        : sorted[mid]!;
    };

    return {
      n: total,
      winRate: wins.length / total,
      avgWin: mean(wins),
      avgLoss: mean(losses),
      avgWinRoiNotional: mean(winRoiNotional),
      medianLossRoiNotional: median(lossRoiNotional),
      avgFeePerRoundTrip: mean(fees),
      avgNotional: notionalSum / rows.length,
    };
  } catch (err) {
    logger.debug('[outcomeRingStats] query failed — caller falls back to default behaviour', {
      agent: opts.agent, lane: opts.lane,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Fix A — break-even notional floor.
 *
 * Returns the minimum notional at which a typical win nets positive
 * after the kernel's own observed fee hit, with a doctrinal safety
 * margin so the typical win nets ≥ 33% positive (fees ≤ 2/3 of win).
 *
 *   floor = (avg_fee / avg_win_roi_notional) * 1.5
 *
 * Returns 0 when stats unavailable, when avg_win_roi is non-positive
 * (no wins yet, kernel hasn't shown an edge to defend), or when the
 * computed floor is non-finite. Caller takes `max(chemistry_notional,
 * floor)` so the floor only binds when chemistry-driven sizing is
 * below the break-even point. Self-deactivates as chemistry recovers
 * and chemistry_notional grows above the floor.
 */
export function computeBreakEvenNotionalFloor(stats: OutcomeRingStats | null): number {
  if (stats === null) return 0;
  if (stats.avgFeePerRoundTrip <= 0) return 0;
  if (stats.avgWinRoiNotional <= 0) return 0;
  const floor = (stats.avgFeePerRoundTrip / stats.avgWinRoiNotional) * FEE_SAFETY_MARGIN;
  return Number.isFinite(floor) && floor > 0 ? floor : 0;
}

/**
 * Fix B — Kelly fraction from the kernel's own outcome ring.
 *
 * Standard Kelly criterion: fraction = edge / |avg_loss| where
 * edge = wr * avg_win - (1 - wr) * |avg_loss|.
 *
 * Returns 0 when edge is non-positive (kernel hasn't earned the right
 * to size up) or stats unavailable. Caller multiplies this by a
 * bounded chemistry modulator (so chemistry shapes but can't collapse
 * the Kelly-derived risk fraction).
 *
 * The current production sample (66.5% WR, avg_win 0.120, avg_loss
 * −0.242) computes:
 *   edge = 0.665 × 0.120 − 0.335 × 0.242 = 0.0798 − 0.0810 = −0.0012
 *   kelly_frac = 0  (negative edge → don't add risk)
 *
 * This is the honest read: with current fee drag the edge is
 * structurally negative. Fix A removes the fee drag, lifting avg_win
 * net of fees, which should turn this positive.
 */
export function computeKellyFraction(stats: OutcomeRingStats | null): number {
  if (stats === null) return 0;
  const absLoss = Math.abs(stats.avgLoss);
  if (absLoss <= 0) {
    // No losses observed yet. If wins exist, allow a small fraction
    // (cold-start positive bias) but cap at 0.25 — the kernel hasn't
    // earned full-Kelly without exposure to losses.
    return stats.avgWin > 0 ? 0.25 : 0;
  }
  const edge = stats.winRate * stats.avgWin - (1 - stats.winRate) * absLoss;
  if (edge <= 0) return 0;
  const k = edge / absLoss;
  return Number.isFinite(k) && k > 0 ? Math.min(k, 1.0) : 0;
}

/**
 * Bounded chemistry modulator — replaces the multiplicative cap-collapse
 * of `max(0.1, dop × phi × (1-gaba))` with a bounded shape that never
 * zeros out a Kelly-justified position.
 *
 * Input:
 *   chem_signal = (dop - 0.5) - (gaba - 0.5)   ∈ [-1, +1]
 *   modulator   = 1.0 + 0.5 * tanh(chem_signal) ∈ [0.5, 1.5]
 *
 * The modulator can never collapse sizing to zero (the old formula
 * could, when any of dop/phi/gaba was extreme). Chemistry now shapes
 * sizing within a factor of 3× (0.5 to 1.5), bounded.
 *
 * Phi is dropped from this formula intentionally — it's a perception
 * coherence reading, not a directional sizing signal. Including it
 * caused the cap to collapse when basin was simply busy (high κ
 * jitter → low phi) without any actual risk-aversion reason.
 */
export function chemistryBoundedModulator(dopamine: number, gaba: number): number {
  const safeDop = Math.max(0, Math.min(1, dopamine));
  const safeGaba = Math.max(0, Math.min(1, gaba));
  const chemSignal = (safeDop - 0.5) - (safeGaba - 0.5);
  return 1.0 + 0.5 * Math.tanh(chemSignal);
}

/**
 * Fix C — observer-derived harvest gate floor.
 *
 * Returns the minimum ROI-on-notional at which `should_profit_harvest`
 * is allowed to fire. Below this floor the proposed exit is suppressed
 * (winners run until commensurate with the kernel's own typical
 * losses + fees).
 *
 *   loss_floor_roi = max(
 *     fee_break_even_roi,                                  # never harvest below fees
 *     |median_loss_roi_notional| * COMMENSURATE_K          # win ≥ k × median loss
 *   )
 *
 * COMMENSURATE_K = 1.5 is the doctrinal constant: when the loss/win
 * ratio is currently > 2× (the live audit number), demanding a win
 * ≥ 1.5× median loss lifts the ratio toward 1 over time. As the ratio
 * improves, this floor stays at the same multiple — it relaxes
 * relative to the smaller losses.
 *
 * Returns 0 when stats unavailable. Caller MUST allow hard SL,
 * bracket TP, directional_disagreement, stale_bleed to fire
 * regardless of this floor — those are safety exits, not harvest.
 */
export function computeObserverLossFloorRoi(stats: OutcomeRingStats | null): number {
  if (stats === null) return 0;
  const feeBreakEvenRoi = stats.avgNotional > 0
    ? stats.avgFeePerRoundTrip / stats.avgNotional
    : 0;
  const commensurate = stats.medianLossRoiNotional * COMMENSURATE_K;
  return Math.max(feeBreakEvenRoi, commensurate);
}

/** Exported constants for unit tests + doctrinal transparency. */
export const _RING_WINDOW = RING_WINDOW;
export const _RING_MIN_TRADES = RING_MIN_TRADES;
export const _FEE_SAFETY_MARGIN = FEE_SAFETY_MARGIN;
export const _COMMENSURATE_K = COMMENSURATE_K;
