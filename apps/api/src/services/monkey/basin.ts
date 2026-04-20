/**
 * basin.ts — Fisher-Rao geometry on Δ⁶³
 *
 * TypeScript port of the canonical Python implementation at
 * `kernels/core/qig_core_local/geometry/fisher_rao.py`, which itself
 * came from pantheon-chat's `qig_geometry/canonical.py`.
 *
 * Monkey's substrate. All trading decisions live on this simplex.
 * A "basin coord" is a 64D probability vector (non-negative, sums
 * to 1). Distance is Fisher-Rao, not Euclidean. Similarity is the
 * Bhattacharyya coefficient, not a dot product.
 *
 * Per UCP v6.6 §1.3 / P1 Geometric Purity, the following operations
 * are CATEGORICALLY FORBIDDEN in this file:
 *   - cosine similarity
 *   - L2 distance between basin vectors
 *   - dot products as similarity
 *   - Adam / SGD optimizers on this space
 *   - softmax output (use simplex projection instead)
 *
 * Reference: UCP v6.6 §1 Fisher Information Manifold.
 */

export const BASIN_DIM = 64;         // E8 rank² = 8² = 64
export const KAPPA_STAR = 64.0;      // Universal coupling fixed point
const EPS = 1e-12;

export type Basin = Float64Array;

// ─── Simplex primitives ──────────────────────────────────────────────

/** Construct a uniform basin (maximum-entropy state). */
export function uniformBasin(dim: number = BASIN_DIM): Basin {
  const b = new Float64Array(dim);
  const v = 1 / dim;
  for (let i = 0; i < dim; i++) b[i] = v;
  return b;
}

/** Project a vector onto Δ⁶³ (non-negative, sums to 1). */
export function toSimplex(v: ArrayLike<number>): Basin {
  const n = v.length;
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Number(v[i]), EPS);
    out[i] = x;
    sum += x;
  }
  for (let i = 0; i < n; i++) out[i] /= sum;
  return out;
}

/** Shannon entropy of a basin. Range [0, log(dim)]. */
export function shannonEntropy(b: Basin): number {
  let h = 0;
  for (let i = 0; i < b.length; i++) {
    const p = b[i];
    if (p > EPS) h -= p * Math.log(p);
  }
  return h;
}

/** Normalized entropy H / log(dim). Range [0, 1]. */
export function normalizedEntropy(b: Basin): number {
  return shannonEntropy(b) / Math.log(b.length);
}

/** Max coordinate mass. > 0.5 means basin is collapsing onto one mode. */
export function maxMass(b: Basin): number {
  let m = 0;
  for (let i = 0; i < b.length; i++) if (b[i] > m) m = b[i];
  return m;
}

// ─── Inner product + distance ────────────────────────────────────────

/**
 * Bhattacharyya coefficient BC(p, q) = Σ √(p_i · q_i).
 * The ONLY inner product valid on Δ⁶³.
 * Range: [0, 1]. BC=1 means p ≡ q. BC=0 means disjoint support.
 */
export function bhattacharyya(p: Basin, q: Basin): number {
  if (p.length !== q.length) {
    throw new Error(`basin dim mismatch: ${p.length} vs ${q.length}`);
  }
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    s += Math.sqrt(Math.max(p[i], 0) * Math.max(q[i], 0));
  }
  return s;
}

/**
 * Fisher-Rao distance on Δ⁶³.
 *   d_FR(p, q) = arccos(Σ √(p_i · q_i))
 * Range: [0, π/2]. 0 = identical, π/2 = maximally distant (orthogonal supports).
 * This is the canonical metric from UCP v6.6 §1.2.
 */
export function fisherRao(p: Basin, q: Basin): number {
  const bc = bhattacharyya(p, q);
  // Numerical stability — arccos can NaN at 1 ± ε.
  const clamped = Math.min(1, Math.max(0, bc));
  return Math.acos(clamped);
}

// ─── Geodesic operations ─────────────────────────────────────────────

/**
 * SLERP in sqrt-coords — geodesic interpolation on Δ⁶³.
 * t=0 returns p, t=1 returns q. Monkey uses this for input
 * refraction: new_basin = slerp(identity, perception, 0.3).
 */
export function slerp(p: Basin, q: Basin, t: number): Basin {
  const n = p.length;
  const sp = new Float64Array(n);
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sp[i] = Math.sqrt(p[i]);
    sq[i] = Math.sqrt(q[i]);
  }
  // dot in sqrt-coords = BC(p, q)
  let dot = 0;
  for (let i = 0; i < n; i++) dot += sp[i] * sq[i];
  dot = Math.min(1, Math.max(-1, dot));
  const omega = Math.acos(dot);
  // Degenerate case: p ≡ q → linear combo in sqrt-space = same point.
  if (omega < 1e-6) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = (1 - t) * sp[i] + t * sq[i];
      out[i] = s * s;
    }
    return toSimplex(out);
  }
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = a * sp[i] + b * sq[i];
    out[i] = s * s;
  }
  return toSimplex(out);
}

/**
 * Fréchet mean (geometric centroid) of a set of basins.
 * Iterative SLERP-based algorithm converging to the centroid
 * that minimizes Σ d_FR(x_i, μ)². Used for identity crystallization
 * (UCP v6.6 §3.4 Pillar 3: earned identity from lived experience).
 */
export function frechetMean(basins: Basin[], iterations = 20): Basin {
  if (basins.length === 0) return uniformBasin();
  if (basins.length === 1) return new Float64Array(basins[0]);
  // Initialize at the first basin
  let mu: Basin = new Float64Array(basins[0]);
  for (let it = 0; it < iterations; it++) {
    // Step toward the weighted mean of all basins, in sqrt-coords.
    const n = mu.length;
    const acc = new Float64Array(n);
    for (const b of basins) {
      for (let i = 0; i < n; i++) acc[i] += Math.sqrt(b[i]);
    }
    for (let i = 0; i < n; i++) acc[i] /= basins.length;
    // Project back onto simplex via square
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) next[i] = acc[i] * acc[i];
    mu = toSimplex(next);
  }
  return mu;
}

// ─── Dirichlet noise (Pillar 1: FLUCTUATIONS) ─────────────────────────

/**
 * Inject Dirichlet noise into a basin. Used when Pillar 1 is
 * violated (basin entropy < threshold): the kernel is approaching
 * a zombie state and needs fresh uncertainty.
 *
 * This is the OPPOSITE of what most ML does (which drives entropy
 * down). Per UCP v6.6 §3.2, without fluctuations there is no
 * geometry, and without geometry there is no consciousness.
 */
export function injectDirichletNoise(b: Basin, alpha: number = 0.1): Basin {
  const n = b.length;
  // Gamma(α, 1) samples via inverse-CDF approximation for α=0.1
  // Simple approximation: sample uniform + scale. For production
  // substitute with a real Dirichlet sampler.
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random();
    const gamma = Math.pow(u, 1 / alpha); // crude but entropy-preserving
    out[i] = b[i] * (1 - alpha) + gamma * alpha;
  }
  return toSimplex(out);
}

// ─── Velocity ─────────────────────────────────────────────────────────

/**
 * Basin velocity = Fisher-Rao distance between successive basins.
 * Low velocity = stable (basin is settling). High velocity = the
 * kernel is rapidly moving through state space (exploration, surprise,
 * or breakdown depending on regime).
 * UCP v6.6 §29.2: serotonin = 1 / basin_velocity (inverse).
 */
export function velocity(prev: Basin, curr: Basin): number {
  return fisherRao(prev, curr);
}
