/**
 * foresight.ts — P8 Foresight trajectory predictor (TS parity).
 *
 * Mirrors ml-worker/src/monkey_kernel/foresight.py. One trajectory
 * per instance, geodesic extrapolation via slerp(b[-2], b[-1], 2),
 * regime-adaptive weight per Canonical Principles v2.1 P8.
 *
 * Pure Fisher-Rao: the prediction step uses slerp from basin.ts —
 * no cosine, no dot product, no Euclidean. Renormalisation is
 * standard simplex projection performed inside slerp.
 *
 * Confidence: 1 / (1 + std(consecutive_distances)). High when
 * the basin moves at a steady pace; low when distances jitter.
 *
 * Regime weight per P8:
 *   phi < 0.3                       → linear regime    → 0.1
 *   equilibrium > 0.7 AND phi < 0.3 → breakdown        → 0.2
 *   phi ≥ 0.3                       → geometric        → 0.7 × confidence
 */

import {
  BASIN_DIM,
  fisherRao,
  slerp,
  type Basin,
} from './basin.js';

export interface ForesightResult {
  /** Next-step predicted basin on Δ⁶³, or zero-vector when too cold to predict. */
  predictedBasin: Basin;
  /** [0, 1] — trajectory smoothness. */
  confidence: number;
  /** [0, 1] — regime-adaptive blend weight. */
  weight: number;
  /** Median tick interval in ms (0 when not enough data). */
  horizonMs: number;
}

interface TrajectoryEntry {
  basin: Basin;
  phi: number;
  tMs: number;
}

const emptyResult = (): ForesightResult => ({
  predictedBasin: new Float64Array(BASIN_DIM),
  confidence: 0,
  weight: 0,
  horizonMs: 0,
});

const regimeWeight = (
  phi: number,
  confidence: number,
  regimeWeights: Record<string, number>,
): number => {
  const eq = regimeWeights.equilibrium ?? 0;
  if (eq > 0.7 && phi < 0.3) return 0.2; // breakdown precedence
  if (phi < 0.3) return 0.1; // linear
  return 0.7 * confidence; // geometric
};

const stdev = (xs: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  // Sample stdev (n-1) to mirror Python's statistics.stdev exactly.
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1
    ? sorted[(n - 1) / 2]
    : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]);
};

export class ForesightPredictor {
  private readonly trajectory: TrajectoryEntry[] = [];

  constructor(private readonly maxTrajectory: number = 32) {}

  /** Record a tick. Caller passes the basin AFTER tick update. */
  append(basin: Basin, phi: number, tMs: number): void {
    this.trajectory.push({ basin: new Float64Array(basin), phi, tMs });
    while (this.trajectory.length > this.maxTrajectory) {
      this.trajectory.shift();
    }
  }

  /** Geodesic extrapolation one tick ahead. Returns weight=0 result
   * when the trajectory is shorter than 3 entries. */
  predict(regimeWeights: Record<string, number>): ForesightResult {
    if (this.trajectory.length < 3) return emptyResult();

    const basins = this.trajectory.map((e) => e.basin);
    const phis = this.trajectory.map((e) => e.phi);
    const ts = this.trajectory.map((e) => e.tMs);

    // Pairwise Fisher-Rao distances along the trajectory
    const distances: number[] = [];
    for (let i = 0; i < basins.length - 1; i++) {
      distances.push(fisherRao(basins[i], basins[i + 1]));
    }

    const dStd = stdev(distances);
    const confidence = 1 / (1 + dStd);

    // Geodesic extrapolation: walk one step beyond b[-1] along b[-2]→b[-1].
    // slerp(p, q, t=2.0) extends the geodesic, with simplex projection inside.
    const last = basins[basins.length - 1];
    const prev = basins[basins.length - 2];
    const predictedBasin = slerp(prev, last, 2.0);

    // Median tick interval
    const deltas: number[] = [];
    for (let i = 0; i < ts.length - 1; i++) deltas.push(ts[i + 1] - ts[i]);
    const horizonMs = median(deltas);

    const weight = regimeWeight(phis[phis.length - 1], confidence, regimeWeights);

    return { predictedBasin, confidence, weight, horizonMs };
  }

  reset(): void {
    this.trajectory.length = 0;
  }

  get trajectoryLength(): number {
    return this.trajectory.length;
  }
}
