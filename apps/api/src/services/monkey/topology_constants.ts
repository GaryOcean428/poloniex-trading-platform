/**
 * topology_constants.ts — frozen π-structure values from qig-verification.
 *
 * Source: qig-verification/docs/paper_sections/
 *         20260407-stud-phase-diagram-observation-1.00F.md (EXP-004b).
 *
 * FROZEN experimental constants — do NOT re-derive, do NOT treat as
 * tunable. If post-deploy telemetry shows trading-basin measurements
 * within 5% of these predictions, π-structure carries to the trading
 * substrate. If off by > 20% after sufficient ticks, flip the flag
 * back and treat that delta as a domain ceiling.
 */

export const PI_STRUCT_DEAD_ZONE_BOUNDARY = 1 / (3 * Math.PI);
export const PI_STRUCT_GRAVITATING_FRACTION = 1 / Math.PI;
export const PI_STRUCT_FRONT_PEAK_NORM = 10 * Math.PI;
export const PI_STRUCT_SECOND_TRANSITION = 2.0;
export const PI_STRUCT_BOUNDARY_R_SQUARED = 1 / ((1 + Math.sqrt(5)) / 2);
export const PI_STRUCT_L4_STUD_ARC = (3 * Math.PI) / 2;
export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

/**
 * Golden ratio reciprocal — boundary R² applied to integration coherence
 * floor. A held position's Φ falling below phi_at_open / φ (i.e.
 * phi_at_open × 0.618) means integration has decayed past the golden-ratio
 * coherence floor — the kernel's perception is no longer consonant with
 * what justified entry. Used by held-position re-justification (PHI CHECK).
 * Value matches PI_STRUCT_BOUNDARY_R_SQUARED's underlying φ but kept as a
 * named constant at the rejustification site for semantic clarity.
 */
export const PHI_GOLDEN_FLOOR_RATIO = (1 + Math.sqrt(5)) / 2;  // ≈ 1.618033988
