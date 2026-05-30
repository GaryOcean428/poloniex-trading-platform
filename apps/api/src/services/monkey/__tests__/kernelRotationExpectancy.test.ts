/**
 * kernelRotationExpectancy.test.ts — issue #1032.
 *
 * The 5-consecutive-loss breaker catches ACUTE streaks but misses
 * CHRONIC negative-expectancy: a ~50%-WR kernel with tiny wins between
 * large losses never reaches 5-in-a-row, yet bleeds. And the WR-only
 * promotion gate lets a high-WR / negative-EV kernel back in. This
 * suite pins:
 *   - rollingExpectancy math (winRate / avgWin / avgLoss / lossWinRatio / edge)
 *   - chronic expectancy demote (flag ON): neg-EV bleeder demotes even
 *     though it never hits 5 consecutive losses
 *   - high-WR / neg-EV demote (WR alone would not catch it)
 *   - promotion requires BOTH within-band expectancy AND loss:win
 *     trending to 1:8
 *   - flag OFF → behaviour identical to legacy (regression-pin)
 */
import { describe, expect, it } from 'vitest';

import {
  applyChronicDemote,
  expectancyLiveEnabled,
  makeRotationState,
  promoteToLive,
  recordClose,
  rollingExpectancy,
  rollingWinRate,
  shouldAutoPromote,
  shouldChronicDemote,
  ROTATION_EXPECTANCY_BAND,
  ROTATION_LOSS_STREAK_THRESHOLD,
  ROTATION_TARGET_LOSS_WIN_RATIO,
  ROTATION_WR_MIN_SAMPLES,
  type RotationPeerSnapshot,
  type RotationState,
} from '../kernel_rotation.js';

/** Build a state with an explicit PnL window (no streak side-effects). */
function stateWithPnls(pnls: number[], mode: 'live' | 'paper' = 'live'): RotationState {
  const s = makeRotationState();
  s.mode = mode;
  s.rollingPnls = [...pnls];
  return s;
}

/** A live peer snapshot carrying expectancy + loss:win ratio. */
function livePeer(
  expectancy: number,
  lossWinRatio: number,
  opts: { winRate?: number; n?: number } = {},
): RotationPeerSnapshot {
  return {
    mode: 'live',
    rollingWinRate: opts.winRate ?? 0.5,
    rollingSampleCount: opts.n ?? ROTATION_WR_MIN_SAMPLES,
    rollingExpectancy: expectancy,
    rollingLossWinRatio: lossWinRatio,
  };
}

describe('rollingExpectancy', () => {
  it('returns NaN edge on an empty window', () => {
    const e = rollingExpectancy(makeRotationState());
    expect(e.sampleCount).toBe(0);
    expect(e.edge).toBeNaN();
    expect(e.winRate).toBeNaN();
    expect(e.lossWinRatio).toBeNaN();
  });

  it('computes winRate, avgWin, signed avgLoss, lossWinRatio and edge', () => {
    // 2 wins of +1, 2 losses of -4. WR=0.5, avgWin=1, avgLoss=-4.
    const e = rollingExpectancy(stateWithPnls([+1, -4, +1, -4]));
    expect(e.winRate).toBeCloseTo(0.5, 9);
    expect(e.avgWin).toBeCloseTo(1, 9);
    expect(e.avgLoss).toBeCloseTo(-4, 9);
    expect(e.lossWinRatio).toBeCloseTo(4, 9); // |avgLoss|/avgWin
    // edge = 0.5*1 - 0.5*4 = -1.5
    expect(e.edge).toBeCloseTo(-1.5, 9);
  });

  it('treats zero-pnl as a loss (matches streak semantics)', () => {
    const e = rollingExpectancy(stateWithPnls([+2, 0]));
    expect(e.winRate).toBeCloseTo(0.5, 9);
    expect(e.avgLoss).toBeCloseTo(0, 9); // the single "loss" is 0
  });

  it('lossWinRatio is +Infinity when there are losses but no wins', () => {
    const e = rollingExpectancy(stateWithPnls([-1, -2, -3]));
    expect(e.lossWinRatio).toBe(Number.POSITIVE_INFINITY);
    expect(e.winRate).toBeCloseTo(0, 9);
  });

  it('lossWinRatio is NaN when there are no losses (cannot rank)', () => {
    const e = rollingExpectancy(stateWithPnls([+1, +2, +3]));
    expect(e.lossWinRatio).toBeNaN();
    expect(e.winRate).toBeCloseTo(1, 9);
  });

  it('positive-edge kernel: many small wins beat rare small losses', () => {
    // 8 wins of +1, 2 losses of -1. edge = 0.8*1 - 0.2*1 = +0.6
    const e = rollingExpectancy(stateWithPnls([+1, +1, +1, +1, +1, +1, +1, +1, -1, -1]));
    expect(e.edge).toBeCloseTo(0.6, 9);
    expect(e.lossWinRatio).toBeCloseTo(1, 9);
  });
});

