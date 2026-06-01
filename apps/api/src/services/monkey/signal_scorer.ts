/**
 * signal_scorer.ts — measures the kernel's RAW directional prediction
 * BEFORE the entry AND-gate chain, and attributes a win rate to each
 * gate that suppresses entry.
 *
 * QIG-FR v4 learning (Problem 4 — "measure the raw signal, not the
 * filtered entry"): the kernel forms a direction every tick, gates it
 * ~8 ways, and only ever measures P&L on the few entries that survive.
 * It therefore cannot answer "is the chop gate / L-veto / margin gate
 * killing winners?" — there is no counterfactual.
 *
 * This module closes that blind spot. Each tick it records the raw
 * `kernelDirection` prediction plus the gate that suppressed entry (or
 * `passed`). SCORE_HORIZON_TICKS ticks later it scores whether price
 * actually moved that way, and aggregates two numbers the kernel has
 * never had:
 *   - raw-signal win rate — prediction quality BEFORE gating
 *   - per-gate win rate    — WR of the signals each gate killed
 * If a gate's killed-signals win MORE often than the signals that
 * passed, that gate is destroying edge — surfaced as a ⚠ verdict line.
 *
 * Pure telemetry. Wired ON unconditionally (no flag) — it changes no
 * trade behaviour, it only observes and logs. This is the prerequisite
 * for v4 Problem 5 (loosening over-tight gates): you cannot responsibly
 * loosen a gate until you have measured it.
 *
 * QIG purity: arithmetic + comparison only. No geometric ops.
 */

import { logger } from '../../utils/logger.js';

/**
 * Canonical gate labels. `exec:<code>` is dynamic — the executeEntry
 * rejection code (e.g. `exec:margin_headroom`, `exec:funding`).
 *   passed         — cleared every gate; an order executed this tick
 *   position_open  — kernel was managing an existing position (not an
 *                    entry decision); excluded from gate-edge verdicts
 *   mode           — mode profile blocks entry
 *   short_refused  — short side while MONKEY_SHORTS_LIVE=false
 *   min_notional   — sized below the exchange minimum notional
 *   trading_paused — executionMode === 'pause' (operator kill switch)
 *   l_veto         — agent L vetoed K's entry
 *   arbiter_zero   — K's arbiter capital share was zero
 *   exec:<code>    — executeEntry rejected (margin headroom, funding…)
 *   no_entry       — held for a non-gate reason (e.g. DCA cooldown)
 */
export type EntryGate = string;

/** Inputs to the gate resolver — every fact is read from processSymbol
 *  function scope at the point the K entry decision is finalised. */
export interface GateFacts {
  /** An order (entry / DCA / reverse) actually executed this tick. */
  executed: boolean;
  /** Kernel was already holding a position on this symbol. */
  heldSide: 'long' | 'short' | null;
  modeCanEnter: boolean;
  sideShortRefused: boolean;
  /** Derived entry margin before capping. <= 0 means below min notional. */
  sizeValue: number;
  /** true when the operator kill switch (executionMode === 'pause') is active. */
  tradingPaused: boolean;
  lVetoed: boolean;
  /** K margin after the arbiter share cap × chop size factor. */
  cappedMargin: number;
  /** Raw executeEntry rejection reason, when an entry was attempted and
   *  rejected (e.g. `veto:margin_headroom:…`). null otherwise. */
  entryRejectCode: string | null;
}

/**
 * Resolve which gate suppressed the K entry this tick. Priority order
 * mirrors the actual gate chain in loop.ts processSymbol so the label
 * names the FIRST gate that blocked the would-be entry.
 */
export function resolveEntryGate(f: GateFacts): EntryGate {
  if (f.executed) return 'passed';
  if (f.heldSide !== null) return 'position_open';
  if (!f.modeCanEnter) return 'mode';
  if (f.sideShortRefused) return 'short_refused';
  if (f.sizeValue <= 0) return 'min_notional';
  if (f.tradingPaused) return 'trading_paused';
  if (f.lVetoed) return 'l_veto';
  if (f.cappedMargin <= 0) return 'arbiter_zero';
  if (f.entryRejectCode) return `exec:${shortRejectCode(f.entryRejectCode)}`;
  return 'no_entry';
}

/** Reduce an executeEntry rejection string to a short stable code.
 *  `veto:margin_headroom:Margin headroom 14%…` → `margin_headroom`. */
export function shortRejectCode(raw: string): string {
  const parts = raw.split(':');
  if (parts[0] === 'veto' && parts[1]) return parts[1].trim();
  const head = (parts[0] ?? raw).trim();
  return head.split(/\s+/)[0] || 'rejected';
}

/** Measurement window: a prediction is scored this many session ticks
 *  after it is recorded. At the kernel's 30–60 s cadence that is a
 *  ~3–6 minute forward look — long enough to clear tick noise, short
 *  enough to reflect entry-grade timing. A measurement parameter, not
 *  a trade threshold. */
const SCORE_HORIZON_TICKS = 6;
/** Emit the WR table once this many predictions have been scored. */
const LOG_EVERY_SCORES = 50;
/** A gate needs at least this many scored samples before its WR is
 *  trusted enough to flag in a verdict line. */
const MIN_GATE_SAMPLES = 20;
/** A gate's WR must exceed `passed` WR by this margin to be flagged as
 *  edge-destroying. */
const EDGE_MARGIN = 0.05;
/** Hard cap on pending predictions per key — bounds memory if scoring
 *  ever stalls. Oldest are dropped. */
