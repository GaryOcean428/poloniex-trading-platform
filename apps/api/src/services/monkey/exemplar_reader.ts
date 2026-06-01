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
 *  - Only the most recent N minutes of decisions are considered (staleness gate).
 *  - Only "sufficient" conviction decisions are used (noise gate).
 *  - Anti-herding: the signal is a MODIFIER on existing entry threshold, not a
 *    gate. It raises or lowers the bar slightly; it cannot block trades outright.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

/** Lookback window: only consider decisions this fresh */
const EXEMPLAR_LOOKBACK_MS = 30 * 60 * 1000; // 30 minutes

/** Minimum conviction to count a decision (0..1). Below this = noise. */
const EXEMPLAR_MIN_CONVICTION = 0.3;

/** Maximum entry threshold modifier: +/- this fraction of base threshold. P25 SAFETY_BOUND. */
const EXEMPLAR_MAX_MODIFIER = 0.15; // 15% max adjustment

export interface ExemplarSignal {
  symbol: string;
  abstainCount: number;   // recent deliberate abstentions
  winCount: number;       // recent profitable entries
  lossCount: number;      // recent losing entries
  totalCount: number;     // total recent decisions
  entryModifier: number;  // [−MAX_MODIFIER, +MAX_MODIFIER]: positive = raise bar (harder to enter)
  regime: string | null;  // most recent exemplar regime assessment
  stale: boolean;         // true if no recent decisions
}

export async function getExemplarSignal(symbol: string): Promise<ExemplarSignal | null> {
  const since = new Date(Date.now() - EXEMPLAR_LOOKBACK_MS).toISOString();
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
         AND created_at >= $2
         AND (conviction IS NULL OR conviction >= $3)
       ORDER BY created_at DESC
       LIMIT 50`,
      [symbol, since, EXEMPLAR_MIN_CONVICTION],
    );
    const rows = result.rows;
    if (rows.length === 0) {
      return {
        symbol, abstainCount: 0, winCount: 0, lossCount: 0, totalCount: 0,
        entryModifier: 0, regime: null, stale: true,
      };
    }
    let abstainCount = 0;
    let winCount = 0;
    let lossCount = 0;
    let latestRegime: string | null = null;
    for (const row of rows) {
      if (row.is_abstain) { abstainCount++; continue; }
      if (row.outcome_pnl != null) {
        if (row.outcome_pnl > 0) winCount++;
        else if (row.outcome_pnl < 0) lossCount++;
      }
      if (latestRegime == null && row.regime != null) latestRegime = row.regime;
    }
    const totalCount = rows.length;
    // Compute entry modifier:
    // - Many abstentions → raise bar (positive modifier = harder to enter)
    // - Many wins → lower bar slightly (negative modifier = easier to enter)
    // - Many losses → raise bar (positive modifier)
    // Damping: bounded by EXEMPLAR_MAX_MODIFIER, tanh-smoothed for anti-herding
    const abstainFrac = abstainCount / Math.max(1, totalCount);
    const activeCount = totalCount - abstainCount;
    const winFrac = winCount / Math.max(1, activeCount);
    const lossFrac = lossCount / Math.max(1, activeCount);
    // Net signal: abstain + loss pull bar up; wins pull bar down
    const rawSignal = abstainFrac + lossFrac * 0.5 - winFrac * 0.3;
    // tanh smoothing prevents extreme modifier on small samples (anti-herding)
    const entryModifier = Math.tanh(rawSignal * 2) * EXEMPLAR_MAX_MODIFIER;
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
