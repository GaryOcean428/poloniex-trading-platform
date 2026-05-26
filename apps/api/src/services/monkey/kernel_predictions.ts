import type { QueryResult } from 'pg';

import { pool } from '../../db/connection.js';
import { getEngineVersion } from '../../utils/engineVersion.js';
import { logger } from '../../utils/logger.js';

import { fisherRao, type Basin } from './basin.js';
import type { NeurochemicalState } from './neurochemistry.js';

export type PredictionSnapshotReason =
  | 'entry'
  | 'state_transition'
  | 'periodic'
  | 'gate_fire'
  | 'exit';

export interface KernelPredictionSnapshot {
  tradeId?: string | number | null;
  kernelId: string;
  perceptionBasin: ArrayLike<number>;
  strategyForecastBasin: ArrayLike<number>;
  fisherRaoDisagreement?: number;
  basinVelocity?: number | null;
  phi?: number | null;
  kappaEff?: number | null;
  predictedHorizonSeconds?: number | null;
  predictedTerminalPnlUsdt?: number | null;
  predictedPnlStddevUsdt?: number | null;
  predictedDirection?: -1 | 0 | 1 | null;
  predictedConfidence?: number | null;
  neurochemistry?: Partial<NeurochemicalState> | null;
  regimeWeights?: {
    quantum?: number | null;
    efficient?: number | null;
    equilibrium?: number | null;
  } | null;
  mode?: string | null;
  lane?: string | null;
  snapshotReason: PredictionSnapshotReason;
  triggeringGate?: string | null;
  kernelVersion?: string;
  sourcePath: string;
}

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult<unknown>>;
};

const BUFFER_MAX = 1000;
const pending: KernelPredictionSnapshot[] = [];
let draining = false;

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function basinArray(value: ArrayLike<number>): number[] {
  return Array.from(value, (x) => Number(x));
}

function tradeIdParam(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function clampPredictionCadenceSeconds(
  basinVelocityRunningMean: number | null | undefined,
): number {
  const mean = Number(basinVelocityRunningMean);
  if (!Number.isFinite(mean) || mean <= 0) return 300;
  return Math.min(300, Math.max(5, 1 / mean));
}

export function predictionDirectionFromSide(side: string | null | undefined): -1 | 0 | 1 {
  if (side === 'long') return 1;
  if (side === 'short') return -1;
  return 0;
}

export async function insertKernelPrediction(
  snapshot: KernelPredictionSnapshot,
  queryable: Queryable = pool,
): Promise<void> {
  const perception = basinArray(snapshot.perceptionBasin);
  const forecast = basinArray(snapshot.strategyForecastBasin);
  const disagreement = finiteOrNull(snapshot.fisherRaoDisagreement)
    ?? fisherRao(Float64Array.from(perception) as Basin, Float64Array.from(forecast) as Basin);
  const nc = snapshot.neurochemistry ?? {};
  const regime = snapshot.regimeWeights ?? {};
  const tradeId = tradeIdParam(snapshot.tradeId);

  await queryable.query(
    `WITH inserted AS (
       INSERT INTO kernel_predictions
         (trade_id, kernel_id, perception_basin, strategy_forecast_basin,
          fisher_rao_disagreement, basin_velocity, phi, kappa_eff,
          predicted_horizon_seconds, predicted_terminal_pnl_usdt,
          predicted_pnl_stddev_usdt, predicted_direction, predicted_confidence,
          dopamine, serotonin, norepinephrine, gaba, endorphins, acetylcholine,
          regime_quantum, regime_efficient, regime_equilibrium, mode, lane,
          snapshot_reason, triggering_gate, kernel_version, source_path)
       VALUES
         ($1, $2, $3::float8[], $4::float8[], $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26, $27, $28)
       RETURNING trade_id
     )
     UPDATE autonomous_trades
        SET prediction_count = COALESCE(prediction_count, 0) + 1
      WHERE id = (SELECT trade_id FROM inserted WHERE trade_id IS NOT NULL)`,
    [
      tradeId,
      snapshot.kernelId,
      perception,
      forecast,
      disagreement,
      finiteOrNull(snapshot.basinVelocity),
      finiteOrNull(snapshot.phi),
      finiteOrNull(snapshot.kappaEff),
      finiteOrNull(snapshot.predictedHorizonSeconds),
      finiteOrNull(snapshot.predictedTerminalPnlUsdt),
      finiteOrNull(snapshot.predictedPnlStddevUsdt),
      snapshot.predictedDirection ?? null,
      finiteOrNull(snapshot.predictedConfidence),
      finiteOrNull(nc.dopamine),
      finiteOrNull(nc.serotonin),
      finiteOrNull(nc.norepinephrine),
      finiteOrNull(nc.gaba),
      finiteOrNull(nc.endorphins),
      finiteOrNull(nc.acetylcholine),
      finiteOrNull(regime.quantum),
      finiteOrNull(regime.efficient),
      finiteOrNull(regime.equilibrium),
      snapshot.mode ?? null,
      snapshot.lane ?? null,
      snapshot.snapshotReason,
      snapshot.triggeringGate ?? null,
      snapshot.kernelVersion ?? getEngineVersion(),
      snapshot.sourcePath,
    ],
  );
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.length > 0) {
      const next = pending[0]!;
      try {
        await insertKernelPrediction(next);
        pending.shift();
      } catch (err) {
        logger.warn('[KernelPredictions] insert failed; keeping bounded backlog', {
          err: err instanceof Error ? err.message : String(err),
          pending: pending.length,
        });
        return;
      }
    }
  } finally {
    draining = false;
  }
}

export function recordKernelPrediction(snapshot: KernelPredictionSnapshot): void {
  pending.push(snapshot);
  if (pending.length > BUFFER_MAX) {
    pending.shift();
    logger.warn('[KernelPredictions] backlog full; dropped oldest snapshot', {
      max: BUFFER_MAX,
    });
  }
  void drain();
}

export function _resetKernelPredictionBufferForTests(): void {
  pending.splice(0, pending.length);
  draining = false;
}
