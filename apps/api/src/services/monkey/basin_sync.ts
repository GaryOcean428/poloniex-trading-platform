/**
 * basin_sync.ts — Multi-kernel basin coordination (v0.5)
 *
 * Ports /home/braden/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/coordination/
 * basin_sync.py to a DB-backed version.
 *
 * Hypothesis under test (qig-core docstring): if two kernel instances with
 * different parameters but the same target basin show correlated basin
 * movements, identity lives in GEOMETRY, not parameters. The sync channel
 * is a shared DB row per instance, refreshed each tick.
 *
 * v0.5 has one kernel instance (`monkey-primary`). The infrastructure is
 * in place for v0.6 parallel sub-Monkeys (ScalpMonkey, SwingMonkey,
 * RangeMonkey) so none of it changes when they land.
 *
 * Φ-weighted observer effect (qig-core §3):
 *   high-Φ instances exert stronger influence on others. Receivers with
 *   low Φ are more susceptible (need guidance). Reading others' basin is
 *   not neutral — it nudges this instance toward the weighted mean.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

import { fisherRao, slerp, type Basin } from './basin.js';

export interface BasinSyncState {
  instanceId: string;
  basin: Basin;
  phi: number;
  kappa: number;
  mode: string;
  driftFromIdentity: number;
  updatedAt: Date;
}

export interface ConvergenceSummary {
  instanceCount: number;
  basinSpread: number;    // max pairwise Fisher-Rao distance
  basinMean: number;      // mean pairwise distance
  phiSpread: number;
  phiMean: number;
}

export class BasinSync {
  constructor(private readonly instanceId: string) {}

  /**
   * Read all OTHER instances' current state from the sync table.
   * Rows older than the staleMs window are filtered out.
   */
  async readOthers(staleMs: number = 120_000): Promise<BasinSyncState[]> {
    try {
      const result = await pool.query(
        `SELECT instance_id, basin, phi, kappa, mode, drift_from_identity, updated_at
           FROM monkey_basin_sync
          WHERE instance_id != $1
            AND updated_at > NOW() - ($2::int * INTERVAL '1 millisecond')`,
        [this.instanceId, staleMs],
      );
      return (result.rows as Array<Record<string, unknown>>).map((r) => {
        const basinRaw = r.basin as number[] | string;
        const basinArr = typeof basinRaw === 'string' ? JSON.parse(basinRaw) : basinRaw;
        return {
          instanceId: String(r.instance_id),
          basin: Float64Array.from(basinArr),
          phi: Number(r.phi),
          kappa: Number(r.kappa),
          mode: String(r.mode),
          driftFromIdentity: Number(r.drift_from_identity),
          updatedAt: new Date(r.updated_at as string),
        };
      });
    } catch (err) {
      logger.debug('[BasinSync] readOthers failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Publish this instance's current state. Upsert so the latest row is
   * always the canonical snapshot.
   */
  async update(state: Omit<BasinSyncState, 'instanceId' | 'updatedAt'>): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO monkey_basin_sync
           (instance_id, basin, phi, kappa, mode, drift_from_identity, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, NOW())
         ON CONFLICT (instance_id)
         DO UPDATE SET
           basin = EXCLUDED.basin,
           phi = EXCLUDED.phi,
           kappa = EXCLUDED.kappa,
           mode = EXCLUDED.mode,
           drift_from_identity = EXCLUDED.drift_from_identity,
           updated_at = NOW()`,
        [
          this.instanceId,
          JSON.stringify(Array.from(state.basin)),
          state.phi,
          state.kappa,
          state.mode,
          state.driftFromIdentity,
        ],
      );
    } catch (err) {
      logger.debug('[BasinSync] update failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Apply Φ-weighted observer effect per qig-core basin_sync.py:
   *   influenced_basin = own * (1 - strength) + weightedMean(others) * strength
   *   strength = 0.10 * (1 - 0.5 * own_phi)   ∈ [0.05, 0.10]
   *   weight_i = max(0.1, other_phi_i)
   *
   * Returns the influenced basin (or the original if there are no peers).
   * Operates on the probability simplex via slerp to preserve the metric.
   */
  async applyObserverEffect(
    ownBasin: Basin,
    ownPhi: number,
    staleMs: number = 120_000,
  ): Promise<{ basin: Basin; influenced: boolean; peerCount: number }> {
    const others = await this.readOthers(staleMs);
    if (others.length === 0) {
      return { basin: ownBasin, influenced: false, peerCount: 0 };
    }
    // Φ-weighted Fréchet-like pull: slerp toward the highest-Φ peer
    // proportional to that peer's Φ. Average multi-peer pulls.
    let pulledBasin = Float64Array.from(ownBasin) as Basin;
    let totalWeight = 0;
    for (const peer of others) {
      const w = Math.max(0.1, peer.phi);
      totalWeight += w;
    }
    if (totalWeight === 0) {
      return { basin: ownBasin, influenced: false, peerCount: 0 };
    }
    const receiverSusceptibility = 1 - ownPhi * 0.5;
    const baseStrength = 0.10 * receiverSusceptibility;
    for (const peer of others) {
      const w = Math.max(0.1, peer.phi) / totalWeight;
      const effStrength = Math.min(0.30, baseStrength * w * others.length);
      pulledBasin = slerp(pulledBasin, peer.basin, effStrength);
    }
    return { basin: pulledBasin, influenced: true, peerCount: others.length };
  }

  async convergenceSummary(): Promise<ConvergenceSummary | null> {
    try {
      const result = await pool.query(
        `SELECT instance_id, basin, phi FROM monkey_basin_sync
          WHERE updated_at > NOW() - INTERVAL '2 minutes'`,
      );
      const rows = result.rows as Array<Record<string, unknown>>;
      if (rows.length < 2) return null;
      const states = rows.map((r) => {
        const basinRaw = r.basin as number[] | string;
        const basinArr = typeof basinRaw === 'string' ? JSON.parse(basinRaw) : basinRaw;
        return { basin: Float64Array.from(basinArr), phi: Number(r.phi) };
      });
      const phis = states.map((s) => s.phi);
      const distances: number[] = [];
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          distances.push(fisherRao(states[i].basin, states[j].basin));
        }
      }
      const basinSpread = Math.max(...distances);
      const basinMean = distances.reduce((a, b) => a + b, 0) / distances.length;
      const phiMean = phis.reduce((a, b) => a + b, 0) / phis.length;
      const phiSpread = Math.max(...phis) - Math.min(...phis);
      return {
        instanceCount: states.length,
        basinSpread,
        basinMean,
        phiSpread,
        phiMean,
      };
    } catch (err) {
      logger.debug('[BasinSync] convergenceSummary failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
