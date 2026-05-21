import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../utils/logger.js';
import {
  computeAndLogConsensus,
  computeConsensus,
  type ConsensusInputs,
} from '../consensus_arbiter.js';
import {
  _injectPeerProposal,
  _resetProposalBus,
  getRecentPeerProposal,
  type ProposalEvent,
} from '../proposal_bus.js';
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

describe('computeAndLogConsensus — [Consensus] log telemetry', () => {
  it('logs the kernel directional lean even when the executed side is null (hold)', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    try {
      const inputs = baseInputs({
        peerProposal: null,
        ownProposal: makeProposal({ proposed_action: 'hold', side: null }),
        ownLean: 'long',
      });
      const decision = computeAndLogConsensus(inputs);
      // The decision's executable side stays null — a hold opens no
      // trade. Correct by design.
      expect(decision.side).toBeNull();
      // The log line renders that as the string 'none' (not a bare
      // null, so the line does not read as missing data) and still
      // surfaces the geometric lean so a hold is not an observability
      // black hole when debugging directional bias.
      const lastCall = spy.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('[Consensus]');
      expect(lastCall?.[1]).toMatchObject({ side: 'none', lean: 'long' });
    } finally {
      spy.mockRestore();
    }
  });

  it('lean falls back to flat when no directional read is supplied', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    try {
      const inputs = baseInputs({
        peerProposal: null,
        ownProposal: makeProposal({ proposed_action: 'hold', side: null }),
      });
      computeAndLogConsensus(inputs);
      expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ lean: 'flat' });
    } finally {
      spy.mockRestore();
    }
  });
});

// ── Task 5: py-live peer path drives non-single-kernel verdict ──────────
// Regression guard: once a py-live peer proposal is in the bus, the
// arbiter must yield a verdict OTHER than 'single-kernel'. This is the
// end-to-end integration test that the peer path is correctly wired:
//   1. _injectPeerProposal → bus stores it
//   2. getRecentPeerProposal returns it
//   3. computeConsensus yields non-single-kernel
//
// Uses _injectPeerProposal (test-only) to bypass Redis; mirrors what the
// in-process subscriber stores when a real py-live proposal arrives.

function makePyLiveMatrix(): RegimeMatrix {
  const cell = (w: number, t: number) => ({
    wins: w, losses: t - w, total: t, wr: t > 0 ? w / t : 0,
  });
  const empty = { wins: 0, losses: 0, total: 0, wr: 0 };
  return {
    'monkey-k': {
      creator: cell(6, 10),
      preserver: empty, dissolver: empty, unknown: empty,
    },
    'py-live': {
      creator: cell(5, 10),
      preserver: empty, dissolver: empty, unknown: empty,
    },
  };
}

