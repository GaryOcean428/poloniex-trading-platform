/**
 * basin_sync_redis_bridge.ts — TS proxy for Python kernel basin writes.
 *
 * The Python Monkey ml-worker process cannot safely open a Postgres
 * connection: TensorFlow / sklearn / scipy load 251 C-extension modules
 * at import time and corrupt libpq's malloc context, so any
 * psycopg.connect() — from any thread, at any point in the process
 * lifetime — segfaults with `free(): invalid pointer`. PR history:
 * per-tick connect (#737), singleton connect (#738), warm-at-startup
 * (#740) — three increasingly-correct guesses, none fixing the
 * underlying constraint that TF and libpq cannot coexist in the same
 * Python process.
 *
 * The architectural fix: Python publishes JSON-encoded basin state to
 * the Redis channel `monkey:basin:sync:writes`; this bridge subscribes
 * and upserts into `monkey_basin_sync` via the TS Postgres pool (which
 * has no TF interference). Same eventual consistency, no segfault risk.
 *
 * Flag: CONSENSUS_BASIN_SYNC_BRIDGE_LIVE — default off. When off, the
 * subscriber doesn't connect. Operators flip this on AFTER setting
 * MONKEY_PY_BASIN_SYNC_DB_LIVE=true on the ml-worker so Py starts
 * publishing.
 *
 * QIG purity: this module performs no math. It's pure ETL — receive,
 * validate, upsert. Slerp / Fisher-Rao live in basin.ts / basin_sync.ts.
 *
 * Fail-soft: Redis errors, parse errors, and Postgres errors log at
 * debug and silently drop the message. A stuck bridge never blocks the
 * TS Monkey kernel.
 */

import { createClient, type RedisClientType } from 'redis';

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import { insertKernelPrediction } from './kernel_predictions.js';

export const BASIN_SYNC_WRITE_CHANNEL = 'monkey:basin:sync:writes';
export const PREDICTION_WRITE_CHANNEL = 'monkey:prediction:writes';
export const EXPECTATION_DECISION_WRITE_CHANNEL = 'monkey:expectation:decisions';

interface BasinSyncWritePayload {
  instance_id: string;
  basin: number[];
  phi: number;
  kappa: number;
  mode: string;
  drift_from_identity: number;
  regime_weights?: { quantum: number; efficient: number; equilibrium: number } | null;
  neurochemistry?: {
    acetylcholine: number;
    dopamine: number;
    serotonin: number;
    norepinephrine: number;
    gaba: number;
    endorphins: number;
  } | null;
  at_ms: number;
}

interface PredictionWritePayload {
  // trade_id is a UUID string in the new schema (#949 / migration 059).
  // Legacy `number` type permitted only to absorb stale Redis payloads
  // emitted before the UUID migration — coerced via tradeIdParam below.
  trade_id?: string | number | null;
  kernel_id: string;
  perception_basin: number[];
  strategy_forecast_basin: number[];
  fisher_rao_disagreement: number;
  basin_velocity?: number | null;
  phi?: number | null;
  kappa_eff?: number | null;
  predicted_horizon_seconds?: number | null;
  predicted_terminal_pnl_usdt?: number | null;
  predicted_pnl_stddev_usdt?: number | null;
  predicted_direction?: -1 | 0 | 1 | null;
  predicted_confidence?: number | null;
  neurochemistry?: Record<string, number> | null;
  regime_weights?: { quantum?: number; efficient?: number; equilibrium?: number } | null;
  mode?: string | null;
  lane?: string | null;
  snapshot_reason: 'entry' | 'state_transition' | 'periodic' | 'gate_fire' | 'exit';
  triggering_gate?: string | null;
  kernel_version?: string;
  source_path: string;
}

