/**
 * expectation_client.test.ts — anti-shelfware tests for the qig-warp
 * expectation bubble HTTP client.
 *
 * Per poloniex-trading-platform#1002 acceptance criteria:
 *   - "Tests prove a tape/basin disagreement fixture changes behaviour
 *      when bubble output says observe_only or flip_to_basin"
 *   - "Tests prove DB write failure does not block catastrophic safety
 *      or exchange safety"
 *   - "Tests prove expectation can influence decisions without operator
 *      env knobs"
 *
 * The bubble's decision logic itself lives in Python
 * (expectation_bubble.py); this test pins the TS contract:
 *   1. The client returns null on transport failure (caller MUST fall
 *      through to existing logic).
 *   2. The client returns a typed ExpectationDecision on success.
 *   3. Every action variant (observe_only / flip_to_basin / reduce_size /
 *      allow) round-trips intact.
 *   4. The qig_warp_source field distinguishes real runtime calls from
 *      fallback paths, exactly as the call site needs to attribute
 *      shelfware regressions later.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  callExpectationBubble,
  type ExpectationDecision,
} from '../expectation_client.js';

function mkDecision(over: Partial<ExpectationDecision> = {}): ExpectationDecision {
  return {
    expectation_id: 'test-id',
    expectation_direction: 'long',
    expectation_confidence: 0.86,
    expectation_regime: 'reverse_tape',
    expectation_action: 'flip_to_basin',
    expectation_reason: 'test',
    qig_warp_mode: 'qig_regime',
    qig_warp_version: '0.4.3',
    qig_warp_source: 'QIG_WARP_RUNTIME',
    tape_trend: -0.65,
    basin_direction: 0.18,
    tape_basin_disagreement: -0.117,
    reverse_tape_window: true,
    reverse_tape_side: 'long',
    ...over,
  };
}

describe('callExpectationBubble — HTTP client', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.ML_WORKER_URL = 'http://test-ml-worker';
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('returns the decision body on HTTP 200', async () => {
    const decision = mkDecision({ expectation_action: 'observe_only' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => decision,
    }) as unknown as typeof fetch;

    const res = await callExpectationBubble({
      tapeTrend: -0.65,
      basinDirection: 0.18,
      recentReturns: [0.001, -0.002, 0.003],
      proposedSide: 'short',
    });

    expect(res).not.toBeNull();
    expect(res!.expectation_action).toBe('observe_only');
    expect(res!.qig_warp_source).toBe('QIG_WARP_RUNTIME');
    expect(res!.reverse_tape_window).toBe(true);
  });

  it('returns null on transport failure (caller falls through to existing logic)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const res = await callExpectationBubble({
      tapeTrend: 0.5,
      basinDirection: 0.5,
      recentReturns: [0.001, 0.002],
    });

    expect(res).toBeNull();
  });

  it('returns null on HTTP 5xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    }) as unknown as typeof fetch;

    const res = await callExpectationBubble({
      tapeTrend: 0.5,
      basinDirection: 0.5,
      recentReturns: [],
    });

    expect(res).toBeNull();
  });

  it('preserves action variants intact (observe_only / flip_to_basin / reduce_size / allow)', async () => {
    for (const action of ['observe_only', 'flip_to_basin', 'reduce_size', 'allow'] as const) {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mkDecision({ expectation_action: action }),
      }) as unknown as typeof fetch;

      const res = await callExpectationBubble({
        tapeTrend: -0.3,
        basinDirection: 0.3,
        recentReturns: [0.001],
      });
      expect(res?.expectation_action).toBe(action);
    }
  });

  it('surfaces qig_warp_source so the caller can distinguish runtime calls from fallbacks', async () => {
    // The bubble's own fallback path (qig_warp not installed) comes back
    // as a normal HTTP 200 with action='allow' and source='QIG_WARP_UNAVAILABLE'.
    // The caller treats that the same as 'allow' but the audit row records
    // the source so we can grep for shelfware regressions.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mkDecision({
        expectation_action: 'allow',
        expectation_regime: 'invalid',
        qig_warp_source: 'QIG_WARP_UNAVAILABLE',
        expectation_reason: 'qig_warp not installed',
      }),
    }) as unknown as typeof fetch;

    const res = await callExpectationBubble({
      tapeTrend: -0.5,
      basinDirection: 0.5,
      recentReturns: [],
    });

    expect(res?.expectation_action).toBe('allow');
    expect(res?.qig_warp_source).toBe('QIG_WARP_UNAVAILABLE');
  });

  it('sends the canonical request shape (snake_case body, recent_returns array)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mkDecision(),
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await callExpectationBubble({
      tapeTrend: -0.65,
      basinDirection: 0.18,
      recentReturns: [0.001, -0.002, 0.003],
      proposedSide: 'short',
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('http://test-ml-worker/monkey/expectation/evaluate');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      tape_trend: -0.65,
      basin_direction: 0.18,
      recent_returns: [0.001, -0.002, 0.003],
      proposed_side: 'short',
    });
  });
});
