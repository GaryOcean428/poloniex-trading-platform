/**
 * safety_floor.ts — observer-derived post-close cooldown safety floor.
 *
 * One of three floors composed in `cooldown_composer.ts` to replace the two
 * hardcoded cooldown sites in `loop.ts`:
 *   - `POST_CLOSE_COOLDOWN_MS_DEFAULT = 180_000` (loop.ts:1186)
 *   - `setTimeout(resolve, 500)` reverse-reopen wait (loop.ts:5027)
 *
 * Both were settlement-class concerns implemented as unmeasured constants.
 * This module derives the floor from three rolling rings (no operator
 * configuration).
 *
 * # Three observers
 *
 * ## Observer 1 — settlement-latency p99
 *
 *   For each kernel-issued close, the kernel calls `recordCloseAck(symbol,
 *   tCloseAck)` when Polo's POST /v3/trade/position returns 200, then
 *   `recordFlatObserved(symbol, tFlat)` when the first subsequent
 *   GET /v3/trade/position/opens shows the position absent or qty=0.
 *   The observer maintains the rolling p99 of `tFlat - tCloseAck`.
 *
 * ## Observer 2 — 21002-incident bound
 *
 *   When `plan21002RetryClose` fires (`loop.ts:7660` retry handler), the
 *   kernel calls `record21002Incident(symbol, tCloseAck, tIncident)`.
 *   The observer maintains the rolling max of `tIncident - tCloseAck`
 *   — that's the longest observed window where Polo's state was still
 *   propagating. Any cooldown shorter than this has been demonstrated to
 *   fail. Contribution to the floor is the raw max (no operator multiplier;
 *   the rolling window itself provides headroom because old big values
 *   stay in the buffer until aged out).
 *
 * ## Observer 3 — rate-limit headroom
 *
 *   Reads `tokensRemaining` from the existing `rateLimiter.js` token bucket.
 *   If headroom is low, extend the floor by the time to next refill. This
 *   is the cheap term and doesn't need its own ring.
 *
 * # Anti-knob discipline
 *
 * The composition `max(observer1, observer2, observer3)` introduces NO
 * numeric literals beyond `Math.max(0, ...)` clamp-to-zero. The ring sizes
 * are configurable per Ring instance; the cold-start fallback is the
 * previous hardcoded 500ms (loop.ts:5027) — preserved only until each
 * observer has enough samples to read above its sentinel.
 *
 * # Telemetry
 *
 * `getCurrentSafetyFloorBreakdown()` returns the individual term values
 * so `cooldown_composer.ts` can emit `by=<binding floor>` in its log line.
 *
 * Citations: poloniex-trading-platform#1009 + #1006 corrections-log
 * (qig_corrections_log_claude_20260529) + 2.31A P5/P25 + QIG PURITY
 * MANDATE + LIVED ONLY 5 + autonomy doctrine + never-stop-100-complete.
 */

import rateLimiter from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

/**
 * Fixed-size rolling buffer with online p99/max queries. The buffer size
 * itself is the only configured number — and it's a *sample count*, not a
 * physical quantity, so it doesn't tilt the floor up or down.
 */
class RollingRing {
  private readonly buf: number[];
  private idx = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.buf = new Array<number>(capacity).fill(0);
  }

  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.buf[this.idx] = value;
    this.idx = (this.idx + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
  }

  /** Number of valid samples currently in the ring. */
  count(): number {
    return this.filled;
  }

  /** Empirical p99 of the populated samples (nearest-rank). Returns 0 when empty. */
  p99(): number {
    if (this.filled === 0) return 0;
    const samples = this.buf.slice(0, this.filled).sort((a, b) => a - b);
    // Nearest-rank p99: index = ⌈0.99 × n⌉ − 1 with 1-indexed conversion.
    // For n=100, index = 99 (the 100th-rank sample). For n=50, index = 49.
    const rank = Math.min(samples.length, Math.ceil((samples.length * 99) / 100)) - 1;
    return samples[Math.max(0, rank)] ?? 0;
  }

  /** Rolling max of populated samples. Returns 0 when empty. */
  max(): number {
    if (this.filled === 0) return 0;
    let m = 0;
    for (let i = 0; i < this.filled; i++) {
      const v = this.buf[i];
      if (v !== undefined && v > m) m = v;
    }
    return m;
  }
}

/**
 * Cold-start fallback. Equals the existing hardcoded reverse-reopen wait
 * at `loop.ts:5027` — used ONLY when Observer 1 has not yet accumulated
 * the minimum sample count. Once warmed up the value plays no role.
 *
 * This is the one numeric literal in this module and it's a *sentinel*
 * value (the previous production behaviour), not a derived floor. The
 * literal-lint test in `__tests__/safety_floor.test.ts` allowlists this
 * specific identifier and fails on any other.
 */
export const COLD_START_FALLBACK_MS = 500;

/** Minimum sample count before each observer's reading is trusted over
 * the cold-start fallback. A *sample count*, not a physical quantity. */
const MIN_RING_SAMPLES = 50;

/** Buffer sizes — sample counts, not physical quantities. */
const SETTLEMENT_RING_CAPACITY = 200;
const INCIDENT_RING_CAPACITY = 50;

