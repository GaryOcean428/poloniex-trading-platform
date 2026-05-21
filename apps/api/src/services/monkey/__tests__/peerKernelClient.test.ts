/**
 * peerKernelClient.test.ts — TS-driven fanout to the Python consensus peer.
 *
 * TDD: tests written BEFORE implementation — must fail initially.
 *
 * Contracts:
 *   1. fanoutToPeerKernel POSTs to ML_WORKER_URL + /monkey/tick/run
 *   2. It never throws on network error (fire-and-forget).
 *   3. It is a no-op when CONSENSUS_PEER_FANOUT_LIVE is unset or 'false'.
 *   4. The POST body includes instance_id = 'monkey-py-peer' and the
 *      symbol from the inputs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module under test (doesn't exist yet — import will fail until Task 4 impl)
import {
  fanoutToPeerKernel,
  isPeerFanoutLive,
  type PeerKernelFanoutInputs,
} from '../peer_kernel_client.js';

function makeInputs(overrides: Partial<PeerKernelFanoutInputs> = {}): PeerKernelFanoutInputs {
  return {
    instanceId: 'monkey-primary',
    symbol: 'BTC_USDT_PERP',
    ohlcv: [
      { timestamp: 1_700_000_000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    ],
    account: {
      equity_fraction: 0.5,
      margin_fraction: 0.2,
      open_positions: 0,
      available_equity: 1000,
    },
    bankSize: 1000,
    sovereignty: 0.5,
    maxLeverage: 10,
    minNotional: 5,
    sizeFraction: 1.0,
    ...overrides,
  };
}

describe('isPeerFanoutLive', () => {
  it('returns false when CONSENSUS_PEER_FANOUT_LIVE is unset', () => {
    const orig = process.env.CONSENSUS_PEER_FANOUT_LIVE;
    delete process.env.CONSENSUS_PEER_FANOUT_LIVE;
    try {
      expect(isPeerFanoutLive()).toBe(false);
    } finally {
      if (orig !== undefined) process.env.CONSENSUS_PEER_FANOUT_LIVE = orig;
    }
  });

  it('returns false when CONSENSUS_PEER_FANOUT_LIVE=false', () => {
    process.env.CONSENSUS_PEER_FANOUT_LIVE = 'false';
    try {
      expect(isPeerFanoutLive()).toBe(false);
    } finally {
      delete process.env.CONSENSUS_PEER_FANOUT_LIVE;
    }
  });

  it('returns true when CONSENSUS_PEER_FANOUT_LIVE=true', () => {
    process.env.CONSENSUS_PEER_FANOUT_LIVE = 'true';
    try {
      expect(isPeerFanoutLive()).toBe(true);
    } finally {
      delete process.env.CONSENSUS_PEER_FANOUT_LIVE;
    }
  });
});

describe('fanoutToPeerKernel — no-op when flag off', () => {
  it('resolves immediately without fetching when flag is off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    delete process.env.CONSENSUS_PEER_FANOUT_LIVE;
    try {
      await fanoutToPeerKernel(makeInputs());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      delete process.env.CONSENSUS_PEER_FANOUT_LIVE;
    }
  });
});

describe('fanoutToPeerKernel — fire-and-forget when flag is live', () => {
  beforeEach(() => {
    process.env.CONSENSUS_PEER_FANOUT_LIVE = 'true';
    process.env.ML_WORKER_URL = 'http://test-ml-worker:8000';
  });

  afterEach(() => {
    delete process.env.CONSENSUS_PEER_FANOUT_LIVE;
    delete process.env.ML_WORKER_URL;
  });

  it('POSTs to /monkey/tick/run with instance_id=monkey-py-peer', async () => {
    let capturedBody: unknown = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response('{"decision":{},"new_state":{}}', { status: 200 });
    });

    try {
      await fanoutToPeerKernel(makeInputs({ symbol: 'BTC_USDT_PERP' }));
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('/monkey/tick/run');
      expect(capturedBody).toMatchObject({
        instance_id: 'monkey-py-peer',
        inputs: expect.objectContaining({ symbol: 'BTC_USDT_PERP' }),
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('never throws on network error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));
    try {
      // Must resolve without throwing
      await expect(fanoutToPeerKernel(makeInputs())).resolves.toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('never throws on non-200 response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );
    try {
      await expect(fanoutToPeerKernel(makeInputs())).resolves.toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('POSTs with Content-Type: application/json', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
      return new Response('{}', { status: 200 });
    });
    try {
      await fanoutToPeerKernel(makeInputs());
      expect(capturedHeaders['content-type']).toContain('application/json');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('uses ML_WORKER_URL env var for the host', async () => {
    let capturedUrl = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url);
      return new Response('{}', { status: 200 });
    });
    try {
      await fanoutToPeerKernel(makeInputs());
      expect(capturedUrl).toContain('http://test-ml-worker:8000');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
