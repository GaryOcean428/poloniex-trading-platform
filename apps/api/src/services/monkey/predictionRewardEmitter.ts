/**
 * predictionRewardEmitter.ts — Phase 3 of issue #941 prediction-corpus.
 *
 * Matrix tier-3 directive (2026-05-27): every chemistry tick, read the
 * residual rows that the Phase-2 residual job wrote, aggregate them into
 * (direction-match, calibration) composites, and emit them as chemistry
 * deltas so the kernel learns from prediction accuracy in addition to
 * trade outcomes.
 *
 * Two channels:
 *
 * 1. **Dopamine ← direction-match rate**
 *    Frozen reference = 0.5 (chance). The kernel earns dopamine when its
 *    forecasts beat chance and pays back dopamine when they don't. Cap
 *    matches the trade-outcome dop cap (0.5) because direction accuracy
 *    is the same class of signal: "the kernel was right about what
 *    happens next."
 *
 * 2. **Serotonin ← calibration quality**
 *    Frozen reference = MAD of a standard normal (0.6745). The kernel
 *    earns serotonin when its predicted_pnl_stddev matches realised
 *    spread (well-calibrated forecast intervals) and pays back serotonin
 *    when it doesn't (over- or under-confident). Cap 0.2 (smaller than
 *    dop) because calibration is a slow-mood-shift signal, not a per-
 *    event reward.
 *
 * **Doctrinal anchors**:
 * - **P1 (Observer sets all params from frozen facts):**
 *   Reference points (0.5 chance, 0.6745 std-normal MAD) are
 *   mathematical constants, not operator knobs. The transform shape
 *   (tanh) and caps mirror the trade-outcome channel's structural
 *   choices, themselves cited as design constants in `pushReward()`.
 * - **P14 (Variable Separation):**
 *   Prediction-accuracy chemistry is its own channel, NOT folded into
 *   the trade-outcome pnlFrac. A perfect forecaster that takes no
 *   trades still earns this dopamine; a lucky trader with wrong
 *   forecasts still feels this loss.
 * - **P15 (Fail-Closed Safety):**
 *   On any DB or aggregation error, the emitter returns zero deltas.
 *   The trade-outcome reward loop continues unaffected.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

// Structural constants (not operator knobs).
// MIN_SAMPLES = 5: below this the rate estimates have stderr > 0.22 and
// matching the noise floor in the trade-outcome reward path
// (PNL_STDDEV_MIN_SAMPLES = 5 in loop.ts pushReward).
const MIN_SAMPLES = 5;

// Per-tick window: scan residuals evaluated in the last DEFAULT_WINDOW_MS.
// 5 min is the cache-warm window for the chemistry tick loop; it bounds
// how much old prediction error keeps reinforcing chemistry after the
// underlying regime has shifted.
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

// Output caps (structural — mirror trade-outcome pushReward caps).
const DOPAMINE_CAP = 0.5;
const SEROTONIN_CAP = 0.2;

// Frozen mathematical reference points.
// CHANCE_RATE = 0.5: the direction-match rate of a coin flip; signed
// deviation from this is the dopamine-bearing signal.
const CHANCE_RATE = 0.5;
// STD_NORMAL_MAD = 0.6745: the median absolute deviation of a standard
// normal distribution. A perfectly-calibrated forecast (predicted_stddev
// matching realised spread) produces residual_normalized values whose
// MAD lands on this number. Deviation is mis-calibration.
const STD_NORMAL_MAD = 0.6745;

export interface ResidualSummary {
  n: number;
  directionMatchRate: number;
  within1SigmaRate: number;
  madResidualNormalized: number;
}

export interface PredictionChemistryDeltas {
  dopamineDelta: number;
  serotoninDelta: number;
  source: string;
  summary: ResidualSummary;
}

/**
 * Read residuals evaluated in the last `windowMs` ms and return summary
 * statistics. Returns n=0 (no signal) on any DB error.
 */