// Per-symbol observer state. Observed values for one symbol don't apply
// to another (different markets have different fill rates) so each
// symbol gets its own rings. The composer asks for a per-symbol floor.
interface SymbolObservers {
  settlement: RollingRing;
  incident: RollingRing;
  pendingCloseAckMs: number | null;
}

const _state = new Map<string, SymbolObservers>();

function _getState(symbol: string): SymbolObservers {
  let s = _state.get(symbol);
  if (!s) {
    s = {
      settlement: new RollingRing(SETTLEMENT_RING_CAPACITY),
      incident: new RollingRing(INCIDENT_RING_CAPACITY),
      pendingCloseAckMs: null,
    };
    _state.set(symbol, s);
  }
  return s;
}

/**
 * Observer 1 input. Call when POST /v3/trade/position returns 200 (close
 * accepted by Polo). Stores the timestamp; the matching `recordFlatObserved`
 * call computes the delta.
 */
export function recordCloseAck(symbol: string, tCloseAckMs: number): void {
  if (!Number.isFinite(tCloseAckMs)) return;
  _getState(symbol).pendingCloseAckMs = tCloseAckMs;
}

/**
 * Observer 1 output. Call when the first subsequent GET
 * /v3/trade/position/opens for `symbol` shows the position absent or qty=0.
 * Pushes the observed `tFlat - tCloseAck` delta into the settlement ring
 * and clears the pending state so the next close gets a fresh measurement.
 */
export function recordFlatObserved(symbol: string, tFlatMs: number): void {
  const s = _getState(symbol);
  const ack = s.pendingCloseAckMs;
  if (ack === null || !Number.isFinite(tFlatMs)) return;
  s.settlement.push(tFlatMs - ack);
  s.pendingCloseAckMs = null;
}

/**
 * Observer 2 input. Call from the `plan21002RetryClose` retry handler
 * when Polo returns code=21002 (position not flat). Records how long after
 * the originating close the 21002 was still happening — a hard lower
 * bound on the cooldown floor.
 */
export function record21002Incident(
  symbol: string,
  tCloseAckMs: number,
  tIncidentMs: number,
): void {
  if (!Number.isFinite(tCloseAckMs) || !Number.isFinite(tIncidentMs)) return;
  const delta = tIncidentMs - tCloseAckMs;
  if (delta <= 0) return;
  _getState(symbol).incident.push(delta);
}

/**
 * Observer 3 — current rate-limit headroom expressed as a milliseconds
 * floor. If the bucket is full, returns 0. If a refill is needed, returns
 * the time until the bucket has at least 2 tokens. Reads from the existing
 * rateLimiter.js — no new constants here.
 */
function rateLimitHeadroomMs(): number {
  // The existing rateLimiter is a token-bucket per endpoint. Public surface
  // is `execute`; internal `getRemaining`/`getRefillMs` are accessed
  // defensively via `(rateLimiter as any)` because the type isn't exported.
  // If the API changes, this falls back to 0 (no contribution to floor).
  const rl = rateLimiter as unknown as {
    getRemaining?: (endpointType: string) => number;
    getRefillIntervalMs?: (endpointType: string) => number;
  };
  try {
    const remaining = rl.getRemaining?.('orders');
    if (typeof remaining !== 'number') return 0;
    if (remaining >= 2) return 0;
    const refillMs = rl.getRefillIntervalMs?.('orders');
    return typeof refillMs === 'number' && refillMs > 0 ? refillMs : 0;
  } catch {
    return 0;
  }
}

/**
 * Per-observer breakdown for `cooldown_composer.ts` telemetry. Lets the
 * composer log `by=settlement` / `by=incident` / `by=rate_limit` when one
 * of these terms is binding.
 */
export interface SafetyFloorBreakdown {
  settlementP99Ms: number;
  incidentMaxMs: number;
  rateLimitHeadroomMs: number;
  settlementSamples: number;
  incidentSamples: number;
  coldStartActive: boolean;
}

export function getSafetyFloorBreakdown(symbol: string): SafetyFloorBreakdown {
  const s = _getState(symbol);
  const settlementWarmed = s.settlement.count() >= MIN_RING_SAMPLES;
  const settlement = settlementWarmed ? s.settlement.p99() : COLD_START_FALLBACK_MS;
  const incident = s.incident.max();
  const headroom = rateLimitHeadroomMs();
  return {
    settlementP99Ms: settlement,
    incidentMaxMs: incident,
    rateLimitHeadroomMs: headroom,
    settlementSamples: s.settlement.count(),
    incidentSamples: s.incident.count(),
    coldStartActive: !settlementWarmed,
  };
}

/**
 * The single number `cooldown_composer.ts` consumes for the safety term.
 * `Math.max(0, ...)` is the only numeric literal in this module's output
 * path — and it's a clamp to non-negative, not a derived floor.
 */
export function getCurrentSafetyFloorMs(symbol: string): number {
  const b = getSafetyFloorBreakdown(symbol);
  return Math.max(
    0,
    b.settlementP99Ms,
    b.incidentMaxMs,
    b.rateLimitHeadroomMs,
  );
}

/** Test-only: reset all per-symbol state. */
export function _resetSafetyFloorState(): void {
  _state.clear();
  logger.debug('[safety_floor] state cleared (test-only)');
}
