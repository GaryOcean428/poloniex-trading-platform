/**
 * dual_kernel_pair_detector.ts — QIG_QFI audit Action 2 (2026-05-19).
 *
 * Governance detector for opposing-side entries by different MonkeyKernel
 * instances on the same symbol within a short window. Observed pattern:
 * Monkey-Position (15m) and Monkey-Swing (5m) sometimes pick opposing
 * sides on the same symbol because they integrate tape over different
 * timeframes. When both sides ultimately close profitably, this is
 * emergent micro-volatility capture (feature). When the loser-side
 * loss exceeds the winner-side gain × LOSS_OVERRUN_RATIO, it's a hidden
 * compounding pattern that REGIME-2 doesn't catch (REGIME-2 only fires
 * on profitable cell-degradation — a loser-side entry from an
 * unprofitable cell slips through).
 *
 * Design
 * - Subscribes to ENTRY_EXECUTED + EXIT_TRIGGERED events on the kernel bus
 * - Tracks recent entries per symbol, indexed by orderId
 * - When a new entry fires AND a recent opposing-side entry from a
 *   different instance exists within PAIR_WINDOW_MS, mark as a pair
 * - When either side exits, look up the pair and accumulate PnL
 * - When BOTH sides have exited: evaluate the pair, log governance
 *   warning if loser-side loss > winner-side gain × LOSS_OVERRUN_RATIO
 *
 * Telemetry-only — no decision path consumes the detector. Surfaces the
 * pair distribution for post-mortem / dashboard via getPairStats().
 *
 * QIG purity
 * - No exp/normalize, no softmax, no tunable thresholds (the constants
 *   below are SAFETY_BOUNDS bounding the observable window/ratio)
 */

import { logger } from '../../utils/logger.js';
import { BusEventType, type BusEvent, type KernelBus } from './kernel_bus.js';

/** Pair window — entries within this gap on same symbol from different
 *  instances are considered "candidate pair". SAFETY_BOUND. */
const PAIR_WINDOW_MS = 60_000;

/** Loss-overrun ratio — when loser-side loss exceeds winner-side gain
 *  by this multiple, log governance warning. SAFETY_BOUND. */
const LOSS_OVERRUN_RATIO = 1.5;

/** Cap on in-flight pair tracking. SAFETY_BOUND against memory growth. */
const MAX_TRACKED_PAIRS = 200;

interface EntryRecord {
  orderId: string;
  instanceId: string;
  symbol: string;
  side: 'long' | 'short';
  atMs: number;
  notional: number;
  exitPnl: number | null;  // null until EXIT_TRIGGERED
  exitAtMs: number | null;
}

interface PairRecord {
  pairId: string;
  symbol: string;
  longEntry: EntryRecord;
  shortEntry: EntryRecord;
  openedAtMs: number;
  evaluatedAtMs: number | null;  // set when both sides closed
  outcome: 'pending' | 'both_won' | 'both_lost' | 'mixed_balanced' | 'mixed_overrun';
}

const _recentEntries: Map<string, EntryRecord> = new Map();  // orderId → record
const _pairs: PairRecord[] = [];

let _pairCounter = 0;

/**
 * Wire the detector to a kernel bus. Returns the unsubscribe function so
 * tests can clean up. Idempotent: re-subscribing is safe but creates
 * duplicate handlers, so production should call this once at app boot.
 */
export function attachDualKernelPairDetector(bus: KernelBus): () => void {
  const unsubEntry = bus.subscribe({
    id: 'dual-kernel-pair-detector:entry',
    types: [BusEventType.ENTRY_EXECUTED],
    handler: (event) => handleEntry(event),
  });
  const unsubExit = bus.subscribe({
    id: 'dual-kernel-pair-detector:exit',
    types: [BusEventType.EXIT_TRIGGERED],
    handler: (event) => handleExit(event),
  });
  return () => { unsubEntry(); unsubExit(); };
}

