/**
 * fill_quality_recorder.ts — evidence collection for #827.
 *
 * Records per-symbol fill quality data (slippage, resting time, direction)
 * for post-hoc analysis of ETH maker fat-tail losses.
 *
 * Read-only telemetry: NEVER blocks trading. All writes are best-effort.
 * The kernel observes its own fill quality — observer-derived, no knobs.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

export interface FillQualityRecord {
  symbol: string;
  side: 'long' | 'short';
  orderType: 'maker' | 'taker';
  entryPrice: number;
  fillPrice: number;
  restingMs?: number | null;
  outcomePnl?: number | null;
  /** autonomous_trades.id — a UUID string, not a number. */
  tradeId?: string | null;
}

export async function recordFillQuality(record: FillQualityRecord): Promise<void> {
  const slippageFrac = (record.fillPrice - record.entryPrice) / record.entryPrice;
  try {
    await pool.query(
      `INSERT INTO symbol_fill_quality
         (symbol, side, order_type, entry_price, fill_price, slippage_frac, resting_ms, outcome_pnl, trade_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.symbol, record.side, record.orderType, record.entryPrice,
        record.fillPrice, slippageFrac, record.restingMs ?? null,
        record.outcomePnl ?? null, record.tradeId ?? null,
      ],
    );
  } catch (err) {
    logger.warn('[fill_quality] record failed (non-fatal)', {
      symbol: record.symbol, err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Per-symbol fill quality summary — the kernel observes its own fill history.
 * Returns null on error (fail open).
 */
export async function getSymbolFillQuality(symbol: string, lookbackRows = 100): Promise<{
  symbol: string;
  makerSlippageMean: number | null;
  takerSlippageMean: number | null;
  makerWinRate: number | null;
  avgRestingMs: number | null;
  n: number;
} | null> {
  try {
    const result = await pool.query<{
      order_type: string; slippage_frac: number; outcome_pnl: number | null; resting_ms: number | null;
    }>(
      `SELECT order_type, slippage_frac, outcome_pnl, resting_ms
       FROM symbol_fill_quality
       WHERE symbol = $1
       ORDER BY captured_at DESC LIMIT $2`,
      [symbol, lookbackRows],
    );
    const rows = result.rows;
    if (rows.length === 0) return { symbol, makerSlippageMean: null, takerSlippageMean: null, makerWinRate: null, avgRestingMs: null, n: 0 };
    const maker = rows.filter(r => r.order_type === 'maker');
    const taker = rows.filter(r => r.order_type === 'taker');
    const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const makerSlips = maker.map(r => r.slippage_frac);
    const takerSlips = taker.map(r => r.slippage_frac);
    const makerOutcomes = maker.filter(r => r.outcome_pnl != null).map(r => r.outcome_pnl!);
    const makerWins = makerOutcomes.filter(p => p > 0).length;
    const restingMs = maker.filter(r => r.resting_ms != null).map(r => r.resting_ms!);
    return {
      symbol,
      makerSlippageMean: mean(makerSlips),
      takerSlippageMean: mean(takerSlips),
      makerWinRate: makerOutcomes.length > 0 ? makerWins / makerOutcomes.length : null,
      avgRestingMs: mean(restingMs),
      n: rows.length,
    };
  } catch (err) {
    logger.warn('[fill_quality] getSymbolFillQuality failed', { symbol, err: String(err) });
    return null;
  }
}
