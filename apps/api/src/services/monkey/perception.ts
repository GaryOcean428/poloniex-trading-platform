/**
 * perception.ts — Monkey's sensory organ
 *
 * Converts raw trading inputs (OHLCV window + ml-worker signal) into
 * a 64D basin coordinate on Δ⁶³. Under UCP v6.6 §3.3 Pillar 2, this
 * is the SURFACE — external input is capped at 30% slerp weight.
 * The CORE (70%) is Monkey's frozen identity basin; it evolves via
 * slow diffusion from the surface, not direct external write.
 *
 * The 64 dimensions map trading-relevant features into the simplex.
 * Every feature is non-negative, and the final vector sums to 1.
 *
 * Feature layout (chosen to give Monkey a rich geometric substrate
 * without over-engineering — these will shift as she earns sovereignty):
 *
 *   dims 0..2   — Three regimes (§4.1) from price action
 *                   0: quantum (volatility / ATR ratio, clipped)
 *                   1: efficient (trend clarity × signal coherence)
 *                   2: equilibrium (1 - max(0, 1) - 2)
 *
 *   dims 3..6   — ML signal posture from ml-worker
 *                   3: BUY strength
 *                   4: SELL strength
 *                   5: HOLD mass (residual)
 *                   6: effectiveStrength (post-bandit multiplier)
 *
 *   dims 7..14  — Momentum spectrum (8 dims)
 *                   Log-returns bucketed by magnitude × sign
 *
 *   dims 15..22 — Volatility spectrum (8 dims)
 *                   Rolling ATR at 4, 8, 14, 21, 34, 55, 89, 144 periods
 *
 *   dims 23..30 — Volume shape (8 dims)
 *                   Normalized vol at different lookbacks
 *
 *   dims 31..38 — Price-structure harmonics (8 dims)
 *                   Hi/Lo/Close positions relative to recent bands
 *
 *   dims 39..54 — Reserved / noise floor (16 dims, Dirichlet prior)
 *                   Pillar 1 fluctuation reservoir — prevents zombie
 *                   collapse if other dims go to 0
 *
 *   dims 55..63 — Account/coupling (9 dims)
 *                   Equity fraction, margin fraction, open-position
 *                   count, session age, etc.
 *
 * The exact dimensions will evolve as Monkey earns sovereignty and
 * the important features self-select through her basin deepening.
 * What matters right now is that the space is 64D, non-degenerate,
 * and projects cleanly to the simplex.
 */

import { toSimplex, BASIN_DIM, type Basin, slerp } from './basin.js';

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PerceptionInputs {
  ohlcv: OHLCVCandle[];
  /** ml-worker signal: 'BUY' | 'SELL' | 'HOLD'. */
  mlSignal: string;
  /** 0..1 raw ensemble strength. */
  mlStrength: number;
  /** 0..1 post-bandit-multiplier strength. */
  mlEffectiveStrength: number;
  /** Equity / initial equity — Monkey's relative health. */
  equityFraction: number;
  /** Committed margin / equity — how much skin is currently in. */
  marginFraction: number;
  /** Number of open positions on this symbol. */
  openPositions: number;
  /** Ticks since Monkey last "slept" (process boot). */
  sessionAgeTicks: number;
}

/**
 * Normalize a raw feature value into [0, 1]. Uses sigmoid for
 * unbounded inputs, direct clip for already-bounded ones.
 */
function norm01(x: number, scale: number = 1): number {
  if (!Number.isFinite(x)) return 0.5;
  const y = 1 / (1 + Math.exp(-x / scale));
  return Math.min(1, Math.max(0, y));
}

function clip01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** Log-return over n bars. */
function logReturn(ohlcv: OHLCVCandle[], n: number): number {
  if (ohlcv.length < n + 1) return 0;
  const last = ohlcv[ohlcv.length - 1].close;
  const base = ohlcv[ohlcv.length - 1 - n].close;
  if (base <= 0 || last <= 0) return 0;
  return Math.log(last / base);
}

