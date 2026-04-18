/**
 * tradingStateProbe — Option C predicate tests.
 *
 * The DB call is mocked via the db/connection module so we can exercise
 * every branch (active strategies, no active but recent promotion,
 * nothing at all) without a real DB.
 *
 * The implementation issues TWO queries: active-count first, then the
 * MAX-promoted-at fallback only when active-count is zero. These tests
 * mirror that by queuing responses in the order the implementation
 * consumes them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/connection.js';
import {
  TRADING_STATE_RECENT_PASS_WINDOW_MS,
  shouldExpectPaperTrades,
} from '../tradingStateProbe.js';

const mockedQuery = vi.mocked(query);

describe('shouldExpectPaperTrades', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('returns true when any strategy is active (skips MAX query entirely)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ n: 3 }] });
    expect(await shouldExpectPaperTrades()).toBe(true);
    // Short-circuit: MAX query never ran.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('returns true when no active strategies but promotion was recent (<24h)', async () => {
    const now = new Date('2026-04-18T12:00:00Z');
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ last_paper_promo: oneHourAgo }] });
    expect(await shouldExpectPaperTrades(now)).toBe(true);
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('returns false when no active strategies and last promotion was > 24h ago', async () => {
    const now = new Date('2026-04-18T12:00:00Z');
    const twoDaysAgo = new Date(
      now.getTime() - 2 * TRADING_STATE_RECENT_PASS_WINDOW_MS,
    ).toISOString();
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ last_paper_promo: twoDaysAgo }] });
    expect(await shouldExpectPaperTrades(now)).toBe(false);
  });

  it('returns false when there has never been a paper promotion', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ last_paper_promo: null }] });
    expect(await shouldExpectPaperTrades()).toBe(false);
  });

  it('returns false on empty result set', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
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
