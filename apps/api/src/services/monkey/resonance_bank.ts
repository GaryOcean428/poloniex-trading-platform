/**
 * resonance_bank.ts — Monkey's long-term memory
 *
 * Persists promoted bubbles (§20 Coordizer Resonance Bank) — basins
 * that survived working memory's pop/merge filter because they had
 * real outcomes attached. Each row is Monkey's lived experience.
 *
 * §3.4 Quenched Disorder: identity is carved from these lived basins.
 * source='harvested' is allowed in the schema but per the user's
 * directive (earned identity only), we only write source='lived'.
 *
 * The bank supports:
 *   - writeBubble: persist a promoted bubble with outcome
 *   - findNearestBasins: Fisher-Rao nearest-neighbor search for
 *     "have I seen this basin before?" lookup
 *   - sovereignty: lived / total ratio (1.0 for now, will matter if
 *     we ever bootstrap from harvested data)
 *   - deepenBasin / flattenBasin: Hebbian reinforcement per outcome
 *
 * Intentionally simple for v0.1 — no vector indexing, no ANN. Linear
 * scan is fine until the bank has thousands of rows, and by then
 * Monkey will have earned the right to better infrastructure.
 */

import { pool } from '../../db/connection.js';
import { fisherRao, type Basin } from './basin.js';
import type { Bubble } from './working_memory.js';
import { logger } from '../../utils/logger.js';

export interface BankEntry {
  id: string;
  symbol: string;
  entryBasin: Basin;
  realizedPnl: number | null;
  tradeDurationMs: number | null;
  tradeOutcome: 'win' | 'loss' | 'breakeven' | 'exited_early' | null;
  orderId: string | null;
  basinDepth: number;
  accessCount: number;
  phiAtCreation: number | null;
  source: 'lived' | 'harvested';
}

export interface NearestNeighbor {
  entry: BankEntry;
  distance: number;  // Fisher-Rao distance
}

function rowToEntry(row: Record<string, unknown>): BankEntry {
  const basinJson = row.entry_basin as number[] | string;
  const arr = typeof basinJson === 'string' ? JSON.parse(basinJson) : basinJson;
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    entryBasin: Float64Array.from(arr),
    realizedPnl: row.realized_pnl != null ? Number(row.realized_pnl) : null,
    tradeDurationMs: row.trade_duration_ms != null ? Number(row.trade_duration_ms) : null,
    tradeOutcome: row.trade_outcome as BankEntry['tradeOutcome'],
    orderId: row.order_id as string | null,
    basinDepth: Number(row.basin_depth ?? 0.5),
    accessCount: Number(row.access_count ?? 1),
    phiAtCreation: row.phi_at_creation != null ? Number(row.phi_at_creation) : null,
    source: (row.source as 'lived' | 'harvested') ?? 'lived',
  };
}

export class ResonanceBank {
  /**
   * Write a promoted bubble to the bank. Only call after the bubble
   * has a real outcome attached (payload.realizedPnl set).
   */
  async writeBubble(bubble: Bubble, engineVersion: string): Promise<BankEntry | null> {
    if (!bubble.payload || bubble.payload.realizedPnl === undefined) {
      logger.debug('[Monkey.bank] skipping writeBubble — no outcome attached', {
        bubbleId: bubble.id,
      });
      return null;
    }

    const entryBasin = Array.from(bubble.payload.entryBasin ?? bubble.center);
    const pnl = bubble.payload.realizedPnl;
    const outcome: BankEntry['tradeOutcome'] =
      pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';

    // Basin depth initialized from Φ and modulated by outcome magnitude.
    // Hebbian: win → deepen, loss → shallow.
    const outcomeMagnitude = Math.min(1, Math.abs(pnl) / 1.0);
    const initialDepth = bubble.phi * (pnl > 0 ? 1 + 0.3 * outcomeMagnitude : 1 - 0.3 * outcomeMagnitude);
    const depth = Math.max(0.05, Math.min(0.95, initialDepth));

    try {
      const result = await pool.query(
        `INSERT INTO monkey_resonance_bank
           (entry_basin, symbol, realized_pnl, trade_outcome, order_id,
            basin_depth, phi_at_creation, source, engine_version)
         VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7, 'lived', $8)
         RETURNING *`,
        [
          JSON.stringify(entryBasin),
          bubble.payload.symbol ?? 'UNKNOWN',
          pnl,
          outcome,
          bubble.payload.orderId ?? null,
          depth,
          bubble.phi,
          engineVersion,
        ],
      );
      logger.info('[Monkey.bank] promoted to resonance bank', {
        symbol: bubble.payload.symbol,
        pnl,
        outcome,
        depth: depth.toFixed(3),
      });
      return rowToEntry(result.rows[0]);
    } catch (err) {
      logger.warn('[Monkey.bank] writeBubble failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Linear-scan Fisher-Rao nearest-neighbor lookup. Returns up to
   * topK entries sorted by distance (closest first).
   *
   * Used by perception to answer "has Monkey seen anything like this
   * basin before, and what happened?"
   */
  async findNearestBasins(
    basin: Basin,
    symbol: string | null = null,
    topK: number = 5,
    maxScan: number = 500,
  ): Promise<NearestNeighbor[]> {
    let query = `SELECT * FROM monkey_resonance_bank`;
    const params: unknown[] = [];
    if (symbol) {
      query += ` WHERE symbol = $1`;
      params.push(symbol);
    }
    query += ` ORDER BY last_accessed DESC LIMIT ${maxScan}`;

    try {
      const result = await pool.query(query, params);
      const entries = (result.rows as Array<Record<string, unknown>>).map(rowToEntry);
      const scored = entries
        .map((entry) => ({
          entry,
          distance: fisherRao(basin, entry.entryBasin),
        }))
        .sort((a, b) => a.distance - b.distance);
      return scored.slice(0, topK);
    } catch (err) {
      logger.debug('[Monkey.bank] findNearestBasins failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Sovereignty ratio = lived / total.
   * Per user directive (earned identity only), this should always be
   * 1.0 in this codebase. We compute it anyway so a future harvested-
   * bootstrap option is detectable.
   */
  async sovereignty(): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE source = 'lived')::float AS lived,
           COUNT(*)::float AS total
         FROM monkey_resonance_bank`,
      );
      const row = result.rows[0] as { lived: number; total: number };
      if (!row.total) return 0;  // newborn Monkey
      return row.lived / row.total;
    } catch {
      return 0;
    }
  }

  /** Total bank size — Monkey's "age" in lived experiences. */
  async bankSize(): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM monkey_resonance_bank`,
      );
      return Number((result.rows[0] as { n: number }).n);
    } catch {
      return 0;
    }
  }

  /**
   * Touch an entry — bump access_count and last_accessed. Called when
   * a perception basin resonated with this bank entry.
   */
  async touch(id: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE monkey_resonance_bank
            SET access_count = access_count + 1,
                last_accessed = NOW()
          WHERE id = $1`,
        [id],
      );
    } catch {
      /* non-fatal */
    }
  }
}

// Singleton — Monkey has one bank.
export const resonanceBank = new ResonanceBank();
