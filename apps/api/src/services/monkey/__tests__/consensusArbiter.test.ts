import { describe, expect, it } from 'vitest';

import { computeConsensus, type ConsensusInputs } from '../consensus_arbiter.js';
import type { ProposalEvent } from '../proposal_bus.js';
import type { RegimeMatrix } from '../wr_matrix.js';

function makeProposal(overrides: Partial<ProposalEvent>): ProposalEvent {
  return {
    instance_id: 'monkey-k',
    symbol: 'BTC_USDT_PERP',
    tick_id: 'BTC|1',
    proposed_action: 'enter_long',
    side: 'long',
    lane: 'swing',
    size_usdt: 30,
    leverage: 5,
    entry_threshold: 0.5,
    conviction: 0.7,
    basin_signature: [],
    phi: 0.22,
    kappa: 64,
    regime_label: 'creator',
    mode: 'investigation',
    at_ms: Date.now(),
    engine_version: 'v0.8-ts',
    ...overrides,
  };
}

function makeMatrix(opts: {
  selfCreator?: { wins: number; total: number };
  peerCreator?: { wins: number; total: number };
}): RegimeMatrix {
  const empty = { wins: 0, losses: 0, total: 0, wr: 0 };
  const cell = (w: number, t: number) => ({
    wins: w, losses: t - w, total: t, wr: t > 0 ? w / t : 0,
  });
  return {
    'monkey-k': {
      creator: opts.selfCreator ? cell(opts.selfCreator.wins, opts.selfCreator.total) : empty,
      preserver: empty,
      dissolver: empty,
      unknown: empty,
    },
    'py-retrospective': {
      creator: opts.peerCreator ? cell(opts.peerCreator.wins, opts.peerCreator.total) : empty,
      preserver: empty,
      dissolver: empty,
      unknown: empty,
    },
  };
}

function baseInputs(over: Partial<ConsensusInputs> = {}): ConsensusInputs {
  return {
    ownProposal: makeProposal({}),
    peerProposal: makeProposal({ instance_id: 'monkey-py-shadow', size_usdt: 20, leverage: 3 }),
    wrMatrix: makeMatrix({
      selfCreator: { wins: 6, total: 10 },
      peerCreator: { wins: 4, total: 10 },
    }),
    selfEngineType: 'monkey-k',
    peerEngineType: 'py-retrospective',
    regime: 'creator',
    bankSize: 200,
    consecutiveLosses: { self: 0, peer: 0 },
    cumulativeLoss: { self: 0, peer: 0 },
    ...over,
  };
}

describe('computeConsensus — no peer (single-kernel mode)', () => {
  it('passes own proposal through unmodified when peer absent', () => {
    const inputs = baseInputs({ peerProposal: null });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('single-kernel');
    expect(d.action).toBe('enter_long');
    expect(d.size_usdt).toBe(30);
    expect(d.leverage).toBe(5);
  });
});

