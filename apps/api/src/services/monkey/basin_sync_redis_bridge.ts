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

export const BASIN_SYNC_WRITE_CHANNEL = 'monkey:basin:sync:writes';

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
    _initialized = true;
    logger.info('[BasinSyncBridge] subscribed', {
      channel: BASIN_SYNC_WRITE_CHANNEL,
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
