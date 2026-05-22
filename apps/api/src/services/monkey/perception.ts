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
  /** Equity / initial equity — Monkey's relative health. */
  equityFraction: number;
  /** Committed margin / equity — how much skin is currently in. */
  marginFraction: number;
  /** Number of open positions on this symbol. */
  openPositions: number;
  /** Ticks since Monkey last "slept" (process boot). */
  sessionAgeTicks: number;
  /** ml-worker signal: 'BUY' | 'SELL' | 'HOLD'. Optional post #ml-separation
   * — kernel callers omit. Defaults to 'HOLD' (neutral). */
  mlSignal?: string;
  /** 0..1 raw ensemble strength. Optional, defaults to 0. */
  mlStrength?: number;
  /** 0..1 post-bandit-multiplier strength. Optional, defaults to 0. */
  mlEffectiveStrength?: number;
  /**
   * PERCEPTION-1: canonical regime label from the observer-driven
   * classifier (regime_classifier_client.classifyPrices). When
   * provided AND the PERCEPTION_V2_LIVE flag is set, dims 0/1/2
   * encode a canonical one-hot mixture in the order
   *   0 = CREATOR, 1 = PRESERVER, 2 = DISSOLVER
   * Otherwise the legacy ATR / trend×ml / residual encoding stands.
   * Caller is expected to fetch this from the ml-worker per tick
   * (cached client; <15s staleness). null = legacy path.
   */
  canonicalRegime?: 'creator' | 'preserver' | 'dissolver' | null;
  /**
   * PERCEPTION-1 (soft): continuous 3-way regime membership from the
   * CAL-3 soft observer. When present, dims 0/1/2 encode this
   * continuous distribution instead of a one-hot of `canonicalRegime`
   * — which keeps downstream signals (quantumWeight → gaba, basin
   * entropy → Φ) continuous instead of quantised. null/absent →
   * one-hot fallback. Sums to ~1; need not be exactly normalised.
   */
  canonicalRegimeScores?: { creator: number; preserver: number; dissolver: number } | null;
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

/**
 * B1 (2026-05-21) — momentum basin coordinate: linear, expressive,
 * 0.5-neutral. Replaces the `norm01` sigmoid for the momentum band
 * (dims 7..14).
 *
 * WHY: `norm01(logReturn, 0.01)` = sigmoid(logReturn·100) saturates.
 * On the realized 15m log-return distribution (BTC+ETH, 1000 candles,
 * 2026-05-21 — |logReturn| p50=0.0022, p90=0.0085) every momentum dim
 * landed inside [0.45, 0.55] → near-uniform basin → |basinDirection|
 * structurally pinned < 0.05. The magnitude gates that read it —
 * M-agent and FAST_ADVERSE_EXIT (|basinDir| > 0.10), modes.ts
 * `hasDirection` (> 0.30) — could therefore never fire (the operator-
 * reported dead M-agent + dead loss-cut, 2026-05-21).
 *
 * FIX: linear `0.5 + GAIN·logReturn`. Keeps the exact 0.5 neutral
 * (logReturn 0 → 0.5) so basinDirection's #880 observer-derived neutral
 * is unaffected — only the momentum band changes, the volatility/volume
 * peer bands are untouched, so the direction SIGN cannot invert. But it
 * is expressive across the real range: p90 reaches 0.5±0.42, p99 clamps
 * geometrically. GAIN = 50 is the log-return sensitivity `trendProxy()`
 * already uses in this file — not a new intuition knob. Floor 0.02
 * keeps the dim off the simplex boundary.
 *
 * §8 follow-up: GAIN becomes observer-derived from the rolling
 * per-symbol log-return distribution. v1 freezes it at the trendProxy
 * value (recomputable — recompute if the distribution shifts).
 */
const MOMENTUM_GAIN = 50;
function momentumCoord(logRet: number): number {
  if (!Number.isFinite(logRet)) return 0.5;
  const y = 0.5 + MOMENTUM_GAIN * logRet;
  return Math.min(1, Math.max(0.02, y));
}

/**
 * Noise-floor raw value — dims 39..54 of every `perceive()` basin are
 * pinned to this constant (Pillar 1 fluctuation reservoir). Because it
 * is a *known fixed raw value*, the noise band pins the simplex scale
 * `T`: after `toSimplex`, `p[noise] = NOISE_FLOOR_VALUE / T`, so
 * `T = NOISE_FLOOR_VALUE / mean(p[39..54])`. `basinDirection` uses this
 * to recover an EXACT neutral-momentum reference (B1.1).
 */
