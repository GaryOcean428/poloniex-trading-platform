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

export interface SymbolSideStats {
  symbol: string;
  side: Side;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}

export interface SelfObservation {
  lookbackHours: number;
  /** Per-(mode, side) stats. */
  byModeSide: Record<MonkeyMode, Record<Side, ModeStats>>;
  /** Per-(mode, side) entry-threshold multiplier. 1.0 = neutral.
   *  < 1.0 = easier entry (good track record here).
   *  > 1.0 = harder entry (losing track record here). */
  entryBias: Record<MonkeyMode, Record<Side, number>>;
  /** Per-(symbol, side) stats — orthogonal to mode. Lets ETH long
   *  accumulate its own bias separately from BTC long, which the
   *  mode-pooled selfObs cannot do. 2026-05-25 audit found ETH long
   *  losses pool with BTC long wins in the (CREATOR_TREND_UP, long)
   *  bucket, so the symbol-specific bias never accumulates. */
  bySymbolSide: Record<string, Record<Side, SymbolSideStats>>;
  /** Per-(symbol, side) entry-threshold multiplier. Wilson-CI gated
   *  exactly like entryBias; multiplies with entryBias at the call
   *  site so a symbol that's losing on a given side gets a harder
   *  entry even when the mode-pooled bias is neutral. */
  symbolSideBias: Record<string, Record<Side, number>>;
}

/**
 * Soft cap on bias deflection magnitude — the "even with strong evidence,
 * don't lean harder than this". Replaces the previous unconditional
 * MAX_BIAS_SWING constant with a documented bound. SELFOBS-1 v2 will
 * derive this from the empirical spread of |winRate-0.5| observed across
 * all populated buckets, once a basin-wide running-stats accumulator is
 * available. Until then, 0.30 carries forward the previously-shipped
 * cap value so behaviour is bit-for-bit identical when sample evidence
 * is strong (Wilson CI tight + winRate extreme).
 */
const MAX_BIAS_SWING = 0.30;

/**
 * Wilson 95% CI z-score. Two-sided confidence for binomial proportions —
 * standard reference: https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval
 */
const WILSON_Z = 1.96;

/**
 * Wilson 95% CI for a binomial proportion (wins/trades). Used by
 * computeEntryBias() to gate bias deflection on statistical evidence
 * rather than a hardcoded sample-count threshold (was
 * MIN_SAMPLE_FOR_BIAS=3). With small n the CI is wide → bias stays
 * neutral; as n grows the CI tightens and bias deflects.
 *
 * Returns NaN/wide-CI sentinel for trades=0 (caller treats as "no info").
 */
