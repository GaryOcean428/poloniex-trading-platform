/**
 * shadow_signal_scorer.ts — measure the UNGATED prediction (Improvement A).
 *
 * The v4 QIG-Fisher-Rao design's deepest learning (its Problem 4): a
 * classifier that only scores its FILTERED entries can never tell
 * whether the filters help — the statistics only move on trades that
 * already passed every gate, so there is no counterfactual.
 *
 * Polytrade has that blind spot at scale. Each tick the kernel forms a
 * raw `sideCandidate` (long/short), then puts it through 8 mandatory
 * AND-gates (mode, direction≠flat, chop-suppression, size, short-refusal,
 * trading-paused, L-veto, arbiter-cap). Only the few that survive become
 * entries, and only those are ever scored. The kernel therefore cannot
 * answer: "is the chop gate killing winners? is the L-veto net-positive?"
 *
 * This module closes that gap. Every tick it records the raw directional
 * prediction AND which gate (if any) suppressed it. `horizonTicks` later
 * it scores whether price actually moved that way. The output is two
 * things the kernel has never had:
 *
 *   1. raw-signal win rate — how good is the prediction BEFORE gating.
 *   2. per-gate win rate    — of the signals a given gate suppressed,
 *      what fraction would have won. If a gate's suppressed-signals win
 *      MORE than the entries that passed, that gate is destroying edge.
 *
 * Telemetry-only. No decision path consumes this; it never changes a
 * trade. It is the prerequisite measurement for any future gate
 * softening — you cannot responsibly loosen a gate you have not scored.
 *
 * In-process singleton, matching aggregate_peak.ts / ws_position_cache.ts /
 * market_intel.ts.
 */

import { logger } from '../../utils/logger.js';

export type ShadowSide = 'long' | 'short';

/**
 * The outcome label for a tick's raw prediction — either it became an
 * entry, or the named gate suppressed it. Kept as a free string so new
 * gates need no enum edit; the kernel passes one of:
 *   'entered' | 'mode' | 'flat' | 'chop' | 'size' | 'short_refused'
 *   | 'paused' | 'l_veto' | 'arbiter' | 'other'
 */
export type GateLabel = string;

interface PendingObservation {
  symbol: string;
  side: ShadowSide;
  gate: GateLabel;
  entryPrice: number;
  tickRecorded: number;
}

interface GateTally {
  wins: number;
  losses: number;
  neutral: number;
}

const HORIZON_TICKS_DEFAULT = 20;
/** Min |return| (fraction) to count a resolution as win/loss vs neutral. */
const NEUTRAL_BAND_DEFAULT = 0.0005;  // 0.05%

class ShadowSignalScorer {
  private pending: PendingObservation[] = [];
  private byGate: Map<GateLabel, GateTally> = new Map();
  private tickCounter = 0;
  private resolvedCount = 0;

  private horizonTicks(): number {
    return Number(process.env.MONKEY_SHADOW_HORIZON_TICKS) || HORIZON_TICKS_DEFAULT;
  }

  private neutralBand(): number {
    return Number(process.env.MONKEY_SHADOW_NEUTRAL_BAND) || NEUTRAL_BAND_DEFAULT;
  }

  private tally(gate: GateLabel): GateTally {
    let t = this.byGate.get(gate);
    if (!t) {
      t = { wins: 0, losses: 0, neutral: 0 };
      this.byGate.set(gate, t);
    }
    return t;
  }

