import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

const SCAN_INTERVAL_MS = 60_000;
const MAX_WINDOW_ROWS = 1200;
const EPS = 1e-9;
const PARITY_EPS = 1e-6;
const MAD_STABILITY_EPS = 1e-3;
const DIP_SIGNIFICANCE_ALPHA = 0.05;
const COVERAGE_FLOOR = 0.8;
const MIN_PARITY_MATCHED_PAIRS = 1;
const SURPRISE_RPE_Z = 1;
const PREDICTED_RPE_Z = 0.5;

export interface RewardRpeReadinessWindowRow {
  ts: string;
  substrate: 'ts' | 'py';
  symbol: string;
  source: string;
  realizedPnlFrac: number;
  predictedPnlFrac: number | null;
  sigmaResidual: number | null;
  phasicRpe: number;
  proposedDop: number;
  tonicBaseline: number;
  valid: boolean;
}

export interface RewardRpeReadinessMetrics {
  predictionSkill: number;
  dipDifferentiationP: number;
  parityDivergence: number;
  parityMatchedPairs: number;
  coverage: number;
  n: number;
  samplesStable: boolean;
  ready: boolean;
  dipSeparated: boolean;
  liveDegradationFlagged: boolean;
  sustainedDegradeWindows: number;
  surpriseCount: number;
  predictedCount: number;
  latestTs: string | null;
}

interface MannWhitneyResult {
  pValue: number;
  commonLanguageEffect: number;
}

let lastMetrics: RewardRpeReadinessMetrics = {
  predictionSkill: 0,
  dipDifferentiationP: 1,
  parityDivergence: 0,
  parityMatchedPairs: 0,
  coverage: 0,
  n: 0,
  samplesStable: !1,
  ready: !1,
  dipSeparated: !1,
  liveDegradationFlagged: !1,
  sustainedDegradeWindows: 0,
  surpriseCount: 0,
  predictedCount: 0,
  latestTs: null,
};
let rpeWindowRows: RewardRpeReadinessWindowRow[] = [];
let readinessTimer: NodeJS.Timeout | null = null;
let readinessTimerUsers = 0;

function finiteOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => {
    const d = value - mean;
    return sum + d * d;
  }, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((value) => Math.abs(value - m)));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = (((((1.061405429 * t) - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

async function loadWindowRows(limit: number): Promise<RewardRpeReadinessWindowRow[]> {
  const rows = await pool.query<{
    ts: string;
    substrate: 'ts' | 'py';
    symbol: string;
    source: string;
    realized_pnl_frac: string | number;
    predicted_pnl_frac: string | number | null;
    sigma_residual: string | number | null;
    phasic_rpe: string | number;
    proposed_dop: string | number;
    tonic_baseline: string | number;
    valid: boolean;
  }>(
    `SELECT ts, substrate, symbol, source, realized_pnl_frac, predicted_pnl_frac,
            sigma_residual, phasic_rpe, proposed_dop, tonic_baseline, valid
       FROM monkey_reward_rpe_evidence
      ORDER BY ts DESC
      LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );

  return rows.rows.map((row) => ({
    ts: row.ts,
    substrate: row.substrate,
    symbol: row.symbol,
    source: row.source,
    realizedPnlFrac: finiteOrNull(row.realized_pnl_frac) ?? 0,
    predictedPnlFrac: finiteOrNull(row.predicted_pnl_frac),
    sigmaResidual: finiteOrNull(row.sigma_residual),
    phasicRpe: finiteOrNull(row.phasic_rpe) ?? 0,
    proposedDop: finiteOrNull(row.proposed_dop) ?? 0,
    tonicBaseline: finiteOrNull(row.tonic_baseline) ?? 0,
    valid: Boolean(row.valid),
  }));
}

function computeCoverage(rows: RewardRpeReadinessWindowRow[]): number {
  if (rows.length === 0) return 0;
  let covered = 0;
  for (const row of rows) {
    if (row.valid && row.predictedPnlFrac !== null && row.sigmaResidual !== null) covered += 1;
  }
  return covered / rows.length;
}

function computePredictionSkill(rows: RewardRpeReadinessWindowRow[]): number {
  const validRows = rows.filter(
    (row) => row.valid && row.predictedPnlFrac !== null && row.sigmaResidual !== null,
  );
  if (validRows.length < 2) return 0;
  const residuals = validRows.map((row) => row.realizedPnlFrac - (row.predictedPnlFrac ?? 0));
  const raw = validRows.map((row) => row.realizedPnlFrac);
  const rawVariance = variance(raw);
  if (rawVariance <= EPS) return 0;
  return 1 - variance(residuals) / rawVariance;
}

function mannWhitneyUTwoSided(surprise: number[], predicted: number[]): MannWhitneyResult {
  const n1 = surprise.length;
  const n2 = predicted.length;
  if (n1 === 0 || n2 === 0) return { pValue: 1, commonLanguageEffect: 0.5 };

  const merged: Array<{ value: number; group: 1 | 2 }> = [
    ...surprise.map((value) => ({ value, group: 1 as const })),
    ...predicted.map((value) => ({ value, group: 2 as const })),
  ].sort((a, b) => a.value - b.value);

  const ranks: number[] = new Array(merged.length);
  let idx = 0;
  while (idx < merged.length) {
    let end = idx + 1;
    while (end < merged.length && merged[end].value === merged[idx].value) end += 1;
    const avgRank = (idx + end + 1) / 2;
    for (let i = idx; i < end; i += 1) ranks[i] = avgRank;
    idx = end;
  }

  let rankSum1 = 0;
  for (let i = 0; i < merged.length; i += 1) {
    if (merged[i].group === 1) rankSum1 += ranks[i];
  }

  const u1 = rankSum1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const meanU = (n1 * n2) / 2;
  const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  if (stdU <= EPS) return { pValue: 1, commonLanguageEffect: 0.5 };

  const z = (Math.min(u1, u2) - meanU) / stdU;
  const pValue = Math.max(EPS, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
  return { pValue, commonLanguageEffect: u1 / (n1 * n2) };
}

function computeDipDifferentiation(rows: RewardRpeReadinessWindowRow[]) {
  const losses = rows.filter((row) => row.valid && row.realizedPnlFrac < 0);
  const surprise = losses
    .filter((row) => Math.abs(row.phasicRpe) > SURPRISE_RPE_Z)
    .map((row) => Math.abs(row.proposedDop - row.tonicBaseline));
  const predicted = losses
    .filter((row) => Math.abs(row.phasicRpe) < PREDICTED_RPE_Z)
    .map((row) => Math.abs(row.proposedDop - row.tonicBaseline));

  const rank = mannWhitneyUTwoSided(surprise, predicted);
  const dipSeparated =
    surprise.length > 0
    && predicted.length > 0
    && rank.commonLanguageEffect > (0.5 + EPS)
    && rank.pValue < DIP_SIGNIFICANCE_ALPHA;

  return {
    surprise,
    predicted,
    dipSeparated,
    ...rank,
  };
}

function computeParityDivergence(rows: RewardRpeReadinessWindowRow[]): {
  divergence: number;
  matchedPairs: number;
} {
  const byKey = new Map<string, { ts?: number; py?: number }>();
  for (const row of rows) {
    const tsMs = Date.parse(row.ts);
    if (!Number.isFinite(tsMs)) continue;
    const key = `${row.symbol}::${row.source}::${new Date(tsMs).toISOString()}`;
    const current = byKey.get(key) ?? {};
    if (row.substrate === 'ts') current.ts = row.proposedDop;
    if (row.substrate === 'py') current.py = row.proposedDop;
    byKey.set(key, current);
  }

  const diffs: number[] = [];
  for (const entry of byKey.values()) {
    if (typeof entry.ts === 'number' && typeof entry.py === 'number') {
      diffs.push(Math.abs(entry.ts - entry.py));
    }
  }
  if (diffs.length === 0) {
    return { divergence: Number.POSITIVE_INFINITY, matchedPairs: 0 };
  }
  return {
    divergence: diffs.reduce((sum, value) => sum + value, 0) / diffs.length,
    matchedPairs: diffs.length,
  };
}

function computeSampleStability(rows: RewardRpeReadinessWindowRow[]): boolean {
  const validRows = rows.filter(
    (row) => row.valid && row.predictedPnlFrac !== null && row.sigmaResidual !== null,
  );
  if (validRows.length < 3) return !1;
  const residualAbs = validRows.map((row) => Math.abs(row.realizedPnlFrac - (row.predictedPnlFrac ?? 0)));

  const rollingMads: number[] = [];
  for (let i = 3; i <= residualAbs.length; i += 1) {
    rollingMads.push(mad(residualAbs.slice(0, i)));
  }
  if (rollingMads.length < 2) return !1;

  const madOfMad = mad(rollingMads);
  return madOfMad <= MAD_STABILITY_EPS;
}

function metricsFailClosedDefaults(): RewardRpeReadinessMetrics {
  return {
    predictionSkill: 0,
    dipDifferentiationP: 1,
    parityDivergence: 0,
    parityMatchedPairs: 0,
    coverage: 0,
    n: 0,
    samplesStable: !1,
    ready: !1,
    dipSeparated: !1,
    liveDegradationFlagged: !1,
    sustainedDegradeWindows: 0,
    surpriseCount: 0,
    predictedCount: 0,
    latestTs: null,
  };
}

function computeReadinessFromRows(rows: RewardRpeReadinessWindowRow[]): RewardRpeReadinessMetrics {
  if (rows.length === 0) return metricsFailClosedDefaults();

  const predictionSkill = computePredictionSkill(rows);
  const dip = computeDipDifferentiation(rows);
  const parity = computeParityDivergence(rows);
  const coverage = computeCoverage(rows);
  const samplesStable = computeSampleStability(rows);
  const ready =
    predictionSkill > 0
    && dip.dipSeparated
    && parity.matchedPairs >= MIN_PARITY_MATCHED_PAIRS
    && parity.divergence <= PARITY_EPS
    && coverage >= COVERAGE_FLOOR
    && samplesStable;

  return {
    predictionSkill,
    dipDifferentiationP: dip.pValue,
    parityDivergence: parity.divergence,
    parityMatchedPairs: parity.matchedPairs,
    coverage,
    n: rows.length,
    samplesStable,
    ready,
    dipSeparated: dip.dipSeparated,
    liveDegradationFlagged: !1,
    sustainedDegradeWindows: 0,
    surpriseCount: dip.surprise.length,
    predictedCount: dip.predicted.length,
    latestTs: rows[0]?.ts ?? null,
  };
}

function updateRevertGate(metrics: RewardRpeReadinessMetrics): RewardRpeReadinessMetrics {
  const skillDegraded = metrics.predictionSkill < 0;
  const dipDegraded = !metrics.dipSeparated;
  const sustainedDipCollapse = dipDegraded && !lastMetrics.dipSeparated && metrics.samplesStable;
  const flagged = skillDegraded || sustainedDipCollapse;
  const sustained = flagged ? lastMetrics.sustainedDegradeWindows + 1 : 0;

  if (flagged) {
    logger.error('MONKEY_REWARD_RPE structural degrade detected', {
      predictionSkill: metrics.predictionSkill,
      dipDifferentiationP: metrics.dipDifferentiationP,
      dipSeparated: metrics.dipSeparated,
      parityDivergence: metrics.parityDivergence,
      parityMatchedPairs: metrics.parityMatchedPairs,
      coverage: metrics.coverage,
      samplesStable: metrics.samplesStable,
      sustainedDegradeWindows: sustained,
    });
  }

  return {
    ...metrics,
    ready: metrics.ready && !flagged,
    liveDegradationFlagged: flagged,
    sustainedDegradeWindows: sustained,
  };
}

export async function getRewardRpeReadiness(
  limit: number = MAX_WINDOW_ROWS,
): Promise<RewardRpeReadinessMetrics> {
  try {
    const rows = await loadWindowRows(limit);
    rpeWindowRows = rows;

    const computed = computeReadinessFromRows(rows);
    const metrics = updateRevertGate(computed);
    return {
      ...metrics,
      predictionSkill: Number.isFinite(metrics.predictionSkill) ? metrics.predictionSkill : 0,
      dipDifferentiationP: Number.isFinite(metrics.dipDifferentiationP)
        ? metrics.dipDifferentiationP
        : 1,
      parityDivergence: Number.isFinite(metrics.parityDivergence) ? metrics.parityDivergence : 0,
      parityMatchedPairs: metrics.parityMatchedPairs,
      coverage: Number.isFinite(metrics.coverage) ? metrics.coverage : 0,
    };
  } catch (error) {
    logger.warn('rewardRpeReadiness failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return metricsFailClosedDefaults();
  }
}

export async function scanRewardRpeReadiness(): Promise<RewardRpeReadinessMetrics> {
  const metrics = await getRewardRpeReadiness(MAX_WINDOW_ROWS);
  lastMetrics = metrics;
  return metrics;
}

export function startRewardRpeReadinessJob(): NodeJS.Timeout {
  if (readinessTimer) {
    readinessTimerUsers += 1;
    return readinessTimer;
  }

  void scanRewardRpeReadiness();
  readinessTimer = setInterval(() => {
    void scanRewardRpeReadiness().then((metrics) => {
      if (metrics.n > 0) {
        logger.info('rewardRpeReadiness pass', {
          ready: metrics.ready,
          predictionSkill: metrics.predictionSkill,
          dipDifferentiationP: metrics.dipDifferentiationP,
          dipSeparated: metrics.dipSeparated,
          parityDivergence: metrics.parityDivergence,
          parityMatchedPairs: metrics.parityMatchedPairs,
          coverage: metrics.coverage,
          n: metrics.n,
          samplesStable: metrics.samplesStable,
          liveDegradationFlagged: metrics.liveDegradationFlagged,
          sustainedDegradeWindows: metrics.sustainedDegradeWindows,
        });
      }
    });
  }, SCAN_INTERVAL_MS);

  readinessTimerUsers = 1;
  return readinessTimer;
}

export function stopRewardRpeReadinessJob(): void {
  if (readinessTimerUsers > 0) readinessTimerUsers -= 1;
  if (readinessTimer && readinessTimerUsers === 0) {
    clearInterval(readinessTimer);
    readinessTimer = null;
  }
}

export function getRewardRpeReadinessTelemetry(): RewardRpeReadinessMetrics {
  return lastMetrics;
}

export function getRewardRpeReadinessWindowRows() {
  return rpeWindowRows;
}

export function serializeRewardRpeReadiness(metrics: RewardRpeReadinessMetrics, ok?: boolean) {
  return {
    ...(ok === undefined ? {} : { ok }),
    prediction_skill: metrics.predictionSkill,
    dip_differentiation_p: metrics.dipDifferentiationP,
    parity_divergence: metrics.parityDivergence,
    parity_matched_pairs: metrics.parityMatchedPairs,
    coverage: metrics.coverage,
    n: metrics.n,
    samples_stable: metrics.samplesStable,
    ready: metrics.ready,
    dip_separated: metrics.dipSeparated,
    live_degradation_flagged: metrics.liveDegradationFlagged,
    sustained_degrade_windows: metrics.sustainedDegradeWindows,
    surprise_count: metrics.surpriseCount,
    predicted_count: metrics.predictedCount,
    latest_ts: metrics.latestTs,
  };
}

export function __setRewardRpeReadinessWindowForTests(
  rows: RewardRpeReadinessWindowRow[],
): void {
  rpeWindowRows = rows;
}

export function __resetRewardRpeReadinessStateForTests(): void {
  lastMetrics = metricsFailClosedDefaults();
  rpeWindowRows = [];
  if (readinessTimer) {
    clearInterval(readinessTimer);
    readinessTimer = null;
  }
  readinessTimerUsers = 0;
}
