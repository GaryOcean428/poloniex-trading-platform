/**
 * governance.ts — Operator-facing kernel observability surface.
 *
 * The trading-side telemetry today is trade-level only (autonomous_trades,
 * monkey_decisions). The consciousness layer (sleep/dream/mushroom cycles,
 * autonomic neurochemistry, basin-coherence trajectory) is RUNNING but
 * UNOBSERVED — the Python kernel modules persist their state to Redis
 * under `monkey:ocean:{instance}:sleep_state` (see
 * `ml-worker/src/monkey_kernel/persistence.py:214`) but no HTTP endpoint
 * exposes it. This module starts that surface with the smallest meaningful
 * step: a single GET that reads the already-persisted state without any
 * new computation, side-effects, or write paths.
 *
 * Path B doctrine: translation only. No new state, no new compute, no
 * side-effects. If this returns nothing useful, the underlying kernel
 * telemetry surface itself is the problem and the next move is to
 * instrument the Python kernel — not to invent new state here.
 */

import type { Request, Response } from 'express';
import express from 'express';
import { createClient, type RedisClientType } from 'redis';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || '';

/** Lazy-initialised shared Redis client. Reconnects on transient failure;
 *  the per-request handler is resilient to a null client (returns the
 *  not-configured shape so the FE can render an empty card). */
let _redisClient: RedisClientType | null = null;
let _redisConnecting = false;
async function getRedisClient(): Promise<RedisClientType | null> {
  if (!REDIS_URL) return null;
  if (_redisClient && _redisClient.isOpen) return _redisClient;
  if (_redisConnecting) {
    // Avoid duplicate connect storms on cold start.
    await new Promise((r) => setTimeout(r, 100));
    return _redisClient && _redisClient.isOpen ? _redisClient : null;
  }
  _redisConnecting = true;
  try {
    const c = createClient({ url: REDIS_URL });
    c.on('error', (err) => logger.warn(`[governance.sleep-state] redis error: ${err instanceof Error ? err.message : String(err)}`));
    await c.connect();
    _redisClient = c as RedisClientType;
    return _redisClient;
  } catch (err) {
    logger.warn(`[governance.sleep-state] redis connect failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    _redisConnecting = false;
  }
}

/** Mapping from the operator-facing :agent label to the kernel instance_id
 *  the Python kernel writes under in Redis. K is the primary kernel; the
 *  M/T/L agents share the same kernel's sleep cycle today (they live
 *  inside the same Monkey loop), so an explicit map keeps the URL clean. */
const AGENT_TO_INSTANCE: Record<string, string> = {
  K: 'monkey-position',
  k: 'monkey-position',
  'monkey-position': 'monkey-position',
  'monkey-swing': 'monkey-swing',
  M: 'monkey-position',  // M lives inside the same kernel instance
  T: 'monkey-position',  // T same
  L: 'monkey-position',  // L same
};

/**
 * GET /api/governance/sleep-state/:agent
 *
 * Reads the already-persisted Ocean sleep state from Redis. No new
 * computation; no side-effects; no write paths. Returns the smallest
 * meaningful payload so an operator can curl it and verify whether
 * the kernel telemetry surface is alive without shipping anything on
 * the trading side.
 *
 * Response shape:
 *   {
 *     agent: string,
 *     instance_id: string,
 *     redis_key: string,
 *     sleep_state: { phase, phase_started_at_ms, last_sleep_ended_at_ms,
 *                    sleep_count, drift_streak } | null,
 *     fetched_at_ms: number,
 *     source: 'redis' | 'empty' | 'not_configured' | 'error'
 *   }
 *
 * `source` interpretation:
 *   - 'redis': payload retrieved from Redis (sleep_state populated)
 *   - 'empty': Redis is reachable but the key is missing (kernel has not
 *              persisted state yet, or runs without persistence enabled)
 *   - 'not_configured': REDIS_URL env var is absent
 *   - 'error': Redis read failed (logged separately)
 */
router.get('/sleep-state/:agent', authenticateToken, async (req: Request, res: Response) => {
  const fetchedAtMs = Date.now();
  const rawAgent = (req.params.agent ?? '').toString();
  const instanceId = AGENT_TO_INSTANCE[rawAgent];
  if (!instanceId) {
    return res.status(400).json({
      success: false,
      error: `Unknown agent '${rawAgent}'. Use K | M | T | L | monkey-position | monkey-swing.`,
    });
  }
  const redisKey = `monkey:ocean:${instanceId}:sleep_state`;
  const client = await getRedisClient();
  if (!client) {
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sleep_state: null,
      fetched_at_ms: fetchedAtMs,
      source: REDIS_URL ? 'error' : 'not_configured',
    });
  }
  try {
    const raw = await client.get(redisKey);
    if (raw == null) {
      return res.json({
        success: true,
        agent: rawAgent,
        instance_id: instanceId,
        redis_key: redisKey,
        sleep_state: null,
        fetched_at_ms: fetchedAtMs,
        source: 'empty',
      });
    }
    let sleepState: unknown = null;
    try {
      sleepState = JSON.parse(raw);
    } catch (parseErr) {
      logger.warn(`[governance.sleep-state] JSON parse failed for ${redisKey}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      sleepState = { _raw: raw };
    }
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sleep_state: sleepState,
      fetched_at_ms: fetchedAtMs,
      source: 'redis',
    });
  } catch (err) {
    logger.warn(`[governance.sleep-state] redis get ${redisKey} failed: ${err instanceof Error ? err.message : String(err)}`);
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sleep_state: null,
      fetched_at_ms: fetchedAtMs,
      source: 'error',
    });
  }
});

export default router;
