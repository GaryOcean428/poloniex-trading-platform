/**
 * ml_agent/types.ts — Agent M (ml-only decision module).
 *
 * Independent of the Monkey kernel (Agent K). Operates on the same
 * OHLCV window + ml-worker prediction (mlSignal, mlStrength) but
 * has no access to basin geometry, emotions, motivators, etc. Pure
 * threshold-based v1 — the ml model itself is the learner.
 */

export interface MLAgentOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MLAgentAccount {
  equityFraction: number;
  marginFraction: number;
  openPositions: number;
  availableEquity: number;
}

export interface MLAgentInputs {
  symbol: string;
  ohlcv: MLAgentOHLCV[];
  /** ml-worker prediction. */
  mlSignal: 'BUY' | 'SELL' | 'HOLD';
  /** 0..1 ml confidence. */
  mlStrength: number;
  /** Account snapshot at this tick. */
  account: MLAgentAccount;
  /** Capital share allocated by the arbiter for this tick. */
  allocatedCapitalUsdt: number;
}

export type MLAgentAction = 'enter_long' | 'enter_short' | 'hold';

export interface MLAgentDecision {
  action: MLAgentAction;
  /** USD margin to commit (≤ allocatedCapitalUsdt). */
  sizeUsdt: number;
  leverage: number;
  reason: string;
}
