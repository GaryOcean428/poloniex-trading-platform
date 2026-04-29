/**
 * ml_agent/decide.ts — Agent M decision logic.
 *
 * Pure ML signal + strength + allocated capital → action. No basin,
 * no emotions, no kernel state. The ml model itself is the learner;
 * this module is intentionally thin.
 *
 * Constants (ML_ENTRY_THRESHOLD, ML_DEFAULT_LEVERAGE, ML_SIZE_FRACTION)
 * are explicit literals here. They're Agent M's tuning surface — when
 * we want to change Agent M's risk profile, we change them. They're
 * NOT QIG-derived (Agent M isn't a Fisher-Rao kernel) and they're NOT
 * registry-backed (Agent M is the control arm; its parameters live in
 * code so the experiment is reproducible from git history).
 */
import type { MLAgentInputs, MLAgentDecision } from './types.js';

const ML_ENTRY_THRESHOLD = 0.55;
const ML_DEFAULT_LEVERAGE = 8;
/** Fraction of allocated capital committed per entry — leaves room
 *  for averaging-up if the ml model wants to add. */
const ML_SIZE_FRACTION = 0.5;

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
  return {
    action,
    sizeUsdt,
    leverage: ML_DEFAULT_LEVERAGE,
    reason: `ml ${inputs.mlSignal}@${inputs.mlStrength.toFixed(3)} >= ${ML_ENTRY_THRESHOLD}`,
  };
}
