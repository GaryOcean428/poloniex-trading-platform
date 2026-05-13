/**
 * mtfBootstrap.ts — pre-warm per-timeframe basin histories from
 * historical OHLCV at startup.
 *
 * Without this, the 4h MTF instance needs ~480 samples × 4h each =
 * 80 days of live ticks before producing decisions. The 1h instance
 * needs ~600 ticks × 1h = 25 days. Live warmup is unworkable for
 * anything beyond 15m.
 *
 * Bootstrap reads enough OHLCV candles per timeframe to synthesise
 * basins via perceive() at the target cadence, then populates the
 * per-timeframe history via setBootstrapHistory().
 *
 * QIG purity: basins synthesised by the existing perceive() function
 * — same path used live. No new banned operations, no shortcuts.
 *
 * Pure compute given OHLCV inputs; one I/O call (Poloniex public
 * candles endpoint) at the top.
 */
import { setBootstrapHistory, type MTFState, type TimeframeLabel } from './mtfLClassifier.js';
import { perceive } from './perception.js';
import poloniexFuturesService from '../poloniexFuturesService.js';
import { logger } from '../../utils/logger.js';

/** Local OHLCV shape — `poloniexFuturesService.ts` is plain JS with a
 *  default export only, so a named type import (`import type { OHLCVCandle }`)
 *  fails the build. Same shape as the candles returned by
 *  `getHistoricalData()`; locally defined to keep this module
 *  decoupled from upstream type plumbing. */
interface OHLCVCandle {
  timestamp?: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

/** How many candles to request per timeframe. Slightly more than
 *  the warmup minimum (480 + 120 horizon = 600) so the classifier
 *  is warm immediately at startup. */
const BOOTSTRAP_CANDLE_COUNT = 700;

/** Poloniex candle resolution strings keyed by our timeframe label.
 *  These map to the granularity the exchange provides; we DO NOT
 *  do further down-sampling because the basin synthesis already
 *  encodes the perceptual scale via perceive(). */
const POLONIEX_INTERVAL_FOR_TF: Record<TimeframeLabel, string> = {
  '15m': '15m',
  '1h': '60m',
  '4h': '4h',
};

/** Pull OHLCV at the timeframe's resolution and synthesise basins
 *  for the bootstrap. Each candle becomes one basin via the same
 *  perceive() the live loop uses; the sliding-window context for
 *  perceive is the trailing N candles ending at each step.
 *
 *  Errors (network, parse, perceive throw) caught and logged; the
 *  function returns with whatever it managed to compute. The MTF
 *  state warms up gradually from live ticks if bootstrap is empty. */
export async function bootstrapMTFForSymbol(
  symbol: string,
  state: MTFState,
): Promise<void> {
  for (const label of ['15m', '1h', '4h'] as const) {
    try {
      const interval = POLONIEX_INTERVAL_FOR_TF[label];
      const candles = (await poloniexFuturesService.getHistoricalData(
        symbol,
        interval,
        BOOTSTRAP_CANDLE_COUNT,
      )) as OHLCVCandle[];
      if (!Array.isArray(candles) || candles.length < 100) {
        logger.warn('[MTF-bootstrap] insufficient OHLCV from exchange', {
          symbol, label, got: candles?.length ?? 0,
        });
        continue;
      }
      // Synthesise basin per candle with a trailing 50-candle window
      // (matches the live perceive call's input shape). Skip the
      // first 50 candles since they don't have a full lookback.
      const basins: import('./basin.js').Basin[] = [];
      const PERCEIVE_WINDOW = 50;
      for (let i = PERCEIVE_WINDOW; i < candles.length; i++) {
        const window = candles.slice(i - PERCEIVE_WINDOW, i + 1);
        try {
          const basin = perceive({
            ohlcv: window.map((c) => ({
              timestamp: Number(c.timestamp ?? 0),
              open: Number(c.open),
              high: Number(c.high),
              low: Number(c.low),
              close: Number(c.close),
              volume: Number(c.volume),
            })),
            // Bootstrap uses neutral values for non-OHLCV inputs.
            // The OHLCV-driven dimensions dominate the basin shape
            // for classifier matching; bootstrap basins will closely
            // resemble live ones once live ticks add equity/margin
            // context.
            equityFraction: 1.0,
            marginFraction: 0,
            openPositions: 0,
            sessionAgeTicks: 0,
            mlSignal: 'HOLD',
            mlStrength: 0,
          });
          basins.push(basin);
        } catch (_perceiveErr) {
          // Skip this bar; the basin synthesis will be sparser but
          // still useful for the classifier.
        }
      }
      setBootstrapHistory(state, label, basins);
      logger.info('[MTF-bootstrap] populated history', {
        symbol, label, basins: basins.length,
      });
    } catch (err) {
      logger.warn('[MTF-bootstrap] failed for timeframe', {
        symbol, label, err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
