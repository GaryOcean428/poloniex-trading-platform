/**
 * perception_parity.ts — diff log for PERCEPTION-1 soak window.
 *
 * For 24h after PERCEPTION-1 ships, both the legacy ATR/trend×ml/
 * residual encoding and the canonical one-hot encoding of dims 0/1/2
 * are computed on every Monkey tick. This module records a
 * ring-buffered diff sample per tick so the operator can confirm the
 * canonical encoding is producing trade-relevant differences before
 * the PERCEPTION_V2_LIVE flag flips and the legacy path is removed.
 *
 * Surface: /governance/perception-parity (read-only ring buffer).
 *
 * Bounded by capacity (default 1000 rows ≈ 2.5h at ~7 ticks/min);
 * unbounded `tick_count_total` mirrors the observable_governance
 * tick-counter pattern so external freshness probes survive the
 * buffer cap.
 */

export type CanonicalRegime = 'creator' | 'preserver' | 'dissolver';

export interface PerceptionParityRow {
  /** ms-epoch when this tick fired. */
  at_ms: number;
  symbol: string;
  /** Legacy v[0], v[1], v[2]. */
  legacy: [number, number, number];
  /** Canonical v[0], v[1], v[2] (one-hot at the regime index). */
  canonical: [number, number, number];
  /** Canonical regime label that drove the canonical encoding. */
  regime: CanonicalRegime;
  /** L2 distance between (legacy_dims, canonical_dims) — the
   * primary scalar diff for at-a-glance health. */
  l2_diff: number;
  /** True when legacy's argmax differs from canonical's. */
  argmax_disagreement: boolean;
  /** Observer warm flag at the time of classification. */
  observer_warm: boolean;
}

const _buffer: PerceptionParityRow[] = [];
const _CAPACITY = 1000;
let _tickCountTotal = 0;

export function recordParity(row: Omit<PerceptionParityRow, 'l2_diff' | 'argmax_disagreement'>): void {
  const dx = row.legacy[0] - row.canonical[0];
  const dy = row.legacy[1] - row.canonical[1];
  const dz = row.legacy[2] - row.canonical[2];
  const l2_diff = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const legacyArgmax = argmax3(row.legacy);
  const canonicalArgmax = argmax3(row.canonical);
  _buffer.push({
    ...row,
    l2_diff,
    argmax_disagreement: legacyArgmax !== canonicalArgmax,
  });
  _tickCountTotal += 1;
  while (_buffer.length > _CAPACITY) _buffer.shift();
}

export function snapshot(): {
  tick_count_total: number;
  sample_count: number;
  capacity: number;
  argmax_disagreement_count: number;
  argmax_disagreement_ratio: number;
  l2_diff: { mean: number; max: number; min: number };
  regime_distribution: Record<CanonicalRegime, number>;
  rows: PerceptionParityRow[];
} {
  const n = _buffer.length;
  let argmaxDisagree = 0;
  let l2Sum = 0;
  let l2Max = 0;
  let l2Min = Number.POSITIVE_INFINITY;
  const regimeDist: Record<CanonicalRegime, number> = {
    creator: 0, preserver: 0, dissolver: 0,
  };
  for (const r of _buffer) {
    if (r.argmax_disagreement) argmaxDisagree++;
    l2Sum += r.l2_diff;
    if (r.l2_diff > l2Max) l2Max = r.l2_diff;
    if (r.l2_diff < l2Min) l2Min = r.l2_diff;
    regimeDist[r.regime]++;
  }
  return {
    tick_count_total: _tickCountTotal,
    sample_count: n,
    capacity: _CAPACITY,
    argmax_disagreement_count: argmaxDisagree,
    argmax_disagreement_ratio: n > 0 ? argmaxDisagree / n : 0,
    l2_diff: {
      mean: n > 0 ? l2Sum / n : 0,
      max: n > 0 ? l2Max : 0,
      min: n > 0 ? l2Min : 0,
    },
    regime_distribution: regimeDist,
    rows: _buffer.slice(-Math.min(200, n)),
  };
}

export function _resetParity(): void {
  _buffer.length = 0;
  _tickCountTotal = 0;
}

function argmax3(v: readonly [number, number, number]): 0 | 1 | 2 {
  if (v[0] >= v[1] && v[0] >= v[2]) return 0;
  if (v[1] >= v[0] && v[1] >= v[2]) return 1;
  return 2;
}
