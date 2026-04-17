/**
 * Regime cohort memory.
 *
 * When a strategy is retired (killed, not demoted) while it had
 * positive lifetime realised P&L, we freeze its genome + regime tag
 * into the frozen_cohorts table. When the same regime recurs later
 * the SLE can reactivate champions that already proved themselves in
 * that regime — avoiding the cold-start cost of generating new
 * variants from scratch.
 *
 * This is a thin DB adapter. Logic for WHEN to freeze / reactivate
 * lives in strategyLearningEngine; this module just owns the storage
 * contract so it's individually testable / mockable.
 */

import { query } from '../db/connection.js';
import type { SignalGenome } from './signalGenome.js';
import type { StrategyClass } from './thompsonBandit.js';
import { getEngineVersion } from '../utils/engineVersion.js';
import { logger } from '../utils/logger.js';

export interface FrozenCohort {
  id: number;
  strategyId: string;
  strategyClass: StrategyClass;
  regime: string;
  signalGenome: SignalGenome;
  lifetimePnl: number;
  liveTrades: number;
  paperTrades: number;
  frozenAt: Date;
  frozenReason: string;
  engineVersion: string;
  reactivatedCount: number;
}

export interface FreezeInput {
  strategyId: string;
  strategyClass: StrategyClass;
  regime: string;
  signalGenome: SignalGenome;
  lifetimePnl: number;
  liveTrades: number;
  paperTrades: number;
  reason: string;
}

/** Insert a champion into the frozen cohort archive. */
export async function freezeCohort(input: FreezeInput): Promise<number | null> {
  try {
    const result = await query(
      `INSERT INTO frozen_cohorts
         (strategy_id, strategy_class, regime, signal_genome,
          lifetime_pnl, live_trades, paper_trades,
          frozen_reason, engine_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.strategyId,
        input.strategyClass,
        input.regime,
        JSON.stringify(input.signalGenome),
        input.lifetimePnl,
        input.liveTrades,
        input.paperTrades,
        input.reason,
        getEngineVersion(),
      ],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    logger.error('[regimeCohortMemory] freezeCohort failed', {
      strategyId: input.strategyId,
      regime: input.regime,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Top-N champions for a regime, ordered by lifetime P&L descending.
 * Used by the bandit when that regime recurs.
 */
export async function findChampionsForRegime(
  regime: string,
  limit = 3,
): Promise<FrozenCohort[]> {
  try {
    const result = await query(
      `SELECT id, strategy_id, strategy_class, regime, signal_genome,
              lifetime_pnl, live_trades, paper_trades, frozen_at,
              frozen_reason, engine_version, reactivated_count
         FROM frozen_cohorts
         WHERE regime = $1
           AND lifetime_pnl > 0
         ORDER BY lifetime_pnl DESC
         LIMIT $2`,
      [regime, limit],
    );
    return result.rows.map(rowToCohort);
  } catch (err) {
    logger.warn('[regimeCohortMemory] findChampionsForRegime failed', {
      regime,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Increment the reactivated counter so we can later see which champions returned. */
export async function markReactivated(cohortId: number): Promise<void> {
  try {
    await query(
      `UPDATE frozen_cohorts
          SET reactivated_count = reactivated_count + 1
        WHERE id = $1`,
      [cohortId],
    );
  } catch (err) {
    logger.warn('[regimeCohortMemory] markReactivated failed', {
      cohortId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function rowToCohort(row: Record<string, unknown>): FrozenCohort {
  const genome =
    typeof row.signal_genome === 'string'
      ? (JSON.parse(row.signal_genome as string) as SignalGenome)
      : (row.signal_genome as SignalGenome);
  return {
    id: Number(row.id),
    strategyId: String(row.strategy_id),
    strategyClass: String(row.strategy_class) as StrategyClass,
    regime: String(row.regime),
    signalGenome: genome,
    lifetimePnl: Number(row.lifetime_pnl),
    liveTrades: Number(row.live_trades),
    paperTrades: Number(row.paper_trades),
    frozenAt: new Date(row.frozen_at as string),
    frozenReason: String(row.frozen_reason),
    engineVersion: String(row.engine_version),
    reactivatedCount: Number(row.reactivated_count),
  };
}
