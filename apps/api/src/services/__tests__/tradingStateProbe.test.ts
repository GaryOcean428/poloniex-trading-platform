/**
 * tradingStateProbe — Option C predicate tests.
 *
 * The DB call is mocked via the db/connection module so we can exercise
 * all three states (active strategies present, no active but recent
 * promotion, nothing at all) without a real DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/connection.js';
import {
  TRADING_STATE_RECENT_PASS_WINDOW_MS,
  shouldExpectPaperTrades,
} from '../tradingStateProbe.js';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

describe('shouldExpectPaperTrades', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });
  afterEach(() => {
    mockedQuery.mockReset();
  });

  it('returns true when any strategy is active in paper/recommended/live', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ active_count: 3, last_paper_promo: null }],
    });
    expect(await shouldExpectPaperTrades()).toBe(true);
  });

  it('returns true when no active strategies but promotion was recent (<24h)', async () => {
    const now = new Date('2026-04-18T12:00:00Z');
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
    mockedQuery.mockResolvedValueOnce({
      rows: [{ active_count: 0, last_paper_promo: oneHourAgo }],
    });
    expect(await shouldExpectPaperTrades(now)).toBe(true);
  });

  it('returns false when no active strategies and last promotion was > 24h ago', async () => {
    const now = new Date('2026-04-18T12:00:00Z');
    const twoDaysAgo = new Date(
      now.getTime() - 2 * TRADING_STATE_RECENT_PASS_WINDOW_MS,
    ).toISOString();
    mockedQuery.mockResolvedValueOnce({
      rows: [{ active_count: 0, last_paper_promo: twoDaysAgo }],
    });
    expect(await shouldExpectPaperTrades(now)).toBe(false);
  });

  it('returns false when there has never been a paper promotion', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ active_count: 0, last_paper_promo: null }],
    });
    expect(await shouldExpectPaperTrades()).toBe(false);
  });

  it('returns false on empty result set', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    expect(await shouldExpectPaperTrades()).toBe(false);
  });

  it('fail-softs to false on DB error (no alert cascade on transient DB hiccup)', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('connection refused'));
    expect(await shouldExpectPaperTrades()).toBe(false);
  });

  it('24h window constant matches the design decision', () => {
    expect(TRADING_STATE_RECENT_PASS_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