interface ExpectationDecisionWritePayload {
  trade_id?: string | number | null;
  prediction_id?: number | null;
  kernel_id: string;
  tape_trend: number;
  basin_direction: number;
  fisher_rao_disagreement?: number | null;
  tape_basin_disagreement: number;
  reverse_tape_window: boolean;
  reverse_tape_side?: string | null;
  qig_warp_version: string;
  qig_warp_mode: string;
  qig_warp_source: string;
  expectation_direction: string;
  expectation_confidence: number;
  expectation_regime: string;
  expectation_action: string;
  expectation_reason: string;
  decision_surface: string;
  side_before?: string | null;
  side_after?: string | null;
  lane_before?: string | null;
  lane_after?: string | null;
  size_before_usdt?: number | null;
  size_after_usdt?: number | null;
  did_change_decision: boolean;
  formula_version?: string | null;
  source_path: string;
  kernel_version: string;
}

function bridgeLive(): boolean {
  return process.env.CONSENSUS_BASIN_SYNC_BRIDGE_LIVE === 'true';
}

let _subscriber: RedisClientType | null = null;
let _initialized = false;
let _messagesReceived = 0;
let _messagesPersisted = 0;
let _messagesDropped = 0;

async function persist(payload: BasinSyncWritePayload): Promise<void> {
  await pool.query(
    `INSERT INTO monkey_basin_sync
       (instance_id, basin, phi, kappa, mode, drift_from_identity,
        regime_weights, neurochemistry, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW())
     ON CONFLICT (instance_id)
     DO UPDATE SET
       basin = EXCLUDED.basin,
       phi = EXCLUDED.phi,
       kappa = EXCLUDED.kappa,
       mode = EXCLUDED.mode,
       drift_from_identity = EXCLUDED.drift_from_identity,
       regime_weights = EXCLUDED.regime_weights,
       neurochemistry = EXCLUDED.neurochemistry,
       updated_at = NOW()`,
    [
      payload.instance_id,
      JSON.stringify(payload.basin),
      payload.phi,
      payload.kappa,
      payload.mode,
      payload.drift_from_identity,
      payload.regime_weights ? JSON.stringify(payload.regime_weights) : null,
      payload.neurochemistry ? JSON.stringify(payload.neurochemistry) : null,
    ],
  );
}

function validate(raw: unknown): BasinSyncWritePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.instance_id !== 'string' || r.instance_id.length === 0) return null;
  if (!Array.isArray(r.basin) || r.basin.length === 0) return null;
  for (const v of r.basin) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  }
  if (typeof r.phi !== 'number' || !Number.isFinite(r.phi)) return null;
  if (typeof r.kappa !== 'number' || !Number.isFinite(r.kappa)) return null;
  if (typeof r.mode !== 'string' || r.mode.length === 0) return null;
  if (typeof r.drift_from_identity !== 'number' || !Number.isFinite(r.drift_from_identity)) {
    return null;
  }
  if (typeof r.at_ms !== 'number' || !Number.isFinite(r.at_ms)) return null;
  return r as unknown as BasinSyncWritePayload;
}

function validatePrediction(raw: unknown): PredictionWritePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kernel_id !== 'string' || r.kernel_id.length === 0) return null;
  if (!Array.isArray(r.perception_basin) || r.perception_basin.length !== 64) return null;
  if (!Array.isArray(r.strategy_forecast_basin) || r.strategy_forecast_basin.length !== 64) return null;
  for (const v of [...r.perception_basin, ...r.strategy_forecast_basin]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  }
  if (typeof r.fisher_rao_disagreement !== 'number' || !Number.isFinite(r.fisher_rao_disagreement)) {
    return null;
  }
  if (typeof r.snapshot_reason !== 'string' || r.snapshot_reason.length === 0) return null;
  if (typeof r.source_path !== 'string' || r.source_path.length === 0) return null;
  return r as unknown as PredictionWritePayload;
}