export const NOISE_FLOOR_VALUE = 0.0055;

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
 * Average True Range over `period` candles (Wilder, simple-mean variant).
 *
 *   TR_i  = max( high−low,
 *                |high − close_{i-1}|,
 *                |low  − close_{i-1}| )
 *   ATR   = mean(TR) over the last `period` candles
 *
 * This is the canonical ATR the Pine indicator uses (`ta.atr(14)`,
 * Pine L93) — proper true range, not the `rollingVol` close-to-close
 * approximation above. Phase B's synthetic TP/SL bracket is derived
 * from this ATR via `frBracketDistances`.
 *
 * Returns 0 when there is insufficient history (fewer than period+1
 * candles) — callers treat 0 as "no bracket derivable, fall through".
 * Exported because the kernel's entry path (loop.ts) needs it.
 */
export function atr14(
  ohlcv: OHLCVCandle[],
  period: number = 14,
): number {
  if (ohlcv.length < period + 1) return 0;
  let sum = 0;
  for (let i = ohlcv.length - period; i < ohlcv.length; i++) {
    const prevClose = ohlcv[i - 1].close;
    const tr = Math.max(
      ohlcv[i].high - ohlcv[i].low,
      Math.abs(ohlcv[i].high - prevClose),
      Math.abs(ohlcv[i].low - prevClose),
    );
    sum += tr;
  }
  return sum / period;
}

/**
 * Basin direction: signed scalar in [-1, 1] read DIRECTLY from Monkey's
 * own perception basin's momentum-spectrum dims (7..14).
 *
 * Proposal #7 (2026-04-30) — Fisher-Rao reprojection. Replaces the
 * 2026-04-24 ``tanh((mom_mass - MOM_NEUTRAL) * 16)`` formulation,
 * which saturated at ~0.92 in mild bull regimes (verified on prod
 * tape, 2026-04-26) and structurally suppressed short conviction.
 *
 * The new formulation:
 *   1. Build a "no-momentum antipode" basin: rescale dims 7..14 to
 *      total mass = neutralMomMass (observer-derived — see below),
 *      redistribute the surplus / deficit uniformly across the 56
 *      non-momentum dims.
 *   2. Compute the Fisher-Rao geodesic distance between basin and
 *      antipode: ``d = arccos(Σ √(p·q))`` on Δ⁶³.
 *   3. Sign by ``mom_mass - neutralMomMass``.
 *   4. Normalise by π/2 (the simplex diameter) so output ∈ [-1, +1]
 *      WITHOUT clipping. Saturation is geometric, not artificial.
 *
 * QIG purity: Fisher-Rao native. No cosine similarity, no Euclidean
 * distance. Mirrors ``ml-worker/src/monkey_kernel/perception_scalars.py
 * :basin_direction`` byte-for-byte (modulo TS/Python idiom).
 *
 * Quarantine note: bubbles persisted in ``working_memory`` BEFORE
 * this commit had basinDir computed under the saturating formula.
 * Migration 041 flags those rows so the kernel can avoid re-using
 * stale-coordinate-system bubbles (UCP §11.8).
 *
 * BUG FIX (2026-05-21): the neutral was a hardcoded MOM_NEUTRAL = 8/64
 * — correct only for a uniform basin. perceive()'s sub-uniform noise
 * floor (dims 39..54 @ 0.0055) made mom_mass exceed 8/64 even on a
 * flat market → sign pinned +1 → basinDir never went negative (the
 * live "only longs" bug). Fixed: neutral is derived from the basin's
 * own direction-agnostic peer bands (volatility 15..22 + volume
 * 23..30). Observer-derived, no hardcoded knob (P1).
 */
