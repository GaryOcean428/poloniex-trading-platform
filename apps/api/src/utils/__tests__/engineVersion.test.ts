/**
 * Unit tests for engineVersion utility.
 *
 * Contract:
 *   - env ENGINE_VERSION wins over everything
 *   - platform env vars are next (RAILWAY_GIT_COMMIT_SHA etc.)
 *   - git rev-parse HEAD is the dev-machine fallback
 *   - 'unknown' is the always-returns-a-string guarantee
 *   - Value is cached across calls; __resetEngineVersionCache clears it
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetEngineVersionCache, getEngineVersion } from '../engineVersion.js';

const ENV_KEYS = [
  'ENGINE_VERSION',
  'RAILWAY_GIT_COMMIT_SHA',
  'GIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
];

describe('engineVersion', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    __resetEngineVersionCache();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __resetEngineVersionCache();
  });

  it('prefers ENGINE_VERSION over platform env vars', () => {
    process.env.ENGINE_VERSION = 'abc123deadbeef';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'ignored';
    expect(getEngineVersion()).toBe('abc123deadbeef');
  });

  it('falls back to RAILWAY_GIT_COMMIT_SHA when ENGINE_VERSION is absent', () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = 'railway-sha-123';
    expect(getEngineVersion()).toBe('railway-sha-123');
  });

  it('trims whitespace and truncates to 40 chars', () => {
    process.env.ENGINE_VERSION = '  ' + 'f'.repeat(60) + '  ';
    expect(getEngineVersion()).toBe('f'.repeat(40));
  });

  it('caches the result across calls', () => {
    process.env.ENGINE_VERSION = 'first';
    const a = getEngineVersion();
    process.env.ENGINE_VERSION = 'second';
    const b = getEngineVersion();
    expect(a).toBe('first');
    expect(b).toBe('first');
  });

  it('__resetEngineVersionCache invalidates the cache', () => {
    process.env.ENGINE_VERSION = 'first';
    expect(getEngineVersion()).toBe('first');
    process.env.ENGINE_VERSION = 'second';
    __resetEngineVersionCache();
    expect(getEngineVersion()).toBe('second');
  });

  it('falls back to git rev-parse or "unknown" when no env var is set', () => {
    const result = getEngineVersion();
    // Either a real git SHA (in this working tree) or 'unknown'.
    // We do not assert the exact value because the test suite runs both
    // in CI (where no git may be present) and locally.
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Git SHAs are 40 hex chars; 'unknown' is 7. Accept either shape.
    expect(result === 'unknown' || /^[0-9a-f]{7,40}$/i.test(result)).toBe(true);
  });

  it('ignores empty-string env vars and continues fallback', () => {
    process.env.ENGINE_VERSION = '';
    process.env.GIT_SHA = 'valid-sha';
    expect(getEngineVersion()).toBe('valid-sha');
  });
});
