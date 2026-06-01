/**
 * exemplar_reader.ts — read-side service for the CC→kernel exemplar channel.
 * (#1033 PR2: kernel consuming exemplar decisions with damping)
 *
 * Queries recent decisions from monkey_exemplar_decisions to produce a
 * per-symbol exemplar signal for the kernel's entry gate.
 *
 * Safety rules (mirrors doctrine from migration 065):
 *  - Reads are BEST-EFFORT: failure returns null (no brake). DB failure must
 *    NEVER block trading or safety.
 *  - The most recent N decisions are used (count-based, not time-based). N is a
 *    sample-size safety bound, not an operational tuning knob (P25 compliant).
 *  - Conviction is used as a WEIGHT, not a filter — low-conviction decisions
 *    contribute less rather than being discarded. This is self-observation:
 *    the kernel's own stated uncertainty modulates each decision's influence.
 *  - Anti-herding: the signal is a MODIFIER on existing entry threshold, not a
 *    gate. It raises or lowers the bar slightly; it cannot block trades outright.
 *
 * P5 / P25 compliance:
 *  - No time-based lookback window (was EXEMPLAR_LOOKBACK_MS — REMOVED).
 *  - No conviction threshold filter (was EXEMPLAR_MIN_CONVICTION — REMOVED).
 *  - EXEMPLAR_SAMPLE_WINDOW is a sample-size safety bound (P25 allows this).
 *  - EXEMPLAR_MODIFIER_SAFETY_CAP is a safety bound preventing runaway modifier.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

/** Safety bound: sample window size. Last N decisions are considered.
 * This is a statistical significance gate (minimum representative sample),
 * not an operational tuning knob. P25 compliant. */
const EXEMPLAR_SAMPLE_WINDOW = 30;

/** Safety bound: maximum exemplar modifier magnitude (prevents anti-herding runaway). P25 compliant. */
const EXEMPLAR_MODIFIER_SAFETY_CAP = 0.15;

export interface ExemplarSignal {
  symbol: string;
  abstainCount: number;   // recent deliberate abstentions (raw count)
  winCount: number;       // recent profitable entries (raw count)
  lossCount: number;      // recent losing entries (raw count)
  totalCount: number;     // total recent decisions (raw count)
  entryModifier: number;  // [−SAFETY_CAP, +SAFETY_CAP]: positive = raise bar (harder to enter)
  regime: string | null;  // most recent exemplar regime assessment
  stale: boolean;         // true if no recent decisions
}

export async function getExemplarSignal(symbol: string): Promise<ExemplarSignal | null> {
  try {
    const result = await pool.query<{
      action: string;
      is_abstain: boolean;
      conviction: number | null;
      outcome_pnl: number | null;
      regime: string | null;
    }>(
      `SELECT action, is_abstain, conviction, outcome_pnl, regime
       FROM monkey_exemplar_decisions
       WHERE symbol = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [symbol, EXEMPLAR_SAMPLE_WINDOW],
    );
    const rows = result.rows;
    if (rows.length === 0) {
      return {
        symbol, abstainCount: 0, winCount: 0, lossCount: 0, totalCount: 0,
        entryModifier: 0, regime: null, stale: true,
      };
    }

    // Conviction-weighted signal accumulation.
    // Conviction is the kernel's own stated certainty (0..1). Using it as a
    // weight (rather than a filter threshold) means low-conviction decisions
    // still contribute — they just count less. Self-observation: the kernel's
    // expressed uncertainty shapes its own history interpretation.
    // Decisions with missing conviction default to 0.5 (neutral weight).
    let abstainWeight = 0;
    let winWeight = 0;
    let lossWeight = 0;
    let totalWeight = 0;
    let abstainCount = 0;
    let winCount = 0;
    let lossCount = 0;
    let latestRegime: string | null = null;

    for (const row of rows) {
      const weight = row.conviction != null ? Math.max(0, Math.min(1, row.conviction)) : 0.5;
      totalWeight += weight;
      if (row.is_abstain) {
        abstainWeight += weight;
        abstainCount++;
        continue;
      }
      if (row.outcome_pnl != null) {
        if (row.outcome_pnl > 0) { winWeight += weight; winCount++; }
        else if (row.outcome_pnl < 0) { lossWeight += weight; lossCount++; }
      }
      if (latestRegime == null && row.regime != null) latestRegime = row.regime;
    }

    const totalCount = rows.length;

    // Compute entry modifier from conviction-weighted fractions:
    // - Many abstentions → raise bar (positive modifier = harder to enter)
    // - Many wins → lower bar slightly (negative modifier = easier to enter)
    // - Many losses → raise bar (positive modifier)
    // Damping: bounded by EXEMPLAR_MODIFIER_SAFETY_CAP, tanh-smoothed (anti-herding).
    const activeWeight = Math.max(0.001, totalWeight - abstainWeight);
    const abstainFrac = abstainWeight / Math.max(0.001, totalWeight);
    const winFrac = winWeight / activeWeight;
    const lossFrac = lossWeight / activeWeight;
    // Net signal: abstain + loss pull bar up; wins pull bar down
    const rawSignal = abstainFrac + lossFrac * 0.5 - winFrac * 0.3;
    // tanh smoothing prevents extreme modifier on small samples (anti-herding)
    const entryModifier = Math.tanh(rawSignal * 2) * EXEMPLAR_MODIFIER_SAFETY_CAP;

    return {
      symbol,
      abstainCount,
      winCount,
      lossCount,
      totalCount,
      entryModifier,
      regime: latestRegime,
      stale: false,
    };
  } catch (err) {
    logger.warn('[exemplar] getExemplarSignal failed (non-fatal, returning null)', {
      symbol, err: err instanceof Error ? err.message : String(err),
    });
    return null; // fail open — never block trading
  }
}
