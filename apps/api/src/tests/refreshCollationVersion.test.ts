import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/connection.js', () => ({
  pool: {
    query: vi.fn()
  }
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import {
  buildCollationRefreshTargets,
  parseDatabaseNameFromConnectionString,
  quoteIdentifier,
  refreshKnownDatabaseCollationVersions
} from '../scripts/refreshCollationVersion.js';

const mockedPoolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedLoggerWarn = logger.warn as unknown as ReturnType<typeof vi.fn>;
const mockedLoggerError = logger.error as unknown as ReturnType<typeof vi.fn>;

describe('refreshKnownDatabaseCollationVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
  });

  it('runs refresh for app, postgres, and template1 databases', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'app_db' }] });
    mockedPoolQuery.mockResolvedValue({});

    await refreshKnownDatabaseCollationVersions();

    expect(mockedPoolQuery).toHaveBeenNthCalledWith(1, 'SELECT current_database() AS db;');
    expect(mockedPoolQuery).toHaveBeenCalledWith(
      'ALTER DATABASE "app_db" REFRESH COLLATION VERSION;'
    );
    expect(mockedPoolQuery).toHaveBeenCalledWith(
      'ALTER DATABASE "postgres" REFRESH COLLATION VERSION;'
    );
    expect(mockedPoolQuery).toHaveBeenCalledWith(
      'ALTER DATABASE "template1" REFRESH COLLATION VERSION;'
    );
  });

  it('falls back to DATABASE_URL database name when current_database query fails', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/fallback_db';
    mockedPoolQuery.mockRejectedValueOnce(new Error('failed to get current database'));
    mockedPoolQuery.mockResolvedValue({});

    await refreshKnownDatabaseCollationVersions();

    expect(mockedPoolQuery).toHaveBeenCalledWith(
      'ALTER DATABASE "fallback_db" REFRESH COLLATION VERSION;'
    );
    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      'Failed to query current database name, using DATABASE_URL fallback',
      expect.any(Object)
    );
  });

  it('logs non-fatal warnings for expected SQLSTATE failures', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'app_db' }] });
    mockedPoolQuery.mockResolvedValueOnce({});
    mockedPoolQuery.mockRejectedValueOnce({ code: '42501', message: 'permission denied' });
    mockedPoolQuery.mockResolvedValueOnce({});

    await refreshKnownDatabaseCollationVersions();

    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      'Skipping non-fatal collation refresh failure',
      expect.objectContaining({ databaseName: 'postgres', code: '42501' })
    );
  });

  it('logs unexpected refresh failures as errors', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'app_db' }] });
    mockedPoolQuery.mockRejectedValueOnce({ code: 'XX000', message: 'unexpected failure' });
    mockedPoolQuery.mockResolvedValue({});

    await refreshKnownDatabaseCollationVersions();

    expect(mockedLoggerError).toHaveBeenCalledWith(
      'Unexpected collation refresh failure',
      expect.objectContaining({ databaseName: 'app_db', code: 'XX000' })
    );
  });
});

describe('refreshCollationVersion helpers', () => {
  it('quotes database identifiers safely', () => {
    expect(quoteIdentifier('postgres')).toBe('"postgres"');
    expect(quoteIdentifier('db"name')).toBe('"db""name"');
  });

  it('parses database name from postgres connection string', () => {
    expect(
      parseDatabaseNameFromConnectionString('postgresql://user:pass@localhost:5432/testdb')
    ).toBe('testdb');
    expect(
      parseDatabaseNameFromConnectionString('postgresql://user:pass@localhost:5432/myapp%5Fdb')
    ).toBe('myapp_db');
  });

  it('returns null for missing or invalid connection strings', () => {
    expect(parseDatabaseNameFromConnectionString(undefined)).toBeNull();
    expect(parseDatabaseNameFromConnectionString('not-a-valid-url')).toBeNull();
    expect(parseDatabaseNameFromConnectionString('postgresql://user:pass@localhost:5432')).toBeNull();
  });

  it('builds deterministic deduplicated refresh targets', () => {
    expect(buildCollationRefreshTargets('app_db')).toEqual(['app_db', 'postgres', 'template1']);
    expect(buildCollationRefreshTargets('postgres')).toEqual(['postgres', 'template1']);
    expect(buildCollationRefreshTargets('template1')).toEqual(['template1', 'postgres']);
  });
});
