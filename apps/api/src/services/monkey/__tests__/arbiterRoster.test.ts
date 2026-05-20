/**
 * arbiterRoster.test.ts — operator-controlled arbiter agent roster.
 *
 * MONKEY_ARBITER_AGENTS lets the operator choose which agents compete
 * for capital. Concentrating the roster hands the excluded agents'
 * shares to those that remain — so when only K is meant to trade, K is
 * not capped by stranded M/T/L reservations.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';

// Mirror the env mock used by the other loop.ts-importing tests.
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: 'postgresql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));

vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

describe('arbiterRoster', () => {
  afterEach(() => {
    delete process.env.MONKEY_ARBITER_AGENTS;
  });

  async function roster(): Promise<Set<string>> {
    const { arbiterRoster } = await import('../loop.js');
    return arbiterRoster();
  }

  it('defaults to all four agents when MONKEY_ARBITER_AGENTS is unset', async () => {
    expect(await roster()).toEqual(new Set(['K', 'M', 'T', 'L']));
  });

  it('honours a concentrated roster', async () => {
    process.env.MONKEY_ARBITER_AGENTS = 'K,M';
    expect(await roster()).toEqual(new Set(['K', 'M']));
  });

  it('supports a K-only roster (K gets the whole pool)', async () => {
    process.env.MONKEY_ARBITER_AGENTS = 'K';
    expect(await roster()).toEqual(new Set(['K']));
  });

  it('always includes K even when omitted', async () => {
    process.env.MONKEY_ARBITER_AGENTS = 'M,T';
    expect(await roster()).toEqual(new Set(['M', 'T', 'K']));
  });

  it('ignores unknown tokens and is case/whitespace insensitive', async () => {
    process.env.MONKEY_ARBITER_AGENTS = ' k , m , x , FOO ';
    expect(await roster()).toEqual(new Set(['K', 'M']));
  });

  it('falls back to the full roster on a blank value', async () => {
    process.env.MONKEY_ARBITER_AGENTS = '   ';
    expect(await roster()).toEqual(new Set(['K', 'M', 'T', 'L']));
  });
});