  /**
   * Record this tick's raw prediction + the gate outcome, and resolve
   * any observations that have now reached the scoring horizon.
   *
   * Called once per symbol per tick from processSymbol. `markPrice` is
   * the live price — used both as the entry reference for this tick's
   * observation and as the resolution price for matured observations.
   *
   * `side` is the raw sideCandidate BEFORE gating. `gate` is 'entered'
   * when the prediction cleared all gates, else the gate that stopped it.
   */
  recordTick(
    symbol: string,
    side: ShadowSide,
    gate: GateLabel,
    markPrice: number,
  ): void {
    this.tickCounter += 1;

    // 1. Resolve matured observations for this symbol against markPrice.
    const horizon = this.horizonTicks();
    const band = this.neutralBand();
    const stillPending: PendingObservation[] = [];
    for (const obs of this.pending) {
      if (obs.symbol !== symbol) {
        stillPending.push(obs);
        continue;
      }
      if (this.tickCounter - obs.tickRecorded < horizon) {
        stillPending.push(obs);
        continue;
      }
      // Matured — score it. Return in the direction the signal predicted.
      const rawReturn = obs.entryPrice > 0
        ? (markPrice - obs.entryPrice) / obs.entryPrice
        : 0;
      const dirReturn = obs.side === 'long' ? rawReturn : -rawReturn;
      const t = this.tally(obs.gate);
      if (dirReturn > band) t.wins += 1;
      else if (dirReturn < -band) t.losses += 1;
      else t.neutral += 1;
      this.resolvedCount += 1;
    }
    this.pending = stillPending;

    // 2. Record this tick's observation.
    if (markPrice > 0) {
      this.pending.push({
        symbol, side, gate,
        entryPrice: markPrice,
        tickRecorded: this.tickCounter,
      });
    }
  }

  /**
   * Per-gate + overall win rates. The headline read: compare the win
   * rate of `entered` against each suppressing gate. A gate whose
   * suppressed signals win at a HIGHER rate than `entered` is removing
   * edge — a candidate for softening (Improvement B).
   */
  snapshot(): {
    resolvedCount: number;
    pendingCount: number;
    overall: { winRate: number; n: number };
    byGate: Array<{
      gate: GateLabel;
      wins: number;
      losses: number;
      neutral: number;
      n: number;
      winRate: number;
    }>;
  } {
    let totWins = 0;
    let totDecided = 0;
    const gates: ShadowSignalScorerSnapshotGate[] = [];
    for (const [gate, t] of this.byGate.entries()) {
      const decided = t.wins + t.losses;
      totWins += t.wins;
      totDecided += decided;
      gates.push({
        gate,
        wins: t.wins,
        losses: t.losses,
        neutral: t.neutral,
        n: t.wins + t.losses + t.neutral,
        winRate: decided > 0 ? t.wins / decided : 0,
      });
    }
    gates.sort((a, b) => b.n - a.n);
    return {
      resolvedCount: this.resolvedCount,
      pendingCount: this.pending.length,
      overall: {
        winRate: totDecided > 0 ? totWins / totDecided : 0,
        n: totDecided,
      },
      byGate: gates,
    };
  }

  /** Compact one-line telemetry string for periodic logging. */
  telemetryLine(): string {
    const s = this.snapshot();
    const parts = s.byGate
      .filter(g => g.n >= 5)
      .map(g => `${g.gate}:${(g.winRate * 100).toFixed(0)}%/${g.n}`);
    return `[ShadowScorer] overall ${(s.overall.winRate * 100).toFixed(1)}%`
      + ` (n=${s.overall.n}, pending=${s.pendingCount}) | ${parts.join(' ')}`;
  }

  /**
   * Emit the telemetry line at INFO, self-throttled — only every
   * `MONKEY_SHADOW_LOG_EVERY` calls (default 20, ≈10 min at the 30 s
   * tick) so a once-per-tick caller does not flood the log.
   */
  private logCallCount = 0;
  logTelemetry(): void {
    this.logCallCount += 1;
    const every = Number(process.env.MONKEY_SHADOW_LOG_EVERY) || 20;
    if (this.logCallCount % every !== 0) return;
    if (this.resolvedCount > 0) {
      logger.info(this.telemetryLine());
    }
  }

  /** Test/reset helper. */
  resetForTests(): void {
    this.pending = [];
    this.byGate.clear();
    this.tickCounter = 0;
    this.resolvedCount = 0;
  }
}

interface ShadowSignalScorerSnapshotGate {
  gate: GateLabel;
  wins: number;
  losses: number;
  neutral: number;
  n: number;
  winRate: number;
}

export const shadowSignalScorer = new ShadowSignalScorer();
export type { ShadowSignalScorer };