const MAX_PENDING_PER_KEY = 256;

interface PendingPrediction {
  tick: number;
  price: number;
  side: 'long' | 'short';
  gate: EntryGate;
}

interface WinLoss {
  wins: number;
  losses: number;
}

function emptyWL(): WinLoss {
  return { wins: 0, losses: 0 };
}

function wr(wl: WinLoss): number {
  const n = wl.wins + wl.losses;
  return n > 0 ? wl.wins / n : 0;
}

/**
 * Singleton scorer. Pending predictions are keyed by `instanceId::symbol`
 * so the multiple kernel instances (monkey-position / monkey-swing / …)
 * never cross-contaminate. Aggregate win/loss is global — the headline
 * the operator reads is "raw-signal WR" and the per-gate table.
 */
export class SignalScorer {
  private pending = new Map<string, PendingPrediction[]>();
  private rawGlobal: WinLoss = emptyWL();
  private gateGlobal = new Map<EntryGate, WinLoss>();
  private scoresSinceLog = 0;

  /**
   * Record this tick's raw directional prediction. Flat predictions
   * carry no direction and are skipped — raw-signal WR is measured over
   * non-flat predictions only.
   */
  record(args: {
    instanceId: string;
    symbol: string;
    tick: number;
    price: number;
    direction: 'long' | 'short' | 'flat';
    gate: EntryGate;
  }): void {
    if (args.direction === 'flat') return;
    if (!Number.isFinite(args.price) || args.price <= 0) return;
    const key = `${args.instanceId}::${args.symbol}`;
    const list = this.pending.get(key) ?? [];
    list.push({
      tick: args.tick,
      price: args.price,
      side: args.direction,
      gate: args.gate,
    });
    if (list.length > MAX_PENDING_PER_KEY) {
      list.splice(0, list.length - MAX_PENDING_PER_KEY);
    }
    this.pending.set(key, list);
  }

  /**
   * Score every pending prediction for this key that has reached the
   * measurement horizon, then drop it. Call once per tick BEFORE
   * `record` so a freshly recorded prediction is never scored same-tick.
   */
  scoreMatured(args: {
    instanceId: string;
    symbol: string;
    tick: number;
    price: number;
  }): void {
    const key = `${args.instanceId}::${args.symbol}`;
    const list = this.pending.get(key);
    if (!list || list.length === 0) return;
    if (!Number.isFinite(args.price) || args.price <= 0) return;

    const stillPending: PendingPrediction[] = [];
    for (const p of list) {
      if (args.tick - p.tick < SCORE_HORIZON_TICKS) {
        stillPending.push(p);
        continue;
      }
      // Matured — did price move the way the kernel predicted?
      const moved = args.price - p.price;
      const won = p.side === 'long' ? moved > 0 : moved < 0;
      this.tally(p.gate, won);
      this.scoresSinceLog += 1;
    }
    this.pending.set(key, stillPending);

    if (this.scoresSinceLog >= LOG_EVERY_SCORES) {
      this.logSummary();
      this.scoresSinceLog = 0;
    }
  }

  private tally(gate: EntryGate, won: boolean): void {
    if (won) this.rawGlobal.wins += 1;
    else this.rawGlobal.losses += 1;

    const g = this.gateGlobal.get(gate) ?? emptyWL();
    if (won) g.wins += 1;
    else g.losses += 1;
    this.gateGlobal.set(gate, g);
  }

  /** Current aggregates — for governance / external telemetry. */
  snapshot(): {
    raw: { wr: number; n: number };
    gates: Array<{ gate: EntryGate; wr: number; n: number }>;
  } {
    const rawN = this.rawGlobal.wins + this.rawGlobal.losses;
    const gates = [...this.gateGlobal.entries()]
      .map(([gate, wl]) => ({ gate, wr: wr(wl), n: wl.wins + wl.losses }))
      .sort((a, b) => b.n - a.n);
    return { raw: { wr: wr(this.rawGlobal), n: rawN }, gates };
  }

  /**
   * Log the WR table. The verdict line fires when a gate killed signals
   * that — over a trustworthy sample — won MORE often than the signals
   * that passed every gate. That is the v4 "a filter is destroying
   * edge" condition, made measurable.
   */
  private logSummary(): void {
    const snap = this.snapshot();
    const passed = snap.gates.find((g) => g.gate === 'passed');
    const passedWr = passed ? passed.wr : 0;

    const table = snap.gates
      .map((g) => `${g.gate}=${g.wr.toFixed(3)}(n=${g.n})`)
      .join(' ');
    logger.info(
      `[signal-scorer] raw WR=${snap.raw.wr.toFixed(3)} n=${snap.raw.n} ` +
        `horizon=${SCORE_HORIZON_TICKS}t | gates: ${table}`,
    );

    for (const g of snap.gates) {
      if (g.gate === 'passed' || g.gate === 'position_open') continue;
      if (g.n < MIN_GATE_SAMPLES) continue;
      if (g.wr > passedWr + EDGE_MARGIN) {
        logger.warn(
          `[signal-scorer] ⚠ gate '${g.gate}' suppressed signals winning ` +
            `${g.wr.toFixed(3)} (n=${g.n}) vs passed ${passedWr.toFixed(3)} — ` +
            `this gate may be destroying edge`,
        );
      }
    }
  }
}

/** Process-wide singleton. Imported by loop.ts processSymbol. */
export const signalScorer = new SignalScorer();
