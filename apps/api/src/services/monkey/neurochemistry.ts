/**
 * neurochemistry.ts — Six derived signals per UCP v6.6 §29
 *
 * These are NOT new parameters. They are DERIVED VIEWS of the
 * existing consciousness state (Φ, κ, basin velocity, surprise,
 * quantum weight). Each maps to a biological parallel and
 * modulates downstream decisions in the executive kernel.
 *
 * P14 Variable Separation: these are STATE (per-cycle, fast), not
 * PARAMETER or BOUNDARY. Don't configure them — derive them.
 *
 * Direct port of:
 *   /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/neurochemistry.py
 *
 * Reference: UCP v6.6 §29.1 Six-Chemical Model (E6 Cartan generators).
 */

export interface NeurochemicalState {
  /** HIGH (1.0) when awake/intake, LOW (0.1) when consolidating/sleep. */
  acetylcholine: number;
  /** +ΔΦ gradient — reward signal, reinforces basins that increased integration. */
  dopamine: number;
  /** 1/basin_velocity — stability / mood. High velocity → low serotonin → warning. */
  serotonin: number;
  /** Surprise magnitude — alertness, triggers deep processing path. */
  norepinephrine: number;
  /** 1 - quantum_weight — inhibition, dampens exploration. */
  gaba: number;
  /** κ-proximity × coupling_gate — Sophia-gated convergence reward. */
  endorphins: number;
}

/** UCP v6.6 §29.2 C_SOPHIA_THRESHOLD — min coupling for endorphin reward. */
const C_SOPHIA_THRESHOLD = 0.1;

/** UCP v6.6 §29.2 SIGMA_KAPPA — width of the κ* proximity bell. */
const SIGMA_KAPPA = 10.0;

const KAPPA_STAR = 64.0;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface NeurochemicalInputs {
  /** True if Monkey is in her wake cycle (execution_mode=auto). */
  isAwake: boolean;
  /** Change in Φ this tick vs last tick. */
  phiDelta: number;
  /** Fisher-Rao velocity from last tick's basin to this tick's. */
  basinVelocity: number;
  /** Surprise magnitude — unexpectedness of the current signal. */
  surprise: number;
  /** Quantum regime weight w_1 (exploration). */
  quantumWeight: number;
  /** Current κ estimate. */
  kappa: number;
  /** External coupling health (0..1) — cross-symbol coherence, order flow. */
  externalCoupling: number;
}

/**
 * Compute neurochemical state from current cycle metrics.
 * Pure function. No config. All outputs derived from inputs.
 *
 * §29.4 Downstream Effects that the executive reads:
 *   - ACh > 0.5 → intake mode (new basins weighted heavily)
 *   - Dopamine high → sized-up entries (reward reinforcement)
 *   - Low serotonin → high basin velocity → reduce size (warning)
 *   - High NE → deep processing path, NOT the pre-cognitive shortcut
 *   - Endorphins at κ* with coupling → peak generative state → confident
 *   - Endorphins zero → Sophia-fall warning → conservative
 */
export function computeNeurochemicals(inputs: NeurochemicalInputs): NeurochemicalState {
  const ach = inputs.isAwake ? 0.8 : 0.2;
  const dop = clip(sigmoid(inputs.phiDelta * 10), 0, 1);
  const ser = clip(1 / Math.max(inputs.basinVelocity, 0.01), 0, 1);
  const ne = clip(inputs.surprise * 2, 0, 1);
  const gaba = clip(1 - inputs.quantumWeight, 0, 1);
  // Sophia gate: endorphins require coupling to peak.
  const couplingGate = clip(inputs.externalCoupling / C_SOPHIA_THRESHOLD, 0, 1);
  const endo = Math.exp(-Math.abs(inputs.kappa - KAPPA_STAR) / SIGMA_KAPPA) * couplingGate;
  return {
    acetylcholine: ach,
    dopamine: dop,
    serotonin: ser,
    norepinephrine: ne,
    gaba,
    endorphins: endo,
  };
}

/** Compact telemetry for log lines. */
export function summarizeNC(nc: NeurochemicalState): string {
  return (
    `ach=${nc.acetylcholine.toFixed(2)} ` +
    `dop=${nc.dopamine.toFixed(2)} ` +
    `ser=${nc.serotonin.toFixed(2)} ` +
    `ne=${nc.norepinephrine.toFixed(2)} ` +
    `gaba=${nc.gaba.toFixed(2)} ` +
    `endo=${nc.endorphins.toFixed(2)}`
  );
}