describe('computeConsensus — same side SLERP', () => {
  it('SLERPs size by dominance: self wr 0.6 vs peer wr 0.4 → 60/40 weighted', () => {
    const inputs = baseInputs();
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('same-side-slerp');
    expect(d.side).toBe('long');
    // dominance = 0.6 / 1.0 = 0.6
    // size = slerp(peer.size=20, self.size=30, 0.6) = 20*0.4 + 30*0.6 = 8 + 18 = 26
    expect(d.size_usdt).toBeCloseTo(26, 2);
    // leverage = slerp(3, 5, 0.6) = 1.2 + 3 = 4.2 → round → 4
    expect(d.leverage).toBe(4);
  });

  it('dominance 0.5 (cold-start) produces equal weight', () => {
    const inputs = baseInputs({
      wrMatrix: makeMatrix({}),  // all zeros
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('same-side-slerp');
    expect(d.size_usdt).toBeCloseTo(25, 2);  // (30+20)/2
  });
});

describe('computeConsensus — side disagreement', () => {
  it('lesser below ACCEPTABLE_FLOOR → dominant fires unilateral', () => {
    const inputs = baseInputs({
      ownProposal: makeProposal({ side: 'long', proposed_action: 'enter_long', size_usdt: 30 }),
      peerProposal: makeProposal({
        instance_id: 'monkey-py-shadow', side: 'short',
        proposed_action: 'enter_short', size_usdt: 20,
      }),
      wrMatrix: makeMatrix({
        selfCreator: { wins: 6, total: 10 },     // self 60%
        peerCreator: { wins: 2, total: 10 },     // peer 20% — below 0.45 floor
      }),
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('lesser-observe');
    expect(d.side).toBe('long');
    expect(d.size_usdt).toBe(30);
  });

  it('both above floor + gap > threshold → dominant-fires', () => {
    const inputs = baseInputs({
      ownProposal: makeProposal({ side: 'long', size_usdt: 30 }),
      peerProposal: makeProposal({
        instance_id: 'monkey-py-shadow', side: 'short', size_usdt: 20,
      }),
      wrMatrix: makeMatrix({
        selfCreator: { wins: 7, total: 10 },   // 70%
        peerCreator: { wins: 5, total: 10 },   // 50% — above floor, gap 0.20 > 0.15
      }),
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('dominant-fires');
    expect(d.side).toBe('long');
  });

  it('WRs close → no-trade-divergence', () => {
    const inputs = baseInputs({
      ownProposal: makeProposal({ side: 'long' }),
      peerProposal: makeProposal({
        instance_id: 'monkey-py-shadow', side: 'short',
      }),
      wrMatrix: makeMatrix({
        selfCreator: { wins: 6, total: 10 },   // 60%
        peerCreator: { wins: 5, total: 10 },   // 50% — above floor, gap 0.10 < 0.15
      }),
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('no-trade-divergence');
    expect(d.action).toBe('hold');
    expect(d.size_usdt).toBe(0);
  });

  it('insufficient samples → no-trade-divergence (safety)', () => {
    const inputs = baseInputs({
      ownProposal: makeProposal({ side: 'long' }),
      peerProposal: makeProposal({
        instance_id: 'monkey-py-shadow', side: 'short',
      }),
      wrMatrix: makeMatrix({
        selfCreator: { wins: 1, total: 2 },    // 50% — only 2 trades
        peerCreator: { wins: 1, total: 2 },
      }),
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('no-trade-divergence');
  });
});

describe('computeConsensus — rethink trigger', () => {
  it('consecutive-loss threshold triggers rethink size reduction', () => {
    const inputs = baseInputs({
      consecutiveLosses: { self: 3, peer: 0 },
    });
    const d = computeConsensus(inputs);
    expect(d.telemetry.rethink_active).toBe(true);
    // size = SLERP result × 0.5 (default rethink factor)
    expect(d.size_usdt).toBeCloseTo(13, 2);  // 26 × 0.5
  });

  it('cumulative-loss vs bank fraction triggers rethink', () => {
    const inputs = baseInputs({
      bankSize: 200,
      cumulativeLoss: { self: -15, peer: 0 },  // 15 / 200 = 7.5% > 5%
    });
    const d = computeConsensus(inputs);
    expect(d.telemetry.rethink_active).toBe(true);
  });

  it('rethink + side disagreement → no-trade', () => {
    const inputs = baseInputs({
      ownProposal: makeProposal({ side: 'long' }),
      peerProposal: makeProposal({
        instance_id: 'monkey-py-shadow', side: 'short',
      }),
      consecutiveLosses: { self: 3, peer: 0 },
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('no-trade-divergence');
    expect(d.telemetry.rethink_active).toBe(true);
  });

  it('rethink-active single-kernel scales size', () => {
    const inputs = baseInputs({
      peerProposal: null,
      consecutiveLosses: { self: 5, peer: 0 },
    });
    const d = computeConsensus(inputs);
    expect(d.verdict).toBe('single-kernel');
    expect(d.size_usdt).toBe(15);  // 30 × 0.5
    expect(d.telemetry.rethink_active).toBe(true);
  });
});
