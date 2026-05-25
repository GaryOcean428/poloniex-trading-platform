/**
 * autonomicRewardBoundary.test.ts — TS→Py reward boundary contract test.
 *
 * Per CC2's PR #910 risk: "silent failures at language boundaries are
 * the classic shape." callAutonomicReward is fire-and-forget — the
 * helper swallows fetch errors via try/catch, so a wrong URL / wrong
 * payload key / wrong content-type silently disappears in production
 * with only a deferred logger.warn line. This test pins the request
 * shape the Python /monkey/autonomic/reward handler expects so any
 * future drift in either direction breaks here, not in prod.
 *
 * The Python handler (ml-worker/main.py:1394) reads:
 *   instance_id, source, realized_pnl_usdt, margin_usdt,
 *   symbol?, kappa_at_exit?
 * — snake_case keys. The TS caller passes camelCase, so the client
 * must translate. This test confirms the translation.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { callAutonomicReward } from '../autonomic_client.js';

const originalFetch = globalThis.fetch;
const originalUrl = process.env.ML_WORKER_URL;

describe('callAutonomicReward boundary contract', () => {
  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | null = null;

  beforeEach(() => {
    capturedUrl = null;
    capturedInit = null;
    process.env.ML_WORKER_URL = 'http://ml-worker.test:8000';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === 'string' ? url : url.toString();
      capturedInit = init ?? null;
      return new Response(JSON.stringify({ reward: { source: 'ok' }, queue_length: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.ML_WORKER_URL;
    else process.env.ML_WORKER_URL = originalUrl;
    vi.restoreAllMocks();
  });

  test('POSTs to /monkey/autonomic/reward on the configured ml-worker URL', async () => {
    // ML_WORKER_URL is read at module-load time, so the production
    // default ('http://ml-worker.railway.internal:8000') is what
    // appears here. The contract being pinned is: path must be
    // exactly /monkey/autonomic/reward (the Python handler path),
    // method must be POST.
    await callAutonomicReward({
      instanceId: 'monkey-swing',
      source: 'own_close:K',
      realizedPnlUsdt: 0.12,
      marginUsdt: 5,
      symbol: 'BTC_USDT_PERP',
      kappaAtExit: 64.3,
    });
    expect(capturedUrl).toMatch(/\/monkey\/autonomic\/reward$/);
    expect(capturedInit?.method).toBe('POST');
  });

  test('serializes payload with snake_case keys the Python handler reads', async () => {
    await callAutonomicReward({
      instanceId: 'monkey-position',
      source: 'reconciler_recovered:liquidation',
      realizedPnlUsdt: -0.45,
      marginUsdt: 5,
      symbol: 'ETH_USDT_PERP',
      kappaAtExit: 64.0,
    });
    expect(capturedInit?.body).toBeDefined();
    const body = JSON.parse(capturedInit!.body as string);
    expect(body).toEqual({
      instance_id: 'monkey-position',
      source: 'reconciler_recovered:liquidation',
      realized_pnl_usdt: -0.45,
      margin_usdt: 5,
      symbol: 'ETH_USDT_PERP',
      kappa_at_exit: 64.0,
    });
    // No stray camelCase keys leaked.
    expect(body).not.toHaveProperty('instanceId');
    expect(body).not.toHaveProperty('realizedPnlUsdt');
    expect(body).not.toHaveProperty('marginUsdt');
    expect(body).not.toHaveProperty('kappaAtExit');
  });

  test('sets Content-Type application/json so FastAPI parses the body', async () => {
    await callAutonomicReward({
      instanceId: 'monkey-swing',
      source: 'witnessed_liveSignal',
      realizedPnlUsdt: 0.20,
      marginUsdt: 5,
    });
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!['Content-Type']).toBe('application/json');
  });

  test('omits optional fields cleanly (symbol/kappaAtExit undefined → JSON omits or nulls them)', async () => {
    await callAutonomicReward({
      instanceId: 'monkey-swing',
      source: 'own_close:K',
      realizedPnlUsdt: 0.10,
      marginUsdt: 5,
      // no symbol, no kappaAtExit
    });
    const body = JSON.parse(capturedInit!.body as string);
    // Required fields present.
    expect(body.instance_id).toBe('monkey-swing');
    expect(body.source).toBe('own_close:K');
    expect(body.realized_pnl_usdt).toBe(0.10);
    expect(body.margin_usdt).toBe(5);
    // Optional fields either absent or null (both are acceptable to
    // the Python handler since it uses .get()).
    if ('symbol' in body) expect(body.symbol === null || body.symbol === undefined).toBe(true);
    if ('kappa_at_exit' in body) {
      expect(body.kappa_at_exit === null || body.kappa_at_exit === undefined).toBe(true);
    }
  });

  test('non-2xx response is swallowed (fire-and-forget contract preserved)', async () => {
    // The TS caller relies on fire-and-forget — if ml-worker is down or
    // returns 500, the kernel must keep ticking. This test exercises the
    // error path without rejecting.
    globalThis.fetch = (async () => {
      return new Response('boom', { status: 500 });
    }) as typeof fetch;
    await expect(
      callAutonomicReward({
        instanceId: 'monkey-swing',
        source: 'own_close:K',
        realizedPnlUsdt: 0.10,
        marginUsdt: 5,
      }),
    ).resolves.toBeUndefined();
  });

  test('network error is swallowed (timeout / connection refused)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;
    await expect(
      callAutonomicReward({
        instanceId: 'monkey-swing',
        source: 'own_close:K',
        realizedPnlUsdt: 0.10,
        marginUsdt: 5,
      }),
    ).resolves.toBeUndefined();
  });
});
