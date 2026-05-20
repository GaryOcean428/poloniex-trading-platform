/**
 * ws_position_cache.ts — event-driven position truth (Phase D).
 *
 * The kernel currently learns its position state by REST-polling
 * `getPositions()` once per tick. That poll is the root of an entire
 * bug class: between the poll and the action the exchange state moves,
 * so `close_coordinator` sees stale qty, the reconciler sees a
 * side-mismatch that isn't real, and orders get retried into 21002
 * "position not enough" storms (the failures behind #676/#677/#679 and
 * much of the reconciler churn this session).
 *
 * Poloniex v3 exposes a private WebSocket with `position`, `orders`,
 * `trade` and `account` channels — event-driven, immediate. The
 * `futuresWebSocket` client already connects and emits those events;
 * what was missing was a consumer. This module is that consumer: a
 * singleton cache that holds the latest exchange-pushed position
 * snapshot per (symbol, side), with the wall-clock age of that
 * snapshot.
 *
 * Phase D scope is ADDITIVE and shadow-only — the cache is populated
 * and exposed; REST polling stays authoritative. Callers can consult
 * `getPosition` as a fresher cross-check, and the reconciler logs
 * WS-vs-REST agreement so a later PR can flip WS to authoritative on
 * evidence. No decision path depends on this cache yet.
 *
 * Mirrors the in-process-singleton pattern of aggregate_peak.ts —
 * monkey-position and monkey-swing share the process, so an in-memory
 * cache is the right surface; a multi-process split would migrate it
 * to Redis.
 */

import { logger } from '../../utils/logger.js';
import futuresWebSocket from '../../websocket/futuresWebSocket.js';

export type WsPositionSide = 'long' | 'short';

export interface WsPositionSnapshot {
  symbol: string;
  side: WsPositionSide;
  /** Position size in contracts (magnitude — side carries direction). */
  qty: number;
  markPrice: number;
  unrealizedPnlUsdt: number;
  liquidationPrice: number;
  /** ms-since-epoch the exchange pushed this snapshot. */
  observedAt: number;
}

/** Raw shape of the `position` event payload from futuresWebSocket. */
interface RawPositionEvent {
  symbol?: string;
  side?: string;
  posSide?: string;
  currentQty?: number | string;
  qty?: number | string;
  markPrice?: number | string;
  unrealisedPnl?: number | string;
  unrealizedPnl?: number | string;
  liquidationPrice?: number | string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

class WsPositionCache {
  private snapshots: Map<string, WsPositionSnapshot> = new Map();
  private subscribed = false;
  private updateCount = 0;

  private static key(symbol: string, side: WsPositionSide): string {
    return `${symbol}|${side}`;
  }

  /**
   * Resolve the position side from a raw event. v3 HEDGE responses
   * carry the real direction in `posSide` (LONG/SHORT); a `qty` sign is
   * the ONE_WAY fallback. Same canonical resolution as
   * exchangePositionSide.ts — posSide first.
   */
  private static resolveSide(ev: RawPositionEvent): WsPositionSide {
    const posSide = String(ev.posSide ?? ev.side ?? '').toUpperCase();
    if (posSide === 'LONG') return 'long';
    if (posSide === 'SHORT') return 'short';
    const qty = num(ev.currentQty ?? ev.qty);
    return qty < 0 ? 'short' : 'long';
  }

  /**
   * Begin consuming the `futuresWebSocket` private `position` feed.
   * Idempotent — repeated calls do not double-subscribe. Gated by the
   * caller on MONKEY_WS_PRIVATE_LIVE; this method only attaches the
   * listener (the WS client owns its own connect/reconnect lifecycle).
   */
  startFeed(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    futuresWebSocket.on('position', (data: unknown) => {
      try {
        this.ingest(data as RawPositionEvent);
      } catch (err) {
        logger.debug('[WsPositionCache] ingest failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });
    logger.info('[WsPositionCache] subscribed to private position feed');
  }

  /** Apply one raw position event to the cache. */
  private ingest(ev: RawPositionEvent): void {
    if (!ev.symbol) return;
    const side = WsPositionCache.resolveSide(ev);
    const snap: WsPositionSnapshot = {
      symbol: ev.symbol,
      side,
      qty: Math.abs(num(ev.currentQty ?? ev.qty)),
      markPrice: num(ev.markPrice),
      unrealizedPnlUsdt: num(ev.unrealisedPnl ?? ev.unrealizedPnl),
      liquidationPrice: num(ev.liquidationPrice),
      observedAt: Date.now(),
    };
    this.snapshots.set(WsPositionCache.key(ev.symbol, side), snap);
    this.updateCount += 1;
  }

  /**
   * Latest exchange-pushed snapshot for (symbol, side), or null when no
   * event has arrived. A qty of 0 is a valid snapshot (flat after a
   * close) — distinct from null (never observed).
   */
  getPosition(
    symbol: string, side: WsPositionSide,
  ): WsPositionSnapshot | null {
    return this.snapshots.get(WsPositionCache.key(symbol, side)) ?? null;
  }

  /** Age of the latest snapshot in ms, or null if none. */
  getAgeMs(symbol: string, side: WsPositionSide): number | null {
    const s = this.snapshots.get(WsPositionCache.key(symbol, side));
    return s ? Date.now() - s.observedAt : null;
  }

  /** True once the feed listener is attached. */
  isLive(): boolean {
    return this.subscribed;
  }

  /** Telemetry snapshot — all tracked positions + cache stats. */
  snapshot(): {
    live: boolean;
    updateCount: number;
    positions: WsPositionSnapshot[];
  } {
    return {
      live: this.subscribed,
      updateCount: this.updateCount,
      positions: Array.from(this.snapshots.values()),
    };
  }

  /** Test/reset helper. */
  resetForTests(): void {
    this.snapshots.clear();
    this.subscribed = false;
    this.updateCount = 0;
  }

  /** Test helper — inject a raw event without a live WS. */
  ingestForTests(ev: RawPositionEvent): void {
    this.ingest(ev);
  }
}

export const wsPositionCache = new WsPositionCache();
export type { WsPositionCache };
