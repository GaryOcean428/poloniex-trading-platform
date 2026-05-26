/**
 * kernel_predictions.ts — Issue #941 Phase 1.
 *
 * Capture-only instrumentation: writes one row to `kernel_predictions`
 * per snapshot (entry / state-transition / periodic / gate-fire / exit).
 *
 * DOCTRINAL GUARANTEES (binding):
 *
 *   1. **READ-ONLY** on kernel state. The capture path consumes kernel
 *      observables and writes them to DB. It NEVER mutates state, NEVER
 *      calls into kernel decision functions. Verified by code review:
 *      no imports of `executive` / `currentPositionSize` / `should*`
 *      from this module, and no setters on the basin or chemistry.
 *
 *   2. **NO ENV KNOBS.** Periodic cadence is observer-derived from
 *      basin_velocity (caller's responsibility). No env vars in this
 *      module — the caller controls the cadence.
 *
 *   3. **P15 FAIL-CLOSED.** All INSERTs are wrapped in try/catch and
 *      drop-and-log on failure. The kernel decision NEVER blocks on
 *      this module — the caller invokes us after the action is set
 *      and ignores any result. A DB outage degrades the corpus, never
 *      the trading path.
 *
 *   4. **PRE-REGISTERED HYPOTHESIS.** The corpus is the *input* to a
 *      kill-test programme on qig-verification. No claim that QIG laws
 *      apply to financial markets is made here. Substrate-specific
 *      exponents (κ_eff, screening ξ, bridge α) are recorded for later
 *      measurement; the frozen 2D TFIM constants stay frozen on TFIM.
 */

import { pool } from '../../db/connection.js';
import { fisherRao, BASIN_DIM, type Basin } from './basin.js';
import logger from '../../utils/logger.js';

export type SnapshotReason =
  | 'entry'
  | 'state_transition'
  | 'periodic'
  | 'gate_fire'
  | 'exit';

export interface KernelPredictionSnapshot {
  tradeId: number | null;
  kernelId: string;

  // Geometry
  perceptionBasin: Basin;
  strategyForecastBasin: Basin;
  basinVelocity: number | null;
  phi: number | null;
  kappaEff: number | null;

  // Prediction payload (nullable — kernel may not have predicted all of these
  // at every snapshot moment, e.g. on a held-position state-transition without
  // a fresh forecast).
  predictedHorizonSeconds: number | null;
  predictedTerminalPnlUsdt: number | null;
  predictedPnlStddevUsdt: number | null;
  predictedDirection: -1 | 0 | 1 | null;
  predictedConfidence: number | null;

  // Chemistry — six channels
  dopamine: number | null;
  serotonin: number | null;
  norepinephrine: number | null;
  gaba: number | null;
  endorphins: number | null;
  acetylcholine: number | null;

  // Regime triple + mode + lane
  regimeQuantum: number | null;
  regimeEfficient: number | null;
  regimeEquilibrium: number | null;
  mode: string | null;
  lane: string | null;

  // Trigger
  snapshotReason: SnapshotReason;
  triggeringGate: string | null;

  // Provenance
  kernelVersion: string;
  sourcePath: string;
}

/**
 * Observer-derived periodic cadence in seconds. Higher basin_velocity
 * → snapshot more often (fast-changing perception); lower → less often.
 * Clamped to [5, 300]s per the issue spec. NOT an env var.
 *
 * Spec: `1 / mean_basin_velocity`, clamped. The 1 in the numerator and
 * the 5..300 bounds are SAFETY_BOUNDs not operator knobs — they enforce
 * a minimum and maximum capture rate independent of basin behaviour.
 */
export function periodicCadenceSeconds(meanBasinVelocity: number): number {
  if (!Number.isFinite(meanBasinVelocity) || meanBasinVelocity <= 0) {
    return 60; // fallback when basin velocity is unknown/degenerate
  }
  const raw = 1 / meanBasinVelocity;
  return Math.max(5, Math.min(300, raw));
}

/** Convert a Basin (Float64Array) to a plain number[] for pg INSERT. */
function basinToArray(b: Basin): number[] {
  const out = new Array<number>(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i];
  return out;
}

/**
 * Write a kernel_predictions row. Fail-closed: any error is logged at
 * WARN and dropped. Returns the inserted id, or null on failure.
 *
 * The caller MUST NOT branch on the return value for kernel decisions —
 * a `null` return means the snapshot was lost but the kernel state is
 * unaffected.
 */
export async function writeKernelPrediction(
  snap: KernelPredictionSnapshot,
): Promise<number | null> {
  // Defensive: enforce basin dimension at the write boundary. If the
  // caller hands us a mis-shaped basin, drop with WARN rather than
  // emitting a CHECK-constraint violation against the DB.
  if (
    snap.perceptionBasin.length !== BASIN_DIM ||
    snap.strategyForecastBasin.length !== BASIN_DIM
  ) {
    logger.warn('[kernel_predictions] basin dim mismatch — dropped', {
      kernelId: snap.kernelId,
      perceptionDim: snap.perceptionBasin.length,
      forecastDim: snap.strategyForecastBasin.length,
      expected: BASIN_DIM,
    });
    return null;
  }

  const disagreement = fisherRao(snap.perceptionBasin, snap.strategyForecastBasin);

  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO kernel_predictions (
        trade_id, kernel_id,
        perception_basin, strategy_forecast_basin, fisher_rao_disagreement,
        basin_velocity, phi, kappa_eff,
        predicted_horizon_seconds, predicted_terminal_pnl_usdt,
        predicted_pnl_stddev_usdt, predicted_direction, predicted_confidence,
        dopamine, serotonin, norepinephrine, gaba, endorphins, acetylcholine,
        regime_quantum, regime_efficient, regime_equilibrium,
        mode, lane,
        snapshot_reason, triggering_gate,
        kernel_version, source_path
      ) VALUES (
        $1, $2,
        $3, $4, $5,
        $6, $7, $8,
        $9, $10,
        $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22,
        $23, $24,
        $25, $26,
        $27, $28
      ) RETURNING id`,
      [
        snap.tradeId, snap.kernelId,
        basinToArray(snap.perceptionBasin), basinToArray(snap.strategyForecastBasin), disagreement,
        snap.basinVelocity, snap.phi, snap.kappaEff,
        snap.predictedHorizonSeconds, snap.predictedTerminalPnlUsdt,
        snap.predictedPnlStddevUsdt, snap.predictedDirection, snap.predictedConfidence,
        snap.dopamine, snap.serotonin, snap.norepinephrine, snap.gaba, snap.endorphins, snap.acetylcholine,
        snap.regimeQuantum, snap.regimeEfficient, snap.regimeEquilibrium,
        snap.mode, snap.lane,
        snap.snapshotReason, snap.triggeringGate,
        snap.kernelVersion, snap.sourcePath,
      ],
    );

    const id = rows[0]?.id ?? null;
    // Increment prediction_count on the parent trade row if linked.
    // This is best-effort — failures here also drop silently.
    if (id !== null && snap.tradeId !== null) {
      try {
        await pool.query(
          `UPDATE autonomous_trades SET prediction_count = COALESCE(prediction_count, 0) + 1 WHERE id = $1`,
          [snap.tradeId],
        );
      } catch (incErr) {
        logger.warn('[kernel_predictions] prediction_count increment failed', {
          tradeId: snap.tradeId,
          err: incErr instanceof Error ? incErr.message : String(incErr),
        });
      }
    }
    return id;
  } catch (err) {
    logger.warn('[kernel_predictions] insert failed — dropped', {
      kernelId: snap.kernelId,
      snapshotReason: snap.snapshotReason,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
