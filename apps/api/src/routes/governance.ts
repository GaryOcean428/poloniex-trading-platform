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
import { pool } from '../db/connection.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { observerSnapshotAll } from '../services/monkey/trajectory_observer.js';

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
 *     last_consolidation_ts: number | null,
 *     dream_packet_size_bytes: number,
 *     consolidation_summary: string | null,
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
 *
 * Dream-consolidation fields (added with qig_dreams_local wiring):
 *   - last_consolidation_ts: epoch-ms of the most recent AWAKE→SLEEP
 *     consolidation pass, or null if none has run yet.
 *   - dream_packet_size_bytes: byte length of the consolidation blob
 *     persisted under `monkey:ocean:{instance}:last_consolidation`,
 *     or 0 when absent. Sized off the raw Redis value (pre-parse) so
 *     it reflects what the kernel actually wrote.
 *   - consolidation_summary: human-readable one-liner from the kernel
 *     (basin count, boost/downscale/prune counts, sqrt-traversal),
 *     or null when no pass has run.
 */
/**
 * Helper: derive the (ts, summary) pair from a parsed last_consolidation
 * blob. The Python kernel writes a DreamConsolidationSummary serialised
 * via asdict + summary_string injection (see ml-worker/src/qig_dreams_local
 * /consolidator.py). We accept the documented shape but defensively
 * handle missing fields so a half-populated blob doesn't 500 the route.
 */