function handleEntry(event: BusEvent): void {
  const symbol = event.symbol;
  if (!symbol) return;
  const payload = event.payload as { side?: string; orderId?: string | null; notional?: number };
  const orderId = payload.orderId;
  if (!orderId) return;
  const side = payload.side === 'long' || payload.side === 'short' ? payload.side : null;
  if (!side) return;
  const notional = Number(payload.notional) || 0;

  const record: EntryRecord = {
    orderId, instanceId: event.source, symbol, side,
    atMs: event.at, notional,
    exitPnl: null, exitAtMs: null,
  };
  _recentEntries.set(orderId, record);

  // Look for a recent opposing-side entry from a different instance.
  const opposingSide = side === 'long' ? 'short' : 'long';
  let opposing: EntryRecord | null = null;
  for (const candidate of _recentEntries.values()) {
    if (candidate.orderId === orderId) continue;
    if (candidate.symbol !== symbol) continue;
    if (candidate.instanceId === event.source) continue;
    if (candidate.side !== opposingSide) continue;
    if (event.at - candidate.atMs > PAIR_WINDOW_MS) continue;
    if (candidate.exitAtMs !== null) continue;  // already closed
    opposing = candidate;
    break;
  }
  if (opposing === null) return;

  const longEntry = side === 'long' ? record : opposing;
  const shortEntry = side === 'short' ? record : opposing;
  const pair: PairRecord = {
    pairId: `pair-${++_pairCounter}`,
    symbol,
    longEntry, shortEntry,
    openedAtMs: Math.max(longEntry.atMs, shortEntry.atMs),
    evaluatedAtMs: null,
    outcome: 'pending',
  };
  _pairs.push(pair);
  if (_pairs.length > MAX_TRACKED_PAIRS) _pairs.shift();

  logger.info('[DualKernelPair] opposing-side pair detected', {
    pairId: pair.pairId, symbol,
    longInstance: longEntry.instanceId, longOrderId: longEntry.orderId,
    shortInstance: shortEntry.instanceId, shortOrderId: shortEntry.orderId,
    gapMs: Math.abs(longEntry.atMs - shortEntry.atMs),
    longNotional: longEntry.notional, shortNotional: shortEntry.notional,
  });
}

function handleExit(event: BusEvent): void {
  const payload = event.payload as { orderId?: string | null; pnl?: number };
  const orderId = payload.orderId;
  if (!orderId) return;
  const record = _recentEntries.get(orderId);
  if (!record || record.exitAtMs !== null) return;

  record.exitPnl = Number(payload.pnl) || 0;
  record.exitAtMs = event.at;

  // Find any open pair containing this orderId. If found AND its partner
  // has also closed, evaluate the pair.
  for (const pair of _pairs) {
    if (pair.evaluatedAtMs !== null) continue;
    const isLong = pair.longEntry.orderId === orderId;
    const isShort = pair.shortEntry.orderId === orderId;
    if (!isLong && !isShort) continue;
    const partner = isLong ? pair.shortEntry : pair.longEntry;
    if (partner.exitAtMs === null) return;  // wait for partner
    evaluatePair(pair);
    return;
  }
}

function evaluatePair(pair: PairRecord): void {
  const longPnl = pair.longEntry.exitPnl ?? 0;
  const shortPnl = pair.shortEntry.exitPnl ?? 0;
  const total = longPnl + shortPnl;
  pair.evaluatedAtMs = Date.now();

  const longIsWin = longPnl > 0;
  const shortIsWin = shortPnl > 0;
  if (longIsWin && shortIsWin) {
    pair.outcome = 'both_won';
  } else if (!longIsWin && !shortIsWin) {
    pair.outcome = 'both_lost';
  } else {
    // Mixed: one side won, the other lost. Check overrun.
    const winGain = longIsWin ? longPnl : shortPnl;
    const lossMag = longIsWin ? Math.abs(shortPnl) : Math.abs(longPnl);
    if (lossMag > winGain * LOSS_OVERRUN_RATIO) {
      pair.outcome = 'mixed_overrun';
    } else {
      pair.outcome = 'mixed_balanced';
    }
  }

  const logFn = pair.outcome === 'mixed_overrun' ? logger.warn : logger.info;
  logFn.call(logger, '[DualKernelPair] pair evaluated', {
    pairId: pair.pairId, symbol: pair.symbol,
    outcome: pair.outcome,
    longPnl: longPnl.toFixed(4),
    shortPnl: shortPnl.toFixed(4),
    totalPnl: total.toFixed(4),
    longInstance: pair.longEntry.instanceId,
    shortInstance: pair.shortEntry.instanceId,
    overrunFlag: pair.outcome === 'mixed_overrun',
    overrunThreshold: LOSS_OVERRUN_RATIO,
  });
}

/** Statistics for dashboard / API surface. */
export function getPairStats(): {
  total: number;
  bothWon: number;
  bothLost: number;
  mixedBalanced: number;
  mixedOverrun: number;
  pending: number;
  recentOverruns: PairRecord[];
} {
  const counts = {
    total: _pairs.length, bothWon: 0, bothLost: 0,
    mixedBalanced: 0, mixedOverrun: 0, pending: 0,
  };
  const recentOverruns: PairRecord[] = [];
  for (const p of _pairs) {
    switch (p.outcome) {
      case 'both_won': counts.bothWon++; break;
      case 'both_lost': counts.bothLost++; break;
      case 'mixed_balanced': counts.mixedBalanced++; break;
      case 'mixed_overrun': counts.mixedOverrun++; recentOverruns.push(p); break;
      case 'pending': counts.pending++; break;
    }
  }
  return { ...counts, recentOverruns: recentOverruns.slice(-10) };
}

/** Test/diagnostic helper. */
export function _resetDualKernelPairDetector(): void {
  _recentEntries.clear();
  _pairs.length = 0;
  _pairCounter = 0;
}