describe('py-live peer path — non-single-kernel verdict regression guard', () => {
  beforeEach(async () => {
    process.env.CONSENSUS_PROPOSAL_BUS_LIVE = 'true';
    await _resetProposalBus();
  });

  afterEach(async () => {
    await _resetProposalBus();
    delete process.env.CONSENSUS_PROPOSAL_BUS_LIVE;
  });

  it('getRecentPeerProposal returns injected py-live proposal', () => {
    const pyProposal: ProposalEvent = {
      instance_id: 'monkey-py-peer',
      symbol: 'BTC_USDT_PERP',
      tick_id: 'BTC|42',
      proposed_action: 'enter_long',
      side: 'long',
      lane: 'swing',
      size_usdt: 20,
      leverage: 4,
      entry_threshold: 0.55,
      conviction: 0.6,
      basin_signature: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      phi: 0.28,
      kappa: 64,
      regime_label: 'creator',
      mode: 'investigation',
      at_ms: Date.now(),
      engine_version: 'v0.8.7c-3-py',
    };

    _injectPeerProposal(pyProposal);

    // TS self id is 'monkey-primary'; peer id is 'monkey-py-peer' → different
    const peer = getRecentPeerProposal('BTC_USDT_PERP', 'monkey-primary');
    expect(peer).not.toBeNull();
    expect(peer!.instance_id).toBe('monkey-py-peer');
    expect(peer!.proposed_action).toBe('enter_long');
  });

  it('computeConsensus yields same-side-slerp when py-live peer agrees on side', () => {
    const pyProposal: ProposalEvent = {
      instance_id: 'monkey-py-peer',
      symbol: 'BTC_USDT_PERP',
      tick_id: 'BTC|43',
      proposed_action: 'enter_long',
      side: 'long',
      lane: 'swing',
      size_usdt: 20,
      leverage: 4,
      entry_threshold: 0.55,
      conviction: 0.6,
      basin_signature: [],
      phi: 0.28,
      kappa: 64,
      regime_label: 'creator',
      mode: 'investigation',
      at_ms: Date.now(),
      engine_version: 'v0.8.7c-3-py',
    };

    _injectPeerProposal(pyProposal);
    const peer = getRecentPeerProposal('BTC_USDT_PERP', 'monkey-primary');
    expect(peer).not.toBeNull();

    const inputs: ConsensusInputs = {
      ownProposal: makeProposal({
        instance_id: 'monkey-primary',
        proposed_action: 'enter_long',
        side: 'long',
        size_usdt: 30,
        leverage: 5,
      }),
      peerProposal: peer,
      wrMatrix: makePyLiveMatrix(),
      selfEngineType: 'monkey-k',
      peerEngineType: 'py-live',
      regime: 'creator',
      bankSize: 200,
      consecutiveLosses: { self: 0, peer: 0 },
      cumulativeLoss: { self: 0, peer: 0 },
    };

    const d = computeConsensus(inputs);
    // Must NOT be single-kernel — the peer IS present
    expect(d.verdict).not.toBe('single-kernel');
    // Both agree on 'long' → same-side-slerp
    expect(d.verdict).toBe('same-side-slerp');
    expect(d.side).toBe('long');
    expect(d.telemetry.peer_wr).toBeGreaterThan(0);
  });

  it('computeConsensus yields dominant-fires when py-live peer disagrees and gap > floor', () => {
    const pyProposal: ProposalEvent = {
      instance_id: 'monkey-py-peer',
      symbol: 'BTC_USDT_PERP',
      tick_id: 'BTC|44',
      proposed_action: 'enter_short',
      side: 'short',      // disagrees with TS self (long)
      lane: 'swing',
      size_usdt: 20,
      leverage: 3,
      entry_threshold: 0.5,
      conviction: 0.5,
      basin_signature: [],
      phi: 0.25,
      kappa: 64,
      regime_label: 'creator',
      mode: 'investigation',
      at_ms: Date.now(),
      engine_version: 'v0.8.7c-3-py',
    };

    _injectPeerProposal(pyProposal);
    const peer = getRecentPeerProposal('BTC_USDT_PERP', 'monkey-primary');
    expect(peer).not.toBeNull();

    const matrix: RegimeMatrix = {
      'monkey-k': {
        creator: { wins: 7, losses: 3, total: 10, wr: 0.7 },
        preserver: { wins: 0, losses: 0, total: 0, wr: 0 },
        dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
        unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
      },
      'py-live': {
        creator: { wins: 5, losses: 5, total: 10, wr: 0.5 },  // gap = 0.20 > 0.15 floor
        preserver: { wins: 0, losses: 0, total: 0, wr: 0 },
        dissolver: { wins: 0, losses: 0, total: 0, wr: 0 },
        unknown: { wins: 0, losses: 0, total: 0, wr: 0 },
      },
    };

    const d = computeConsensus({
      ownProposal: makeProposal({
        instance_id: 'monkey-primary',
        proposed_action: 'enter_long',
        side: 'long',
        size_usdt: 30,
        leverage: 5,
      }),
      peerProposal: peer,
      wrMatrix: matrix,
      selfEngineType: 'monkey-k',
      peerEngineType: 'py-live',
      regime: 'creator',
      bankSize: 200,
      consecutiveLosses: { self: 0, peer: 0 },
      cumulativeLoss: { self: 0, peer: 0 },
    });

    expect(d.verdict).not.toBe('single-kernel');
    expect(d.verdict).toBe('dominant-fires');
    expect(d.side).toBe('long');  // TS (0.7 WR) wins
  });

  it('stale py-live proposal (> 60s) falls back to single-kernel', async () => {
    const staleProposal: ProposalEvent = {
      instance_id: 'monkey-py-peer',
      symbol: 'BTC_USDT_PERP',
      tick_id: 'BTC|45',
      proposed_action: 'enter_long',
      side: 'long',
      lane: 'swing',
      size_usdt: 20,
      leverage: 4,
      entry_threshold: 0.5,
      conviction: 0.5,
      basin_signature: [],
      phi: 0.25,
      kappa: 64,
      regime_label: null,
      mode: 'investigation',
      at_ms: Date.now() - 65_000,  // 65 s ago — beyond 60 s freshness window
      engine_version: 'v0.8.7c-3-py',
    };

    _injectPeerProposal(staleProposal);
    // Stale → getRecentPeerProposal should return null
    const peer = getRecentPeerProposal('BTC_USDT_PERP', 'monkey-primary');
    expect(peer).toBeNull();

    const d = computeConsensus({
      ownProposal: makeProposal({ instance_id: 'monkey-primary' }),
      peerProposal: peer,
      wrMatrix: makePyLiveMatrix(),
      selfEngineType: 'monkey-k',
      peerEngineType: 'py-live',
      regime: 'creator',
      bankSize: 200,
      consecutiveLosses: { self: 0, peer: 0 },
      cumulativeLoss: { self: 0, peer: 0 },
    });

    // Stale peer → arbiter falls back to single-kernel (correct safe default)
    expect(d.verdict).toBe('single-kernel');
  });
});