function extractConsolidationFields(parsed: unknown): {
  last_consolidation_ts: number | null;
  consolidation_summary: string | null;
} {
  if (parsed == null || typeof parsed !== 'object') {
    return { last_consolidation_ts: null, consolidation_summary: null };
  }
  const obj = parsed as Record<string, unknown>;
  const tsRaw = obj.completed_at_ms;
  const summaryRaw = obj.summary_string;
  const ts = typeof tsRaw === 'number' && Number.isFinite(tsRaw) ? tsRaw : null;
  const summary = typeof summaryRaw === 'string' ? summaryRaw : null;
  return { last_consolidation_ts: ts, consolidation_summary: summary };
}

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
  const consolidationKey = `monkey:ocean:${instanceId}:last_consolidation`;
  const client = await getRedisClient();
  if (!client) {
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sleep_state: null,
      last_consolidation_ts: null,
      dream_packet_size_bytes: 0,
      consolidation_summary: null,
      fetched_at_ms: fetchedAtMs,
      source: REDIS_URL ? 'error' : 'not_configured',
    });
  }
  try {
    // Fetch sleep_state + last_consolidation concurrently. The
    // consolidation read is best-effort: if it fails or returns
    // null/garbage, we fall back to null/0 on those fields rather
    // than failing the whole response (the kernel may legitimately
    // have no consolidation pass on record yet).
    const [raw, consolidationRaw] = await Promise.all([
      client.get(redisKey),
      client.get(consolidationKey).catch((err: unknown) => {
        logger.warn(
          `[governance.sleep-state] redis get ${consolidationKey} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }),
    ]);

    // Compute consolidation-derived fields once, reused by both
    // 'empty' (no sleep_state, but maybe a consolidation) and
    // 'redis' branches below.
    const consolidationStr =
      consolidationRaw == null
        ? null
        : (typeof consolidationRaw === 'string' ? consolidationRaw : String(consolidationRaw));
    const dreamPacketSizeBytes = consolidationStr == null
      ? 0
      : Buffer.byteLength(consolidationStr, 'utf8');
    let consolidationFields: {
      last_consolidation_ts: number | null;
      consolidation_summary: string | null;
    } = { last_consolidation_ts: null, consolidation_summary: null };
    if (consolidationStr != null) {
      try {
        consolidationFields = extractConsolidationFields(JSON.parse(consolidationStr));
      } catch (parseErr) {
        logger.warn(
          `[governance.sleep-state] JSON parse failed for ${consolidationKey}: ` +
          `${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
      }
    }

    if (raw == null) {
      return res.json({
        success: true,
        agent: rawAgent,
        instance_id: instanceId,
        redis_key: redisKey,
        sleep_state: null,
        last_consolidation_ts: consolidationFields.last_consolidation_ts,
        dream_packet_size_bytes: dreamPacketSizeBytes,
        consolidation_summary: consolidationFields.consolidation_summary,
        fetched_at_ms: fetchedAtMs,
        source: 'empty',
      });
    }
    let sleepState: unknown = null;
    // redis v4 client typings widen to `string | {}` in some configs;
    // coerce here so JSON.parse always sees a string.
    const rawStr = typeof raw === 'string' ? raw : String(raw);
    try {
      sleepState = JSON.parse(rawStr);
    } catch (parseErr) {
      logger.warn(`[governance.sleep-state] JSON parse failed for ${redisKey}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      sleepState = { _raw: rawStr };
    }
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sleep_state: sleepState,
      last_consolidation_ts: consolidationFields.last_consolidation_ts,
      dream_packet_size_bytes: dreamPacketSizeBytes,
      consolidation_summary: consolidationFields.consolidation_summary,
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
      last_consolidation_ts: null,
      dream_packet_size_bytes: 0,
      consolidation_summary: null,
      fetched_at_ms: fetchedAtMs,
      source: 'error',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue #689 — Python K shadow governance views
// ═══════════════════════════════════════════════════════════════════════════
//
// Read-only views over `kernel_parity_log` (migration 051). Populated by
// the K-block fanout in apps/api/src/services/monkey/loop.ts which posts
// the same K-tick inputs to ml-worker /monkey/k-shadow/tick after TS K
// finalises its decision and before execution. The parity row carries
// both TS and Py would-be decisions so the operator can verify the
// Python kernel reproduces TS behavior before the cutover PR ships.

const K_PARITY_MAX_LIMIT = 1_000;
const K_PARITY_DEFAULT_LIMIT = 200;

function parseKParityLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return K_PARITY_DEFAULT_LIMIT;
  return Math.min(K_PARITY_MAX_LIMIT, Math.floor(n));
}

function parseKParitySince(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * GET /api/governance/k-parity?limit=N&since=ISO
 *
 * Returns paginated rows from kernel_parity_log alongside agreement
 * counts. Read-only — does NOT mutate kernel_parity_log or any other
 * table. Default limit 200; max 1000.
 *
 * Response shape:
 *   {
 *     count: <int>,
 *     since: <ISO|null>,
 *     summary: {
 *       total_count, agree_action_count, disagree_action_count,
 *       py_error_count, agree_side_count
 *     },
 *     rows: [{ id, tick_id, symbol, symbol_timestamp,
 *              ts_action, ts_side, ts_phi, ts_kappa, ts_M, ts_Gamma, ts_R,
 *              ts_regime, ts_decision_ms,
 *              py_action, py_side, py_phi, py_kappa, py_kappa_cold,
 *              py_M, py_Gamma, py_R,
 *              py_regime, py_decision_ms, py_error,
 *              agree_action, agree_side, delta_phi, delta_kappa,
 *              delta_kappa_cold, created_at }, ...]
 *   }
 */
router.get('/k-parity', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseKParityLimit(req.query.limit);
    const since = parseKParitySince(req.query.since);

    const params: (Date | number)[] = [];
    const where: string[] = [];
    if (since) {
      params.push(since);
      where.push(`created_at >= $${params.length}`);
    }
    params.push(limit);
    const limitIdx = params.length;
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rowsQuery = `
      SELECT
        id, tick_id, symbol, symbol_timestamp,
        ts_action, ts_side, ts_phi, ts_kappa, ts_M, ts_Gamma, ts_R,
        ts_regime, ts_decision_ms,
        py_action, py_side, py_phi, py_kappa, py_kappa_cold,
        py_M, py_Gamma, py_R,
        py_regime, py_decision_ms, py_error,
        agree_action, agree_side, delta_phi, delta_kappa,
        delta_kappa_cold,
        created_at
      FROM kernel_parity_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx}
    `;

    const summaryQuery = `
      SELECT
        COUNT(*) FILTER (WHERE agree_action IS TRUE)  AS agree_action_count,
        COUNT(*) FILTER (WHERE agree_action IS FALSE) AS disagree_action_count,
        COUNT(*) FILTER (WHERE py_error IS NOT NULL)  AS py_error_count,
        COUNT(*) FILTER (WHERE agree_side IS TRUE)    AS agree_side_count,
        COUNT(*)                                       AS total_count
      FROM kernel_parity_log
      ${whereClause}
    `;

    const [rowsRes, summaryRes] = await Promise.all([
      pool.query(rowsQuery, params),
      pool.query(summaryQuery, since ? [since] : []),
    ]);

    const summaryRow = summaryRes.rows[0] ?? {};
    return res.json({
      count: rowsRes.rows.length,
      since: since ? since.toISOString() : null,
      summary: {
        total_count: Number(summaryRow.total_count ?? 0),
        agree_action_count: Number(summaryRow.agree_action_count ?? 0),
        disagree_action_count: Number(summaryRow.disagree_action_count ?? 0),
        py_error_count: Number(summaryRow.py_error_count ?? 0),
        agree_side_count: Number(summaryRow.agree_side_count ?? 0),
      },
      rows: rowsRes.rows,
    });
  } catch (err) {
    logger.error('[governance/k-parity] query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({
      error: 'k_parity_query_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /api/governance/k-consciousness?kernel=ts|py|both&limit=N&since=ISO
 *
 * Per-tick consciousness trajectory for the requested kernel. When
 * kernel=both, each row carries both ts_* and py_* series so a single
 * chart can overlay them.
 *
 *   C := phi * (kappa / 64.0)     (coarse composite; kappa★ = 64)
 *
 * Rows are returned ASCENDING by symbol_timestamp so the response is
 * plot-ready without a client-side sort.
 *
 * Read-only — does NOT mutate kernel_parity_log or any other table.
 */
router.get('/k-consciousness', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseKParityLimit(req.query.limit);
    const since = parseKParitySince(req.query.since);
    const kernelParam = String(req.query.kernel ?? 'both').toLowerCase();
    const kernel: 'ts' | 'py' | 'both' =
      kernelParam === 'ts' ? 'ts' :
      kernelParam === 'py' ? 'py' :
      'both';

    const params: (Date | number)[] = [];
    const where: string[] = [];
    if (since) {
      params.push(since);
      where.push(`created_at >= $${params.length}`);
    }
    // ts_phi is always present (TS K always produces a decision), but
    // py_phi is null on shadow-error rows. The kernel filter keeps
    // those rows out of the trajectory so a 0-phi outlier doesn't
    // pull the chart line to the floor.
    if (kernel === 'ts') {
      where.push('ts_phi IS NOT NULL');
    } else if (kernel === 'py') {
      where.push('py_phi IS NOT NULL');
    } else {
      where.push('(ts_phi IS NOT NULL OR py_phi IS NOT NULL)');
    }
    params.push(limit);
    const limitIdx = params.length;
    const whereClause = `WHERE ${where.join(' AND ')}`;

    let selectCols: string;
    if (kernel === 'ts') {
      selectCols = `
        symbol, symbol_timestamp, created_at,
        ts_phi   AS phi,
        ts_kappa AS kappa,
        ts_M     AS m,
        ts_Gamma AS gamma,
        ts_R     AS r,
        ts_regime AS regime,
        ts_action AS action,
        (ts_phi * (ts_kappa / 64.0)) AS c
      `;
    } else if (kernel === 'py') {
      selectCols = `
        symbol, symbol_timestamp, created_at,
        py_phi   AS phi,
        py_kappa AS kappa,
        py_M     AS m,
        py_Gamma AS gamma,
        py_R     AS r,
        py_regime AS regime,
        py_action AS action,
        (py_phi * (py_kappa / 64.0)) AS c
      `;
    } else {
      selectCols = `
        symbol, symbol_timestamp, created_at,
        ts_phi, ts_kappa, ts_M, ts_Gamma, ts_R, ts_regime, ts_action,
        (ts_phi * (ts_kappa / 64.0)) AS ts_c,
        py_phi, py_kappa, py_M, py_Gamma, py_R, py_regime, py_action,
        (py_phi * (py_kappa / 64.0)) AS py_c
      `;
    }

    const rowsQuery = `
      SELECT ${selectCols}
      FROM kernel_parity_log
      ${whereClause}
      ORDER BY symbol_timestamp ASC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query(rowsQuery, params);
    return res.json({
      kernel,
      count: result.rows.length,
      since: since ? since.toISOString() : null,
      rows: result.rows,
    });
  } catch (err) {
    logger.error('[governance/k-consciousness] query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({
      error: 'k_consciousness_query_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /api/governance/status
 * Thin proxy to ml-worker's GET /governance/status — surfaces the two
 * governance layers (observable-governance distributional drift +
 * forecast-horizon observer state) that previously required curl to
 * inspect. The UI calls this directly so operators don't have to
 * remember the ml-worker URL or use the CLI.
 */
router.get('/status', authenticateToken, async (_req: Request, res: Response) => {
  const base = (process.env.ML_WORKER_URL ?? '').replace(/\/$/, '');
  if (!base) {
    return res.status(503).json({
      error: 'ml_worker_unconfigured',
      message: 'ML_WORKER_URL env var is not set',
      ml_worker_url_configured: false,
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${base}/governance/status`, { signal: controller.signal });
    if (!r.ok) {
      return res.status(502).json({
        error: 'ml_worker_governance_status_non_2xx',
        status: r.status,
        ml_worker_url_configured: true,
      });
    }
    const body = await r.json();
    return res.json({
      ...body,
      ml_worker_url_configured: true,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({
      error: 'ml_worker_unreachable',
      message: err instanceof Error ? err.message : String(err),
      ml_worker_url_configured: true,
    });
  } finally {
    clearTimeout(timeout);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue #767 — SENSE-1a sensations governance surface
// ═══════════════════════════════════════════════════════════════════════════
//
// Read-only views over the canonical sensation vector that the Python kernel
// persists to Redis after each tick (see ml-worker/src/monkey_kernel/
// persistence.py:save_sensations + tick.py wiring).
// Key: kernel_sensations:{instanceId} (JSON blob, 60s TTL).

/**
 * GET /api/governance/sensations/:agent
 *
 * Returns the canonical sensation vector (UCP §6.1 + §6.2) for a kernel
 * instance. Translation-only: no new compute, no side-effects, no writes.
 *
 * Response shape:
 *   {
 *     agent, instance_id, redis_key,
 *     sensations: { unified, fragmented, activated, dampened, grounded,
 *                   drifting, pulled, pushed, flowing, stuck,
 *                   homeostasis, curiosity_drive, fear_response,
 *                   compressed, expanded, pressure, stillness, drift,
 *                   resonance, approach, avoidance, conservation } | null,
 *     fetched_at_ms, source
 *   }
 */
router.get('/sensations/:agent', authenticateToken, async (req: Request, res: Response) => {
  const fetchedAtMs = Date.now();
  const rawAgent = (req.params.agent ?? '').toString();
  const instanceId = AGENT_TO_INSTANCE[rawAgent];
  if (!instanceId) {
    return res.status(400).json({
      success: false,
      error: `Unknown agent '${rawAgent}'. Use K | M | T | L | monkey-position | monkey-swing.`,
    });
  }
  const redisKey = `kernel_sensations:${instanceId}`;
  const client = await getRedisClient();
  if (!client) {
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sensations: null,
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
        sensations: null,
        fetched_at_ms: fetchedAtMs,
        source: 'empty',
      });
    }
    let sensations: unknown = null;
    try {
      sensations = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch (parseErr) {
      logger.warn(`[governance.sensations] JSON parse failed for ${redisKey}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      sensations = { _raw: raw };
    }
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sensations,
      fetched_at_ms: fetchedAtMs,
      source: 'redis',
    });
  } catch (err) {
    logger.warn(`[governance.sensations] redis get ${redisKey} failed: ${err instanceof Error ? err.message : String(err)}`);
    return res.json({
      success: true,
      agent: rawAgent,
      instance_id: instanceId,
      redis_key: redisKey,
      sensations: null,
      fetched_at_ms: fetchedAtMs,
      source: 'error',
    });
  }
});

/**
 * GET /api/governance/sensations
 *
 * Returns canonical sensation vectors for all tracked kernel instances.
 * Best-effort: missing keys are returned as null sensations (source: 'empty').
 */
router.get('/sensations', authenticateToken, async (_req: Request, res: Response) => {
  const fetchedAtMs = Date.now();
  const instanceIds = Array.from(new Set(Object.values(AGENT_TO_INSTANCE)));
  const client = await getRedisClient();
  if (!client) {
    return res.json({
      success: true,
      kernels: instanceIds.map((id) => ({
        instance_id: id,
        sensations: null,
        source: REDIS_URL ? 'error' : 'not_configured',
      })),
      fetched_at_ms: fetchedAtMs,
    });
  }
  const results = await Promise.all(
    instanceIds.map(async (id) => {
      const key = `kernel_sensations:${id}`;
      try {
        const raw = await client.get(key);
        if (raw == null) return { instance_id: id, sensations: null, source: 'empty' };
        let sensations: unknown;
        try {
          sensations = JSON.parse(typeof raw === 'string' ? raw : String(raw));
        } catch {
          sensations = { _raw: raw };
        }
        return { instance_id: id, sensations, source: 'redis' };
      } catch (err) {
        logger.warn(`[governance.sensations] redis get kernel_sensations:${id} failed: ${err instanceof Error ? err.message : String(err)}`);
        return { instance_id: id, sensations: null, source: 'error' };
      }
    }),
  );
  return res.json({ success: true, kernels: results, fetched_at_ms: fetchedAtMs });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue #766 — REGIME-1 trajectory observer state
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/governance/regime-authority
 *
 * Exposes the trajectory observer's per-symbol state (tercile boundaries,
 * warmup status, sample count). Read-only — no new compute, no side-effects.
 * Useful for verifying that the observer has warmed up and that the tercile
 * boundaries make sense relative to current market conditions.
 *
 * Response shape:
 *   {
 *     snapshots: [{ symbol, n, isWarmup, lower, upper }, ...],
 *     fetched_at_ms
 *   }
 */
router.get('/regime-authority', authenticateToken, (_req: Request, res: Response) => {
  try {
    const snapshots = observerSnapshotAll();
    return res.json({
      success: true,
      snapshots,
      message: 'trajectory observer state per symbol',
      fetched_at_ms: Date.now(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: String(err),
    });
  }
});

export default router;