export function wilsonCI(
  wins: number,
  trades: number,
  z = WILSON_Z,
): { lower: number; upper: number } {
  if (trades <= 0) return { lower: 0, upper: 1 };
  const phat = wins / trades;
  const z2_n = (z * z) / trades;
  const denom = 1 + z2_n;
  const center = (phat + z2_n / 2) / denom;
  const margin = (z / denom) * Math.sqrt(phat * (1 - phat) / trades + z2_n / (4 * trades));
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Decides whether the Wilson CI for (wins, trades) excludes 0.5 — i.e.
 * whether we have statistical evidence that the bucket's win-rate is
 * meaningfully different from chance. Replaces the previous trades>=3
 * gate, which was sample-count-based instead of evidence-based.
 */
function hasBiasEvidence(wins: number, trades: number): boolean {
  if (trades <= 0) return false;
  const { lower, upper } = wilsonCI(wins, trades);
  // Strictly: CI must be entirely above or entirely below 0.5
  return lower > 0.5 || upper < 0.5;
}

function emptyStats(mode: MonkeyMode, side: Side): ModeStats {
  return { mode, side, trades: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0 };
}

function emptySymbolStats(symbol: string, side: Side): SymbolSideStats {
  return { symbol, side, trades: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0 };
}

/**
 * Pure-function bias derivation per (symbol, side). Same Wilson-95% CI
 * evidence gate as computeEntryBias — neutral 1.0 until the CI clearly
 * excludes 0.5. Exported so the unit tests can pin the behaviour
 * without a database round-trip.
 *
 * Empty input → empty output (caller falls back to 1.0 via ?.).
 */
export function computeSymbolSideBias(
  bySymbolSide: Record<string, Record<Side, SymbolSideStats>>,
): Record<string, Record<Side, number>> {
  const out: Record<string, Record<Side, number>> = {};
  for (const [symbol, sides] of Object.entries(bySymbolSide)) {
    out[symbol] = { long: 1.0, short: 1.0 };
    for (const side of SIDES) {
      const s = sides[side];
      if (hasBiasEvidence(s.wins, s.trades)) {
        out[symbol][side] = winRateToBias(s.winRate);
      }
    }
  }
  return out;
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
  // Strategy B (hierarchical fallback) with Wilson 95% CI gate replacing
  // the prior MIN_SAMPLE_FOR_BIAS=3 threshold. The CI gate is strictly
  // stronger: with n=3 the Wilson CI is wide enough to include 0.5 for
  // all but the most extreme splits, so bias stays neutral until there
  // is actual statistical evidence of asymmetry. The fallback order is
  // preserved so a less-populated bucket still inherits from a parent
  // pool once the parent's evidence is firm.
  for (const mode of ALL_MODES) {
    for (const side of SIDES) {
      const bucket = bucketStats[mode][side];
      const modeS = modePooled[mode];
      const globalS = globalPooled[side];
      if (hasBiasEvidence(bucket.wins, bucket.trades)) {
        bias[mode][side] = winRateToBias(bucket.winRate);
      } else if (hasBiasEvidence(modeS.wins, modeS.trades)) {
        bias[mode][side] = winRateToBias(modeS.winRate);
      } else if (hasBiasEvidence(globalS.wins, globalS.trades)) {
        bias[mode][side] = winRateToBias(globalS.winRate);
      } else if (hasBiasEvidence(globalAll.wins, globalAll.trades)) {
        bias[mode][side] = winRateToBias(globalAll.winRate);
      }
      // else: stays 1.0 (neutral) — no level has CI-firm evidence yet
    }
  }
  return bias;
}

/**
 * Aggregate Monkey's own closed trades by (mode, side). Mode recovered
 * from monkey_decisions.derivation->'mode'->>'value'. Side from
 * autonomous_trades.side ('buy'=long, 'sell'=short).
 */
export async function computeSelfObservation(
  lookbackHours: number = 24,
  instanceId?: string,
): Promise<SelfObservation> {
  const byModeSide = buildEmptyByModeSide();
  const bySymbolSide: Record<string, Record<Side, SymbolSideStats>> = {};

  try {
    // Scope to a specific kernel instance when provided (v0.6b multi-
    // kernel). Pattern 'monkey|kernel=<id>|%' matches that kernel's own
    // rows only; fallback 'monkey|%' gives all-Monkey aggregate for a
    // callers passing no instanceId.
    const reasonPattern = instanceId
      ? `monkey|kernel=${instanceId}|%`
      : 'monkey|%';
    const result = await pool.query(
      `SELECT at.pnl::float AS pnl,
              at.side        AS side,
              at.symbol      AS symbol,
              at.exit_reason,
              md.derivation->'mode'->>'value' AS mode
         FROM autonomous_trades at
         JOIN monkey_decisions md ON md.reason = at.reason
        WHERE at.reason LIKE $2
          AND at.status = 'closed'
          AND at.exit_time > NOW() - ($1::int * INTERVAL '1 hour')
          AND md.proposed_action IN ('enter_long', 'enter_short')
          AND md.executed = true`,
      [lookbackHours, reasonPattern],
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
      const symbol = String(row.symbol ?? '');
      const stats = byModeSide[mode][side];
      stats.trades += 1;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins += 1;
      else if (pnl < 0) stats.losses += 1;
      if (symbol.length > 0) {
        if (!bySymbolSide[symbol]) {
          bySymbolSide[symbol] = {
            long: emptySymbolStats(symbol, 'long'),
            short: emptySymbolStats(symbol, 'short'),
          };
        }
        const sStats = bySymbolSide[symbol][side];
        sStats.trades += 1;
        sStats.totalPnl += pnl;
        if (pnl > 0) sStats.wins += 1;
        else if (pnl < 0) sStats.losses += 1;
      }
    }
    for (const mode of ALL_MODES) {
      for (const side of SIDES) {
        const s = byModeSide[mode][side];
        s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
        s.avgPnl = s.trades > 0 ? s.totalPnl / s.trades : 0;
      }
    }
    for (const symbol of Object.keys(bySymbolSide)) {
      for (const side of SIDES) {
        const s = bySymbolSide[symbol][side];
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
  const symbolSideBias = computeSymbolSideBias(bySymbolSide);
  return { lookbackHours, byModeSide, entryBias, bySymbolSide, symbolSideBias };
}
