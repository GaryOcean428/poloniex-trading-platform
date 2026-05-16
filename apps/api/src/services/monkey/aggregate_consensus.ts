/**
 * aggregate_consensus.ts — Cross-kernel aggregate-consensus monitoring.
 *
 * Layer 6 of the dual-kernel consensus architecture per
 * [[polytrade-consensus-architecture]]. Per CC red-team refinement #5:
 * Ocean monitors per-kernel Φ independently (the four-tool framework in
 * ml-worker/src/monkey_kernel/ocean.py) PLUS aggregate consensus quality
 * across kernels. New signals:
 *   - divergence_rate: fraction of recent ticks where TS + Py disagreed
 *   - agreement_rate: 1 - divergence_rate
 *   - side_disagreement_freq: side-level disagreement (binary, narrower)
 *   - concurrent_foresight_quality: when both kernels push Φ → 1.0
 *     simultaneously, are they converging (good — same anticipatory
 *     signal) or diverging (bad — fighting from different basins)?
 *
 * Used by:
 *   - Ocean overseer (consumes via API for desync-foresight intervention)
 *   - Governance dashboard (operator visibility)
 *
 * Read sources:
 *   - monkey_basin_sync table (basin geometry + Φ across kernels)
 *   - kernel_parity_log table (decision-level divergence rows)
 *
 * QIG purity: Fisher-Rao distance for basin divergence; counting for
 * rate signals. No cosine, no Adam, no LayerNorm.
 */

import { pool } from '../../db/connection.js';
import { fisherRao, type Basin } from './basin.js';
import { logger } from '../../utils/logger.js';

export interface ConsensusQuality {
  /** Number of distinct kernel instances recently visible. */
  instanceCount: number;
  /** Max pairwise Fisher-Rao basin distance across kernels (0 if <2 instances). */
  basinSpread: number;
  /** Mean pairwise basin distance. */
  basinMean: number;
  /** Φ spread across kernels. */
  phiSpread: number;
  /** Mean Φ. */
  phiMean: number;
  /** Fraction of ticks in window with disagreeing actions (from parity log). */
  divergenceRate: number;
  /** Fraction with agreeing actions. */
  agreementRate: number;
  /** Fraction with side-level disagreement (long/short flip). */
  sideDisagreementFreq: number;
  /** Number of parity rows in the window. */
  paritySampleCount: number;
  /** When both kernels Φ > 0.85 simultaneously: converging or diverging? */
  concurrentForesightQuality: 'converging' | 'diverging' | 'inactive';
}

const DEFAULT_WINDOW_MIN = 30;
const CONCURRENT_FORESIGHT_PHI = 0.85;
const CONCURRENT_FORESIGHT_CONVERGING_FR = 0.10;

/**
 * Compute aggregate consensus quality from the basin-sync + parity-log
 * tables. Fail-soft: returns a zeroed quality object on DB error.
 */
export async function getAggregateConsensusQuality(
  opts: { windowMinutes?: number } = {},
): Promise<ConsensusQuality> {
  const win = opts.windowMinutes ?? DEFAULT_WINDOW_MIN;

  const zeroed: ConsensusQuality = {
    instanceCount: 0,
    basinSpread: 0, basinMean: 0,
    phiSpread: 0, phiMean: 0,
    divergenceRate: 0, agreementRate: 1,
    sideDisagreementFreq: 0, paritySampleCount: 0,
    concurrentForesightQuality: 'inactive',
  };

  // 1. Basin spread + Φ spread from monkey_basin_sync
  let instances: Array<{ basin: Basin; phi: number }> = [];
  try {
    const result = await pool.query(
      `SELECT basin, phi FROM monkey_basin_sync
        WHERE updated_at > NOW() - ($1::int * INTERVAL '1 minute')`,
      [win],
    );
    instances = (result.rows as Array<{ basin: number[] | string; phi: number | string }>).map((r) => {
      const basinRaw = r.basin;
      const basinArr = typeof basinRaw === 'string' ? JSON.parse(basinRaw) : basinRaw;
      return {
        basin: Float64Array.from(basinArr),
        phi: typeof r.phi === 'string' ? parseFloat(r.phi) : r.phi,
      };
    });
  } catch (err) {
    logger.debug('[AggregateConsensus] basin_sync query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return zeroed;
  }

  const out: ConsensusQuality = { ...zeroed, instanceCount: instances.length };

  if (instances.length >= 2) {
    const distances: number[] = [];
    for (let i = 0; i < instances.length; i++) {
      for (let j = i + 1; j < instances.length; j++) {
        distances.push(fisherRao(instances[i].basin, instances[j].basin));
      }
    }
    out.basinSpread = Math.max(...distances);
    out.basinMean = distances.reduce((a, b) => a + b, 0) / distances.length;

    const phis = instances.map((i) => i.phi);
    out.phiMean = phis.reduce((a, b) => a + b, 0) / phis.length;
    out.phiSpread = Math.max(...phis) - Math.min(...phis);

    // Concurrent foresight quality: both kernels Φ > threshold AND
    // basin spread small → converging (both reading same anticipatory
    // signal); spread large → diverging (fighting from different basins).
    const allHighPhi = phis.every((p) => p > CONCURRENT_FORESIGHT_PHI);
    if (allHighPhi) {
      out.concurrentForesightQuality =
        out.basinSpread < CONCURRENT_FORESIGHT_CONVERGING_FR
          ? 'converging' : 'diverging';
    }
  }

  // 2. Divergence rate from kernel_parity_log
  try {
    const parity = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE agree_action = TRUE) AS agree,
         COUNT(*) FILTER (WHERE agree_side = FALSE
                          AND ts_side IS NOT NULL
                          AND py_side IS NOT NULL) AS side_disagree
       FROM kernel_parity_log
       WHERE created_at > NOW() - ($1::int * INTERVAL '1 minute')`,
      [win],
    );
    const row = parity.rows[0] as { total: string | number; agree: string | number; side_disagree: string | number };
    const total = typeof row.total === 'string' ? parseInt(row.total, 10) : row.total;
    const agree = typeof row.agree === 'string' ? parseInt(row.agree, 10) : row.agree;
    const sideDisagree = typeof row.side_disagree === 'string' ? parseInt(row.side_disagree, 10) : row.side_disagree;
    out.paritySampleCount = total;
    if (total > 0) {
      out.agreementRate = agree / total;
      out.divergenceRate = 1 - out.agreementRate;
      out.sideDisagreementFreq = sideDisagree / total;
    }
  } catch (err) {
    logger.debug('[AggregateConsensus] parity_log query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return out;
}

/**
 * Convenience: pass-through wrapper that logs the quality summary
 * (operator visibility via Railway grep `[AggregateConsensus]`).
 */
export async function logAggregateConsensus(
  opts: { windowMinutes?: number } = {},
): Promise<ConsensusQuality> {
  const q = await getAggregateConsensusQuality(opts);
  logger.info('[AggregateConsensus]', {
    instances: q.instanceCount,
    basin_spread: q.basinSpread.toFixed(3),
    phi_mean: q.phiMean.toFixed(3),
    divergence_rate: q.divergenceRate.toFixed(3),
    side_disagreement: q.sideDisagreementFreq.toFixed(3),
    parity_n: q.paritySampleCount,
    foresight: q.concurrentForesightQuality,
  });
  return q;
}