export async function summariseRecentResiduals(
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<ResidualSummary> {
  const empty: ResidualSummary = {
    n: 0,
    directionMatchRate: 0,
    within1SigmaRate: 0,
    madResidualNormalized: 0,
  };
  try {
    const rows = await pool.query<{
      direction_match: boolean;
      within_1_sigma: boolean;
      residual_normalized: string | number;
    }>(
      `SELECT direction_match, within_1_sigma, residual_normalized
         FROM kernel_outcome_residuals
        WHERE evaluated_at >= NOW() - ($1 || ' milliseconds')::INTERVAL
        ORDER BY evaluated_at DESC
        LIMIT 500`,
      [windowMs],
    );
    return summariseFromRows(rows.rows);
  } catch (err) {
    logger.warn('[predictionRewardEmitter] residual scan failed — zero signal', {
      err: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

/**
 * Pure aggregation — extracted for testability. Operates on the row
 * shape returned by `summariseRecentResiduals`.
 */
export function summariseFromRows(
  rows: Array<{
    direction_match: boolean;
    within_1_sigma: boolean;
    residual_normalized: string | number;
  }>,
): ResidualSummary {
  if (rows.length === 0) {
    return {
      n: 0,
      directionMatchRate: 0,
      within1SigmaRate: 0,
      madResidualNormalized: 0,
    };
  }
  let matches = 0;
  let within1 = 0;
  const resids: number[] = [];
  for (const r of rows) {
    if (r.direction_match) matches += 1;
    if (r.within_1_sigma) within1 += 1;
    const v = Number(r.residual_normalized);
    if (Number.isFinite(v)) resids.push(v);
  }
  return {
    n: rows.length,
    directionMatchRate: matches / rows.length,
    within1SigmaRate: within1 / rows.length,
    madResidualNormalized: medianAbsoluteDeviation(resids),
  };
}

/**
 * Median absolute deviation around the median. Robust to outliers
 * (50% breakdown point) — the same robustness reason the trade-outcome
 * pushReward channel switched from stddev to MAD on 2026-05-25.
 */
export function medianAbsoluteDeviation(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
    : sorted[Math.floor(sorted.length / 2)]!;
  const devs = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  const mad = devs.length % 2 === 0
    ? (devs[devs.length / 2 - 1]! + devs[devs.length / 2]!) / 2
    : devs[Math.floor(devs.length / 2)]!;
  return mad;
}

/**
 * Pure transform: residual summary → chemistry deltas.
 *
 * - Dopamine: signed deviation of directionMatchRate from chance (0.5),
 *   tanh-squashed, scaled by DOPAMINE_CAP.
 * - Serotonin: negative absolute deviation of MAD(residual_normalized)
 *   from the standard-normal reference (0.6745). Perfect calibration
 *   gives ser=0; mis-calibration drags ser toward -SEROTONIN_CAP.
 *
 * Below MIN_SAMPLES the function returns zero deltas (insufficient
 * statistical power to update chemistry).
 */
export function predictionChemistryDeltas(
  summary: ResidualSummary,
): PredictionChemistryDeltas {
  if (summary.n < MIN_SAMPLES) {
    return {
      dopamineDelta: 0,
      serotoninDelta: 0,
      source: `prediction_residual_insufficient:n=${summary.n}`,
      summary,
    };
  }

  // Surgical anti-windup for persistent predictor anti-correlation.
  // If the direction-match rate is below chance (0.5), the predictor is
  // systematically wrong more often than right. Continuing to emit
  // negative dopamineDelta creates a constant aversive bleed with no
  // recovery path (the exact pattern that produced pinned predDop ~-0.231).
  // Conservative fix (P1, no new knobs): zero the predictor deltas until
  // it earns at least chance. Uses the existing CHANCE_RATE constant.
  // This stops the suicidal constant punishment while preserving the
  // channel for when the predictor improves.
  if (summary.directionMatchRate < CHANCE_RATE) {
    return {
      dopamineDelta: 0,
      serotoninDelta: 0,
      source: `prediction_residual_anti_correlated:rate=${summary.directionMatchRate.toFixed(3)}`,
      summary,
    };
  }

  const dirSignal = summary.directionMatchRate - CHANCE_RATE;
  const dopamineDelta = Math.tanh(dirSignal) * DOPAMINE_CAP;

  // Calibration: zero-or-negative score against the std-normal MAD
  // reference. We don't reward "better than std-normal" because that
  // means the forecast stddev was too wide (under-confident); the
  // honest direction is "punish drift from perfect calibration."
  const calibError = Math.abs(summary.madResidualNormalized - STD_NORMAL_MAD);
  const serotoninDelta = -Math.tanh(calibError) * SEROTONIN_CAP;

  return {
    dopamineDelta,
    serotoninDelta,
    source: `prediction_residual:n=${summary.n}`,
    summary,
  };
}

/**
 * Full orchestrator: scan residuals → compute deltas. Used by the
 * chemistry tick loop in loop.ts. Always returns a result; on error
 * the deltas are zero (see P15 anchor above).
 */
export async function computePredictionChemistry(
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<PredictionChemistryDeltas> {
  const summary = await summariseRecentResiduals(windowMs);
  return predictionChemistryDeltas(summary);
}
