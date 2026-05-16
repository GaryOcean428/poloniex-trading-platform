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