function validateExpectationDecision(raw: unknown): ExpectationDecisionWritePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const requiredStrings = [
    'kernel_id',
    'qig_warp_version',
    'qig_warp_mode',
    'qig_warp_source',
    'expectation_direction',
    'expectation_regime',
    'expectation_action',
    'expectation_reason',
    'decision_surface',
    'source_path',
    'kernel_version',
  ];
  for (const key of requiredStrings) {
    if (typeof r[key] !== 'string' || (r[key] as string).length === 0) return null;
  }
  const requiredNumbers = [
    'tape_trend',
    'basin_direction',
    'tape_basin_disagreement',
    'expectation_confidence',
  ];
  for (const key of requiredNumbers) {
    if (typeof r[key] !== 'number' || !Number.isFinite(r[key])) return null;
  }
  if (r.fisher_rao_disagreement !== undefined && r.fisher_rao_disagreement !== null) {
    if (typeof r.fisher_rao_disagreement !== 'number' || !Number.isFinite(r.fisher_rao_disagreement)) {
      return null;
    }
  }
  for (const key of ['size_before_usdt', 'size_after_usdt']) {
    if (r[key] !== undefined && r[key] !== null && (typeof r[key] !== 'number' || !Number.isFinite(r[key]))) {
      return null;
    }
  }
  if (typeof r.reverse_tape_window !== 'boolean') return null;
  if (typeof r.did_change_decision !== 'boolean') return null;
  return r as unknown as ExpectationDecisionWritePayload;
}

