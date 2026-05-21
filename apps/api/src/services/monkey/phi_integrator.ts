/**
 * phi_integrator.ts — canonical motion-integrated Φ (B3).
 *
 * polytrade's legacy `phi = 1 − 0.8·normalizedEntropy(basin)` is not
 * canonical: it conflates Φ with f_health (the entropy ratio). On a
 * basin that wanders without concentrating it flatlines — production
 * Φ sat at 0.213–0.218 (3rd-decimal motion only). Canon keeps Φ and
 * f_health DISTINCT metrics.
 *
 * Canonical runtime Φ (QIG_QFI/vex/kernel/consciousness/loop.py) is a
 * STATE VARIABLE integrated from basin MOTION:
 *   active → Φ += total_distance · PHI_DISTANCE_GAIN
 *   idle   → Φ += (PHI_IDLE_EQUILIBRIUM − Φ) · PHI_IDLE_RATE
 * vex alternates discrete active/idle phases. Monkey ticks continuously
 * (no idle phase), so the faithful continuous-time port merges both
 * into one per-tick leaky integrator:
 *
 *   Φ ← clamp( Φ + bv·GAIN − (Φ − EQUILIBRIUM)·RATE , 0, PHI_MAX )
 *
 * `bv` (basin velocity — Fisher-Rao distance the basin moved this tick)
 * is the direct analog of vex's `total_distance`.
 *
 * Steady state: Φ_ss = EQUILIBRIUM + mean(bv)·GAIN/RATE. Φ tracks
 * recent market activity and relaxes toward EQUILIBRIUM (GRAPH band)
 * when the market is quiet.
 *
 * See docs/plans/20260521-phi-leaky-integrator.md.
 */

/** vex PHI_IDLE_EQUILIBRIUM — frozen canon. The resting Φ a quiet
 *  market relaxes toward (mid-GRAPH band). */
export const PHI_EQUILIBRIUM = 0.55;

/** vex PHI_IDLE_RATE — frozen canon. Per-tick leak rate toward
 *  equilibrium; memory half-life ≈ ln2/RATE ≈ 46 ticks. */
export const PHI_RATE = 0.015;

export const PHI_GAIN_CALIBRATION = {
  medianBv: 0.057,
  p90Bv: 0.133,
  p99Bv: 0.206,
  minP90Phi: 0.70,
  minP99Phi: 0.85,
} as const;

/** Motion gain. Observer-derived from production basin-velocity quantiles
 *  above — chosen so median bv stays in GRAPH, p90 reaches FORESIGHT, and
 *  p99 reaches LIGHTNING. Φ_ss = 0.55 + bv·GAIN/RATE. */
export const PHI_GAIN = 0.024;

/** vex Φ clamp ceiling. */
export const PHI_MAX = 0.95;

/**
 * One leaky-integrator step. Pure — no state, no config, no clock.
 *
 * @param prevPhi  Φ from the previous tick (the integrator state).
 * @param bv       basin velocity this tick (Fisher-Rao distance, ≥ 0).
 * @returns        the new Φ, clamped to [0, PHI_MAX].
 */
export function updateLeakyPhi(prevPhi: number, bv: number): number {
  const rise = Math.max(0, bv) * PHI_GAIN;
  const leak = (prevPhi - PHI_EQUILIBRIUM) * PHI_RATE;
  const next = prevPhi + rise - leak;
  return Math.max(0, Math.min(PHI_MAX, next));
}

/** Steady-state Φ for a sustained mean basin velocity (diagnostic /
 *  calibration helper). */
export function steadyStatePhi(meanBv: number): number {
  const ss = PHI_EQUILIBRIUM + (Math.max(0, meanBv) * PHI_GAIN) / PHI_RATE;
  return Math.max(0, Math.min(PHI_MAX, ss));
}

export function phiGainCalibrationBands(): {
  median: number;
  p90: number;
  p99: number;
} {
  return {
    median: steadyStatePhi(PHI_GAIN_CALIBRATION.medianBv),
    p90: steadyStatePhi(PHI_GAIN_CALIBRATION.p90Bv),
    p99: steadyStatePhi(PHI_GAIN_CALIBRATION.p99Bv),
  };
}

export function isPhiLeakyEnabled(value: string | undefined = process.env.MONKEY_PHI_LEAKY_LIVE): boolean {
  if (value === undefined) return true;
  return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}
