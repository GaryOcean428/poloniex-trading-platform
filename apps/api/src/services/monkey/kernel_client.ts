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
  lane: 'scalp' | 'swing' | 'trend' | 'observe';
  direction: 'long' | 'short' | 'flat';
  size_fraction: number;
  dca_intent: boolean;
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

// ─────────────────────────────────────────────────────────────────
// v0.8.7d-1 — HTTP helpers for the four trading decision endpoints
// shipped in v0.8.7a/b/c-1/c-2:
//   POST /risk/evaluate         (v0.8.7a)  — pre-trade blast-door gates
//   POST /live/decide           (v0.8.7b)  — signal threshold + sizing + ATR
//   POST /live/exit-decide      (v0.8.7c-1) — stop-loss/take-profit/trailing
//   POST /live/reconcile        (v0.8.7c-2) — DB-vs-exchange symbol diff
//
// Same pattern as callExecutiveDecide / callTickRun above: 5s timeout,
// fire-and-forget on shadow, structured diff loggers alongside.
// Shadow gating uses existing env var — one flag per shadow surface:
//
//   MONKEY_TICK_PY_SHADOW=true              → already wired (tick)
//   RISK_KERNEL_PY_SHADOW=true              → v0.8.7d-2 wires
//   LIVE_SIGNAL_PY_SHADOW=true              → v0.8.7d-3 wires
//   AUTONOMOUS_TRADER_PY_SHADOW=true        → v0.8.7d-4 wires

// ── /risk/evaluate ───────────────────────────────────────────────

export function isRiskShadowEnabled(): boolean {
  return process.env.RISK_KERNEL_PY_SHADOW === 'true';
}

export interface RiskKernelOrder {
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  notional: number;
  leverage: number;
  price: number;
}

export interface RiskKernelOpenPosition {
  symbol: string;
  side: 'long' | 'short';
  notional: number;
}

export interface RiskKernelRestingOrder {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
}

export interface RiskKernelAccountState {
  equityUsdt: number;
  unrealizedPnlUsdt: number;
  openPositions: RiskKernelOpenPosition[];
  restingOrders: RiskKernelRestingOrder[];
}

export interface RiskKernelContext {
  isLive: boolean;
  mode: 'auto' | 'paper_only' | 'pause';
  symbolMaxLeverage: number;
}

export interface RiskKernelRequest {
  kernelOrder: RiskKernelOrder;
  accountState: RiskKernelAccountState;
  context: RiskKernelContext;
}

export interface RiskKernelDecision {
  allowed: boolean;
  reason?: string | null;
  code?: string | null;
}

export async function callRiskEvaluate(
  req: RiskKernelRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RiskKernelDecision> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ML_WORKER_URL}/risk/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/risk/evaluate HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as RiskKernelDecision;
  } finally {
    clearTimeout(timer);
  }
}

export function logRiskParityDiff(
  ts: { allowed: boolean; code?: string | null },
  py: RiskKernelDecision,
): void {
  // For risk, the meaningful diff is ALLOWED mismatch (safety) OR
  // different veto code on a mutual-block (why we'd reject for a
  // different reason). Not a numeric tolerance — it's boolean +
  // string match.
  if (ts.allowed !== py.allowed) {
    logger.warn('[kernel_client] risk parity diff (allowed mismatch)', {
      ts_allowed: ts.allowed, py_allowed: py.allowed,
      ts_code: ts.code, py_code: py.code,
    });
    return;
  }
  if (!ts.allowed && ts.code !== py.code) {
    logger.warn('[kernel_client] risk parity diff (veto code mismatch)', {
      ts_code: ts.code, py_code: py.code,
    });
  }
}

// ── /live/decide ─────────────────────────────────────────────────

export function isLiveSignalShadowEnabled(): boolean {
  return process.env.LIVE_SIGNAL_PY_SHADOW === 'true';
}

export interface LiveDecideOHLCV {
  high: number;
  low: number;
  close: number;
}

export interface LiveDecideRequest {
  ohlcv: LiveDecideOHLCV[];
  mlSignal: string;
  mlStrength: number;
  mlReason?: string;
  effectiveStrength?: number;
  positionUsdt?: number;
  leverage?: number;
}

