/**
 * funding_arb_observer.ts — Class B #7 (issue #794).
 *
 * Cross-symbol funding-rate spread observer. Maintains a rolling buffer
 * of (btc_fund, eth_fund, gap = eth - btc) samples. Computes z-score of
 * the current gap vs the rolling distribution. When |z| exceeds the
 * upper-tercile threshold of the historical |z| distribution, the spread
 * is statistically extreme — candidate signal for a delta-neutral pair
 * trade (long lower-funding, short higher-funding) earning the funding
 * spread and capturing mean-reversion if it happens.
 *
 * QIG-pure: the trigger threshold is derived from the observation's OWN
 * tercile distribution (WarpBubble.auto() pattern), not a hardcoded
 * "fire when |z| > 2.0" knob.
 *
 * Phase 1 (this module): pure observer + signal computation. The
 * downstream consumer (funding_arb_strategy if MONKEY_FUNDING_ARB_LIVE
 * is true) decides what to do with the signal.
 */

const MAX_HISTORY = 1440;  // SAFETY_BOUND: 24h at 60s tick cadence
const MIN_SAMPLES = 30;    // SAFETY_BOUND: ~30 min warmup before signals
const TERCILE_UPPER = 0.67;  // matches CAL-3 / trajectory_observer convention

export interface FundingSample {
  /** Funding rate for BTC perpetual at observation time. */
  btcFunding: number;
  /** Funding rate for ETH perpetual at observation time. */
  ethFunding: number;
  /** Gap = ethFunding - btcFunding at observation time. */
  gap: number;
  /** Observation timestamp (ms). */
  atMs: number;
}

export interface FundingArbReading {
  /** Latest BTC funding rate observed. */
  btcFunding: number;
  /** Latest ETH funding rate observed. */
  ethFunding: number;
  /** Latest gap (eth - btc). */
  currentGap: number;
  /** Rolling mean of gap over the buffer. */
  meanGap: number;
  /** Rolling standard deviation of gap. */
  stdGap: number;
  /** z-score of current gap vs rolling distribution.
   *  Positive = eth funding rich vs btc; negative = btc funding rich. */
  zScore: number;
  /** Upper-tercile of |z| observed over the rolling buffer — the
   *  observer-derived threshold for "this gap is unusually wide." */
  zUpperTercile: number;
  /** True when |zScore| >= zUpperTercile AND not in warmup. The
   *  downstream strategy fires on this. */
  signalFires: boolean;
  /** Suggested direction: 'long_btc_short_eth' when ethFunding > btcFunding
   *  (eth's rate too rich → short eth, long btc to earn the spread).
   *  Null when signal doesn't fire. */
  suggestedDirection: 'long_btc_short_eth' | 'short_btc_long_eth' | null;
  /** Number of samples used. */
  n: number;
  /** True until n >= MIN_SAMPLES. All derived values are still
   *  computed but signalFires is forced false. */
  warmup: boolean;
}

const _samples: FundingSample[] = [];

/**
 * Push a new funding sample into the buffer and return the current
 * reading. Caller fetches funding rates from the exchange and calls
 * this with the two latest rates.
 */
export function observeFundingArb(
  btcFunding: number,
  ethFunding: number,
  atMs: number = Date.now(),
): FundingArbReading {
  const gap = ethFunding - btcFunding;
  _samples.push({ btcFunding, ethFunding, gap, atMs });
  if (_samples.length > MAX_HISTORY) _samples.shift();
  return computeFundingArb(_samples);
}

/**
 * Compute the funding-arb reading from a sample buffer. Pure derivation —
 * exposed for testability. The mean/std/tercile use the gap distribution
 * directly (no smoothing); they capture the funding-rate volatility
 * structure that determines when the gap is statistically extreme.
 */
export function computeFundingArb(
  samples: readonly FundingSample[],
): FundingArbReading {
  const n = samples.length;
  if (n === 0) {
    return {
      btcFunding: 0, ethFunding: 0, currentGap: 0,
      meanGap: 0, stdGap: 0, zScore: 0, zUpperTercile: 0,
      signalFires: false, suggestedDirection: null,
      n: 0, warmup: true,
    };
  }
  const latest = samples[n - 1]!;
  const gaps = samples.map((s) => s.gap);
  const meanGap = gaps.reduce((a, b) => a + b, 0) / n;
  const variance = gaps.reduce((a, g) => a + (g - meanGap) ** 2, 0) / n;
  const stdGap = Math.sqrt(variance);
  const zScore = stdGap > 1e-9 ? (latest.gap - meanGap) / stdGap : 0;
  // Upper-tercile of |z| — the threshold above which |z| is "high"
  // relative to its own history (WarpBubble.auto() pattern).
  const absZs = gaps
    .map((g) => (stdGap > 1e-9 ? Math.abs((g - meanGap) / stdGap) : 0))
    .sort((a, b) => a - b);
  const terciIdx = Math.min(absZs.length - 1, Math.floor(absZs.length * TERCILE_UPPER));
  const zUpperTercile = absZs[terciIdx] ?? 0;
  const warmup = n < MIN_SAMPLES;
  const signalFires = !warmup && Math.abs(zScore) >= zUpperTercile && stdGap > 1e-9;
  let suggestedDirection: 'long_btc_short_eth' | 'short_btc_long_eth' | null = null;
  if (signalFires) {
    // Positive zScore means ethFunding - btcFunding is HIGH (eth's rate
    // is unusually rich). To earn the spread: short eth (pays rich rate),
    // long btc (receives less rich rate). Net = earn the difference.
    suggestedDirection = zScore > 0 ? 'long_btc_short_eth' : 'short_btc_long_eth';
  }
  return {
    btcFunding: latest.btcFunding,
    ethFunding: latest.ethFunding,
    currentGap: latest.gap,
    meanGap, stdGap, zScore, zUpperTercile,
    signalFires, suggestedDirection,
    n, warmup,
  };
}

/** Test/diagnostic helper. */
export function _resetFundingArb(): void {
  _samples.length = 0;
}

/** Test/diagnostic helper. */
export function _peekFundingArb(): readonly FundingSample[] {
  return _samples;
}
