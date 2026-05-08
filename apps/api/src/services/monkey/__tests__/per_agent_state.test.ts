/**
 * per_agent_state.test.ts — tests for per-agent reactive emotion +
 * neurochemistry + decision/outcome rings.
 */
import { describe, expect, it } from 'vitest';
import {
  applyOutcomeToState,
  computeSelfObs,
  decayPerAgentState,
  newPerAgentState,
  recordDecision,
  riskModulator,
  MAX_DECISIONS_PER_AGENT,
  MAX_OUTCOMES_PER_AGENT,
  type AgentDecisionRecord,
  type AgentOutcomeEvent,
} from '../per_agent_state.js';

const winningOutcome: AgentOutcomeEvent = {
  agent: 'M', symbol: 'BTC_USDT_PERP',
  realizedPnl: 5,
  expectedDirection: 'long', realizedDirection: 'long',
};
const losingOutcome: AgentOutcomeEvent = {
  agent: 'M', symbol: 'BTC_USDT_PERP',
  realizedPnl: -3,
  expectedDirection: 'long', realizedDirection: 'short',
};

describe('newPerAgentState', () => {
  it('returns neutral state', () => {
    const s = newPerAgentState();
    expect(s.emotions.dopamine).toBe(0.5);
    expect(s.emotions.frustration).toBe(0.0);
    expect(s.neurochemistry.serotonin).toBe(0.5);
    expect(s.decisions).toEqual([]);
    expect(s.outcomes).toEqual([]);
  });
});

describe('applyOutcomeToState', () => {
  it('boosts dopamine on a winning outcome', () => {
    const s0 = newPerAgentState();
    const s1 = applyOutcomeToState(s0, winningOutcome);
    expect(s1.emotions.dopamine).toBeGreaterThan(s0.emotions.dopamine);
    expect(s1.neurochemistry.dopamine).toBeGreaterThan(s0.neurochemistry.dopamine);
    expect(s1.outcomes).toHaveLength(1);
  });

  it('boosts frustration on a losing outcome', () => {
    const s0 = newPerAgentState();
    const s1 = applyOutcomeToState(s0, losingOutcome);
    expect(s1.emotions.frustration).toBeGreaterThan(s0.emotions.frustration);
    expect(s1.neurochemistry.gaba).toBeGreaterThan(s0.neurochemistry.gaba);
  });

  it('boosts flow when prediction aligned with realization', () => {
    const s0 = newPerAgentState();
    const s1 = applyOutcomeToState(s0, winningOutcome); // aligned (long predicted, long realized)
    expect(s1.emotions.flow).toBeGreaterThan(s0.emotions.flow);
  });

  it('reduces flow when prediction did not align', () => {
    const s0 = newPerAgentState();
    const s1 = applyOutcomeToState(s0, losingOutcome); // long predicted, short realized
    expect(s1.emotions.flow).toBeLessThan(s0.emotions.flow);
  });

  it('clamps emotions to [0, 1]', () => {
    let s = newPerAgentState();
    for (let i = 0; i < 30; i++) s = applyOutcomeToState(s, winningOutcome);
    expect(s.emotions.dopamine).toBeLessThanOrEqual(1);
    expect(s.emotions.frustration).toBeGreaterThanOrEqual(0);
    expect(s.neurochemistry.dopamine).toBeLessThanOrEqual(1);
  });

  it('caps outcome ring at MAX_OUTCOMES_PER_AGENT', () => {
    let s = newPerAgentState();
    for (let i = 0; i < MAX_OUTCOMES_PER_AGENT + 10; i++) {
      s = applyOutcomeToState(s, winningOutcome);
    }
    expect(s.outcomes.length).toBe(MAX_OUTCOMES_PER_AGENT);
  });
});

