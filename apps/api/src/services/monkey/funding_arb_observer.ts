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
  /** 1-period log-return of BTC at observation time (optional). */
  btcReturn?: number;
  /** 1-period log-return of ETH at observation time (optional). */
  ethReturn?: number;
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
  /** OLS regression beta of ETH log-returns vs BTC log-returns, derived
   *  from samples with observed price returns. When fewer than MIN_SAMPLES
   *  have returns: 1.0 (delta-neutral 1:1 default). Clamped to [0.5, 2.0]
   *  (P25 safety bounds). Used by the execution layer for delta-neutral
   *  sizing of the ETH leg. Fully observer-derived — no hardcoded ratio. */
  betaEthVsBtc: number;
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
 * Push a new funding sample with optional price log-returns for beta
 * estimation. Preferred over observeFundingArb when caller has
 * single-period log-returns available (btcReturn = log(btcClose/btcPrev),
 * ethReturn = log(ethClose/ethPrev)).
 */
export function observeFundingArbWithReturns(
  btcFunding: number,
  ethFunding: number,
  btcReturn?: number,
  ethReturn?: number,
  atMs: number = Date.now(),
): FundingArbReading {
  const gap = ethFunding - btcFunding;
  _samples.push({ btcFunding, ethFunding, gap, atMs, btcReturn, ethReturn });
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
      n: 0, warmup: true, betaEthVsBtc: 1.0,
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

  // OLS beta of ETH log-returns vs BTC log-returns for delta-neutral sizing.
  // beta = cov(ethR, btcR) / var(btcR) over samples that have both returns.
  // Fully observer-derived — no hardcoded ratio (QIG-pure, P5).
  // When insufficient return pairs exist: default to 1.0 (1:1 delta neutral).
  const returnPairs = samples.filter(
    (s): s is FundingSample & { btcReturn: number; ethReturn: number } =>
      s.btcReturn !== undefined && s.ethReturn !== undefined &&
      Number.isFinite(s.btcReturn) && Number.isFinite(s.ethReturn),
  );
  let betaEthVsBtc = 1.0;  // P25 safety default: 1:1 when insufficient data
  if (returnPairs.length >= MIN_SAMPLES) {
    const btcRets = returnPairs.map((s) => s.btcReturn);
    const ethRets = returnPairs.map((s) => s.ethReturn);
    const btcMean = btcRets.reduce((a, b) => a + b, 0) / btcRets.length;
    const ethMean = ethRets.reduce((a, b) => a + b, 0) / ethRets.length;
    const cov = btcRets.reduce((a, x, i) =>
      a + (x - btcMean) * (ethRets[i]! - ethMean), 0) / btcRets.length;
    const varBtc = btcRets.reduce((a, x) => a + (x - btcMean) ** 2, 0) / btcRets.length;
    if (varBtc > 1e-12) {
      // SAFETY_BOUND: clamp beta to [0.5, 2.0] — prevents degenerate
      // sizing from short-window outliers (P25-compliant safety bound).
      betaEthVsBtc = Math.max(0.5, Math.min(2.0, cov / varBtc));
    }
  }

  return {
    btcFunding: latest.btcFunding,
    ethFunding: latest.ethFunding,
    currentGap: latest.gap,
    meanGap, stdGap, zScore, zUpperTercile,
    signalFires, suggestedDirection,
    n, warmup, betaEthVsBtc,
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
