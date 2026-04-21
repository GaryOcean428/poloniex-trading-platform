/**
 * kernel_client.ts — HTTP client for ml-worker /monkey/executive and
 *                    /monkey/mode endpoints (v0.7.3 migration).
 *
 * This sits next to autonomic_client.ts (v0.7) and provides the full
 * executive surface the TS orchestrator needs. Feature-flagged via
 * MONKEY_KERNEL_PY=true — when unset, loop.ts uses its in-process TS
 * executive/modes code (the current live path).
 *
 * Design: one endpoint call per tick for the full executive pass.
 * Latency on Railway's private network is ~2ms round-trip; negligible
 * vs the purity benefit (no TS-port drift, all QIG math in one place).
 *
 * NOT YET wired into loop.ts — v0.7.3 ships only the client. v0.7.4
 * wires under the feature flag with parity-compare telemetry.
 */

import { logger } from '../../utils/logger.js';

const ML_WORKER_URL =
  process.env.ML_WORKER_URL || 'http://ml-worker.railway.internal:8000';
const DEFAULT_TIMEOUT_MS = 5000;

export function isPythonKernelEnabled(): boolean {
  return process.env.MONKEY_KERNEL_PY === 'true';
}

// ── Shared types matching Python monkey_kernel.state ──

export interface PyNeurochemicalState {
  acetylcholine: number;
  dopamine: number;
  serotonin: number;
  norepinephrine: number;
  gaba: number;
  endorphins: number;
}

export interface PyExecBasinState {
  basin: number[];
  identity_basin: number[];
  phi: number;
  kappa: number;
  regime_weights: { quantum: number; efficient: number; equilibrium: number };
  sovereignty: number;
  basin_velocity: number;
  neurochemistry: PyNeurochemicalState;
}

// ── Executive decide ──

export interface ExecutiveDecideRequest {
  basin_state: PyExecBasinState;
  closes: number[];
  ml_signal: 'BUY' | 'SELL' | 'HOLD';
  ml_strength: number;
  held_side?: 'long' | 'short' | null;
  own_position?: {
    entry_price: number;
    quantity: number;
    peak_pnl_usdt?: number;
    dca_add_count?: number;
    last_entry_at_ms?: number;
  };
  last_price?: number;
  available_equity: number;
  min_notional: number;
  max_leverage: number;
  bank_size: number;
  self_obs_bias: number;
  mode?: 'exploration' | 'investigation' | 'integration' | 'drift';
  symbol: string;
  now_ms?: number;
}

export interface ExecutiveDecision<T> {
  value: T;
  reason: string;
  derivation: Record<string, number | string>;
}

export interface ExecutiveDecideResponse {
  entry_threshold: ExecutiveDecision<number>;
  leverage: ExecutiveDecision<number>;
  size: ExecutiveDecision<number>;
  harvest: ExecutiveDecision<boolean> | null;
  scalp: ExecutiveDecision<boolean> | null;
  dca: ExecutiveDecision<boolean> | null;
  loop2: ExecutiveDecision<boolean> | null;
  mode: string;
  tape_trend: number;
  basin_direction: number;
  side_candidate: 'long' | 'short';
  side_override: boolean;
  ml_side: 'long' | 'short';
  ml_strength_gate_clear: boolean;
}

export async function callExecutiveDecide(
  req: ExecutiveDecideRequest,
): Promise<ExecutiveDecideResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/monkey/executive/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`executive/decide ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as ExecutiveDecideResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ── Mode detect ──

export interface ModeDetectRequest {
  basin_state: PyExecBasinState;
  phi_history: number[];
  fhealth_history: number[];
  drift_history: number[];
}

export interface ModeDetectResponse {
  mode: string;
  reason: string;
  derivation: Record<string, number>;
}

export async function callModeDetect(
  req: ModeDetectRequest,
): Promise<ModeDetectResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/monkey/mode/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`mode/detect ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as ModeDetectResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ── Parity-diff helper (v0.7.4 will use this) ──

/**
 * Compare two executive decisions and log if they diverge significantly.
 * Called opportunistically when MONKEY_KERNEL_PY_SHADOW=true and the
 * TS path is still authoritative — gives us parity telemetry before
 * cutting over to Python-authoritative.
 */
export function logParityDiff(
  kind: string,
  tsValue: number | boolean,
  pyValue: number | boolean,
  tolerance: number = 0.01,
): void {
  if (typeof tsValue === 'boolean' || typeof pyValue === 'boolean') {
    if (tsValue !== pyValue) {
      logger.warn('[kernel_client] parity diff (boolean)', {
        kind,
        ts: tsValue,
        py: pyValue,
      });
    }
    return;
  }
  const diff = Math.abs(tsValue - pyValue);
  if (diff > tolerance) {
    logger.warn('[kernel_client] parity diff (numeric)', {
      kind,
      ts: tsValue,
      py: pyValue,
      diff,
      tolerance,
    });
  }
}
