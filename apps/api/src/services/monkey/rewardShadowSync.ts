import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

export type RewardShadowSubstrate = 'ts' | 'py';
export type RewardShadowSource = 'trade_close' | 'paper_close' | 'polo_authoritative_close';

export interface RewardRpeDarkPayload {
  source?: unknown;
  substrate?: unknown;
  symbol?: unknown;
  realized_pnl_frac?: unknown;
  predicted_pnl_frac?: unknown;
  sigma_residual?: unknown;
  phasic_rpe?: unknown;
  legibility?: unknown;
  regime?: unknown;
  regime_persisted?: unknown;
  legacy_dop?: unknown;
  legacy_ser?: unknown;
  legacy_endo?: unknown;
  proposed_dop?: unknown;
  proposed_ser?: unknown;
  proposed_endo?: unknown;
  tonic_baseline?: unknown;
  valid?: unknown;
  ts?: unknown;
}

export interface RewardShadowRecord {
  ts: Date;
  symbol: string;
  source: RewardShadowSource;
  substrate: RewardShadowSubstrate;
  realizedPnlFrac: number;
  predictedPnlFrac: number | null;
  sigmaResidual: number | null;
  phasicRpe: number;
  legibility: number | null;
  regime: string | null;
  regimePersisted: number | null;
  legacyDop: number;
  legacySer: number;
  legacyEndo: number;
  proposedDop: number;
  proposedSer: number;
  proposedEndo: number;
  tonicBaseline: number;
  valid: boolean;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseLegacyLogText(message: string): Record<string, unknown> | null {
  const marker = 'reward-rpe dark';
  const idx = message.indexOf(marker);
  if (idx < 0) return null;
  const start = message.indexOf('{', idx + marker.length);
  const end = message.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(message.slice(start, end + 1));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseRewardRpeDarkPayload(input: unknown): RewardRpeDarkPayload | null {
  if (isObject(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return isObject(parsed) ? parsed : null;
    } catch {
      return parseLegacyLogText(trimmed);
    }
  }
  return null;
}

export function canPersistRewardShadow(): boolean {
  return process.env.MONKEY_REWARD_RPE_DARK !== 'false';
}

export function materializeRewardShadowRecord(payload: RewardRpeDarkPayload): RewardShadowRecord | null {
  if (!canPersistRewardShadow()) return null;
  const hasCoreSignal = [
    payload.realized_pnl_frac,
    payload.phasic_rpe,
    payload.legacy_dop,
    payload.proposed_dop,
  ].some((value) => finiteNumber(value) !== null);
  if (!hasCoreSignal) return null;

  const sourceRaw = typeof payload.source === 'string' ? payload.source : 'trade_close';
  const source: RewardShadowSource =
    sourceRaw === 'paper_close' || sourceRaw === 'polo_authoritative_close'
      ? sourceRaw
      : 'trade_close';
  const substrate: RewardShadowSubstrate = payload.substrate === 'py' ? 'py' : 'ts';
  const symbolRaw = typeof payload.symbol === 'string' ? payload.symbol.trim() : '';
  const symbol = symbolRaw || 'UNKNOWN';

  const tsValue = payload.ts instanceof Date
    ? payload.ts
    : typeof payload.ts === 'string' || typeof payload.ts === 'number'
      ? new Date(payload.ts)
      : new Date();
  const ts = Number.isNaN(tsValue.getTime()) ? new Date() : tsValue;

  const realizedPnlFrac = finiteNumber(payload.realized_pnl_frac) ?? 0;
  const predictedPnlFrac = finiteNumber(payload.predicted_pnl_frac);
  const sigmaResidual = finiteNumber(payload.sigma_residual);
  const phasicRpe = finiteNumber(payload.phasic_rpe) ?? 0;
  const legibility = finiteNumber(payload.legibility);
  const regime = typeof payload.regime === 'string' ? payload.regime : null;
  const regimePersisted = finiteNumber(payload.regime_persisted);
  const legacyDop = finiteNumber(payload.legacy_dop) ?? 0;
  const legacySer = finiteNumber(payload.legacy_ser) ?? 0;
  const legacyEndo = finiteNumber(payload.legacy_endo) ?? 0;
  const proposedDop = finiteNumber(payload.proposed_dop) ?? legacyDop;
  const proposedSer = finiteNumber(payload.proposed_ser) ?? legacySer;
  const proposedEndo = finiteNumber(payload.proposed_endo) ?? legacyEndo;
  const tonicBaseline = finiteNumber(payload.tonic_baseline) ?? 0;
  const valid = payload.valid === true
    ? true
    : Number.isFinite(realizedPnlFrac)
      && Number.isFinite(phasicRpe)
      && Number.isFinite(legacyDop)
      && Number.isFinite(legacySer)
      && Number.isFinite(legacyEndo)
      && Number.isFinite(proposedDop)
      && Number.isFinite(proposedSer)
      && Number.isFinite(proposedEndo)
      && Number.isFinite(tonicBaseline);

  return {
    ts,
    symbol,
    source,
    substrate,
    realizedPnlFrac,
    predictedPnlFrac,
    sigmaResidual,
    phasicRpe,
    legibility,
    regime,
    regimePersisted,
    legacyDop,
    legacySer,
    legacyEndo,
    proposedDop,
    proposedSer,
    proposedEndo,
    tonicBaseline,
    valid,
  };
}

export async function persistRewardShadowRecord(record: RewardShadowRecord): Promise<void> {
  await pool.query(
    `INSERT INTO monkey_reward_shadow (
      ts, symbol, source, substrate,
      realized_pnl_frac, predicted_pnl_frac, sigma_residual, phasic_rpe,
      legibility, regime, regime_persisted,
      legacy_dop, legacy_ser, legacy_endo,
      proposed_dop, proposed_ser, proposed_endo,
      tonic_baseline, valid
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )`,
    [
      record.ts.toISOString(),
      record.symbol,
      record.source,
      record.substrate,
      record.realizedPnlFrac,
      record.predictedPnlFrac,
      record.sigmaResidual,
      record.phasicRpe,
      record.legibility,
      record.regime,
      record.regimePersisted,
      record.legacyDop,
      record.legacySer,
      record.legacyEndo,
      record.proposedDop,
      record.proposedSer,
      record.proposedEndo,
      record.tonicBaseline,
      record.valid,
    ],
  );
}

export async function ingestRewardRpeDark(payloadInput: unknown): Promise<boolean> {
  const payload = parseRewardRpeDarkPayload(payloadInput);
  if (!payload) return false;
  try {
    const record = materializeRewardShadowRecord(payload);
    if (!record) return false;
    await persistRewardShadowRecord(record);
    return true;
  } catch (error) {
    logger.warn('reward-shadow ingest failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
