/**
 * btc_beacon.ts — SENSE-2 #768 (Phase 1, telemetry-only).
 *
 * Cross-symbol correlation observer. When BTC moves hard in one
 * direction, the alt market drags with it. Entering long alt during
 * a BTC dump is structurally wrong — the kernel currently can't see
 * that because basinDirection is per-symbol and ETH's own basin
 * may look constructive while BTC implodes.
 *
 * The BTC beacon surfaces:
 *   - rolling Pearson correlation between this symbol and BTC over a
 *     window of recent price ticks
 *   - BTC's own recent direction (sign of dPrice/dt)
 *   - a derived suppression magnitude: |corr| × |btc_dir|, capped
 *     to [0, 1] for downstream consumption
 *
 * Phase 1 (this module): pure computation + per-symbol rolling buffer
 * of (symbolPrice, btcPrice) pairs + telemetry. No decision path
 * consumes the suppression magnitude yet.
 *
 * Phase 2 (follow-up): wire into entry suppression — alt-long entry
 * gets harder when BTC beacon shows strong negative correlation with
 * strong BTC down move; alt-short gets harder during strong BTC up
 * move; same-side entries get easier when BTC is moving in agreement.
 *
 * Per QIG-pure framing: pure derivation, no operator-tunable
 * thresholds. The correlation IS the signal; the magnitude is the
 * raw product; the downstream consumer decides what magnitude
 * triggers what action.
 */

/** Rolling window matches CAL-3 / trajectory-observer convention. */
const DEFAULT_WINDOW = 60;
/** Min samples before correlation is statistically meaningful.
 *  Below this, returns warmup=true with neutral values (corr=0). */
const MIN_SAMPLES = 8;

export interface BtcBeaconReading {
  /** Pearson correlation coefficient over the rolling window,
   *  in [-1, +1]. NaN-safe (returns 0 when stddev=0 either side). */
  correlation: number;
  /** BTC's own recent direction: sign-magnitude of
   *  (latest − first) / (|first| × n). Positive = BTC trending up;
   *  negative = BTC trending down. Same units as
   *  equity_gradient.gradient. */
  btcDirection: number;
  /** Suppression magnitude in [0, 1] = clamp(|corr| × |btcDir|, 0, 1)
   *  amplified by a saturating mapping so values close to either
   *  scale produce a useful raw signal. The downstream consumer
   *  decides how to use it (suppress, allow, invert direction, etc). */
  suppressionMagnitude: number;
  /** When true, the buffer hasn't accumulated MIN_SAMPLES yet —
   *  all derived values are returned as 0/neutral (fail-soft). */
  warmup: boolean;
  /** Sample count contributing to this reading. */
  n: number;
}

/** Compute the rolling correlation + BTC direction over two same-length
 *  price series. Pure derivation — no state. */
export function computeBtcBeacon(
  symbolPrices: readonly number[],
  btcPrices: readonly number[],
  window: number = DEFAULT_WINDOW,
): BtcBeaconReading {
  const n = Math.min(symbolPrices.length, btcPrices.length);
  if (n < MIN_SAMPLES) {
    return { correlation: 0, btcDirection: 0, suppressionMagnitude: 0, warmup: true, n };
  }
  const symSlice = symbolPrices.slice(-window);
  const btcSlice = btcPrices.slice(-window);
  const m = Math.min(symSlice.length, btcSlice.length);
  // Align trailing slices to the same length.
  const sym = symSlice.slice(-m);
  const btc = btcSlice.slice(-m);

  const corr = pearson(sym, btc);
  const btcFirst = btc[0]!;
  const btcLast = btc[m - 1]!;
  const btcDir = (btcLast - btcFirst) / (Math.max(Math.abs(btcFirst), 1e-9) * m);

  // Suppression magnitude: |corr| × |btcDir|, then a soft cap to [0, 1].
  // Using tanh so very large excursions saturate rather than dominate.
  const raw = Math.abs(corr) * Math.abs(btcDir);
  const suppression = Math.tanh(raw * 100);  // 100 scales typical raw (≈0.005) into the linear-tanh region

  return {
    correlation: corr,
    btcDirection: btcDir,
    suppressionMagnitude: suppression,
    warmup: false,
    n: m,
  };
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let meanA = 0, meanB = 0;
  for (let i = 0; i < n; i++) { meanA += a[i]!; meanB += b[i]!; }
  meanA /= n; meanB /= n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-12) return 0;  // zero-variance on one side → undefined; return neutral
  return cov / denom;
}

/** Per-symbol rolling buffers of paired (symbolPrice, btcPrice). One
 *  observer per non-BTC symbol; BTC's own prices feed every observer. */
interface BeaconState {
  symbolPrices: number[];
  btcPrices: number[];
}
const _states: Map<string, BeaconState> = new Map();
const MAX_BUFFER = 500;

function getState(symbol: string): BeaconState {
  let s = _states.get(symbol);
  if (!s) {
    s = { symbolPrices: [], btcPrices: [] };
    _states.set(symbol, s);
  }
  return s;
}

function pushBoth(state: BeaconState, sym: number, btc: number, cap: number): void {
  state.symbolPrices.push(sym);
  state.btcPrices.push(btc);
  if (state.symbolPrices.length > cap) state.symbolPrices.shift();
  if (state.btcPrices.length > cap) state.btcPrices.shift();
}

/** Observe a new (symbolPrice, btcPrice) sample and return the current
 *  beacon reading. For BTC itself, callers should NOT call this
 *  (correlation with self is trivially 1.0) — pass non-BTC symbols only. */
export function observeBtcBeacon(
  symbol: string,
  symbolPrice: number,
  btcPrice: number,
  window: number = DEFAULT_WINDOW,
): BtcBeaconReading {
  const s = getState(symbol);
  pushBoth(s, symbolPrice, btcPrice, MAX_BUFFER);
  return computeBtcBeacon(s.symbolPrices, s.btcPrices, window);
}

/** Test/diagnostic helpers. */
export function _resetBtcBeacon(symbol?: string): void {
  if (symbol === undefined) { _states.clear(); return; }
  _states.delete(symbol);
}
export function _peekBtcBeacon(symbol: string): { symbolPrices: readonly number[]; btcPrices: readonly number[] } {
  const s = _states.get(symbol);
  return { symbolPrices: s?.symbolPrices ?? [], btcPrices: s?.btcPrices ?? [] };
}