describe('expectancyLiveEnabled — canonical (no gate)', () => {
  it('is always on, regardless of env', () => {
    expect(expectancyLiveEnabled()).toBe(true);
    const _orig = process.env.MONKEY_ROTATION_EXPECTANCY_LIVE;
    try {
      process.env.MONKEY_ROTATION_EXPECTANCY_LIVE = '******';
      expect(expectancyLiveEnabled()).toBe(true);
      process.env.MONKEY_ROTATION_EXPECTANCY_LIVE = 'true';
      expect(expectancyLiveEnabled()).toBe(true);
    } finally {
      if (_orig !== undefined) {
        process.env.MONKEY_ROTATION_EXPECTANCY_LIVE = _orig;
      } else {
        delete process.env.MONKEY_ROTATION_EXPECTANCY_LIVE;
      }
    }
  });
});

describe('chronic expectancy demote — issue #1032 gap 1 (chronic neg-EV)', () => {
  it('demotes a ~50%-WR bleeder that NEVER hits 5 consecutive losses', () => {
    // Interleave tiny win / large loss so the consecutive-loss streak
    // never reaches the threshold, yet expectancy is deeply negative.
    const s = makeRotationState();
    for (let i = 0; i < ROTATION_WR_MIN_SAMPLES; i++) {
      recordClose(s, i % 2 === 0 ? +0.1 : -2.0);
    }
    // Sanity: the acute breaker never fired (streak resets on each win).
    expect(s.mode).toBe('live');
    expect(s.consecutiveLosses).toBeLessThan(5);

    const e = rollingExpectancy(s);
    expect(e.edge).toBeLessThan(0); // genuinely negative-EV

    // A healthy live peer with strongly positive expectancy.
    const peers = [livePeer(+0.5, ROTATION_TARGET_LOSS_WIN_RATIO)];
    const reason = shouldChronicDemote(s, peers, /*expectancyLive*/ true);
    expect(reason).not.toBeNull();
    expect(reason).toContain('chronic-demote');

    const res = applyChronicDemote(s, peers, true);
    expect(res.demoted).toBe(true);
    expect(s.mode).toBe('paper');
    expect(s.lastDemotionAtMs).not.toBeNull();
  });

  it('does NOT demote a kernel within band of the best live peer', () => {
    // Candidate edge ~ +0.45; best live ~ +0.5; band 10% of 0.5 = 0.05.
    // 0.5 - 0.45 = 0.05 ≤ 0.05 → within band → stays live.
    const s = stateWithPnls([+1, +1, +1, +1, +1, +1, +1, -0.5, -0.5, -0.5]);
    const e = rollingExpectancy(s);
    expect(e.edge).toBeGreaterThan(0);
    const best = e.edge / (1 - ROTATION_EXPECTANCY_BAND) + 1e-9; // just outside? keep within
    const peers = [livePeer(e.edge + ROTATION_EXPECTANCY_BAND * Math.abs(e.edge), 1)];
    void best;
    const reason = shouldChronicDemote(s, peers, true);
    expect(reason).toBeNull();
  });

  it('high-WR / neg-EV kernel demotes (WR alone would NOT catch it)', () => {
    // 80% WR but tiny wins and one catastrophic loss → negative edge.
    // 8 wins of +0.1 (sum 0.8), 2 losses of -3 (sum -6).
    // edge = 0.8*0.1 - 0.2*3 = 0.08 - 0.6 = -0.52.
    const s = stateWithPnls([+0.1, +0.1, +0.1, +0.1, +0.1, +0.1, +0.1, +0.1, -3, -3]);
    const e = rollingExpectancy(s);
    expect(e.winRate).toBeCloseTo(0.8, 9); // looks great on WR
    expect(e.edge).toBeLessThan(0);        // but bleeds money

    const peers = [livePeer(+0.4, ROTATION_TARGET_LOSS_WIN_RATIO)];
    const reason = shouldChronicDemote(s, peers, true);
    expect(reason).not.toBeNull();
  });

  it('does NOT demote before ROTATION_WR_MIN_SAMPLES (no demote on noise)', () => {
    const s = stateWithPnls([-5, +0.1, -5]); // awful but only 3 samples
    const peers = [livePeer(+0.5, ROTATION_TARGET_LOSS_WIN_RATIO)];
    expect(shouldChronicDemote(s, peers, true)).toBeNull();
  });

  it('does NOT demote when no informative live peer exists (no benchmark)', () => {
    const s = stateWithPnls([-5, +0.1, -5, +0.1, -5, +0.1, -5, +0.1, -5, +0.1]);
    const peers: RotationPeerSnapshot[] = [
      { mode: 'paper', rollingWinRate: 0.5, rollingSampleCount: 50, rollingExpectancy: 1 },
      { mode: 'live', rollingWinRate: 0.5, rollingSampleCount: ROTATION_WR_MIN_SAMPLES - 1, rollingExpectancy: 1 },
    ];
    expect(shouldChronicDemote(s, peers, true)).toBeNull();
  });
});