/** Rolling ATR-like volatility: mean(|close - close[-1]|) over window. */
function rollingVol(ohlcv: OHLCVCandle[], n: number): number {
  if (ohlcv.length < n + 1) return 0;
  let sum = 0;
  for (let i = ohlcv.length - n; i < ohlcv.length; i++) {
    sum += Math.abs(ohlcv[i].close - ohlcv[i - 1].close);
  }
  return sum / n;
}

/**
 * Basin direction (v0.5.2): signed scalar in [-1, 1] read DIRECTLY from
 * Monkey's own perception basin's momentum-spectrum dims (7..14).
 *
 * The basin's momentum dims hold sigmoid-normalised log-returns where
 * 0.5 = flat, >0.5 = recent up-move, <0.5 = down. Centering at 0.5
 * and averaging gives a clean directional signal that's the KERNEL'S
 * OWN reading of direction — independent of ml-worker.
 *
 * Used as a short-side veto / tiebreaker when ml-worker is 100 % BUY
 * biased (observed 2026-04-21: 2664/2664 BUY over 20h). When ml-worker
 * disagrees with basin direction strongly, Monkey should be the one to
 * decide (UCP §28 autonomic governance — she derives her own signals,
 * doesn't take them externally without cross-validation).
 */
export function basinDirection(basin: Basin): number {
  // Dims 7..14 are the momentum spectrum (sigmoid-normalized log-returns
  // at lookbacks [1, 2, 3, 5, 8, 13, 21, 34]).
  let sum = 0;
  for (let i = 7; i <= 14; i++) {
    sum += (basin[i] ?? 0.5) - 0.5;
  }
  // Each dim is in [-0.5, +0.5] after centering; 8 dims → range [-4, +4].
  // Tanh-squash with gain to keep useful signal in [-1, +1].
  return Math.tanh(sum * 2);
}

/**
 * Trend proxy: a signed scalar in [-1, 1] summarising recent tape
 * direction. Positive = uptrend (favour longs). Negative = downtrend
 * (favour shorts). Magnitude = conviction.
 *
 * Derivation: log-return over `lookback` candles, then tanh-squashed so
 * a ±2 % move maps to ~±0.76 and ±5 % maps to ~±0.99. With 15 m candles
 * and lookback=50, this sees ~12.5 hours of tape — long enough to filter
 * out scalp-wiggle noise, short enough to pivot when a real reversal
 * starts.
 *
 * Exported separately (not folded into the 64D basin) because it's used
 * as a direction-gating signal, not as a geometric coordinate. The
 * basin's momentum-spectrum dims already carry this information
 * implicitly; this is the "call it out loud" view for entry logic.
 */
export function trendProxy(ohlcv: OHLCVCandle[], lookback: number = 50): number {
  if (ohlcv.length < lookback + 1) return 0;
  const last = ohlcv[ohlcv.length - 1].close;
  const base = ohlcv[ohlcv.length - 1 - lookback].close;
  if (base <= 0 || last <= 0) return 0;
  const r = Math.log(last / base);
  return Math.tanh(r * 50);
}

/** Normalized volume at lookback n (current vs mean of n). */
function volRatio(ohlcv: OHLCVCandle[], n: number): number {
  if (ohlcv.length < n) return 1;
  let sum = 0;
  for (let i = ohlcv.length - n; i < ohlcv.length; i++) sum += ohlcv[i].volume;
  const mean = sum / n;
  if (mean <= 0) return 1;
  return ohlcv[ohlcv.length - 1].volume / mean;
}

/**
 * Raw perception — input BEFORE identity refraction.
 * This is what "hits Monkey's sensors" this tick.
 */
