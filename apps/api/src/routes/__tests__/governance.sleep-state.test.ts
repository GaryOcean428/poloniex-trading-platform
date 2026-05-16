/**
 * governance.sleep-state.test.ts — Two-test coverage per the
 * "single endpoint, two tests: empty state, populated state" spec.
 *
 * No supertest dependency: invokes the route handler directly with
 * stub req/res. Redis client is mocked via vi.doMock so the handler
 * exercises its real flow without an actual Redis round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

interface StubResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
  status: (n: number) => StubResponse;
  json: (b: Record<string, unknown>) => StubResponse;
}

function makeRes(): StubResponse {
  const res: StubResponse = {
    statusCode: 200,
    body: null,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

async function callHandler(agent: string): Promise<StubResponse> {
  const { default: router } = await import('../governance.js');
  // Express Router exposes registered routes via router.stack; pull our
  // single GET handler and invoke it directly with a stub req/res.
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ method?: string; handle: (req: Request, res: Response, next: (err?: unknown) => void) => unknown }> } }> })
    .stack.find((l) => l.route?.path === '/sleep-state/:agent');
  if (!layer || !layer.route) throw new Error('handler not registered');
  // Router-level middleware (authenticateToken) is the first stack entry;
  // the actual route handler is the last.
  const finalHandler = layer.route.stack[layer.route.stack.length - 1]!.handle;
  const req = { params: { agent }, user: { id: 'test-user' } } as unknown as Request;
  const res = makeRes();
  await finalHandler(req, res as unknown as Response, () => undefined);
  return res;
}

describe('GET /api/governance/sleep-state/:agent', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.REDIS_URL = 'redis://stub:6379';
  });
  afterEach(() => {
    vi.doUnmock('redis');
    delete process.env.REDIS_URL;
  });

  it('returns source=empty + null sleep_state when the key is absent', async () => {
    vi.doMock('redis', () => ({
      createClient: () => ({
        isOpen: true,
        on: (_evt: string, _cb: (err: Error) => void) => undefined,
        connect: async () => undefined,
        get: async (_key: string) => null,
      }),
    }));
    const res = await callHandler('K');
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.agent).toBe('K');
    expect(res.body?.instance_id).toBe('monkey-position');
    expect(res.body?.redis_key).toBe('monkey:ocean:monkey-position:sleep_state');
    expect(res.body?.sleep_state).toBeNull();
    expect(res.body?.source).toBe('empty');
    expect(typeof res.body?.fetched_at_ms).toBe('number');
    // Dream-consolidation fields are absent/null when the
    // last_consolidation key has not been written.
    expect(res.body?.last_consolidation_ts).toBeNull();
    expect(res.body?.dream_packet_size_bytes).toBe(0);
    expect(res.body?.consolidation_summary).toBeNull();
  });

  it('returns source=redis + parsed sleep_state when the key is populated', async () => {
    const populated = {
      phase: 'SLEEP',
      phase_started_at_ms: 1778900000000,
      last_sleep_ended_at_ms: 1778890000000,
      sleep_count: 7,
      drift_streak: 3,
    };
    vi.doMock('redis', () => ({
      createClient: () => ({
        isOpen: true,
        on: (_evt: string, _cb: (err: Error) => void) => undefined,
        connect: async () => undefined,
        get: async (key: string) => key === 'monkey:ocean:monkey-position:sleep_state' ? JSON.stringify(populated) : null,
      }),
    }));
    const res = await callHandler('K');
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.source).toBe('redis');
    expect(res.body?.sleep_state).toEqual(populated);
    // No consolidation key populated → fields still null/0
    expect(res.body?.last_consolidation_ts).toBeNull();
    expect(res.body?.dream_packet_size_bytes).toBe(0);
    expect(res.body?.consolidation_summary).toBeNull();
  });

  it('populates dream-consolidation fields when last_consolidation key exists', async () => {
    const sleepState = {
      phase: 'SLEEP',
      phase_started_at_ms: 1778900000000,
      sleep_count: 3,
      drift_streak: 0,
    };
    const consolidation = {
      completed_at_ms: 1778900111000,
      basin_count: 12,
      replayed_count: 5,
      boosted: 5,
      downscaled: 7,
      pruned: 2,
      vetoed: 1,
      sqrt_distance_traversed: 0.1234,
      trigger: 'awake_to_sleep',
      summary_string: '12 basins, 5 boosted / 7 downscaled / 2 pruned, sqrt-traversal=0.1234',
    };
    const consolidationStr = JSON.stringify(consolidation);
    vi.doMock('redis', () => ({
      createClient: () => ({
        isOpen: true,
        on: (_evt: string, _cb: (err: Error) => void) => undefined,
        connect: async () => undefined,
        get: async (key: string) => {
          if (key === 'monkey:ocean:monkey-position:sleep_state') return JSON.stringify(sleepState);
          if (key === 'monkey:ocean:monkey-position:last_consolidation') return consolidationStr;
          return null;
        },
      }),
    }));
    const res = await callHandler('K');
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.source).toBe('redis');
    expect(res.body?.sleep_state).toEqual(sleepState);
    expect(res.body?.last_consolidation_ts).toBe(1778900111000);
    expect(res.body?.dream_packet_size_bytes).toBe(consolidationStr.length);
    expect(res.body?.consolidation_summary).toBe(consolidation.summary_string);
  });

  it('handles malformed last_consolidation JSON without 500ing', async () => {
    const sleepState = { phase: 'AWAKE' };
    vi.doMock('redis', () => ({
      createClient: () => ({
        isOpen: true,
        on: (_evt: string, _cb: (err: Error) => void) => undefined,
        connect: async () => undefined,
        get: async (key: string) => {
          if (key === 'monkey:ocean:monkey-position:sleep_state') return JSON.stringify(sleepState);
          if (key === 'monkey:ocean:monkey-position:last_consolidation') return '{not-valid-json';
          return null;
        },
      }),
    }));
    const res = await callHandler('K');
    expect(res.statusCode).toBe(200);
    expect(res.body?.source).toBe('redis');
    expect(res.body?.sleep_state).toEqual(sleepState);
    // Malformed JSON → ts/summary null; size still reflects raw bytes
    expect(res.body?.last_consolidation_ts).toBeNull();
    expect(res.body?.consolidation_summary).toBeNull();
    expect(res.body?.dream_packet_size_bytes).toBe('{not-valid-json'.length);
  });

  it('returns dream-consolidation fields even when sleep_state is empty', async () => {
    // Tests the case where the kernel persisted a consolidation
    // but the sleep_state key has been wiped (e.g. TTL or test
    // harness). The endpoint should still surface what it has.
    const consolidation = {
      completed_at_ms: 1234567890,
      summary_string: 'orphan',
    };
    vi.doMock('redis', () => ({
      createClient: () => ({
        isOpen: true,
        on: (_evt: string, _cb: (err: Error) => void) => undefined,
        connect: async () => undefined,
        get: async (key: string) => {
          if (key === 'monkey:ocean:monkey-position:last_consolidation') {
            return JSON.stringify(consolidation);
          }
          return null;
        },
      }),
    }));
    const res = await callHandler('K');
    expect(res.statusCode).toBe(200);
    expect(res.body?.source).toBe('empty');
    expect(res.body?.sleep_state).toBeNull();
    expect(res.body?.last_consolidation_ts).toBe(1234567890);
    expect(res.body?.consolidation_summary).toBe('orphan');
    expect(res.body?.dream_packet_size_bytes).toBeGreaterThan(0);
  });

  it('rejects unknown agent labels with 400', async () => {
    vi.doMock('redis', () => ({
      createClient: () => ({
        isOpen: true,
        on: () => undefined,
        connect: async () => undefined,
        get: async () => null,
      }),
    }));
    const res = await callHandler('XYZ');
    expect(res.statusCode).toBe(400);
    expect(res.body?.success).toBe(false);
    expect((res.body?.error as string)).toContain('XYZ');
  });
});
