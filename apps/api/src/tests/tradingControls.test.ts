/**
 * tradingControls.test.ts — process-wide trading kill switch.
 *
 * `isTradingPaused()` is the canonical entry-pause gate. Before
 * 2026-05-14 it lived in monkey/loop_constants.ts and read only
 * MONKEY_TRADING_PAUSED — so the operator's kill switch stopped the
 * Monkey kernel but LiveSignal and FAT kept opening positions. It now
 * lives here and both env vars pause ALL entry engines.
 *
 * These tests pin: (1) either env var pauses, (2) neither set = live,
 * (3) only the literal string 'true' counts, (4) it is read live (not
 * cached) so a Railway var flip takes effect without a redeploy.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { isTradingPaused } from '../services/tradingControls.js';

const TRADING = 'TRADING_PAUSED';
const MONKEY = 'MONKEY_TRADING_PAUSED';

describe('tradingControls — isTradingPaused', () => {
  afterEach(() => {
    delete process.env[TRADING];
    delete process.env[MONKEY];
  });

  it('returns false when neither env var is set', () => {
    expect(isTradingPaused()).toBe(false);
  });

  it('returns true when TRADING_PAUSED=true (canonical, engine-agnostic)', () => {
    process.env[TRADING] = 'true';
    expect(isTradingPaused()).toBe(true);
  });

  it('returns true when MONKEY_TRADING_PAUSED=true (back-compat — now global)', () => {
    process.env[MONKEY] = 'true';
    expect(isTradingPaused()).toBe(true);
  });

  it('returns true when both are set', () => {
    process.env[TRADING] = 'true';
    process.env[MONKEY] = 'true';
    expect(isTradingPaused()).toBe(true);
  });

  it('only the literal string "true" pauses — not "1", "TRUE", "yes"', () => {
    for (const truthy of ['1', 'TRUE', 'True', 'yes', 'on', '']) {
      process.env[TRADING] = truthy;
      process.env[MONKEY] = truthy;
      expect(isTradingPaused()).toBe(false);
    }
  });

  it('is read live — a mid-process flip takes effect immediately (no caching)', () => {
    expect(isTradingPaused()).toBe(false);
    process.env[TRADING] = 'true';
    expect(isTradingPaused()).toBe(true);
    delete process.env[TRADING];
    expect(isTradingPaused()).toBe(false);
  });
});
