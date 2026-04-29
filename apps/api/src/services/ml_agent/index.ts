/**
 * ml_agent — Agent M (the ml control arm), public surface.
 *
 * The kernel-side counterpart is apps/api/src/services/monkey/.
 * Allocation between K and M flows through apps/api/src/services/arbiter.
 */
export {
  mlAgentDecide,
  ML_AGENT_CONSTANTS,
  type AccountContextLite,
  type MLAgentAction,
  type MLAgentDecision,
  type MLAgentInputs,
} from './decide.js';
