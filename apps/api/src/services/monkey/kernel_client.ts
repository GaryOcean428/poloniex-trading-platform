/**
 * kernel_client.ts — HTTP client for ml-worker's Python kernel endpoints.
 *
 * Post-cutover: Python is authoritative for kernel decisions. There is
 * no TS fallback — if Python is down, the trading path errors and
 * surfaces. 5 s default timeout. The previous shadow flags
 * (MONKEY_KERNEL_PY, MONKEY_TICK_PY_SHADOW, RISK_KERNEL_PY_SHADOW,
 * LIVE_SIGNAL_PY_SHADOW, AUTONOMOUS_TRADER_PY_SHADOW) and parity-diff
 * loggers were removed in the TS→Py kernel cutover (PR #674).
 */

const ML_WORKER_URL =
  process.env.ML_WORKER_URL || 'http://ml-worker.railway.internal:8000';
const DEFAULT_TIMEOUT_MS = 5000;

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

// ── Tick run — full kernel pipeline (authoritative post-cutover) ──

/** OHLCV candle as the Python endpoint expects. */
export interface TickRunOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Per-lane position carried from the orchestrator into Python. */
export interface TickRunLanePosition {
  lane: 'scalp' | 'swing' | 'trend';
  side: 'long' | 'short';
  notional: number;
  margin_usdt: number;
  funding_paid_usdt: number;
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
  lane_positions?: TickRunLanePosition[];
}

/** Inputs for one tick, matching Python TickInputs. */
export interface TickRunInputs {
  symbol: string;
  ohlcv: TickRunOHLCV[];
  account: TickRunAccount;
  bank_size: number;
  sovereignty: number;
  max_leverage: number;
  min_notional: number;
  size_fraction: number;
  self_obs_bias?: Record<string, Record<string, number>> | null;
  funding_rate_8h?: number;
  /**
   * Per-lane Kelly rolling stats (proposal #3 + lane-conditioned split).
   * Tuple: [winRate, avgWin, avgLoss]. When null, Kelly cap is a no-op.
   */
  rolling_kelly_stats?: [number, number, number] | null;
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
  /**
   * Held-position re-justification anchors — per-lane (regime, Φ)
   * snapshots taken at the moment a position opens.
   */
  regime_at_open_by_lane?: Record<string, string>;
  phi_at_open_by_lane?: Record<string, number>;
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
  // Phase 1 cutover-payload extensions
  harvest_kind?: string | null;
  r_score?: number | null;
  mtf_decision_action?: string | null;
  mtf_size_multiplier?: number | null;
  leverage_cap_from_regime?: number | null;
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

// ─────────────────────────────────────────────────────────────────
// Trading decision endpoints (separate from the kernel tick):
//   POST /risk/evaluate         — pre-trade blast-door gates
//   POST /live/decide           — signal threshold + sizing + ATR
//   POST /live/exit-decide      — stop-loss/take-profit/trailing
//   POST /live/reconcile        — DB-vs-exchange symbol diff

// ── /risk/evaluate ───────────────────────────────────────────────

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

// ── /live/decide ─────────────────────────────────────────────────

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
