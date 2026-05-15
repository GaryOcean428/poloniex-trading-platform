/**
 * autonomic_client.ts — HTTP client for ml-worker's /monkey/autonomic/*
 * endpoints (v0.7 migration boundary).
 *
 * The TypeScript orchestrator calls these instead of computing
 * neurochemistry / reward decay / sleep phase locally, so the math
 * lives in Python with qig_core_local primitives (no TS-port drift).
 *
 * Feature-flagged via MONKEY_KERNEL_PY=true; when unset, loop.ts
 * continues to use the in-process TS computeNeurochemicals. This
 * lets us validate the Python kernel live-parallel before cutting
 * over, and revert instantly if a drift / latency issue appears.
 *
 * NOT wired into loop.ts yet — that happens in a follow-up PR once
 * we've observed one full tick round-trip in staging.
 */

import { logger } from '../../utils/logger.js';

const ML_WORKER_URL =
  process.env.ML_WORKER_URL || 'http://ml-worker.railway.internal:8000';
const DEFAULT_TIMEOUT_MS = 5000;

export interface AutonomicTickRequest {
  instanceId: string;
  phiDelta: number;
  basinVelocity: number;
  surprise: number;
  quantumWeight: number;
  kappa: number;
  externalCoupling: number;
  currentMode: string;
  isFlat: boolean;
  nowMs?: number;
}

export interface AutonomicTickResponse {
  nc: {
    acetylcholine: number;
    dopamine: number;
    serotonin: number;
    norepinephrine: number;
    gaba: number;
    endorphins: number;
  };
  phase: 'awake' | 'sleep';
  is_awake: boolean;
  entered_sleep: boolean;
  woke: boolean;
  sleep_remaining_ms: number;
  reward_sums: {
    dopamine: number;
    serotonin: number;
    endorphin: number;
  };
}

export interface RewardPush {
  instanceId: string;
  source: string;
  realizedPnlUsdt: number;
  marginUsdt: number;
  symbol?: string;
  kappaAtExit?: number;
}

/**
 * Single autonomic tick — returns neurochemistry + sleep phase.
 * Fail-soft: on HTTP error, throws so the caller can fall back to TS
 * local compute. Caller must handle with try/catch under the
 * MONKEY_KERNEL_PY flag.
 */
export async function callAutonomicTick(
  req: AutonomicTickRequest,
): Promise<AutonomicTickResponse> {
  const body = JSON.stringify({
    instance_id: req.instanceId,
    phi_delta: req.phiDelta,
    basin_velocity: req.basinVelocity,
    surprise: req.surprise,
    quantum_weight: req.quantumWeight,
    kappa: req.kappa,
    external_coupling: req.externalCoupling,
    current_mode: req.currentMode,
    is_flat: req.isFlat,
    now_ms: req.nowMs,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/monkey/autonomic/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`autonomic/tick ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as AutonomicTickResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Push a reward event. Fire-and-forget from the caller's perspective
 * (resolves once the request lands; telemetry-only failures are logged).
 */
export async function callAutonomicReward(req: RewardPush): Promise<void> {
  const body = JSON.stringify({
    instance_id: req.instanceId,
    source: req.source,
    realized_pnl_usdt: req.realizedPnlUsdt,
    margin_usdt: req.marginUsdt,
    symbol: req.symbol,
    kappa_at_exit: req.kappaAtExit,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/monkey/autonomic/reward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('[autonomic_client] reward push failed', {
        status: res.status,
        body: await res.text(),
      });
    }
  } catch (err) {
    logger.warn('[autonomic_client] reward push threw', {
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Feature-flag helper. */
export function isPythonKernelEnabled(): boolean {
  return process.env.MONKEY_KERNEL_PY === 'true';
}
