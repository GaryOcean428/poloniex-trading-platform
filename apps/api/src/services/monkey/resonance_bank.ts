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
import type { LaneType } from './executive.js';
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
  /** v0.8.6 (#586) — execution lane active when this bubble was recorded. */
  lane: LaneType;
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
    lane: (row.lane as LaneType | null) ?? 'swing',
  };
}

export class ResonanceBank {
  // In-memory dedup set — rebuilt from DB on first write.
  // Prevents duplicate bank entries from concurrent promotions or
  // startup replay (both kernels, and restart re-replay of history).
  private readonly seenOrderIds = new Set<string>();
  private seenOrderIdsLoaded = false;
  private seenOrderIdsLoadingPromise: Promise<void> | null = null;

  private async ensureSeenOrderIdsLoaded(): Promise<void> {
    if (this.seenOrderIdsLoaded) return;
    if (this.seenOrderIdsLoadingPromise) {
      await this.seenOrderIdsLoadingPromise;
      return;
    }
    this.seenOrderIdsLoadingPromise = (async () => {
      try {
        const result = await pool.query(
          `SELECT order_id FROM monkey_resonance_bank WHERE order_id IS NOT NULL`,
        );
        for (const row of result.rows as Array<{ order_id: string }>) {
          this.seenOrderIds.add(row.order_id);
        }
        this.seenOrderIdsLoaded = true;
      } catch (err) {
        logger.warn('[Monkey.bank] failed to load seen order IDs (dedup cache)', {
          err: err instanceof Error ? err.message : String(err),
        });
        // Reset so the next call retries the load.
        this.seenOrderIdsLoadingPromise = null;
      }
    })();
    await this.seenOrderIdsLoadingPromise;
  }

  /**
   * Returns true if the given orderId has already been promoted to the
   * bank in this session or a prior one. Used in tests and for
   * external dedup checks.
   */
  async hasOrderId(orderId: string): Promise<boolean> {
    await this.ensureSeenOrderIdsLoaded();
    return this.seenOrderIds.has(orderId);
  }

  /**
   * Write a promoted bubble to the bank. Only call after the bubble
   * has a real outcome attached (payload.realizedPnl set).
   *
   * Idempotent on orderId: if the same orderId was already promoted
   * (in this session or a prior one), the call is a no-op and returns
   * null. This prevents double/triple-counting on container restart
   * and when both Position and Swing kernels witness the same exit.
   */
  async writeBubble(bubble: Bubble, engineVersion: string): Promise<BankEntry | null> {
    if (!bubble.payload || bubble.payload.realizedPnl === undefined) {
      logger.debug('[Monkey.bank] skipping writeBubble — no outcome attached', {
        bubbleId: bubble.id,
      });
      return null;
    }

    // Dedup guard: skip if this orderId was already promoted (same or prior session).
    const orderId = bubble.payload.orderId ?? null;
    if (orderId) {
      await this.ensureSeenOrderIdsLoaded();
      if (this.seenOrderIds.has(orderId)) {
        logger.debug('[Monkey.bank] skip duplicate promotion', { orderId });
        return null;
      }
      // Reserve the slot synchronously to block concurrent duplicate calls
      // for the same orderId before the async INSERT completes.
      this.seenOrderIds.add(orderId);
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
            basin_depth, phi_at_creation, source, engine_version, lane)
         VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7, 'lived', $8, $9)
         RETURNING *`,
        [
          JSON.stringify(entryBasin),
          bubble.payload.symbol ?? 'UNKNOWN',
          pnl,
          outcome,
          orderId,
          depth,
          bubble.phi,
          engineVersion,
          bubble.payload.lane ?? 'swing',
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
      // Release the reservation so the entry can be retried in this session.
      if (orderId) {
        this.seenOrderIds.delete(orderId);
      }
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
   *
   * When *lane* is given, only entries for that lane are scored.
   * This prevents cross-lane reward contamination (#586 §4): "what
   * works in scalp at this basin state" is a separate query from
   * "what works in swing at this basin state."
   */
  async findNearestBasins(
    basin: Basin,
    symbol: string | null = null,
    topK: number = 5,
    maxScan: number = 500,
    lane: LaneType | null = null,
  ): Promise<NearestNeighbor[]> {
    // #579 — exclude quarantined bubbles from retrieval. Pre-basin-fix
    // bubbles (created before 589c775 / 2026-04-27T02:39:32Z) have warped
    // geometric coordinates because basinDir was pegged at -1.0; including
    // them in nearest-neighbour search poisons retrieval against any
    // post-fix bearish-lean tick. Migration 036 marks the cutoff.
    let query = `SELECT * FROM monkey_resonance_bank WHERE quarantined = false`;
    // Dynamic $N placeholders: each filter appended in order, $1, $2, ...
    // params.push() happens immediately after each placeholder is added so
    // `params.length + 1` always yields the next correct index.
    const params: unknown[] = [];
    if (symbol) {
      query += ` AND symbol = $${params.length + 1}`;
      params.push(symbol);
    }
    // #586 — lane-filtered retrieval. Each lane has a separate geometric
    // signature; mixing them contaminates the reward landscape.
    if (lane) {
      query += ` AND lane = $${params.length + 1}`;
      params.push(lane);
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
      // #579 — quarantined bubbles do not count toward sovereignty.
      // Earned identity must come from valid lived experience; bubbles
      // recorded under the saturated-basin bug have warped geometric
      // labels even when the outcome label is correct.
      const result = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE source = 'lived')::float AS lived,
           COUNT(*)::float AS total
         FROM monkey_resonance_bank
         WHERE quarantined = false`,
      );
      const row = result.rows[0] as { lived: number; total: number };
      if (!row.total) return 0;  // newborn Monkey
      return row.lived / row.total;
    } catch {
      return 0;
    }
  }

  /** Total bank size — Monkey's "age" in lived experiences.
   * #579 — excludes quarantined bubbles. Quarantined entries are
   * preserved for forensic analysis but don't contribute to maturity
   * gating (current_position_size, etc.).
   */
  async bankSize(): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM monkey_resonance_bank WHERE quarantined = false`,
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
