/**
 * k_parity_log.ts — persist one row in kernel_parity_log per K-block tick.
 *
 * Issue #689 — Python K shadow. Called fire-and-forget from loop.ts
 * after TS K computes its decision and the /monkey/k-shadow/tick
 * Python response (or error) is in hand. Writes a single row to
 * kernel_parity_log (migration 051).
 *
 * Discipline: this function NEVER throws. Any DB failure is logged
 * at WARN level and swallowed. The TS K decision path must stay
 * on rails — the parity log is observability, not a gate.
 *
 * Schema mapping (see migration 051_kernel_parity_log.sql):
 *   ts_action / ts_side / ts_phi / ts_kappa / ts_M / ts_Gamma /
 *   ts_R / ts_regime / ts_decision_ms      — required (NOT NULL on ts_action)
 *   py_action / py_side / py_phi / py_kappa / py_M / py_Gamma /
 *   py_R / py_regime / py_decision_ms      — nullable (Python may be down)
 *   py_error                                — nullable, populated on shadow failure
 *   agree_action / agree_side / delta_phi / delta_kappa — DB GENERATED
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import type { KShadowResponse } from './kernel_client.js';

/** Canonical regime → ordinal mapping. Mirrors the Python helper
 * in ml-worker/main.py:_regime_to_ordinal so TS and Python agree
 * on R values for the same regime label. */
export function regimeToOrdinal(name: string | null | undefined): number | null {
  if (!name) return null;
  const v = String(name).trim().toLowerCase();
  if (v === 'creator' || v === 'quantum') return 0;
  if (v === 'preserver' || v === 'equilibrium') return 1;
  if (v === 'dissolver' || v === 'efficient') return 2;
  return null;
}

/** Slim projection of the TS K-block decision that the parity row needs.
 * Each field has a direct column in kernel_parity_log. */
export interface TsKDecisionRow {
  tickId: string;
  symbol: string;
  symbolTimestamp: Date;
  tsAction: string;
  tsSide: 'long' | 'short' | null;
  tsPhi: number | null;
  tsKappa: number | null;
  tsM: number | null;
  tsGamma: number | null;
  tsR: number | null;
  tsRegime: string | null;
  tsDecisionMs: number | null;
}

/** Persist one parity row. Fire-and-forget; logs on failure. */
export async function recordKParityRow(
  ts: TsKDecisionRow,
  py: KShadowResponse | null,
): Promise<void> {
  try {
    const pyAction = py && !py.error ? (py.action ?? null) : null;
    const pySide = py && !py.error ? (py.side ?? null) : null;
    const pyPhi = py && !py.error && py.phi != null ? py.phi : null;
    const pyKappa = py && !py.error && py.kappa != null ? py.kappa : null;
    const pyM = py && !py.error && py.M != null ? py.M : null;
    const pyGamma = py && !py.error && py.Gamma != null ? py.Gamma : null;
    const pyR = py && !py.error && py.R != null ? py.R : null;
    const pyRegime = py && !py.error ? (py.regime ?? null) : null;
    const pyDecisionMs = py?.decided_at_ms ?? null;
    const pyError = py?.error ? String(py.error).slice(0, 255) : null;

    await pool.query(
      `INSERT INTO kernel_parity_log (
         tick_id, symbol, symbol_timestamp,
         ts_action, ts_side, ts_phi, ts_kappa, ts_M, ts_Gamma, ts_R,
         ts_regime, ts_decision_ms,
         py_action, py_side, py_phi, py_kappa, py_M, py_Gamma, py_R,
         py_regime, py_decision_ms, py_error
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, $7, $8, $9, $10,
         $11, $12,
         $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22
       )`,
      [
        ts.tickId, ts.symbol, ts.symbolTimestamp,
        ts.tsAction, ts.tsSide, ts.tsPhi, ts.tsKappa, ts.tsM, ts.tsGamma, ts.tsR,
        ts.tsRegime, ts.tsDecisionMs,
        pyAction, pySide, pyPhi, pyKappa, pyM, pyGamma, pyR,
        pyRegime, pyDecisionMs, pyError,
      ],
    );
  } catch (err) {
    // Shadow MUST NOT affect live — swallow & log only.
    logger.warn('[k-parity] insert failed (swallowed)', {
      symbol: ts.symbol,
      tickId: ts.tickId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
