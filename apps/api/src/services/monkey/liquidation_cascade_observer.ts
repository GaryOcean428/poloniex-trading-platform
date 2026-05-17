/**
 * liquidation_cascade_observer.ts — Class B #8 (issue #795).
 *
 * Detects liquidation clusters from /v3/market/liquidationOrder responses.
 * A cluster = a burst of liquidations on one side (forced LONG or forced
 * SHORT) significantly above the rolling baseline. Cluster firings on
 * the LONG side mean longs were liquidated (forced sells) — the
 * mean-reversion is typically UP. On the SHORT side: forced buys → MR is
 * typically DOWN.
 *
 * QIG-pure: the cluster threshold is derived from the rolling-quantile
 * of recent cluster sizes (same WarpBubble.auto() pattern as the regime
 * observer and the funding-arb observer). No hardcoded "fire when N USD
 * liquidated" knob.
 *
 * Phase 1 (this module): pure observer + signal. The downstream strategy
 * decides whether to enter (gated by MONKEY_LIQ_REVERSAL_LIVE).
 */

/** SAFETY_BOUND constants — bound risk, not behaviour. */
const MAX_HISTORY = 720;        // 12h at 60s polling cadence
const MIN_SAMPLES = 20;          // ~20 min warmup
const TERCILE_UPPER = 0.85;      // upper quantile for "cluster fires"

export interface LiquidationSample {
  /** Total long-liquidation notional this sample. */
  longLiqUsd: number;
  /** Total short-liquidation notional this sample. */
  shortLiqUsd: number;
  /** Net (long - short) — sign indicates which side dominates. */
  net: number;
  /** Timestamp (ms). */
  atMs: number;
}

export interface LiquidationCascadeReading {
  /** Latest long-liquidation notional observed. */
  latestLongLiqUsd: number;
  /** Latest short-liquidation notional observed. */
  latestShortLiqUsd: number;
  /** Sum (long + short) for the latest sample. */
  totalNotional: number;
  /** Rolling threshold above which a sample qualifies as a "cluster" —
   *  upper-tercile of historical (long+short) totalNotional. */
  clusterThreshold: number;
  /** True when latest totalNotional >= clusterThreshold AND not warmup. */
  clusterFires: boolean;
  /** When cluster fires, which side dominated? Determines reversion side. */
  dominantSide: 'long_liq_reversion_up' | 'short_liq_reversion_down' | null;
  /** Suggested mean-reversion entry side. */
  suggestedEntrySide: 'long' | 'short' | null;
  /** Sample count. */
  n: number;
  /** True until n >= MIN_SAMPLES. */
  warmup: boolean;
}

const _samplesBySymbol: Map<string, LiquidationSample[]> = new Map();

/**
 * Observe a new liquidation sample for a symbol and return the current
 * reading. Caller passes the long + short notional totals (summed over
 * whatever window — typically the last polling period).
 */
export function observeLiquidationCascade(
  symbol: string,
  longLiqUsd: number,
  shortLiqUsd: number,
  atMs: number = Date.now(),
): LiquidationCascadeReading {
  let samples = _samplesBySymbol.get(symbol);
  if (!samples) {
    samples = [];
    _samplesBySymbol.set(symbol, samples);
  }
  samples.push({
    longLiqUsd, shortLiqUsd,
    net: longLiqUsd - shortLiqUsd,
    atMs,
  });
  if (samples.length > MAX_HISTORY) samples.shift();
  return computeLiquidationCascade(samples);
}

/**
 * Pure computation over a sample buffer. Exposed for testability.
 */
export function computeLiquidationCascade(
  samples: readonly LiquidationSample[],
): LiquidationCascadeReading {
  const n = samples.length;
  if (n === 0) {
    return {
      latestLongLiqUsd: 0, latestShortLiqUsd: 0, totalNotional: 0,
      clusterThreshold: 0, clusterFires: false, dominantSide: null,
      suggestedEntrySide: null, n: 0, warmup: true,
    };
  }
  const latest = samples[n - 1]!;
  const total = latest.longLiqUsd + latest.shortLiqUsd;
  // Rolling-quantile threshold over (long+short) totals.
  const totals = samples.map((s) => s.longLiqUsd + s.shortLiqUsd).sort((a, b) => a - b);
  const tercIdx = Math.min(totals.length - 1, Math.floor(totals.length * TERCILE_UPPER));
  const clusterThreshold = totals[tercIdx] ?? 0;
  const warmup = n < MIN_SAMPLES;
  const clusterFires = !warmup && total >= clusterThreshold && total > 0;
  let dominantSide: 'long_liq_reversion_up' | 'short_liq_reversion_down' | null = null;
  let suggestedEntrySide: 'long' | 'short' | null = null;
  if (clusterFires) {
    if (latest.longLiqUsd > latest.shortLiqUsd) {
      // Longs liquidated (forced sells exhausted) → expect mean-reversion up
      dominantSide = 'long_liq_reversion_up';
      suggestedEntrySide = 'long';
    } else if (latest.shortLiqUsd > latest.longLiqUsd) {
      // Shorts liquidated (forced buys exhausted) → expect mean-reversion down
      dominantSide = 'short_liq_reversion_down';
      suggestedEntrySide = 'short';
    }
  }
  return {
    latestLongLiqUsd: latest.longLiqUsd,
    latestShortLiqUsd: latest.shortLiqUsd,
    totalNotional: total,
    clusterThreshold,
    clusterFires,
    dominantSide,
    suggestedEntrySide,
    n, warmup,
  };
}

/** Test/diagnostic helper. */
export function _resetLiquidationCascade(symbol?: string): void {
  if (symbol === undefined) {
    _samplesBySymbol.clear();
    return;
  }
  _samplesBySymbol.delete(symbol);
}

/** Test/diagnostic helper. */
export function _peekLiquidationCascade(symbol: string): readonly LiquidationSample[] {
  return _samplesBySymbol.get(symbol) ?? [];
}
