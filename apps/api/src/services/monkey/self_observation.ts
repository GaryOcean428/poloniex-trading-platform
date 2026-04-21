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

export type Side = 'long' | 'short';

export interface ModeStats {
  mode: MonkeyMode;
  side: Side;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

export interface SelfObservation {
  lookbackHours: number;
  /** Per-(mode, side) stats. */
  byModeSide: Record<MonkeyMode, Record<Side, ModeStats>>;
  /** Per-(mode, side) entry-threshold multiplier. 1.0 = neutral.
   *  < 1.0 = easier entry (good track record here).
   *  > 1.0 = harder entry (losing track record here). */
  entryBias: Record<MonkeyMode, Record<Side, number>>;
}

const MAX_BIAS_SWING = 0.30;  // ±30 % from neutral 1.0

/**
 * Minimum closed trades PER (mode, side) bucket before the bucket's
 * win-rate influences the bias. The right value is a speed-vs-noise
 * tradeoff — see README below for the decision.
 *
 * TODO (user): pick the bucket-min-sample strategy. See computeEntryBias()
 * below for where this gets used.
 */
const MIN_SAMPLE_FOR_BIAS = 3;

function emptyStats(mode: MonkeyMode, side: Side): ModeStats {
  return { mode, side, trades: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0 };
}

/**
 * Compute the entry bias for a (mode, side) bucket.
 *
 * ── USER CONTRIBUTION POINT ──────────────────────────────────────────
 * The three valid strategies I see:
 *
 * A. STRICT PER-BUCKET (most conservative, slowest to learn)
 *    bias = 1.0 until trades ≥ MIN_SAMPLE_FOR_BIAS, then
 *           1 - 2·MAX·(winRate - 0.5)
 *    — Needs each of 8 buckets (4 modes × 2 sides) to accumulate
 *      independently. She can't generalise; shorts start fresh even
 *      if longs-in-this-mode already show a pattern.
 *
 * B. HIERARCHICAL FALLBACK (balanced)
 *    if bucket.trades ≥ MIN_SAMPLE_FOR_BIAS → use bucket winRate
 *    else if mode.trades ≥ MIN_SAMPLE_FOR_BIAS → use mode-pooled winRate
 *    else if global.trades ≥ MIN_SAMPLE_FOR_BIAS → use global winRate
 *    else → 1.0
 *    — Faster learning: a short in a new mode can inherit from the
 *      overall short track record until it has its own data.
 *
 * C. WEIGHTED BLEND (smooth, most complex)
 *    bias = w_bucket·bucketRate + w_mode·modeRate + w_global·globalRate
 *    where weights = sampleSize / (sampleSize + k) with k ≈ 5.
 *    — Every level contributes proportional to its confidence.
 *    — Classic shrinkage / empirical-Bayes style.
 *
 * My pick: B (hierarchical fallback) for clarity. A is too slow with
 * our current ~3 trades/day pace; C is nicer statistically but harder
 * to debug when she's behaving oddly.
 *
 * In computeSelfObservation() below, implement the chosen strategy.
 * ────────────────────────────────────────────────────────────────────
 */

const ALL_MODES: MonkeyMode[] = [
  MonkeyMode.EXPLORATION,
  MonkeyMode.INVESTIGATION,
  MonkeyMode.INTEGRATION,
  MonkeyMode.DRIFT,
];
const SIDES: Side[] = ['long', 'short'];

function buildEmptyByModeSide(): Record<MonkeyMode, Record<Side, ModeStats>> {
  const out = {} as Record<MonkeyMode, Record<Side, ModeStats>>;
  for (const mode of ALL_MODES) {
    out[mode] = {
      long: emptyStats(mode, 'long'),
      short: emptyStats(mode, 'short'),
    };
  }
  return out;
}

function buildNeutralBias(): Record<MonkeyMode, Record<Side, number>> {
  const out = {} as Record<MonkeyMode, Record<Side, number>>;
  for (const mode of ALL_MODES) {
    out[mode] = { long: 1.0, short: 1.0 };
  }
  return out;
}

/**
 * Translate a win rate into a bias multiplier in [1-MAX, 1+MAX].
 * 0.5 win rate → 1.0 (neutral). 1.0 → 1-MAX (easy entry). 0.0 → 1+MAX (hard).
 */
function winRateToBias(winRate: number): number {
  const centered = winRate - 0.5;
  const raw = 1 - centered * 2 * MAX_BIAS_SWING;
  return Math.max(1 - MAX_BIAS_SWING, Math.min(1 + MAX_BIAS_SWING, raw));
}

/**
 * Compute entry bias per (mode, side).
 *
 * TODO(user): pick strategy A / B / C as per the header decision. Return
 * entryBias[mode][side]. See header for strategy definitions.
 * The helper inputs available:
 *   - bucketStats[mode][side]  — per (mode, side) stats
 *   - modePooled[mode]         — both sides combined per mode
 *   - globalPooled[side]       — both modes combined per side
 *   - globalAll                — everything
 */
function computeEntryBias(
  bucketStats: Record<MonkeyMode, Record<Side, ModeStats>>,
  modePooled: Record<MonkeyMode, { trades: number; wins: number; winRate: number }>,
  globalPooled: Record<Side, { trades: number; wins: number; winRate: number }>,
  globalAll: { trades: number; wins: number; winRate: number },
): Record<MonkeyMode, Record<Side, number>> {
  const bias = buildNeutralBias();
  // ──────── USER-CONTRIBUTED STRATEGY GOES HERE ────────
  // Placeholder that implements strategy B (hierarchical fallback) so
  // typecheck passes. Replace with your chosen strategy.
  for (const mode of ALL_MODES) {
    for (const side of SIDES) {
      const bucket = bucketStats[mode][side];
      const modeS = modePooled[mode];
      const globalS = globalPooled[side];
      if (bucket.trades >= MIN_SAMPLE_FOR_BIAS) {
        bias[mode][side] = winRateToBias(bucket.winRate);
      } else if (modeS.trades >= MIN_SAMPLE_FOR_BIAS) {
        bias[mode][side] = winRateToBias(modeS.winRate);
      } else if (globalS.trades >= MIN_SAMPLE_FOR_BIAS) {
        bias[mode][side] = winRateToBias(globalS.winRate);
      } else if (globalAll.trades >= MIN_SAMPLE_FOR_BIAS) {
        bias[mode][side] = winRateToBias(globalAll.winRate);
      }
      // else: stays 1.0 (neutral) — she hasn't learned anything yet
    }
  }
  return bias;
  // ─────────────────────────────────────────────────────
}

/**
 * Aggregate Monkey's own closed trades by (mode, side). Mode recovered
 * from monkey_decisions.derivation->'mode'->>'value'. Side from
 * autonomous_trades.side ('buy'=long, 'sell'=short).
 */
export async function computeSelfObservation(
  lookbackHours: number = 24,
): Promise<SelfObservation> {
  const byModeSide = buildEmptyByModeSide();

  try {
    const result = await pool.query(
      `SELECT at.pnl::float AS pnl,
              at.side        AS side,
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
      const mode = (ALL_MODES.includes(modeStr as MonkeyMode)
        ? modeStr
        : MonkeyMode.INVESTIGATION) as MonkeyMode;
      const sideRaw = String(row.side ?? '').toLowerCase();
      const side: Side = sideRaw === 'sell' || sideRaw === 'short' ? 'short' : 'long';
      const pnl = Number(row.pnl ?? 0);
      const stats = byModeSide[mode][side];
      stats.trades += 1;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins += 1;
      else if (pnl < 0) stats.losses += 1;
    }
    for (const mode of ALL_MODES) {
      for (const side of SIDES) {
        const s = byModeSide[mode][side];
        s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
        s.avgPnl = s.trades > 0 ? s.totalPnl / s.trades : 0;
      }
    }
  } catch (err) {
    logger.debug('[SelfObs] query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Pool for hierarchical fallback strategies (B, C).
  const modePooled: Record<MonkeyMode, { trades: number; wins: number; winRate: number }> =
    {} as Record<MonkeyMode, { trades: number; wins: number; winRate: number }>;
  for (const mode of ALL_MODES) {
    const t = byModeSide[mode].long.trades + byModeSide[mode].short.trades;
    const w = byModeSide[mode].long.wins + byModeSide[mode].short.wins;
    modePooled[mode] = { trades: t, wins: w, winRate: t > 0 ? w / t : 0 };
  }
  const globalPooled: Record<Side, { trades: number; wins: number; winRate: number }> = {
    long: { trades: 0, wins: 0, winRate: 0 },
    short: { trades: 0, wins: 0, winRate: 0 },
  };
  for (const side of SIDES) {
    for (const mode of ALL_MODES) {
      globalPooled[side].trades += byModeSide[mode][side].trades;
      globalPooled[side].wins += byModeSide[mode][side].wins;
    }
    globalPooled[side].winRate =
      globalPooled[side].trades > 0 ? globalPooled[side].wins / globalPooled[side].trades : 0;
  }
  const globalAll = {
    trades: globalPooled.long.trades + globalPooled.short.trades,
    wins: globalPooled.long.wins + globalPooled.short.wins,
    winRate: 0,
  };
  globalAll.winRate = globalAll.trades > 0 ? globalAll.wins / globalAll.trades : 0;

  const entryBias = computeEntryBias(byModeSide, modePooled, globalPooled, globalAll);
  return { lookbackHours, byModeSide, entryBias };
}
