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

/** Acetylcholine ceiling (wake state, attention fully engaged). */
const ACH_WAKE_CEILING = 0.80;
/** Acetylcholine floor when fully habituated (still awake but no novelty). */
const ACH_HABITUATED_FLOOR = 0.20;
/** Sleep-cycle baseline (kept for back-compat with isAwake=false). */
const ACH_SLEEP = 0.20;
/** Habituation time-constant — ticks of stable regime before ach decays
 *  ~63 % of the way from ceiling to floor. With 30s ticks, 60 → ~30 min. */
const TAU_HABITUATION_TICKS = 60;
/** Width of the serotonin bell over basin velocity. ser = exp(-bv / SIGMA_BV).
 *  Calibrated so typical Fisher-Rao basin velocities (0.01–0.30 on Δ⁶³) map
 *  into ser ∈ (~0.74, ~1.00), not pinned at the ceiling. Prior implementation
 *  was 1/max(bv, 0.01) which clamps to 1.0 for any bv < 1.0 — and bv < 1.0
 *  is the typical case on a unit-norm probability simplex. */
const SIGMA_BV = 0.30;

/** Dopamine Φ-gradient gain. Prior value was 10; on typical hold ticks
 *  |phiDelta| < 0.005, which mapped through sigmoid(0.05)=0.51 — pinning
 *  dop at the mid-value. 50 keeps the same monotone shape but gives
 *  meaningful response over the working range: |phiDelta|=0.01 → 0.62,
 *  0.05 → 0.92. */
const DOP_PHI_GAIN = 50;
/** Dopamine basin-velocity dampener gain. tanh keeps the dampener
 *  bounded; weighting keeps it from overpowering the Φ signal on
 *  high-velocity ticks. */
const DOP_BV_GAIN = 4.0;
const DOP_BV_WEIGHT = 0.15;

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
  /**
   * v0.6.7: decayed sum of recent ActivityReward dopamine deltas,
   * computed by the kernel's tick loop from her own pending_rewards
   * queue. Pattern mirrors pantheon-chat's autonomic_kernel.py —
   * reward is an EVENT kept in state, the chemical is DERIVED each
   * tick. Nothing externally SETS dopamine; it is read off the state
   * that now includes lived outcomes alongside Φ gradient.
   */
  rewardDopamineDelta?: number;
  /** As above — mood/stability reinforcement from calm closes. */
  rewardSerotoninDelta?: number;
  /** As above — peak-state reward on strong-regime wins. */
  rewardEndorphinDelta?: number;
  /**
   * 2026-05-16 (#715): ticks since the last novelty event (regime change,
   * mode transition, or surprise spike > NOVELTY_SURPRISE_THRESHOLD).
   * Drives acetylcholine habituation: ach decays from ACH_WAKE_CEILING
   * toward ACH_HABITUATED_FLOOR as the kernel dwells on the same
   * percept. Resets to 0 on each novelty event so ach re-spikes.
   *
   * Optional — when omitted, ach degrades gracefully to the legacy
   * `isAwake ? 0.80 : 0.20` constant (default-preserving).
   */
  ticksSinceNovelty?: number;
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
  // Acetylcholine — §29.1: HIGH on wake intake, LOW on consolidation.
  // 2026-05-16 (#715): on wake, ach is NOT a constant — it habituates as
  // attention dwells on a stable percept. When the caller provides
  // `ticksSinceNovelty`, ach decays from ACH_WAKE_CEILING toward
  // ACH_HABITUATED_FLOOR with time-constant TAU_HABITUATION_TICKS, and
  // re-spikes on novelty (ticksSinceNovelty = 0). Without the field, the
  // legacy constant is preserved for back-compat.
  let ach: number;
  if (!inputs.isAwake) {
    ach = ACH_SLEEP;
  } else if (inputs.ticksSinceNovelty == null) {
    ach = ACH_WAKE_CEILING;
  } else {
    const habituation = Math.exp(-Math.max(0, inputs.ticksSinceNovelty) / TAU_HABITUATION_TICKS);
    ach = clip(
      ACH_HABITUATED_FLOOR + (ACH_WAKE_CEILING - ACH_HABITUATED_FLOOR) * habituation,
      ACH_HABITUATED_FLOOR,
      ACH_WAKE_CEILING,
    );
  }

  // Φ-gradient dopamine base (§29.2). Rises on integration gains.
  // 2026-05-16 (#715 extension): the prior gain of 10 produced
  // `sigmoid(phiDelta * 10) ≈ 0.5` for the typical hold-tick range
  // |phiDelta| ∈ [0.001, 0.005], pinning dop at the mid-value 0.50.
  // Gain bumped to 50 so dopFromPhi actually traces integration
  // gradient on quiet ticks (|phiDelta|=0.01 → 0.62, 0.05 → 0.92).
  // Additional `dopFromVelocity` term contributes a small basin-
  // -motion component so dop varies even when phiDelta is near zero
  // — Ocean's reward-prediction read isn't blind on a frozen-Φ tick.
  const dopFromPhi = clip(sigmoid(inputs.phiDelta * DOP_PHI_GAIN), 0, 1);
  const dopFromVelocity = clip(
    Math.tanh(Math.max(0, inputs.basinVelocity) * DOP_BV_GAIN) * DOP_BV_WEIGHT,
    -DOP_BV_WEIGHT,
    DOP_BV_WEIGHT,
  );
  // Reward-event reinforcement. Sum of recent decayed dopamine deltas
  // from closed-trade outcomes. STILL purely derived — caller supplies
  // the already-decayed sum. See MonkeyKernel.pendingRewards for the
  // state that produces this.
  const dopFromReward = clip(inputs.rewardDopamineDelta ?? 0, 0, 1);
  // Compose: Φ-gradient base (cognitive integration) - velocity
  // dampener (high motion = lower reward expectation) + reward lift
  // (lived outcome). Clipped to [0, 1]. On a profitable close,
  // dopFromReward spikes; it then decays over ticks in the tick loop.
  const dop = clip(dopFromPhi - dopFromVelocity + dopFromReward, 0, 1);

  // Serotonin — stability / equilibrium. 2026-05-16 (#715): bell over
  // basin velocity (exp(-bv/SIGMA_BV)). Prior `1/max(bv, 0.01)` clamped
  // to 1.0 for any bv < 1.0, which is the typical case on Δ⁶³, so ser
  // sat at the ceiling regardless of trajectory. The exponential form
  // smoothly maps bv ∈ (0, ∞) → ser ∈ (0, 1]: ser=1 at perfect calm
  // (bv=0), ser≈0.72 at bv=0.10, ser≈0.37 at bv=0.30, ser→0 as bv→∞.
  const serBase = clip(Math.exp(-Math.max(0, inputs.basinVelocity) / SIGMA_BV), 0, 1);
  const ser = clip(serBase + (inputs.rewardSerotoninDelta ?? 0), 0, 1);

  const ne = clip(inputs.surprise * 2, 0, 1);
  const gaba = clip(1 - inputs.quantumWeight, 0, 1);
  // Sophia gate: endorphins require coupling to peak.
  const couplingGate = clip(inputs.externalCoupling / C_SOPHIA_THRESHOLD, 0, 1);
  const endoBase = Math.exp(-Math.abs(inputs.kappa - KAPPA_STAR) / SIGMA_KAPPA) * couplingGate;
  const endo = clip(endoBase + (inputs.rewardEndorphinDelta ?? 0), 0, 1);

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