describe('chronic expectancy demote — FLAG OFF regression pin', () => {
  it('shouldChronicDemote ALWAYS returns null when flag is off', () => {
    const s = stateWithPnls([-5, +0.1, -5, +0.1, -5, +0.1, -5, +0.1, -5, +0.1]);
    const peers = [livePeer(+1.0, ROTATION_TARGET_LOSS_WIN_RATIO)];
    expect(shouldChronicDemote(s, peers, /*expectancyLive*/ false)).toBeNull();
  });

  it('applyChronicDemote is a no-op (no mode change) when flag is off', () => {
    const s = stateWithPnls([-5, +0.1, -5, +0.1, -5, +0.1, -5, +0.1, -5, +0.1]);
    const peers = [livePeer(+1.0, ROTATION_TARGET_LOSS_WIN_RATIO)];
    const res = applyChronicDemote(s, peers, false);
    expect(res.demoted).toBe(false);
    expect(s.mode).toBe('live');
    expect(s.lastDemotionAtMs).toBeNull();
  });
});

describe('expectancy promotion gate — issue #1032 gap 2 (WR not enough)', () => {
  // Helper: a paper candidate with a chosen PnL window.
  function paperCandidate(pnls: number[]): RotationState {
    return stateWithPnls(pnls, 'paper');
  }

  it('FLAG OFF: promotion uses WR only (legacy regression pin)', () => {
    // High WR, but loss:win ratio terrible (neg-EV). With the flag off
    // the legacy WR-only gate still promotes — pinning that the default
    // path is unchanged.
    const s = paperCandidate([+0.1, +0.1, +0.1, +0.1, +0.1, +0.1, +0.1, +0.1, -3, -3]); // 80% WR
    const peers = [livePeer(+0.4, ROTATION_TARGET_LOSS_WIN_RATIO, { winRate: 0.6 })];
    const reason = shouldAutoPromote(s, peers, /*expectancyLive*/ false);
    expect(reason).not.toBeNull();
    expect(reason).toContain('rolling WR');
  });

  it('FLAG ON: high-WR / neg-EV candidate is BLOCKED (expectancy gate)', () => {
    // Same 80% WR neg-EV candidate. With the flag on, the expectancy +
    // loss:win gates block promotion even though WR passes.
    const s = paperCandidate([+0.1, +0.1, +0.1, +0.1, +0.1, +0.1, +0.1, +0.1, -3, -3]);
    const peers = [livePeer(+0.4, ROTATION_TARGET_LOSS_WIN_RATIO, { winRate: 0.6 })];
    const reason = shouldAutoPromote(s, peers, /*expectancyLive*/ true);
    expect(reason).toBeNull();
  });

  it('FLAG ON: promotes only when expectancy in-band AND loss:win trending to 1:8', () => {
    // Candidate: 8 wins of +1, 2 losses of -1 → edge +0.6, loss:win 1.0.
    const s = paperCandidate([+1, +1, +1, +1, +1, +1, +1, +1, -1, -1]);
    const cand = rollingExpectancy(s);
    expect(cand.edge).toBeCloseTo(0.6, 9);
    expect(cand.lossWinRatio).toBeCloseTo(1, 9);

    // Best live peer: same expectancy (within band trivially) and a
    // loose loss:win ratio (1.5) so the candidate's 1.0 is ≤ the peer's
    // bar → ratio trending toward target relative to cohort.
    const peers = [
      livePeer(0.6, 1.5, { winRate: 0.8 }),
    ];
    const reason = shouldAutoPromote(s, peers, true);
    expect(reason).not.toBeNull();
    expect(reason).toContain('auto-promotion(expectancy)');
  });

  it('FLAG ON: BLOCKED when expectancy in-band but loss:win WORSE than cohort and above target', () => {
    // Candidate edge ~ best, but loss:win = 4 (above 1:8 target AND
    // above the peer's tighter 1.5 bar) → blocked.
    // 5 wins +4 (sum 20), 5 losses -4 (sum -20): WR .5, edge 0, lw=1 -> need worse.
    // Use: 9 wins +1 (sum 9) 1 loss -9 → WR .9 edge 0, lw = 9.
    const s = paperCandidate([+1, +1, +1, +1, +1, +1, +1, +1, +1, -9]);
    const cand = rollingExpectancy(s);
    expect(cand.edge).toBeCloseTo(0, 6);
    expect(cand.lossWinRatio).toBeCloseTo(9, 6);
    // Peer edge 0 (within band), peer loss:win tight (1.0). Candidate 9 > 1 and > target → blocked.
    const peers = [livePeer(0, 1.0, { winRate: 0.6 })];
    const reason = shouldAutoPromote(s, peers, true);
    expect(reason).toBeNull();
  });

  it('FLAG ON: candidate with loss:win at/under the 1:8 target passes the ratio bar outright', () => {
    // 9 wins of +1 (sum 9), 1 loss of -0.1 → loss:win = 0.1 ≤ 0.125 target.
    const s = paperCandidate([+1, +1, +1, +1, +1, +1, +1, +1, +1, -0.1]);
    const cand = rollingExpectancy(s);
    expect(cand.lossWinRatio).toBeLessThanOrEqual(ROTATION_TARGET_LOSS_WIN_RATIO);
    // Peer with within-band expectancy and a TIGHT ratio (0.05); the
    // candidate's 0.1 is worse than the peer but still ≤ the 1:8 target,
    // so the outright-target arm passes.
    const peers = [livePeer(cand.edge, 0.05, { winRate: 0.9 })];
    const reason = shouldAutoPromote(s, peers, true);
    expect(reason).not.toBeNull();
  });

  it('FLAG ON: still respects the legacy WR gate (WR too far below best blocks)', () => {
    // Low-WR candidate far below the best live WR is blocked before the
    // expectancy gate is even reached.
    const s = paperCandidate([+5, -1, -1, -1, -1, -1, -1, -1, -1, -1]); // WR 0.1
    const peers = [livePeer(0.5, ROTATION_TARGET_LOSS_WIN_RATIO, { winRate: 0.9 })];
    const reason = shouldAutoPromote(s, peers, true);
    expect(reason).toBeNull();
  });

  it('FLAG ON: a PURE-BLEED candidate (losses, no wins → Infinity ratio) is NOT promoted, even in a weak/bleeding cohort (Copilot #1035)', () => {
    // Regression for the Infinity-vs-NaN ratio-gate bug: lossWinRatio is
    // Infinity for losses-but-no-wins (worst case). A prior
    // `!Number.isFinite(...)` check treated Infinity like the benign NaN
    // (no-data) case and let it bypass the ratio gate — so a pure-bleed
    // paper kernel could re-promote into a weak cohort. Construct exactly
    // that: candidate clears the WR + expectancy-band gates against a
    // bleeding cohort, and MUST still be blocked by the ratio gate.
    const s = paperCandidate([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1]); // WR 0, edge -1
    const cand = rollingExpectancy(s);
    expect(cand.lossWinRatio).toBe(Number.POSITIVE_INFINITY); // pure bleed
    // Bleeding cohort: best-live WR 0.05 (so WR 0 ≥ 0.05−0.10 passes) and
    // expectancy −1 (so candidate −1 is within the 10% band).
    const peers = [livePeer(-1.0, 5.0, { winRate: 0.05 })];
    const reason = shouldAutoPromote(s, peers, /*expectancyLive*/ true);
    expect(reason).toBeNull(); // blocked by the ratio gate (Infinity fails it)
  });
});

