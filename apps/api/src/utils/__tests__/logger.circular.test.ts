/**
 * Regression: a logger must never throw on its caller.
 *
 * 2026-05-14 production: post-cutover, every Poloniex 429 produced
 * `[Monkey] <sym> tick failed {"err":"Converting circular structure
 * to JSON ... TLSSocket"}`. Root cause: winston's printf formatter did
 * `JSON.stringify(metadata)`; an axios error spread into metadata
 * carries `.request → .socket` (a circular TLSSocket), so the stringify
 * threw — and that throw replaced the original 429, failing the tick.
 *
 * The formatter is now circular-safe. These tests pin that a
 * `logger.error(msg, <object-with-a-cycle>)` call completes normally.
 */
import { describe, it, expect } from 'vitest';
import { logger } from '../logger.js';

describe('logger circular-structure safety', () => {
  it('does not throw when metadata contains a direct cycle', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => logger.error('cyclic metadata', cyclic)).not.toThrow();
  });

  it('does not throw on an axios-shaped error (request → socket → request)', () => {
    // Mirrors the real failure: an axios error whose .request.socket
    // points back up the graph.
    const socket: Record<string, unknown> = { constructor: { name: 'TLSSocket' } };
    const request: Record<string, unknown> = { socket };
    socket.parser = { socket };
    const axiosLikeError = Object.assign(new Error('Request failed with status code 429'), {
      request,
      response: { status: 429, data: '' },
    });
    expect(() => logger.error('Error fetching historical data for BTC:', axiosLikeError)).not.toThrow();
  });

  it('still logs plain metadata correctly', () => {
    expect(() => logger.info('plain metadata', { endpoint: '/market/candles', status: 200 })).not.toThrow();
  });
});
