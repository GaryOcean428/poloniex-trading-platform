/**
 * autonomicPredictionRewardBoundary.test.ts — TS→Py prediction reward boundary.
 *
 * Pins the snake_case contract consumed by ml-worker's
 * /monkey/autonomic/prediction_reward handler so prediction-error
 * chemistry fanout cannot drift silently.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { callAutonomicPredictionReward } from '../autonomic_client.js';

const originalFetch = globalThis.fetch;

describe('callAutonomicPredictionReward boundary contract', () => {
  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | null = null;

  beforeEach(() => {
    capturedUrl = null;
    capturedInit = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === 'string' ? url : url.toString();
      capturedInit = init ?? null;
      return new Response(JSON.stringify({ cached: { n: 12 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('POSTs to /monkey/autonomic/prediction_reward', async () => {
    await callAutonomicPredictionReward({
      instanceId: 'monkey-primary',
      dopamineDelta: 0.25,
      serotoninDelta: -0.05,
      n: 12,
    });

    expect(capturedUrl).toMatch(/\/monkey\/autonomic\/prediction_reward$/);
    expect(capturedInit?.method).toBe('POST');
  });

  test('serializes payload with snake_case keys the Python handler reads', async () => {
    await callAutonomicPredictionReward({
      instanceId: 'monkey-swing',
      dopamineDelta: 0.125,
      serotoninDelta: -0.075,
      n: 17,
    });

    expect(capturedInit?.body).toBeDefined();
    const body = JSON.parse(capturedInit!.body as string);
    expect(body).toEqual({
      instance_id: 'monkey-swing',
      dopamine_delta: 0.125,
      serotonin_delta: -0.075,
      n: 17,
    });
    expect(body).not.toHaveProperty('instanceId');
    expect(body).not.toHaveProperty('dopamineDelta');
    expect(body).not.toHaveProperty('serotoninDelta');
  });

  test('sets Content-Type application/json so FastAPI parses the body', async () => {
    await callAutonomicPredictionReward({
      instanceId: 'monkey-primary',
      dopamineDelta: 0,
      serotoninDelta: 0,
      n: 0,
    });

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!['Content-Type']).toBe('application/json');
  });

  test('non-2xx response is swallowed (fire-and-forget contract preserved)', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;

    await expect(
      callAutonomicPredictionReward({
        instanceId: 'monkey-primary',
        dopamineDelta: 0.1,
        serotoninDelta: -0.1,
        n: 5,
      }),
    ).resolves.toBeUndefined();
  });

  test('network error is swallowed (timeout / connection refused)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    await expect(
      callAutonomicPredictionReward({
        instanceId: 'monkey-primary',
        dopamineDelta: 0.1,
        serotoninDelta: -0.1,
        n: 5,
      }),
    ).resolves.toBeUndefined();
  });
});
