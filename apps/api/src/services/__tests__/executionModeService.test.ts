/**
 * executionModeService — global safety-override service tests.
 *
 * DB is mocked so we can drive every branch (cache hit, cache miss,
 * update, missing row, DB error) without touching a real database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/connection.js';
import {
  __resetExecutionModeCache,
  getCurrentExecutionMode,
  getExecutionModeRecord,
  isLiveExecutionAllowed,
  isOrderExecutionAllowed,
  setExecutionMode,
} from '../executionModeService.js';

const mockedQuery = vi.mocked(query);

describe('executionModeService', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    __resetExecutionModeCache();
  });

  afterEach(() => {
    __resetExecutionModeCache();
  });

  it('reads the current mode from the singleton row', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'auto', updated_at: '2026-04-18T00:00:00Z', updated_by: 'seed', reason: null }],
    });
    expect(await getCurrentExecutionMode()).toBe('auto');
  });

  it('defaults to pause (fail closed) when the singleton is missing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getCurrentExecutionMode()).toBe('pause');
  });

  it('defaults to pause (fail closed) on DB error', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('connection refused'));
    expect(await getCurrentExecutionMode()).toBe('pause');
  });

  it('caches within TTL', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'auto', updated_at: '2026-04-18T00:00:00Z', updated_by: 's', reason: null }],
    });
    await getCurrentExecutionMode();
    await getCurrentExecutionMode();
    // Second call hit cache → still only one DB call.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('isOrderExecutionAllowed is false only under pause', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'pause', updated_at: '2026-04-18T00:00:00Z', updated_by: 'op', reason: 'drill' }],
    });
    expect(await isOrderExecutionAllowed()).toBe(false);

    __resetExecutionModeCache();
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'paper_only', updated_at: '2026-04-18T00:00:00Z', updated_by: 'op', reason: null }],
    });
    expect(await isOrderExecutionAllowed()).toBe(true);
  });

  it('isLiveExecutionAllowed is true only under auto', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'paper_only', updated_at: '2026-04-18T00:00:00Z', updated_by: 'op', reason: null }],
    });
    expect(await isLiveExecutionAllowed()).toBe(false);

    __resetExecutionModeCache();
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'auto', updated_at: '2026-04-18T00:00:00Z', updated_by: 'op', reason: null }],
    });
    expect(await isLiveExecutionAllowed()).toBe(true);
  });

  it('setExecutionMode writes, invalidates cache, returns the new record', async () => {
    // First: UPDATE (no rows returned)
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Second: SELECT after cache invalidation
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        mode: 'paper_only',
        updated_at: '2026-04-18T03:00:00Z',
        updated_by: 'braden',
        reason: 'debug',
      }],
    });
    const record = await setExecutionMode('paper_only', 'braden', 'debug');
    expect(record.mode).toBe('paper_only');
    expect(record.updatedBy).toBe('braden');
    expect(record.reason).toBe('debug');
  });

  it('setExecutionMode rejects invalid modes', async () => {
    await expect(setExecutionMode('invalid' as any, 'op', null)).rejects.toThrow(/Invalid/);
  });

  it('getExecutionModeRecord force-refreshes the cache', async () => {
    // Prime the cache.
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'auto', updated_at: '2026-04-18T00:00:00Z', updated_by: 'seed', reason: null }],
    });
    await getCurrentExecutionMode();

    // Audit read should re-hit the DB despite the cache being warm.
    mockedQuery.mockResolvedValueOnce({
      rows: [{ mode: 'auto', updated_at: '2026-04-18T00:00:00Z', updated_by: 'seed', reason: null }],
    });
    const record = await getExecutionModeRecord();
    expect(record).not.toBeNull();
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });
});