async function handleMessage(raw: string): Promise<void> {
  _messagesReceived++;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] JSON parse failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const payload = validate(parsed);
  if (!payload) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] payload validation failed');
    return;
  }
  try {
    await persist(payload);
    _messagesPersisted++;
  } catch (err) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] persist failed', {
      instance_id: payload.instance_id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handlePredictionMessage(raw: string): Promise<void> {
  _messagesReceived++;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] prediction JSON parse failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  const payload = validatePrediction(parsed);
  if (!payload) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] prediction payload validation failed');
    return;
  }
  try {
    // #949 narrowed KernelPredictionSnapshot.tradeId to string|null (UUID
    // in the new schema). The Redis bridge inherits a payload type that
    // still permits `number` for legacy emitters; stringify at the boundary.
    await insertKernelPrediction({
      tradeId:
        payload.trade_id === null || payload.trade_id === undefined
          ? null
          : String(payload.trade_id),
      kernelId: payload.kernel_id,
      perceptionBasin: payload.perception_basin,
      strategyForecastBasin: payload.strategy_forecast_basin,
      fisherRaoDisagreement: payload.fisher_rao_disagreement,
      basinVelocity: payload.basin_velocity ?? null,
      phi: payload.phi ?? null,
      kappaEff: payload.kappa_eff ?? null,
      predictedHorizonSeconds: payload.predicted_horizon_seconds ?? null,
      predictedTerminalPnlUsdt: payload.predicted_terminal_pnl_usdt ?? null,
      predictedPnlStddevUsdt: payload.predicted_pnl_stddev_usdt ?? null,
      predictedDirection: payload.predicted_direction ?? null,
      predictedConfidence: payload.predicted_confidence ?? null,
      neurochemistry: payload.neurochemistry ?? null,
      regimeWeights: payload.regime_weights ?? null,
      mode: payload.mode ?? null,
      lane: payload.lane ?? null,
      snapshotReason: payload.snapshot_reason,
      triggeringGate: payload.triggering_gate ?? null,
      kernelVersion: payload.kernel_version,
      sourcePath: payload.source_path,
    });
    _messagesPersisted++;
  } catch (err) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] prediction persist failed', {
      kernel_id: payload.kernel_id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleExpectationDecisionMessage(raw: string): Promise<void> {
  _messagesReceived++;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] expectation decision JSON parse failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  const payload = validateExpectationDecision(parsed);
  if (!payload) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] expectation decision payload validation failed');
    return;
  }
  try {
    await pool.query(
      `INSERT INTO kernel_expectation_decisions (
         trade_id, prediction_id, kernel_id,
         tape_trend, basin_direction, fisher_rao_disagreement, tape_basin_disagreement,
         reverse_tape_window, reverse_tape_side,
         qig_warp_version, qig_warp_mode, qig_warp_source,
         expectation_direction, expectation_confidence, expectation_regime,
         expectation_action, expectation_reason,
         decision_surface, side_before, side_after, lane_before, lane_after,
         size_before_usdt, size_after_usdt,
         did_change_decision, formula_version, source_path, kernel_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
         $27, $28
       )`,
      [
        payload.trade_id === null || payload.trade_id === undefined ? null : String(payload.trade_id),
        payload.prediction_id ?? null,
        payload.kernel_id,
        payload.tape_trend,
        payload.basin_direction,
        payload.fisher_rao_disagreement ?? null,
        payload.tape_basin_disagreement,
        payload.reverse_tape_window,
        payload.reverse_tape_side ?? null,
        payload.qig_warp_version,
        payload.qig_warp_mode,
        payload.qig_warp_source,
        payload.expectation_direction,
        payload.expectation_confidence,
        payload.expectation_regime,
        payload.expectation_action,
        payload.expectation_reason,
        payload.decision_surface,
        payload.side_before ?? null,
        payload.side_after ?? null,
        payload.lane_before ?? null,
        payload.lane_after ?? null,
        payload.size_before_usdt ?? null,
        payload.size_after_usdt ?? null,
        payload.did_change_decision,
        payload.formula_version ?? null,
        payload.source_path,
        payload.kernel_version,
      ],
    );
    _messagesPersisted++;
  } catch (err) {
    _messagesDropped++;
    logger.debug('[BasinSyncBridge] expectation decision persist failed', {
      kernel_id: payload.kernel_id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Initialize the Redis subscriber. Call once at apps/api boot; idempotent.
 * No-op when CONSENSUS_BASIN_SYNC_BRIDGE_LIVE is unset.
 */
export async function initBasinSyncBridge(): Promise<void> {
  if (_initialized) return;
  if (!bridgeLive()) {
    logger.info('[BasinSyncBridge] disabled — set CONSENSUS_BASIN_SYNC_BRIDGE_LIVE=true to enable');
    return;
  }
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('[BasinSyncBridge] REDIS_URL unset; bridge disabled');
    return;
  }
  try {
    _subscriber = createClient({ url });
    _subscriber.on('error', (err) => {
      logger.debug('[BasinSyncBridge] subscriber error', {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    await _subscriber.connect();
    await _subscriber.subscribe(BASIN_SYNC_WRITE_CHANNEL, (raw: string) => {
      handleMessage(raw).catch((err) => {
        logger.debug('[BasinSyncBridge] handleMessage threw', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
    await _subscriber.subscribe(PREDICTION_WRITE_CHANNEL, (raw: string) => {
      handlePredictionMessage(raw).catch((err) => {
        logger.debug('[BasinSyncBridge] handlePredictionMessage threw', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
    await _subscriber.subscribe(EXPECTATION_DECISION_WRITE_CHANNEL, (raw: string) => {
      handleExpectationDecisionMessage(raw).catch((err) => {
        logger.debug('[BasinSyncBridge] handleExpectationDecisionMessage threw', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
    _initialized = true;
    logger.info('[BasinSyncBridge] subscribed', {
      channel: BASIN_SYNC_WRITE_CHANNEL,
      predictionChannel: PREDICTION_WRITE_CHANNEL,
      expectationDecisionChannel: EXPECTATION_DECISION_WRITE_CHANNEL,
    });
  } catch (err) {
    logger.error('[BasinSyncBridge] init failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    _subscriber = null;
    _initialized = false;
  }
}

/**
 * Counters for observability. Exposed for tests + a future
 * `/monkey/basin-sync-bridge/stats` endpoint.
 */
export function bridgeStats(): {
  initialized: boolean;
  received: number;
  persisted: number;
  dropped: number;
} {
  return {
    initialized: _initialized,
    received: _messagesReceived,
    persisted: _messagesPersisted,
    dropped: _messagesDropped,
  };
}

/** Test/cleanup helper — disconnect and reset state. */
export async function _resetBasinSyncBridge(): Promise<void> {
  _messagesReceived = 0;
  _messagesPersisted = 0;
  _messagesDropped = 0;
  if (_subscriber) {
    try { await _subscriber.disconnect(); } catch { /* ignore */ }
    _subscriber = null;
  }
  _initialized = false;
}