/**
 * CAPITAL-FIREWALL PURITY — the firewall must be a pure capital-routing
 * filter. Demotion/promotion may flip ONLY the routing/mode state; they
 * must NOT alter the kernel's decision inputs or its reward/chemistry
 * path. The kernel is blind to paper-vs-live.
 *
 * The rotation module's surface only ever receives a RotationState (+
 * peer snapshots). The "cognition-relevant" data the kernel learns from
 * is its rolling outcome window (state.rollingPnls) — the same window
 * the loop builds reward/chemistry from. These tests pin that the
 * firewall transitions touch ONLY {mode, lastDemotionAtMs,
 * lastTransitionReason} (and the streak counter on promote, which is
 * itself firewall bookkeeping) and leave the learning window — and any
 * object the caller did NOT pass in — untouched.
 *
 * STRUCTURAL GUARANTEE this leans on: the functions cannot reach a
 * decision input or the reward push because those are never passed to
 * them. The reward is computed + pushed in loop.ts BEFORE rotation is
 * touched; rotation receives only the already-realized PnL number.
 */
describe('capital-firewall purity — kernel cognition is blind to routing', () => {
  /** Deep-ish snapshot of the learning-relevant window. */
  function learningSnapshot(s: RotationState) {
    return {
      rollingPnls: [...s.rollingPnls],
      rollingWinRate: rollingWinRate(s),
      rollingExpectancy: rollingExpectancy(s).edge,
    };
  }

  it('acute demote flips ONLY routing/mode state — learning window is byte-identical', () => {
    const s = makeRotationState();
    // Seed a window, then drive 5 consecutive losses to trip the breaker.
    for (let i = 0; i < ROTATION_WR_MIN_SAMPLES; i++) recordClose(s, +1);
    const before = learningSnapshot(s);
    expect(s.mode).toBe('live');

    let demoted = false;
    for (let i = 0; i < ROTATION_LOSS_STREAK_THRESHOLD; i++) {
      const r = recordClose(s, -1);
      demoted = demoted || r.demoted;
    }
    expect(demoted).toBe(true);
    expect(s.mode).toBe('paper'); // routing flipped...

    const after = learningSnapshot(s);
    // ...but the learning window only GREW by the closes we fed it; the
    // demotion itself injected nothing and rewrote nothing. The window
    // is exactly [before + the 5 losses we recorded].
    expect(after.rollingPnls).toEqual([...before.rollingPnls, -1, -1, -1, -1, -1]);
    // Win-rate / expectancy reflect ONLY the recorded closes, not the
    // mode flip — the firewall does not perturb the learning signal.
    const independent = makeRotationState();
    for (const p of after.rollingPnls) recordClose(independent, p);
    expect(rollingWinRate(s)).toBe(rollingWinRate(independent));
    expect(rollingExpectancy(s).edge).toBe(rollingExpectancy(independent).edge);
  });

  it('chronic demote mutates ONLY {mode, lastDemotionAtMs, lastTransitionReason} — never the learning window', () => {
    // A genuine neg-EV bleeder so the chronic gate fires under the flag.
    const s = stateWithPnls(
      [+0.1, -2, +0.1, -2, +0.1, -2, +0.1, -2, +0.1, -2],
      'live',
    );
    const peers = [livePeer(+0.5, ROTATION_TARGET_LOSS_WIN_RATIO)];
    const beforeWindow = [...s.rollingPnls];
    const beforeLearn = learningSnapshot(s);

    const res = applyChronicDemote(s, peers, /*expectancyLive*/ true, 123456);
    expect(res.demoted).toBe(true);

    // Routing/bookkeeping changed:
    expect(s.mode).toBe('paper');
    expect(s.lastDemotionAtMs).toBe(123456);
    expect(s.lastTransitionReason).toContain('chronic-demote');

    // Learning window + derived learning signal are UNCHANGED — the
    // firewall read the window but did not write to it.
    expect(s.rollingPnls).toEqual(beforeWindow);
    expect(rollingWinRate(s)).toBe(beforeLearn.rollingWinRate);
    expect(rollingExpectancy(s).edge).toBe(beforeLearn.rollingExpectancy);
  });

  it('chronic demote does NOT touch the consecutive-loss counter (acute breaker independent)', () => {
    const s = stateWithPnls(
      [+0.1, -2, +0.1, -2, +0.1, -2, +0.1, -2, +0.1, -2],
      'live',
    );
    s.consecutiveLosses = 2; // mid-streak
    const peers = [livePeer(+0.5, ROTATION_TARGET_LOSS_WIN_RATIO)];
    applyChronicDemote(s, peers, true);
    // The chronic firewall path leaves the acute streak counter alone —
    // it is a separate routing criterion, not a cognition mutation.
    expect(s.consecutiveLosses).toBe(2);
  });

  it('promotion flips routing back to live without injecting outcomes into the learning window', () => {
    const s = stateWithPnls(
      [+1, +1, +1, +1, +1, +1, +1, +1, -1, -1],
      'paper',
    );
    const beforeWindow = [...s.rollingPnls];
    const beforeWR = rollingWinRate(s);
    const beforeEdge = rollingExpectancy(s).edge;

    const res = promoteToLive(s, 'test-promote');
    expect(res.promoted).toBe(true);
    expect(s.mode).toBe('live'); // routing flipped back

    // Promotion resets the firewall's own streak bookkeeping but injects
    // NO synthetic outcome — the learning window and signal are intact.
    expect(s.consecutiveLosses).toBe(0);
    expect(s.rollingPnls).toEqual(beforeWindow);
    expect(rollingWinRate(s)).toBe(beforeWR);
    expect(rollingExpectancy(s).edge).toBe(beforeEdge);
  });

  it('a paper-mode kernel and an identical live-mode kernel learn IDENTICALLY from the same closes', () => {
    // The decisive blindness pin: feed the exact same outcome stream to
    // a live kernel and a paper-routed kernel. Their learning windows
    // and derived signals must be bit-identical — mode does not enter
    // the learning math at all.
    const live = makeRotationState();
    const paper = makeRotationState();
    paper.mode = 'paper';
    const stream = [+1, -1, +2, -0.5, +0.3, -3, +1.2, -0.1, +0.9, -2];
    for (const p of stream) {
      recordClose(live, p);
      recordClose(paper, p);
    }
    expect(paper.rollingPnls).toEqual(live.rollingPnls);
    expect(rollingWinRate(paper)).toBe(rollingWinRate(live));
    expect(rollingExpectancy(paper).edge).toBe(rollingExpectancy(live).edge);
  });
});