describe('recordDecision', () => {
  it('appends to decision ring', () => {
    const s0 = newPerAgentState();
    const d: AgentDecisionRecord = {
      ts: 1, action: 'enter_long', conviction: 0.7, margin: 25,
      reason: 'test', realizedPnl: null, settledTs: null,
    };
    const s1 = recordDecision(s0, d);
    expect(s1.decisions).toHaveLength(1);
    expect(s1.decisions[0]).toBe(d);
  });

  it('caps decision ring at MAX_DECISIONS_PER_AGENT', () => {
    let s = newPerAgentState();
    const d: AgentDecisionRecord = {
      ts: 0, action: 'hold', conviction: 0, margin: 0,
      reason: '', realizedPnl: null, settledTs: null,
    };
    for (let i = 0; i < MAX_DECISIONS_PER_AGENT + 10; i++) {
      s = recordDecision(s, { ...d, ts: i });
    }
    expect(s.decisions.length).toBe(MAX_DECISIONS_PER_AGENT);
    expect(s.decisions[0]!.ts).toBe(10); // first 10 dropped
  });
});

describe('decayPerAgentState', () => {
  it('nudges all emotions toward their neutral target', () => {
    let s = newPerAgentState();
    // Inflate dopamine via wins.
    for (let i = 0; i < 5; i++) s = applyOutcomeToState(s, winningOutcome);
    const inflated = s.emotions.dopamine;
    expect(inflated).toBeGreaterThan(0.5);
    // Decay several ticks.
    for (let i = 0; i < 20; i++) s = decayPerAgentState(s);
    expect(s.emotions.dopamine).toBeLessThan(inflated);
    expect(s.emotions.dopamine).toBeGreaterThanOrEqual(0.5 - 0.1); // converging toward 0.5
  });
});

describe('riskModulator', () => {
  it('returns ~1.0 for neutral state', () => {
    const s = newPerAgentState();
    expect(riskModulator(s)).toBeCloseTo(1.0, 5);
  });

  it('boosts above 1.0 on winning streak', () => {
    let s = newPerAgentState();
    for (let i = 0; i < 5; i++) s = applyOutcomeToState(s, winningOutcome);
    expect(riskModulator(s)).toBeGreaterThan(1.0);
  });

  it('dampens below 1.0 on losing streak', () => {
    let s = newPerAgentState();
    for (let i = 0; i < 5; i++) s = applyOutcomeToState(s, losingOutcome);
    expect(riskModulator(s)).toBeLessThan(1.0);
  });

  it('stays within bounds [0.3, 1.5]', () => {
    let sWin = newPerAgentState();
    for (let i = 0; i < 50; i++) sWin = applyOutcomeToState(sWin, winningOutcome);
    expect(riskModulator(sWin)).toBeLessThanOrEqual(1.5);

    let sLoss = newPerAgentState();
    for (let i = 0; i < 50; i++) sLoss = applyOutcomeToState(sLoss, losingOutcome);
    expect(riskModulator(sLoss)).toBeGreaterThanOrEqual(0.3);
  });
});

describe('computeSelfObs', () => {
  it('returns neutral on empty state', () => {
    const s = newPerAgentState();
    const obs = computeSelfObs(s);
    expect(obs.recentDecisionCount).toBe(0);
    expect(obs.winRate).toBe(0.5);
    expect(obs.alignmentRate).toBe(0.5);
  });

  it('computes win rate from settled decisions', () => {
    let s = newPerAgentState();
    s = recordDecision(s, {
      ts: 1, action: 'enter_long', conviction: 0.8, margin: 10,
      reason: '', realizedPnl: 5, settledTs: 100,
    });
    s = recordDecision(s, {
      ts: 2, action: 'enter_long', conviction: 0.8, margin: 10,
      reason: '', realizedPnl: -2, settledTs: 200,
    });
    s = recordDecision(s, {
      ts: 3, action: 'enter_short', conviction: 0.7, margin: 8,
      reason: '', realizedPnl: 3, settledTs: 300,
    });
    const obs = computeSelfObs(s);
    expect(obs.recentSettledCount).toBe(3);
    expect(obs.winRate).toBeCloseTo(2 / 3, 5);
    expect(obs.avgPnl).toBeCloseTo(2, 5);
  });

  it('computes alignment rate from outcome ring', () => {
    let s = newPerAgentState();
    s = applyOutcomeToState(s, winningOutcome); // aligned
    s = applyOutcomeToState(s, losingOutcome);  // not aligned
    s = applyOutcomeToState(s, winningOutcome); // aligned
    const obs = computeSelfObs(s);
    expect(obs.alignmentRate).toBeCloseTo(2 / 3, 5);
  });
});
