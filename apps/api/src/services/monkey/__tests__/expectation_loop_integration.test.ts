import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ExpectationDecision } from '../expectation_client.js';

let applyEntryExpectationDecision: (
  sideCandidate: 'long' | 'short',
  basinDir: number,
  expectationDecision: ExpectationDecision | null,
) => { sideAfterExpectation: 'long' | 'short'; sizeMultiplier: number; entryBlockedByExpectation: boolean };

let applyHoldExitExpectationDecision: (
  heldSide: 'long' | 'short',
  basinDir: number,
  exitWouldFire: boolean,
  expectationDecision: ExpectationDecision | null,
) => {
  actionAfterExpectation: 'hold' | 'exit';
  exitSuppressedByExpectation: boolean;
  exitForcedByExpectation: boolean;
  holdConfidenceMultiplier: number;
};

let persistExpectationDecisionBestEffort: (
  queryPromise: Promise<unknown>,
  symbol: string,
) => Promise<void>;

function mkDecision(overrides: Partial<ExpectationDecision> = {}): ExpectationDecision {
  return {
    expectation_id: 'expectation-test',
    expectation_direction: 'long',
    expectation_confidence: 0.6,
    expectation_regime: 'reverse_tape',
    expectation_action: 'allow',
    expectation_reason: 'test',
    qig_warp_mode: 'qig_regime',
    qig_warp_version: '0.0.0-test',
    qig_warp_source: 'QIG_WARP_RUNTIME',
    tape_trend: -0.5,
    basin_direction: 0.5,
    tape_basin_disagreement: -0.25,
    reverse_tape_window: true,
    reverse_tape_side: 'long',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', '******://******:******@localhost:5432/******');
  const loop = await import('../loop.js');
  applyEntryExpectationDecision = loop.applyEntryExpectationDecision;
  applyHoldExitExpectationDecision = loop.applyHoldExitExpectationDecision;
  persistExpectationDecisionBestEffort = loop.persistExpectationDecisionBestEffort;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('loop expectation decision integration helpers', () => {
  it('observe_only maps to hold path (entry blocked)', () => {
    const res = applyEntryExpectationDecision(
      'short',
      0.25,
      mkDecision({ expectation_action: 'observe_only' }),
    );

    expect(res.entryBlockedByExpectation).toBe(true);
  });

  it('flip_to_basin flips side to basin sign', () => {
    const res = applyEntryExpectationDecision(
      'short',
      0.25,
      mkDecision({ expectation_action: 'flip_to_basin' }),
    );

    expect(res.sideAfterExpectation).toBe('long');
    expect(res.entryBlockedByExpectation).toBe(false);
  });

  it('reduce_size scales size by confidence', () => {
    const res = applyEntryExpectationDecision(
      'long',
      0.25,
      mkDecision({ expectation_action: 'reduce_size', expectation_confidence: 0.3 }),
    );

    expect(res.sizeMultiplier).toBeCloseTo(0.7);
  });

  it('audit persistence is best-effort and does not mutate chosen action outcome', async () => {
    const chosen = applyEntryExpectationDecision(
      'long',
      0.25,
      mkDecision({ expectation_action: 'flip_to_basin' }),
    );

    await expect(
      persistExpectationDecisionBestEffort(
        Promise.reject(new Error('db down')),
        'BTC_USDT_PERP',
      ),
    ).resolves.toBeUndefined();

    expect(chosen.sideAfterExpectation).toBe('long');
    expect(chosen.entryBlockedByExpectation).toBe(false);
  });

  it('hold/exit path can suppress a non-catastrophic adverse-basin exit when bubble says observe_only', () => {
    const res = applyHoldExitExpectationDecision(
      'short',
      0.25,
      true,
      mkDecision({ expectation_action: 'observe_only', expectation_confidence: 0.4 }),
    );

    expect(res.actionAfterExpectation).toBe('hold');
    expect(res.exitSuppressedByExpectation).toBe(true);
    expect(res.holdConfidenceMultiplier).toBeCloseTo(0.6);
  });

  it('hold/exit path keeps exit when bubble says flip_to_basin against the held side', () => {
    const res = applyHoldExitExpectationDecision(
      'short',
      0.25,
      true,
      mkDecision({ expectation_action: 'flip_to_basin' }),
    );

    expect(res.actionAfterExpectation).toBe('exit');
    expect(res.exitSuppressedByExpectation).toBe(false);
  });
});
