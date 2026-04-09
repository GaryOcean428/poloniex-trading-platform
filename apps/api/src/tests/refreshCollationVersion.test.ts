import { describe, expect, it } from 'vitest';
import {
  buildCollationRefreshTargets,
  parseDatabaseNameFromConnectionString,
  quoteIdentifier
} from '../scripts/refreshCollationVersion.js';

describe('refreshCollationVersion helpers', () => {
  it('quotes database identifiers safely', () => {
    expect(quoteIdentifier('postgres')).toBe('"postgres"');
    expect(quoteIdentifier('db"name')).toBe('"db""name"');
  });

  it('parses database name from postgres connection string', () => {
    expect(
      parseDatabaseNameFromConnectionString('postgresql://user:pass@localhost:5432/poloniex')
    ).toBe('poloniex');
    expect(
      parseDatabaseNameFromConnectionString('postgresql://user:pass@localhost:5432/poloniex%5Fdb')
    ).toBe('poloniex_db');
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
