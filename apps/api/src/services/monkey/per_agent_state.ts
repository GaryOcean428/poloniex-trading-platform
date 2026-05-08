/**
 * per_agent_state.ts — per-agent reactive cognition state.
 *
 * Today the four trading agents (K/M/T/L) have asymmetric cognition: K
 * has full Δ⁶³ basin perception + Layer 2B emotions + neurochemistry +
 * foresight + self-observation; M/T/L are mechanical (signal/breakout/
 * KNN with no per-agent state). User directive 2026-05-08: lift M/T/L
 * to K-parity so all kernels react to outcomes, see what others do via
 * the bus, anticipate consequences, and modulate their own risk-taking
 * via dopamine-on-success / frustration-on-loss dynamics.
 *
 * This module provides a unified per-agent reactive-emotion +
 * neurochemistry + decision-history state that any agent can carry.
 * Layer 2B geometric emotions (computed from the basin) remain shared
 * at the symbol level; this layer is the outcome-driven reactive layer
 * that's specific to each agent's track record on the symbol.
 *
 * Design choices:
 *   - Outcome-driven: emotions update on realized PnL events, not on
 *     basin geometry alone (geometric emotions are already shared at
 *     the symbol level via state.lastBasin, etc.)
 *   - Decay over time: dopamine fades, frustration fades — no
 *     permanent grudge from a single bad trade
 *   - Dimensionless: all values in [0, 1] so cross-agent comparisons
 *     and sizing modulators are scale-free
 *   - Pure functions only: no I/O, no DB, no exchange — all updates
 *     are deterministic transforms of (prevState, event)
 *
 * QIG purity: no exp on probability simplices, no cosine, no Adam,
 * no embeddings. The emotions are scalars in [0, 1] so this layer is
 * BOUNDARY/operational, not Δ⁶³ cognition. Updates are pure arithmetic
 * (add/subtract/clamp/multiply by scalar decay factors).
 */

/** Reactive emotions specific to one agent, updated by that agent's
 *  own realized outcomes. Range [0, 1] for all fields. */
export interface AgentReactiveEmotion {
  /** Recent-win confidence. Boosts on realized profit; decays linearly. */
  dopamine: number;
  /** Recent-loss tightening. Boosts on realized loss; decays linearly. */
  frustration: number;
  /** Realized-vs-expected outcome alignment. High = predictions match
   *  reality, low = surprise events dominate. */
  flow: number;
  /** Recent activity rate. Boosts on entry, decays — keeps an agent
   *  from idling forever even when other emotions are calm. */
  agency: number;
}

export const NEUTRAL_AGENT_EMOTION: AgentReactiveEmotion = {
  dopamine: 0.5,
  frustration: 0.0,
  flow: 0.5,
  agency: 0.5,
};

/** Per-agent neurochemistry — modulates risk-taking thresholds. Each
 *  scalar in [0, 1]. Mirrors the existing global NeurochemicalState
 *  shape but per-agent so M's serotonin can differ from K's. */
export interface AgentNeurochemicalState {
  /** Serotonin — calmness / patience. Tightens on consecutive losses,
   *  loosens on consistent wins. */
  serotonin: number;
  /** Dopamine — reward sensitivity. Spikes on wins, decays. */
  dopamine: number;
  /** Norepinephrine — alertness / urgency. Spikes on surprise events
   *  (realized outcome far from expectation). */
  norepinephrine: number;
  /** Acetylcholine — attention / focus. Boosted on consecutive
   *  same-direction signals, dampened on signal flipping. */
  acetylcholine: number;
  /** GABA — inhibition / hold-back. Boosted on near-frustration
   *  states; reduces willingness to enter. */
  gaba: number;
  /** Endorphins — flow-state booster. Mirrors emotion.flow with a lag. */
  endorphins: number;
}

export const NEUTRAL_AGENT_NEUROCHEM: AgentNeurochemicalState = {
  serotonin: 0.5,
  dopamine: 0.5,
  norepinephrine: 0.5,
  acetylcholine: 0.5,
  gaba: 0.5,
  endorphins: 0.5,
};

/** A single decision an agent made on a tick. Used for the
 *  self-observation ring buffer. */