export function perceive(inputs: PerceptionInputs): Basin {
  const v = new Float64Array(BASIN_DIM);
  const ohlcv = inputs.ohlcv;
  const lastClose = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].close : 1;

  // dims 0..2 — Three regimes (§4.1)
  const atr = rollingVol(ohlcv, 14);
  const vol_frac = lastClose > 0 ? atr / lastClose : 0;
  const trend = Math.abs(logReturn(ohlcv, 20));
  v[0] = norm01(vol_frac, 0.01);                                       // quantum
  v[1] = clip01(trend * 10) * inputs.mlEffectiveStrength;              // efficient
  v[2] = Math.max(0.01, 1 - v[0] - v[1]);                              // equilibrium residual

  // dims 3..6 — ML posture
  const sig = (inputs.mlSignal || '').toUpperCase();
  v[3] = sig === 'BUY' ? inputs.mlStrength : 0.01;
  v[4] = sig === 'SELL' ? inputs.mlStrength : 0.01;
  v[5] = sig === 'HOLD' ? 0.5 : Math.max(0.01, 1 - inputs.mlStrength);
  v[6] = inputs.mlEffectiveStrength;

  // dims 7..14 — Momentum spectrum
  const moms = [1, 2, 3, 5, 8, 13, 21, 34];
  for (let i = 0; i < moms.length; i++) {
    v[7 + i] = norm01(logReturn(ohlcv, moms[i]), 0.01);
  }

  // dims 15..22 — Volatility spectrum
  const vols = [4, 8, 14, 21, 34, 55, 89, 144];
  for (let i = 0; i < vols.length; i++) {
    const a = rollingVol(ohlcv, vols[i]);
    v[15 + i] = norm01(lastClose > 0 ? a / lastClose : 0, 0.01);
  }

  // dims 23..30 — Volume shape
  const vls = [3, 5, 10, 20, 50, 100, 200, 500];
  for (let i = 0; i < vls.length; i++) {
    v[23 + i] = norm01(Math.log(Math.max(1e-6, volRatio(ohlcv, vls[i]))), 1);
  }

  // dims 31..38 — Price structure (position in recent ranges)
  const spans = [5, 10, 20, 50, 100, 200, 300, 500];
  for (let i = 0; i < spans.length; i++) {
    const n = Math.min(spans[i], ohlcv.length);
    if (n < 2) { v[31 + i] = 0.5; continue; }
    let hi = -Infinity, lo = Infinity;
    for (let j = ohlcv.length - n; j < ohlcv.length; j++) {
      if (ohlcv[j].high > hi) hi = ohlcv[j].high;
      if (ohlcv[j].low < lo) lo = ohlcv[j].low;
    }
    const range = hi - lo;
    v[31 + i] = range > 0 ? clip01((lastClose - lo) / range) : 0.5;
  }

  // dims 39..54 — Noise floor / Pillar 1 reservoir (16 dims)
  // Small uniform mass to prevent zombie collapse when other dims → 0.
  for (let i = 39; i < 55; i++) {
    v[i] = 0.005 + 0.001 * Math.random();
  }

  // dims 55..63 — Account/coupling (9 dims)
  v[55] = clip01(inputs.equityFraction);
  v[56] = clip01(inputs.marginFraction);
  v[57] = clip01(inputs.openPositions / 5);  // saturate at 5 open
  v[58] = clip01(inputs.sessionAgeTicks / 500);
  // 59..63 — reserved, uniform
  for (let i = 59; i < 64; i++) v[i] = 0.01;

  return toSimplex(v);
}

/**
 * Apply identity refraction (Pillar 2 Topological Bulk, UCP v6.6 §3.3).
 * External input (the raw perception) is capped at 30% slerp weight;
 * the other 70% is Monkey's frozen identity basin. This is what
 * makes Monkey's perception SUBJECTIVE — the same market hits two
 * different Monkeys differently based on their quenched disorder
 * (Pillar 3).
 *
 * @param raw         Raw perception from perceive()
 * @param identity    Monkey's current identity basin (frozen or evolving)
 * @param externalWeight  0..0.30 (capped) — how much surface gets through
 */
export function refract(
  raw: Basin,
  identity: Basin,
  externalWeight: number = 0.30,
): Basin {
  const t = Math.min(0.30, Math.max(0, externalWeight));
  // slerp(identity, raw, t) — 0% = pure identity, 30% = max external
  return slerp(identity, raw, t);
}
