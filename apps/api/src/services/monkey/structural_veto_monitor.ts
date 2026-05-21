/**
 * structural_veto_monitor.ts — detects structurally dead gates (B1).
 *
 * A gate that is ALWAYS false (a condition that can never be met) or a
 * veto that is ALWAYS true (a block that never lifts) is invisible in
 * normal logs: every individual tick looks reasonable. Over hundreds of
 * ticks it is a silent structural failure — e.g. the |basinDir| > 0.10
 * magnitude gate (M-agent, FAST_ADVERSE_EXIT) sat always-false because
 * the perception basin was near-uniform. Nobody saw the M-agent die.
 *
 * This monitor tracks named boolean signals across ticks and flags any
 * that have been stuck at one value for >= STUCK_TICKS consecutive
 * observations. It is the kernel observing its own dead gates — the
 * counterpart to B1's expressive-basin fix: after the fix lands, a gate
 * that was stuck `false` should start un-sticking, and this monitor is
 * how that is confirmed in production.
 *
 * Process-lifetime, in-memory, no persistence (like getLVetoOverKStats).
 */

import { logger } from '../../utils/logger.js';

/**
 * Consecutive observations at one value before a signal is called
 * structurally stuck. At 30–60 s ticks, 200 ticks ≈ 1.5–3.5 h — long
 * enough that a quiet-market spell does not false-flag, short enough to
 * catch a genuinely dead gate within a session.
 */
export const STUCK_TICKS = 200;

interface SignalState {
  last: boolean;
  /** Consecutive observations at `last`. */
  run: number;
  /** Currently flagged as structurally stuck. */
  stuck: boolean;
  trueCount: number;
  totalCount: number;
}

export class StructuralVetoMonitor {
  private readonly signals = new Map<string, SignalState>();

  /**
   * Record one observation of a named boolean gate/veto.
   * `true` = the gate passed / the veto fired; `false` = it did not.
   */
  observe(name: string, value: boolean): void {
    const s = this.signals.get(name);
    if (!s) {
      this.signals.set(name, {
        last: value, run: 1, stuck: false,
        trueCount: value ? 1 : 0, totalCount: 1,
      });
      return;
    }
    s.totalCount++;
    if (value) s.trueCount++;
    if (value === s.last) {
      s.run++;
      if (!s.stuck && s.run >= STUCK_TICKS) {
        s.stuck = true;
        logger.warn('[StructuralVeto] gate structurally stuck', {
          name,
          value,
          ticks: s.run,
          interpretation: value ? 'veto always-on' : 'gate always-off',
        });
      }
    } else {
      if (s.stuck) {
        logger.info('[StructuralVeto] gate un-stuck', {
          name, was: s.last, now: value, stuckFor: s.run,
        });
      }
      s.last = value;
      s.run = 1;
      s.stuck = false;
    }
  }

  /** Telemetry snapshot — per-signal stuck state + lifetime true-rate. */
  snapshot(): Array<{
    name: string;
    stuck: boolean;
    value: boolean;
    run: number;
    trueRate: number;
  }> {
    const out: Array<{ name: string; stuck: boolean; value: boolean; run: number; trueRate: number }> = [];
    for (const [name, s] of this.signals) {
      out.push({
        name,
        stuck: s.stuck,
        value: s.last,
        run: s.run,
        trueRate: s.totalCount > 0 ? s.trueCount / s.totalCount : 0,
      });
    }
    return out;
  }

  /** Test/restart helper — clears all tracked signals. */
  reset(): void {
    this.signals.clear();
  }
}

/** Shared process-wide monitor. */
export const structuralVetoMonitor = new StructuralVetoMonitor();