export interface AgentDecisionRecord {
  ts: number;
  action: 'enter_long' | 'enter_short' | 'hold' | 'exit';
  conviction: number;       // [0, 1]
  margin: number;           // USDT committed (0 if hold/exit)
  reason: string;
  /** Realized PnL once known. Null while still open. */
  realizedPnl: number | null;
  /** Set when realizedPnl lands. Used for dopamine spike. */
  settledTs: number | null;
}

/** Outcome event — when a trade settles, distill it into an emotion
 *  delta. Pure transform input. */
export interface AgentOutcomeEvent {
  agent: 'K' | 'M' | 'T' | 'L';
  symbol: string;
  realizedPnl: number;
  /** Was this a winner relative to the agent's stated conviction at
   *  entry? Used for flow alignment. */
  expectedDirection: 'long' | 'short';
  realizedDirection: 'long' | 'short' | 'flat';
}

/** The full per-agent state on a symbol. */
export interface PerAgentState {
  emotions: AgentReactiveEmotion;
  neurochemistry: AgentNeurochemicalState;
  /** Bounded ring of recent decisions. Capped at MAX_DECISIONS_PER_AGENT. */
  decisions: AgentDecisionRecord[];
  /** Bounded ring of recent realized outcomes. Capped at MAX_OUTCOMES_PER_AGENT. */
  outcomes: AgentOutcomeEvent[];
  /** Cursor into the bus event stream — last event_id this agent has
   *  consumed. New events with id > this are unseen. */
  lastBusEventConsumed: number;
}

export const MAX_DECISIONS_PER_AGENT = 100;
export const MAX_OUTCOMES_PER_AGENT = 50;

export function newPerAgentState(): PerAgentState {
  return {
    emotions: { ...NEUTRAL_AGENT_EMOTION },
    neurochemistry: { ...NEUTRAL_AGENT_NEUROCHEM },
    decisions: [],
    outcomes: [],
    lastBusEventConsumed: 0,
  };
}

/** Update the agent's reactive emotion + neurochemistry from a
 *  realized outcome. Pure transform. */
export function applyOutcomeToState(
  prev: PerAgentState,
  outcome: AgentOutcomeEvent,
): PerAgentState {
  const isWinner = outcome.realizedPnl > 0;
  const isLoser = outcome.realizedPnl < 0;
  const isAligned =
    outcome.realizedDirection !== 'flat' &&
    outcome.realizedDirection === outcome.expectedDirection;

  // Emotions — bounded in [0, 1].
  const e = prev.emotions;
  const dopamineDelta = isWinner ? 0.20 : 0;
  const frustrationDelta = isLoser ? 0.20 : 0;
  const flowDelta = isAligned ? 0.10 : -0.05;
  const newEmotions: AgentReactiveEmotion = {
    dopamine: clamp01(e.dopamine + dopamineDelta - 0.05), // small constant decay
    frustration: clamp01(e.frustration + frustrationDelta - 0.03),
    flow: clamp01(e.flow + flowDelta),
    agency: clamp01(e.agency + 0.05), // outcome arrived → agent acted recently
  };

  // Neurochemistry — moves slower than emotions, more bounded swings.
  const n = prev.neurochemistry;
  const newNeurochem: AgentNeurochemicalState = {
    serotonin: clamp01(n.serotonin + (isWinner ? 0.04 : isLoser ? -0.04 : 0)),
    dopamine: clamp01(n.dopamine + dopamineDelta * 0.5),
    norepinephrine: clamp01(
      n.norepinephrine + (Math.abs(outcome.realizedPnl) > 5 ? 0.10 : -0.02),
    ),
    acetylcholine: clamp01(n.acetylcholine + (isAligned ? 0.05 : -0.05)),
    gaba: clamp01(n.gaba + (isLoser ? 0.08 : -0.02)),
    endorphins: clamp01(n.endorphins + (isWinner && isAligned ? 0.10 : -0.02)),
  };

  // Append to outcome ring.
  const newOutcomes = [...prev.outcomes, outcome];
  if (newOutcomes.length > MAX_OUTCOMES_PER_AGENT) newOutcomes.shift();

  return {
    emotions: newEmotions,
    neurochemistry: newNeurochem,
    decisions: prev.decisions,
    outcomes: newOutcomes,
    lastBusEventConsumed: prev.lastBusEventConsumed,
  };
}

