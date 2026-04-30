/**
 * ml_agent/decide.ts — Agent M decision logic.
 *
 * Pure ML signal + strength + allocated capital → action. No basin,
 * no emotions, no kernel state. The ml model itself is the learner;
 * this module is intentionally thin.
 *
 * Constants (ML_ENTRY_THRESHOLD, ML_LEV_BASE, ML_LEV_MAX, ML_SIZE_FRACTION)
 * are explicit literals here. They're Agent M's tuning surface — when
 * we want to change Agent M's risk profile, we change them. They're
 * NOT QIG-derived (Agent M isn't a Fisher-Rao kernel) and they're NOT
 * registry-backed (Agent M is the control arm; its parameters live in
 * code so the experiment is reproducible from git history).
 *
 * Proposal #8 — leverage now scales linearly with ml_strength above
 * threshold, instead of being clamped to a flat ML_DEFAULT_LEVERAGE
 * = 8. M is the unconstrained control arm; let it use its own
 * confidence dynamically. At the entry threshold (0.55) leverage is
 * ML_LEV_BASE = 8 (preserves prior behavior for marginal-confidence
 * signals); at perfect confidence (1.0) leverage caps at ML_LEV_MAX
 * = 20 (half of LIVE_LEVERAGE = 40, so M can never exceed half of
 * the absolute leverage ceiling regardless of how confident the model
 * gets — guards against blow-up on a single overconfident signal).
 */
import type { MLAgentInputs, MLAgentDecision } from './types.js';

const ML_ENTRY_THRESHOLD = 0.55;
/** Leverage at the entry threshold. Same as the v0.8.7c constant
 *  ML_DEFAULT_LEVERAGE that this superseded — preserves backward-compat
 *  on marginal signals. */
const ML_LEV_BASE = 8;
/** Leverage ceiling. ``LIVE_LEVERAGE`` (the absolute exchange max)
 *  is 40; M is constrained to half of that so a single overconfident
 *  ml prediction can't single-handedly blow up the account. */
const ML_LEV_MAX = 20;
/** Fraction of allocated capital committed per entry — leaves room
 *  for averaging-up if the ml model wants to add. */
const ML_SIZE_FRACTION = 0.5;

/**
 * Map an ``mlStrength`` value (assumed >= ``ML_ENTRY_THRESHOLD``) to
 * a leverage in ``[ML_LEV_BASE, ML_LEV_MAX]``. Linear in strength
 * excess over the threshold. Pure function — no I/O, no globals,
 * trivially testable.
 *
 * Below threshold the function still returns a defined value
 * (``ML_LEV_BASE``) so callers can use it without first having to
 * gate on threshold; in practice ``mlAgentDecide`` returns 'hold'
 * before any leverage computation when below threshold.
 */
export function mlLeverageForStrength(mlStrength: number): number {
  const excess = Math.max(0, mlStrength - ML_ENTRY_THRESHOLD);
  // Range: threshold (0.55) -> 1.0, excess in [0, 0.45]. Slope chosen
  // so excess=0.45 maps to (LEV_MAX - LEV_BASE) = 12.
  const range = 1.0 - ML_ENTRY_THRESHOLD; // 0.45
  const span = ML_LEV_MAX - ML_LEV_BASE; // 12
  const lev = ML_LEV_BASE + span * (excess / range);
  // Clamp on both ends. ``Math.round`` keeps integer leverage so
  // exchange-side margin math is stable.
  return Math.max(ML_LEV_BASE, Math.min(ML_LEV_MAX, Math.round(lev)));
}

export function mlAgentDecide(inputs: MLAgentInputs): MLAgentDecision {
  if (inputs.mlSignal === 'HOLD') {
    return { action: 'hold', sizeUsdt: 0, leverage: 1, reason: 'ml signal HOLD' };
  }
  if (inputs.mlStrength < ML_ENTRY_THRESHOLD) {
    return {
      action: 'hold',
      sizeUsdt: 0,
      leverage: 1,
      reason: `ml strength ${inputs.mlStrength.toFixed(3)} < threshold ${ML_ENTRY_THRESHOLD}`,
    };
  }
  if (inputs.allocatedCapitalUsdt <= 0) {
    return {
      action: 'hold',
      sizeUsdt: 0,
      leverage: 1,
      reason: 'arbiter allocated 0 capital',
    };
  }
  const action: MLAgentDecision['action'] =
    inputs.mlSignal === 'BUY' ? 'enter_long' : 'enter_short';
  const sizeUsdt = Math.min(
    inputs.allocatedCapitalUsdt,
    inputs.allocatedCapitalUsdt * ML_SIZE_FRACTION,
  );
  const leverage = mlLeverageForStrength(inputs.mlStrength);
  return {
    action,
    sizeUsdt,
    leverage,
    reason: `ml ${inputs.mlSignal}@${inputs.mlStrength.toFixed(3)} >= ${ML_ENTRY_THRESHOLD} lev=${leverage}x`,
  };
}
