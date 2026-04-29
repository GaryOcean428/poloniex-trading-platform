/**
 * ml_agent/decide.ts — Agent M (the ml control arm).
 *
 * Stateless threshold-based first version. No basin, no emotions, no
 * kernel state. Pure ML signal × strength × OHLCV. The ml ensemble
 * is the learner — Agent M is the decision shell that turns its
 * scalar output into a trade.
 *
 * Why a separate agent: the kernel (Agent K) is now QIG-pure and
 * decides on its own geometry. ml's predictions used to feed the
 * kernel's decisions; that coupling made it impossible to read the
 * standalone performance of either path. Splitting them lets us run
 * both live, label trades by agent in autonomous_trades, and let the
 * arbiter allocate capital toward the winner.
 *
 * Constraints: Agent M is unconstrained — it does NOT have to use
 * Fisher-Rao math, does NOT see the basin, does NOT consult the
 * emotion stack. Fisher-Rao purity is a kernel-side requirement; M
 * is the control arm against which K is measured.
 */

import type { OHLCVCandle } from '../monkey/perception.js';

export interface AccountContextLite {
  /** Available equity in USDT (post-arbiter allocation). */
  availableEquityUsdt: number;
  /** Whether Agent M currently holds a position on this symbol. */
  heldSide: 'long' | 'short' | null;
  /** Current mark price. */
  lastPrice: number;
  /** Exchange minimum notional in USDT. */
  minNotional: number;
}

export interface MLAgentInputs {
  symbol: string;
  ohlcv: OHLCVCandle[];
  /** Raw ml-worker label. */
  mlSignal: 'BUY' | 'SELL' | 'HOLD' | string;
  /** Raw ml-worker conviction in [0, 1]. */
  mlStrength: number;
  account: AccountContextLite;
}

export type MLAgentAction = 'enter_long' | 'enter_short' | 'exit' | 'hold';

export interface MLAgentDecision {
  action: MLAgentAction;
  /** Margin to commit in USDT. 0 when action is 'hold' or 'exit'. */
  size_usdt: number;
  /** Leverage to apply. 1 when action is 'hold' or 'exit'. */
  leverage: number;
  /** Human-readable explanation; surfaces in autonomous_trades.reason. */
  reason: string;
}

/**
 * ML strength threshold below which Agent M holds. Calibrated against
 * the historical strength distribution of ml-worker — values < 0.55
 * are essentially noise-band for the current ensemble. SAFETY_BOUND;
 * tunable via env if M needs to over- or under-trade for evaluation.
 */
const ML_ENTRY_THRESHOLD = Number(process.env.ML_AGENT_ENTRY_THRESHOLD) || 0.55;

/**
 * Default leverage for Agent M entries. Conservative — M is the
 * control arm; we don't want it carrying a wider blast radius than
 * Agent K. Risk-kernel still vetoes anything dangerous.
 */
const ML_DEFAULT_LEVERAGE = Number(process.env.ML_AGENT_DEFAULT_LEVERAGE) || 8;

/**
 * Default size as fraction of available equity. M sizes flatly —
 * no Φ-modulation, no emotion-amplification. This is intentional:
 * M is the simple control arm. Risk-kernel min-notional lift still
 * applies on top of this.
 */
const ML_DEFAULT_SIZE_FRACTION = Number(process.env.ML_AGENT_SIZE_FRACTION) || 0.5;

export function mlAgentDecide(inputs: MLAgentInputs): MLAgentDecision {
  const sig = String(inputs.mlSignal || '').toUpperCase();
  const strength = Number.isFinite(inputs.mlStrength) ? inputs.mlStrength : 0;
  const equity = inputs.account.availableEquityUsdt;
  const minNotional = inputs.account.minNotional;

  // Exit gate: when held, exit on opposite signal at threshold strength
  // OR on HOLD signal. M doesn't trail-stop or harvest — it just acts
  // on the latest model conviction. The kernel handles the geometric
  // exits; M handles the model-confidence exits.
  if (inputs.account.heldSide !== null) {
    if (sig === 'HOLD') {
      return {
        action: 'exit',
        size_usdt: 0,
        leverage: 1,
        reason: `ml HOLD while ${inputs.account.heldSide} held — exit`,
      };
    }
    const heldSide = inputs.account.heldSide;
    const sigSide: 'long' | 'short' | null =
      sig === 'BUY' ? 'long' : sig === 'SELL' ? 'short' : null;
    if (sigSide && sigSide !== heldSide && strength >= ML_ENTRY_THRESHOLD) {
      return {
        action: 'exit',
        size_usdt: 0,
        leverage: 1,
        reason: `ml ${sig}@${strength.toFixed(3)} reverses ${heldSide} — exit`,
      };
    }
    // Else hold the existing position
    return {
      action: 'hold',
      size_usdt: 0,
      leverage: 1,
      reason: `ml ${sig}@${strength.toFixed(3)} agrees with ${heldSide} — hold`,
    };
  }

  // Flat — entry decision
  if (strength < ML_ENTRY_THRESHOLD) {
    return {
      action: 'hold',
      size_usdt: 0,
      leverage: 1,
      reason: `ml strength ${strength.toFixed(3)} < threshold ${ML_ENTRY_THRESHOLD.toFixed(2)}`,
    };
  }
  if (sig === 'HOLD' || (sig !== 'BUY' && sig !== 'SELL')) {
    return {
      action: 'hold',
      size_usdt: 0,
      leverage: 1,
      reason: `ml signal ${sig} — no directional intent`,
    };
  }
  if (equity <= 0) {
    return {
      action: 'hold',
      size_usdt: 0,
      leverage: 1,
      reason: `available equity ${equity.toFixed(2)} <= 0`,
    };
  }

  const leverage = ML_DEFAULT_LEVERAGE;
  let margin = equity * ML_DEFAULT_SIZE_FRACTION;
  // Lift-to-min: if the flat fraction can't clear the exchange min
  // notional, raise to a fraction that just clears (capped at 100 %
  // of equity). M doesn't have a max-fraction safety bound of its
  // own — the risk kernel applies the platform-wide cap.
  if (margin * leverage < minNotional && equity > 0 && leverage > 0) {
    const required = minNotional / leverage;
    margin = Math.min(equity, required * 1.05);
  }
  if (margin * leverage < minNotional) {
    return {
      action: 'hold',
      size_usdt: 0,
      leverage: 1,
      reason: `equity ${equity.toFixed(2)} cannot clear min notional ${minNotional.toFixed(2)} at ${leverage}x`,
    };
  }

  const action: MLAgentAction = sig === 'BUY' ? 'enter_long' : 'enter_short';
  return {
    action,
    size_usdt: margin,
    leverage,
    reason: `ml ${sig}@${strength.toFixed(3)} >= ${ML_ENTRY_THRESHOLD.toFixed(2)}; ` +
            `margin=${margin.toFixed(2)} lev=${leverage}x notional=${(margin * leverage).toFixed(2)}`,
  };
}

export const ML_AGENT_CONSTANTS = {
  ML_ENTRY_THRESHOLD,
  ML_DEFAULT_LEVERAGE,
  ML_DEFAULT_SIZE_FRACTION,
};