export interface LiveDecideOrder {
  side: 'long' | 'short';
  leverage: number;
  notional: number;
  price: number;
  atr: number;
  atrStopDistance: number;
  atrTpDistance: number;
}

export interface LiveDecideResponse {
  normalisedSignal: 'BUY' | 'SELL' | 'HOLD';
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'unknown';
  signalKey: string;
  atr: number;
  entryGate: { passed: boolean; reason: string };
  order: LiveDecideOrder | null;
}

export async function callLiveDecide(
  req: LiveDecideRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<LiveDecideResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ML_WORKER_URL}/live/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/live/decide HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as LiveDecideResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ── /live/exit-decide ────────────────────────────────────────────

export function isExitShadowEnabled(): boolean {
  return process.env.AUTONOMOUS_TRADER_PY_SHADOW === 'true';
}

export interface ExitDecidePosition {
  symbol: string;
  qty: number;           // signed: +long / -short
  entryPrice: number;
  unrealizedPnl: number;
}

export interface ExitDecideConfig {
  stopLossPercent: number;
  takeProfitPercent: number;
}

export interface ExitDecideAnalysis {
  trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
}

export interface ExitDecideRequest {
  position: ExitDecidePosition;
  config: ExitDecideConfig;
  analysis?: ExitDecideAnalysis;
}

export type ExitReason = 'stop_loss' | 'take_profit' | 'trend_reversal' | 'hold';

export interface ExitDecideResponse {
  shouldClose: boolean;
  reason: ExitReason;
  explanation: string;
  pnlPercent: number;
  stopLossThreshold: number;
  takeProfitThreshold: number;
}

export async function callExitDecide(
  req: ExitDecideRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExitDecideResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ML_WORKER_URL}/live/exit-decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/live/exit-decide HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as ExitDecideResponse;
  } finally {
    clearTimeout(timer);
  }
}

export function logExitParityDiff(
  ts: { shouldClose: boolean; reason: string },
  py: ExitDecideResponse,
): void {
  if (ts.shouldClose !== py.shouldClose) {
    logger.warn('[kernel_client] exit parity diff (shouldClose mismatch)', {
      ts, py_reason: py.reason,
    });
    return;
  }
  if (ts.shouldClose && ts.reason !== py.reason) {
    logger.warn('[kernel_client] exit parity diff (reason mismatch)', {
      ts_reason: ts.reason, py_reason: py.reason,
    });
  }
}

// ── /live/reconcile ──────────────────────────────────────────────

export interface ReconcileDbRow {
  symbol: string;
  orderId?: string;
}

export interface ReconcileExchangePosition {
  symbol: string;
  qty: number;
}

export interface ReconcileRequest {
  dbRows: ReconcileDbRow[];
  exchangePositions: ReconcileExchangePosition[];
}

export interface ReconcileResponse {
  matchedSymbols: string[];
  phantomDbSymbols: string[];
  orphanExchangeSymbols: string[];
  hasDrift: boolean;
}

export async function callReconcile(
  req: ReconcileRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ReconcileResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ML_WORKER_URL}/live/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/live/reconcile HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as ReconcileResponse;
  } finally {
    clearTimeout(timer);
  }
}

export function logReconcileParityDiff(
  ts: { phantomDbSymbols: string[]; orphanExchangeSymbols: string[] },
  py: ReconcileResponse,
): void {
  // Reconcile parity compares SETS (order-agnostic).
  const eq = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const bs = new Set(b);
    return a.every((x) => bs.has(x));
  };
  if (!eq(ts.phantomDbSymbols, py.phantomDbSymbols)) {
    logger.warn('[kernel_client] reconcile parity diff (phantoms mismatch)', {
      ts: ts.phantomDbSymbols, py: py.phantomDbSymbols,
    });
  }
  if (!eq(ts.orphanExchangeSymbols, py.orphanExchangeSymbols)) {
    logger.warn('[kernel_client] reconcile parity diff (orphans mismatch)', {
      ts: ts.orphanExchangeSymbols, py: py.orphanExchangeSymbols,
    });
  }
}
