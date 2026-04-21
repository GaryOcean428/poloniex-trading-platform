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

// ── Tick run — full pipeline shadow (v0.8.3b) ──

export function isShadowTickEnabled(): boolean {
  return process.env.MONKEY_TICK_PY_SHADOW === 'true';
}

/** OHLCV candle as the Python endpoint expects. */
export interface TickRunOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Account context slice sent to /monkey/tick/run. */
export interface TickRunAccount {
  equity_fraction: number;
  margin_fraction: number;
  open_positions: number;
  available_equity: number;
  exchange_held_side?: string | null;
  own_position_entry_price?: number | null;
  own_position_quantity?: number | null;
  own_position_trade_id?: string | null;
}

/** Inputs for one tick, matching Python TickInputs. */
export interface TickRunInputs {
  symbol: string;
  ohlcv: TickRunOHLCV[];
  ml_signal: string;
  ml_strength: number;
  account: TickRunAccount;
  bank_size: number;
  sovereignty: number;
  max_leverage: number;
  min_notional: number;
  size_fraction: number;
  self_obs_bias?: Record<string, Record<string, number>> | null;
}

/** Serialized Python SymbolState — carried across ticks. */
export interface TickRunSymbolState {
  symbol: string;
  identity_basin: number[];
  last_basin: number[] | null;
  kappa: number;
  session_ticks: number;
  last_mode: string | null;
  basin_history: number[][];
  phi_history: number[];
  fhealth_history: number[];
  drift_history: number[];
  dca_add_count: number;
  last_entry_at_ms: number | null;
  peak_pnl_usdt: number | null;
  peak_tracked_trade_id: string | null;
}

export interface TickRunRequest {
  instance_id: string;
  inputs: TickRunInputs;
  prev_state: TickRunSymbolState | null;
}

export interface TickRunDecision {
  action: string;
  reason: string;
  mode: string;
  size_usdt: number;
  leverage: number;
  entry_threshold: number;
  phi: number;
  kappa: number;
  basin_velocity: number;
  f_health: number;
  drift_from_identity: number;
  basin_direction: number;
  tape_trend: number;
  side_candidate: string;
  side_override: boolean;
  neurochemistry: Record<string, number>;
  derivation: Record<string, unknown>;
  basin: number[];
  is_dca_add: boolean;
  is_reverse: boolean;
}

export interface TickRunResponse {
  decision: TickRunDecision;
  new_state: TickRunSymbolState;
}

export async function callTickRun(
  req: TickRunRequest,
): Promise<TickRunResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/monkey/tick/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`tick/run ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as TickRunResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Log parity diffs between TS and Python full-pipeline tick decisions.
 * Called from shadow path — fire-and-forget, non-blocking.
 */
export function logTickParityDiffs(
  symbol: string,
  tsDecision: {
    action: string;
    entry_threshold: number;
    leverage: number;
    size_usdt: number;
    mode: string;
    side_candidate: string;
    side_override: boolean;
    phi: number;
    kappa: number;
  },
  pyDecision: TickRunDecision,
): void {
  if (tsDecision.action !== pyDecision.action) {
    logger.warn('[shadow-tick] parity diff (action)', {
      symbol,
      ts: tsDecision.action,
      py: pyDecision.action,
    });
  }
  if (tsDecision.mode !== pyDecision.mode) {
    logger.warn('[shadow-tick] parity diff (mode)', {
      symbol,
      ts: tsDecision.mode,
      py: pyDecision.mode,
    });
  }
  if (tsDecision.side_candidate !== pyDecision.side_candidate) {
    logger.warn('[shadow-tick] parity diff (side_candidate)', {
      symbol,
      ts: tsDecision.side_candidate,
      py: pyDecision.side_candidate,
    });
  }
  logParityDiff('tick.entry_threshold', tsDecision.entry_threshold, pyDecision.entry_threshold);
  logParityDiff('tick.leverage', tsDecision.leverage, pyDecision.leverage);
  // Size tolerance wider (0.1 USDT) — rounding and sizeFraction edge-case
  // arithmetic can legitimately differ between TS and Python by a few cents.
  logParityDiff('tick.size_usdt', tsDecision.size_usdt, pyDecision.size_usdt, 0.1);
  logParityDiff('tick.phi', tsDecision.phi, pyDecision.phi);
  // κ tolerance 0.5 — EMA smoothing with f64 vs f64 can drift by ~0.3
  // across 100-tick histories; 0.5 catches real divergence, not FP noise.
  logParityDiff('tick.kappa', tsDecision.kappa, pyDecision.kappa, 0.5);
  logParityDiff('tick.side_override', tsDecision.side_override, pyDecision.side_override);
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
