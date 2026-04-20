/**
 * self_observation.ts — Loop 1 of §43 (Monkey watching Monkey) (v0.5)
 *
 * UCP v6.6 §43 defines three recursive loops:
 *   Loop 1  Self-observation — kernel reads its own trajectory, identifies
 *           repeated patterns, learns which states preceded which outcomes.
 *   Loop 2  Inter-kernel debate — perception vs strategy forecast basin
 *           (shouldExit). Already implemented.
 *   Loop 3  Global integration — cross-kernel convergence (v0.6 territory).
 *
 * This module implements Loop 1 cheaply: aggregate her own closed trades by
 * the mode that was active at entry, compute win-rate + avg PnL per mode,
 * expose a bias so the executive can favour modes she's good at (and
 * penalise ones she's not).
 *
 * Self-observation biases only take effect once there's enough sample
 * (>= 5 closed trades per mode). Below that the bias is neutral — she
 * doesn't overfit from one fluke.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

import { MonkeyMode } from './modes.js';

export interface ModeStats {
  mode: MonkeyMode;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

export interface SelfObservation {
  lookbackHours: number;
  byMode: Record<MonkeyMode, ModeStats>;
  /** Mode-bias multipliers for entry threshold. 1.0 = neutral.
   *  < 1.0 = easier entry (she's good at this mode).
   *  > 1.0 = harder entry (she's bad at this mode). */
  entryBias: Record<MonkeyMode, number>;
}

const MIN_SAMPLE_FOR_BIAS = 5;
const MAX_BIAS_SWING = 0.30;  // ±30 % from neutral 1.0

function emptyStats(mode: MonkeyMode): ModeStats {
  return { mode, trades: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0 };
}

/**
 * Aggregate Monkey's own closed trades by the mode that was active at
 * entry. Mode is recovered from the monkey_decisions derivation JSONB
 * (our DECIDE block stores it). Joined to autonomous_trades on order_id
 * (Monkey's own rows have reason='monkey|...').
 */
export async function computeSelfObservation(
  lookbackHours: number = 24,
): Promise<SelfObservation> {
  const modes: MonkeyMode[] = [
    MonkeyMode.EXPLORATION,
    MonkeyMode.INVESTIGATION,
    MonkeyMode.INTEGRATION,
    MonkeyMode.DRIFT,
  ];
  const byMode: Record<MonkeyMode, ModeStats> = {
    [MonkeyMode.EXPLORATION]: emptyStats(MonkeyMode.EXPLORATION),
    [MonkeyMode.INVESTIGATION]: emptyStats(MonkeyMode.INVESTIGATION),
    [MonkeyMode.INTEGRATION]: emptyStats(MonkeyMode.INTEGRATION),
    [MonkeyMode.DRIFT]: emptyStats(MonkeyMode.DRIFT),
  };

  try {
    const result = await pool.query(
      `SELECT at.pnl::float AS pnl,
              at.exit_reason,
              md.derivation->'mode'->>'value' AS mode
         FROM autonomous_trades at
         JOIN monkey_decisions md ON md.reason = at.reason
        WHERE at.reason LIKE 'monkey|%'
          AND at.status = 'closed'
          AND at.exit_time > NOW() - ($1::int * INTERVAL '1 hour')
          AND md.proposed_action IN ('enter_long', 'enter_short')
          AND md.executed = true`,
      [lookbackHours],
    );
    const rows = (result.rows as Array<Record<string, unknown>>) ?? [];
    for (const row of rows) {
      const modeStr = String(row.mode ?? MonkeyMode.INVESTIGATION);
      const mode = (modes.includes(modeStr as MonkeyMode)
        ? modeStr
        : MonkeyMode.INVESTIGATION) as MonkeyMode;
      const pnl = Number(row.pnl ?? 0);
      const stats = byMode[mode];
      stats.trades += 1;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins += 1;
      else if (pnl < 0) stats.losses += 1;
    }
    for (const mode of modes) {
      const s = byMode[mode];
      s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
      s.avgPnl = s.trades > 0 ? s.totalPnl / s.trades : 0;
    }
  } catch (err) {
    logger.debug('[SelfObs] query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Bias = how to nudge future entry thresholds per mode.
  // Baseline 1.0. Winner modes get bias < 1 (easier entry). Loser modes
  // get bias > 1 (harder entry). Clamped to [1-MAX, 1+MAX].
  const entryBias: Record<MonkeyMode, number> = {
    [MonkeyMode.EXPLORATION]: 1.0,
    [MonkeyMode.INVESTIGATION]: 1.0,
    [MonkeyMode.INTEGRATION]: 1.0,
    [MonkeyMode.DRIFT]: 1.0,
  };
  for (const mode of modes) {
    const s = byMode[mode];
    if (s.trades < MIN_SAMPLE_FOR_BIAS) continue;
    // Map winRate in [0,1] → bias in [1+MAX, 1-MAX], centred at 0.5 win rate.
    const centered = s.winRate - 0.5;
    const bias = 1 - centered * 2 * MAX_BIAS_SWING;
    entryBias[mode] = Math.max(1 - MAX_BIAS_SWING, Math.min(1 + MAX_BIAS_SWING, bias));
  }

  return { lookbackHours, byMode, entryBias };
}