/** Append a decision to the ring buffer. Pure transform. */
export function recordDecision(
  prev: PerAgentState,
  decision: AgentDecisionRecord,
): PerAgentState {
  const newDecisions = [...prev.decisions, decision];
  if (newDecisions.length > MAX_DECISIONS_PER_AGENT) newDecisions.shift();
  return { ...prev, decisions: newDecisions };
}

/** Idle decay tick — decay emotions/neurochemistry on every tick where
 *  no outcome arrived. Keeps the state from getting stuck at extremes. */
export function decayPerAgentState(prev: PerAgentState): PerAgentState {
  const decay = 0.02;
  const nudgeToward = (v: number, target: number) =>
    clamp01(v + (target - v) * decay);
  return {
    emotions: {
      dopamine: nudgeToward(prev.emotions.dopamine, 0.5),
      frustration: nudgeToward(prev.emotions.frustration, 0),
      flow: nudgeToward(prev.emotions.flow, 0.5),
      agency: nudgeToward(prev.emotions.agency, 0.5),
    },
    neurochemistry: {
      serotonin: nudgeToward(prev.neurochemistry.serotonin, 0.5),
      dopamine: nudgeToward(prev.neurochemistry.dopamine, 0.5),
      norepinephrine: nudgeToward(prev.neurochemistry.norepinephrine, 0.5),
      acetylcholine: nudgeToward(prev.neurochemistry.acetylcholine, 0.5),
      gaba: nudgeToward(prev.neurochemistry.gaba, 0.5),
      endorphins: nudgeToward(prev.neurochemistry.endorphins, 0.5),
    },
    decisions: prev.decisions,
    outcomes: prev.outcomes,
    lastBusEventConsumed: prev.lastBusEventConsumed,
  };
}

/** Risk modulator derived from agent state. Returns a multiplier to
 *  apply to entry sizing and conviction. Range typically [0.3, 1.5].
 *
 *  High dopamine + low frustration + high flow → boost up to ~1.5×.
 *  High frustration + low dopamine + high gaba → dampen down to ~0.3×.
 *
 *  Pure function of state. */
export function riskModulator(state: PerAgentState): number {
  const e = state.emotions;
  const n = state.neurochemistry;
  // Emotion contribution: dopamine and flow boost; frustration dampens.
  const emotionBoost = (e.dopamine - 0.5) * 0.6 + (e.flow - 0.5) * 0.3
    - e.frustration * 0.5;
  // Neurochem contribution: serotonin steadies, norepinephrine alerts,
  // acetylcholine focuses, gaba inhibits.
  const neurochemBoost = (n.serotonin - 0.5) * 0.2
    + (n.acetylcholine - 0.5) * 0.2
    + (n.endorphins - 0.5) * 0.1
    - (n.gaba - 0.5) * 0.4;
  const raw = 1.0 + emotionBoost + neurochemBoost;
  return Math.min(1.5, Math.max(0.3, raw));
}

/** Self-observation summary — distills recent decisions+outcomes into
 *  a calibration signal an agent can use to detect "I'm taking too
 *  many losses lately". */
export interface SelfObsSummary {
  recentDecisionCount: number;
  recentSettledCount: number;
  winRate: number;          // [0, 1]
  avgPnl: number;           // mean realized PnL
  /** [0, 1] — fraction of decisions where realized outcome aligned
   *  with stated direction. Different from winRate: a small loser
   *  on the right direction still counts as aligned. */
  alignmentRate: number;
}

/** Compute self-observation summary from the decision/outcome rings.
 *  Pure read. */
export function computeSelfObs(state: PerAgentState): SelfObsSummary {
  const settled = state.decisions.filter((d) => d.realizedPnl !== null);
  const wins = settled.filter((d) => (d.realizedPnl ?? 0) > 0).length;
  const total = settled.length;
  const sumPnl = settled.reduce((s, d) => s + (d.realizedPnl ?? 0), 0);
  // Alignment: based on outcomes ring (the canonical record).
  const aligned = state.outcomes.filter(
    (o) => o.realizedDirection !== 'flat' &&
           o.realizedDirection === o.expectedDirection,
  ).length;
  const outcomeTotal = state.outcomes.length;
  return {
    recentDecisionCount: state.decisions.length,
    recentSettledCount: total,
    winRate: total > 0 ? wins / total : 0.5,
    avgPnl: total > 0 ? sumPnl / total : 0,
    alignmentRate: outcomeTotal > 0 ? aligned / outcomeTotal : 0.5,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
