/**
 * per_agent_bus.ts — bus subscription helpers for cross-agent
 * observation.
 *
 * Each agent on a tick wants to know: what did the OTHER agents on
 * this symbol do recently? If K just entered LONG and I (M) am
 * thinking SHORT, that's information — I should require higher
 * conviction before crossing K's leg, or pivot to align.
 *
 * Bus events are append-only. Each agent maintains a cursor into the
 * stream (PerAgentState.lastBusEventConsumed). On each tick, the agent
 * reads new events since its cursor and folds them into its decision
 * context.
 *
 * Pure functions only. The bus itself is the I/O layer (kernel_bus.ts);
 * this module just transforms (events, agent_perspective) → context.
 */

import type { BusEvent } from './kernel_bus.js';

export type AgentLabel = 'K' | 'M' | 'T' | 'L';

/** A summarized cross-agent observation for the current decision tick.
 *  Distilled from raw bus events on the symbol. */
export interface CrossAgentContext {
  /** Most recent entry by ANOTHER agent on this symbol within the
   *  observation window. Null if none. */
  recentEntryByOtherAgent: {
    agent: AgentLabel;
    side: 'long' | 'short';
    ts: number;
    /** How many ticks ago. */
    ticksAgo: number;
  } | null;

  /** Count of vetoes in the observation window. High vetoes = risk
   *  kernel is rejecting orders → market is in a bad state. */
  recentVetoCount: number;

  /** Agents that successfully exited recently. Useful for "X just
   *  took profit, maybe I should consider exit too" signals. */
  recentExits: AgentLabel[];

  /** Anomaly events (ML outage, position not on exchange, etc.) in
   *  the window. */
  recentAnomalies: number;
}

export const NEUTRAL_CROSS_AGENT_CONTEXT: CrossAgentContext = {
  recentEntryByOtherAgent: null,
  recentVetoCount: 0,
  recentExits: [],
  recentAnomalies: 0,
};

/** Default observation window: 8 ticks (~4 minutes at 30s tick). */
export const DEFAULT_BUS_WINDOW_TICKS = 8;

/** Build a cross-agent context from recent bus events.
 *
 *  @param events — all bus events on this symbol within the window
 *    (caller filters by symbol + time)
 *  @param viewerAgent — which agent's perspective we're computing for;
 *    we exclude their own events
 *  @param currentTick — used to compute ticksAgo
 *
 *  Pure function. */
export function buildCrossAgentContext(
  events: readonly BusEvent[],
  viewerAgent: AgentLabel,
  currentTick: number,
): CrossAgentContext {
  let recentEntry: CrossAgentContext['recentEntryByOtherAgent'] = null;
  let vetoCount = 0;
  const exits: AgentLabel[] = [];
  let anomalies = 0;

  for (const ev of events) {
    const eventAgent = extractAgent(ev);
    const eventTick = extractTick(ev) ?? currentTick;

    switch (ev.type) {
      case 'entry_executed':
        // Skip self.
        if (eventAgent === viewerAgent) break;
        if (eventAgent && isAgentLabel(eventAgent)) {
          // Take the most recent entry by anyone-but-viewer.
          if (
            recentEntry === null ||
            eventTick > (currentTick - recentEntry.ticksAgo)
          ) {
            const side = extractSide(ev);
            if (side) {
              recentEntry = {
                agent: eventAgent,
                side,
                ts: eventTick,
                ticksAgo: Math.max(0, currentTick - eventTick),
              };
            }
          }
        }
        break;
      case 'kernel_veto':
        vetoCount++;
        break;
      case 'exit_triggered':
        if (eventAgent && isAgentLabel(eventAgent) && eventAgent !== viewerAgent) {
          exits.push(eventAgent);
        }
        break;
      case 'anomaly':
        anomalies++;
        break;
      // ignore: mode_transition, entry_proposed, outcome, insight, bank_write
    }
  }

  return {
    recentEntryByOtherAgent: recentEntry,
    recentVetoCount: vetoCount,
    recentExits: exits,
    recentAnomalies: anomalies,
  };
}

/** Conviction dampener — when another agent just entered the OPPOSITE
 *  side recently, this agent's entry conviction should be reduced.
 *  Returns a multiplier in [0.3, 1.0].
 *
 *  Same-side recent entry → no dampening (1.0)
 *  Opposite-side recent entry → dampen, more recent = stronger dampen
 *  No recent entry → no dampening (1.0)
 *
 *  Pure function. */
export function convictionDampenerFromBus(
  ctx: CrossAgentContext,
  proposedSide: 'long' | 'short',
): number {
  if (!ctx.recentEntryByOtherAgent) return 1.0;
  if (ctx.recentEntryByOtherAgent.side === proposedSide) return 1.0;
  // Opposite-side: dampen based on recency.
  const ticksAgo = ctx.recentEntryByOtherAgent.ticksAgo;
  // 0 ticks ago → 0.3 dampen, 8 ticks ago → 1.0 (no dampen).
  const recencyFactor = Math.min(1.0, ticksAgo / DEFAULT_BUS_WINDOW_TICKS);
  return 0.3 + 0.7 * recencyFactor;
}

// ─── Internal helpers ─────────────────────────────────────────────

function extractAgent(ev: BusEvent): string | null {
  const payload = ev.payload as Record<string, unknown> | undefined;
  return payload?.agent ? String(payload.agent) : null;
}

function extractSide(ev: BusEvent): 'long' | 'short' | null {
  const payload = ev.payload as Record<string, unknown> | undefined;
  const raw = String(payload?.side ?? '').toLowerCase();
  if (raw === 'long' || raw === 'enter_long' || raw === 'buy') return 'long';
  if (raw === 'short' || raw === 'enter_short' || raw === 'sell') return 'short';
  return null;
}

function extractTick(ev: BusEvent): number | null {
  // Bus events don't carry a tick number directly today — fall back to
  // null and the caller uses currentTick. Future: add tick to BusEvent.
  void ev;
  return null;
}

function isAgentLabel(s: string): s is AgentLabel {
  return s === 'K' || s === 'M' || s === 'T' || s === 'L';
}
