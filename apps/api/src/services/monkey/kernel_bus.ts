/**
 * kernel_bus.ts — Inter-kernel pub/sub (v0.6a)
 *
 * Faster-than-DB inter-kernel communication. Ported in spirit from
 * /home/braden/Desktop/Dev/archived-repos-docs/pantheon-projects/Dev/SSC/
 * SearchSpaceCollapse/server/strategy-knowledge-bus.ts — an in-memory
 * event bus that lets kernels publish insights and subscribe to patterns,
 * with a DB tail for persistence + audit.
 *
 * v0.6a goal: the infrastructure is in place BEFORE parallel sub-Monkeys
 * (v0.6b) spawn, so adding ScalpMonkey / SwingMonkey / RangeMonkey only
 * needs `new SubKernel(bus)` — zero bus wiring at that point.
 *
 * Event types are a closed enum so subscribers can pattern-filter without
 * parsing free-text. Payloads are typed per event.
 *
 * Persistence: every event lands in monkey_bus_events (append-only) with
 * a 7-day retention TTL. Useful for post-hoc debugging (why did Monkey
 * flip to DRIFT at 03:14?) and for replay during integration tests.
 */

import { EventEmitter } from 'events';

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

export enum BusEventType {
  /** Monkey entered a new cognitive mode (transition). */
  MODE_TRANSITION = 'mode_transition',
  /** Entry proposed by a decision kernel (not yet executed). */
  ENTRY_PROPOSED = 'entry_proposed',
  /** Entry executed — order placed at exchange. */
  ENTRY_EXECUTED = 'entry_executed',
  /** Exit triggered — scalp TP/SL, Loop 2, or autoflatten. */
  EXIT_TRIGGERED = 'exit_triggered',
  /** Risk kernel vetoed an order. */
  KERNEL_VETO = 'kernel_veto',
  /** Trade closed at exchange; realized P&L attached. */
  OUTCOME = 'outcome',
  /** Anomaly detected by self-observation — downstream kernels may act. */
  ANOMALY = 'anomaly',
  /** Cross-kernel insight: a sub-kernel found a pattern worth sharing. */
  INSIGHT = 'insight',
  /** Witness bubble landed in the resonance bank. */
  BANK_WRITE = 'bank_write',
}

export interface BusEvent {
  type: BusEventType;
  source: string;        // which kernel emitted (e.g. 'monkey-primary', 'risk-kernel', 'scalp-monkey')
  symbol?: string;
  payload: Record<string, unknown>;
  at: number;            // ms since epoch
}

type BusSubscriber = {
  id: string;
  types: Set<BusEventType> | null;   // null = all
  symbols: Set<string> | null;        // null = all
  handler: (event: BusEvent) => void | Promise<void>;
};

class _KernelBus extends EventEmitter {
  private subscribers: BusSubscriber[] = [];
  private static readonly MAX_LISTENERS = 50;

  constructor() {
    super();
    this.setMaxListeners(_KernelBus.MAX_LISTENERS);
  }

  /**
   * Publish an event. Sync fan-out to subscribers (fire-and-forget —
   * subscriber exceptions don't propagate). Async DB write in background.
   */
  publish(event: Omit<BusEvent, 'at'>): void {
    const full: BusEvent = { ...event, at: Date.now() };
    // Sync fan-out first so subscribers see it immediately.
    for (const sub of this.subscribers) {
      if (sub.types && !sub.types.has(full.type)) continue;
      if (sub.symbols && full.symbol && !sub.symbols.has(full.symbol)) continue;
      try {
        const out = sub.handler(full);
        if (out && typeof (out as Promise<void>).catch === 'function') {
          (out as Promise<void>).catch((err) => {
            logger.debug('[KernelBus] subscriber async error', {
              sub: sub.id, err: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        logger.debug('[KernelBus] subscriber sync error', {
          sub: sub.id, err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // DB tail — non-blocking.
    void this.persist(full);
    // Classic EventEmitter broadcast for anyone wanting raw on().
    this.emit(full.type, full);
    this.emit('*', full);
  }

  /**
   * Subscribe to events. Returns unsubscribe function.
   */
  subscribe(opts: {
    id: string;
    types?: BusEventType[];
    symbols?: string[];
    handler: (event: BusEvent) => void | Promise<void>;
  }): () => void {
    const sub: BusSubscriber = {
      id: opts.id,
      types: opts.types ? new Set(opts.types) : null,
      symbols: opts.symbols ? new Set(opts.symbols) : null,
      handler: opts.handler,
    };
    this.subscribers.push(sub);
    return () => {
      const idx = this.subscribers.findIndex((s) => s === sub);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }

  /** Number of active subscribers — surfaced for dashboard. */
  subscriberCount(): number {
    return this.subscribers.length;
  }

  private async persist(event: BusEvent): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO monkey_bus_events (at, type, source, symbol, payload)
         VALUES (to_timestamp($1::double precision / 1000), $2, $3, $4, $5::jsonb)`,
        [event.at, event.type, event.source, event.symbol ?? null, JSON.stringify(event.payload)],
      );
    } catch (err) {
      logger.debug('[KernelBus] persist failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Query recent events by filter. Used by the UI timeline and by
   * self-observation for pattern discovery.
   */
  async queryRecent(opts: {
    types?: BusEventType[];
    symbol?: string;
    sinceMs?: number;
    limit?: number;
  } = {}): Promise<BusEvent[]> {
    const { types, symbol, sinceMs, limit = 100 } = opts;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (types && types.length > 0) {
      params.push(types);
      conds.push(`type = ANY($${params.length}::text[])`);
    }
    if (symbol) {
      params.push(symbol);
      conds.push(`symbol = $${params.length}`);
    }
    if (sinceMs) {
      params.push(new Date(sinceMs).toISOString());
      conds.push(`at > $${params.length}`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit);
    try {
      const result = await pool.query(
        `SELECT at, type, source, symbol, payload FROM monkey_bus_events
         ${where}
         ORDER BY at DESC LIMIT $${params.length}`,
        params,
      );
      return (result.rows as Array<Record<string, unknown>>).map((r) => ({
        type: r.type as BusEventType,
        source: String(r.source),
        symbol: r.symbol ? String(r.symbol) : undefined,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload as Record<string, unknown>),
        at: new Date(r.at as string).getTime(),
      }));
    } catch (err) {
      logger.debug('[KernelBus] queryRecent failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

export type KernelBus = _KernelBus;

// Singleton — one bus per process. Sub-kernels grab it with getKernelBus().
let _instance: _KernelBus | null = null;
export function getKernelBus(): _KernelBus {
  if (!_instance) _instance = new _KernelBus();
  return _instance;
}