export function basinDirection(basin: Basin): number {
  // Degenerate-basin fallback ONLY. The live neutral is observer-derived
  // below (neutralMomMass) — 8/64 is correct only for a uniform basin.
  const MOM_NEUTRAL_FALLBACK = 8 / BASIN_DIM;  // 0.125
  const EPS = 1e-12;

  // Step 0: defensive simplex normalization (caller may pass raw basin).
  let total = 0;
  for (let i = 0; i < BASIN_DIM; i++) total += Math.max(0, basin[i] ?? 0);
  if (total <= EPS) return 0;
  const p: number[] = new Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) {
    p[i] = Math.max(0, basin[i] ?? 0) / total;
  }

  // Step 1: momentum-band mass and neutral reference.
  let momMass = 0;
  for (let i = 7; i <= 14; i++) momMass += p[i]!;
  // B1.1 — noise-floor-anchored neutral (EXACT; supersedes #880's
  // `8·peerMean` estimate).
  //
  // The momentum band is built by `momentumCoord`, which is 0.5-neutral
  // by construction (logReturn 0 → 0.5 raw). So a neutral momentum band
  // weighs 8 × 0.5 = 4 in raw (pre-toSimplex) units. The noise band
  // (dims 39..54) is a fixed raw NOISE_FLOOR_VALUE per dim — it pins the
  // simplex scale `T = NOISE_FLOOR_VALUE / noiseMean`, so the neutral
  // momentum p-share is exact: (8·0.5)/T = 4·noiseMean/NOISE_FLOOR_VALUE.
  // The sign test then reduces exactly to `mean(momentum dim) ≥ 0.5`.
  //
  // #880's `8·peerMean` averaged the volatility+volume bands as a proxy
  // for "neutral per-dim mass" — but those bands are NOT 0.5-centred
  // (volume's log(volRatio) runs mostly negative → volume dims ~0.40),
  // so the neutral skewed low → momMass > neutral even on a flat market
  // → basinDir sign pinned +1 (confirmed in production telemetry post-B1,
  // 2026-05-21). The noise anchor removes that skew.
  //
  // The anchor is EXACT only on a genuine perceive() output (noise dims
  // at raw NOISE_FLOOR_VALUE). It self-detects that: a real perceive()
  // noise band is 16 × 0.0055 raw ≈ 0.4–0.9% of the basin (T ≈ 10–20).
  // The `noiseSum < 0.02` guard (2%) sits ~3× above that and well below
  // any hand-built uniform-ish basin (whose 16 "noise" dims carry ≥4%)
  // — so synthetic test fixtures and non-perceive basins fall through
  // to #880's peerMean, no regression. MONKEY_PERCEPTION_EXPRESSIVE_LIVE
  // =false reverts the whole B1 path. Final fallback: the 8/64 constant.
  let neutralMomMass: number;
  let noiseSum = 0;
  for (let i = 39; i <= 54; i++) noiseSum += p[i]!;
  if (
    process.env.MONKEY_PERCEPTION_EXPRESSIVE_LIVE !== 'false'
    && noiseSum > EPS
    && noiseSum < 0.02
  ) {
    const noiseMean = noiseSum / 16;
    neutralMomMass = (8 * 0.5 * noiseMean) / NOISE_FLOOR_VALUE;
  } else {
    let peerSum = 0;
    for (let i = 15; i <= 30; i++) peerSum += p[i]!;
    const peerMean = peerSum / 16;
    neutralMomMass = peerMean > EPS ? 8 * peerMean : MOM_NEUTRAL_FALLBACK;
  }
  // Step 2: B1.2 — direction is the momentum-band MARGINAL, in [-1, 1].
  //
  // momMass / neutralMomMass is the band's mass relative to its 8×0.5
  // neutral — i.e. rawMomMass / 4. Subtract 1 → 0 at neutral momentum,
  // +1 at a fully-activated band (raw mass 8), −1 at a dead band.
  //
  // Supersedes the Fisher-Rao distance to a no-momentum antipode
  // (proposal #7). That distance measured an 8-dim signal (dims 7..14)
  // across the full 64-dim basin: the antipode perturbed only those 8
  // dims, the other 56 barely moved, so Σ√(p·q) stayed ≈ 1 and arccos
  // ≈ 0 — a structural ~±0.2 ceiling that `kernelDirection`'s
  // 0.5·tapeTrend term drowned, so the M-agent and FAST_ADVERSE_EXIT
  // |basinDir| > 0.10 gates could never fire. The marginal carries the
  // band's full dynamic range with no dimensional dilution. QIG purity:
  // a band marginal on Δ⁶³ — no distance, no cosine, no Euclidean op.
  if (neutralMomMass <= EPS) return 0;
  const direction = momMass / neutralMomMass - 1;
  return Math.max(-1, Math.min(1, direction));
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

  // ml inputs default to neutral when absent (post #ml-separation
  // — Agent K's perception runs without ml fields).
  const mlSignal = (inputs.mlSignal ?? 'HOLD').toUpperCase();
  const mlStrength = inputs.mlStrength ?? 0;
  const mlEffectiveStrength = inputs.mlEffectiveStrength ?? 0;

  // dims 0..2 — Three regimes (canonical, observer-driven classifier;
  // CAL-3 + PERCEPTION-1). Indices match canonical Python ordering:
  //   0 = CREATOR    1 = PRESERVER    2 = DISSOLVER
  //
  // Caller (loop.ts) fetches the classification from ml-worker's
  // POST /regime/classify_prices (cached per symbol). ε=1e-3 padding
  // keeps the simplex non-degenerate for the downstream toSimplex
  // normaliser.
  //
  // PREFERRED — continuous: when the soft observer supplies a 3-way
  // membership (`canonicalRegimeScores`), encode it CONTINUOUSLY. A
  // one-hot label snaps dims 0-2 to a fixed (winner, loser, loser)
  // triple every tick, which quantises everything derived from them
  // (quantumWeight → gaba went binary; basin entropy → Φ pinned).
  // The soft scores move tick-to-tick, so dims 0-2 carry live signal.
  //
  // FALLBACK — one-hot: during the observer's warmup, or when the
  // ml-worker omits scores, encode a one-hot of the hard `regime`
  // label. Classifier unreachable entirely → uniform 1/3 prior.
  const epsilon = 1e-3;
  const scores = inputs.canonicalRegimeScores;
  const scoreSum = scores
    ? Math.max(0, scores.creator) + Math.max(0, scores.preserver) + Math.max(0, scores.dissolver)
    : 0;
  if (scores && scoreSum > 0) {
    // Normalise to a simplex with an ε floor on each dim so no regime
    // is exactly 0 (keeps toSimplex non-degenerate) while preserving
    // the relative continuous weighting.
    const span = 1 - 3 * epsilon;
    v[0] = epsilon + span * (Math.max(0, scores.creator) / scoreSum);
    v[1] = epsilon + span * (Math.max(0, scores.preserver) / scoreSum);
    v[2] = epsilon + span * (Math.max(0, scores.dissolver) / scoreSum);
  } else if (inputs.canonicalRegime === 'creator') {
    v[0] = 1 - 2 * epsilon; v[1] = epsilon; v[2] = epsilon;
  } else if (inputs.canonicalRegime === 'preserver') {
    v[0] = epsilon; v[1] = 1 - 2 * epsilon; v[2] = epsilon;
  } else if (inputs.canonicalRegime === 'dissolver') {
    v[0] = epsilon; v[1] = epsilon; v[2] = 1 - 2 * epsilon;
  } else {
    // Classifier unreachable — uniform prior (safer than picking
    // one regime when we have no information).
    v[0] = 1 / 3; v[1] = 1 / 3; v[2] = 1 / 3;
  }

  // dims 3..6 — ML posture (constant when ml inputs absent).
  v[3] = mlSignal === 'BUY' ? mlStrength : 0.01;
  v[4] = mlSignal === 'SELL' ? mlStrength : 0.01;
  v[5] = mlSignal === 'HOLD' ? 0.5 : Math.max(0.01, 1 - mlStrength);
  v[6] = mlEffectiveStrength;

  // dims 7..14 — Momentum spectrum.
  // B1: linear expressive encoding (momentumCoord) — flag-gated.
  // MONKEY_PERCEPTION_EXPRESSIVE_LIVE=false reverts to the legacy
  // norm01 sigmoid instantly. See momentumCoord for the rationale.
  const moms = [1, 2, 3, 5, 8, 13, 21, 34];
  const expressiveMomentum = process.env.MONKEY_PERCEPTION_EXPRESSIVE_LIVE !== 'false';
  for (let i = 0; i < moms.length; i++) {
    const lr = logReturn(ohlcv, moms[i]);
    v[7 + i] = expressiveMomentum ? momentumCoord(lr) : norm01(lr, 0.01);
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

  // dims 39..54 — Noise floor / Pillar 1 reservoir (16 dims).
  // Fixed constant (v0.8.0) for deterministic cross-language parity with the
  // Python port. A non-zero floor is the Pillar 1 requirement; per-tick
  // variance was decorative. toSimplex normalises so uniform mass still
  // keeps the basin off the boundary.
  for (let i = 39; i < 55; i++) v[i] = NOISE_FLOOR_VALUE;

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
