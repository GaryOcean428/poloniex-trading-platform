/**
 * riskSettings.test.ts — operator risk-profile parsing + the daily-loss
 * halt condition (the pure logic behind the risk_settings → kernel wiring).
 */

import { describe, it, expect } from 'vitest';
import {
  parseRiskSettingsRow,
  dailyLossHalted,
  DEFAULT_RISK_SETTINGS,
  getEntryRiskSettingsHalt,
} from '../risk_settings.js';

describe('getEntryRiskSettingsHalt', () => {
  it('returns null when no operator profile is saved', () => {
    expect(getEntryRiskSettingsHalt({
      riskSettings: null,
      todayRealizedPnl: -500,
      equityUsdt: 1000,
      openMonkeyPositions: 99,
    })).toBeNull();
  });

  it('halts new entries on daily loss before checking concurrency', () => {
    expect(getEntryRiskSettingsHalt({
      riskSettings: {
        ...DEFAULT_RISK_SETTINGS,
        dailyLossLimit: 5,
        maxConcurrentPositions: 3,
      },
      todayRealizedPnl: -50,
      equityUsdt: 1000,
      openMonkeyPositions: 3,
    })).toEqual({
      kind: 'daily_loss_limit',
      todayRealizedPnl: -50,
      limitPct: 5,
      equityUsdt: 1000,
    });
  });

  it('halts new entries once max concurrent positions is reached', () => {
    expect(getEntryRiskSettingsHalt({
      riskSettings: {
        ...DEFAULT_RISK_SETTINGS,
        maxConcurrentPositions: 5,
      },
      todayRealizedPnl: 25,
      equityUsdt: 1000,
      openMonkeyPositions: 5,
    })).toEqual({
      kind: 'max_concurrent_positions',
      openMonkeyPositions: 5,
      cap: 5,
    });
  });

  it('allows entries while both ceilings are still clear', () => {
    expect(getEntryRiskSettingsHalt({
      riskSettings: {
        ...DEFAULT_RISK_SETTINGS,
        maxConcurrentPositions: 5,
      },
      todayRealizedPnl: -10,
      equityUsdt: 1000,
      openMonkeyPositions: 4,
    })).toBeNull();
  });
});

describe('parseRiskSettingsRow', () => {
  it('returns defaults for a null/undefined row', () => {
    expect(parseRiskSettingsRow(null)).toEqual(DEFAULT_RISK_SETTINGS);
    expect(parseRiskSettingsRow(undefined)).toEqual(DEFAULT_RISK_SETTINGS);
  });

  it('parses a well-formed row (the aggressive UI preset)', () => {
    const parsed = parseRiskSettingsRow({
      max_drawdown: 25,
      max_position_size: 10,
      max_concurrent_positions: 5,
      stop_loss: 3,
      take_profit: 6,
      daily_loss_limit: 10,
      max_leverage: 20,
      risk_level: 'aggressive',
    });
    expect(parsed).toEqual({
      maxDrawdown: 25,
      maxPositionSize: 10,
      maxConcurrentPositions: 5,
      stopLoss: 3,
      takeProfit: 6,
      dailyLossLimit: 10,
      maxLeverage: 20,
      riskLevel: 'aggressive',
    });
  });

  it('parses numeric strings (pg NUMERIC columns arrive as strings)', () => {
    const parsed = parseRiskSettingsRow({
      max_leverage: '12',
      daily_loss_limit: '7.5',
      max_concurrent_positions: '4',
    });
    expect(parsed.maxLeverage).toBe(12);
    expect(parsed.dailyLossLimit).toBe(7.5);
    expect(parsed.maxConcurrentPositions).toBe(4);
  });

  it('clamps out-of-range values so a corrupt row cannot break a gate', () => {
    const high = parseRiskSettingsRow({ max_leverage: 999, max_concurrent_positions: 80 });
    expect(high.maxLeverage).toBe(100);
    expect(high.maxConcurrentPositions).toBe(50);

    const low = parseRiskSettingsRow({ max_leverage: 0, max_concurrent_positions: 0 });
    expect(low.maxLeverage).toBe(1);
    expect(low.maxConcurrentPositions).toBe(1);
  });

  it('falls back per-field on non-numeric / wrong-typed values', () => {
    const parsed = parseRiskSettingsRow({
      max_leverage: 'not-a-number',
      daily_loss_limit: null,
      risk_level: 42,
    });
    expect(parsed.maxLeverage).toBe(DEFAULT_RISK_SETTINGS.maxLeverage);
    expect(parsed.dailyLossLimit).toBe(DEFAULT_RISK_SETTINGS.dailyLossLimit);
    expect(parsed.riskLevel).toBe(DEFAULT_RISK_SETTINGS.riskLevel);
  });

  it('rounds max_concurrent_positions and max_leverage to integers', () => {
    const parsed = parseRiskSettingsRow({ max_concurrent_positions: 3.7, max_leverage: 14.2 });
    expect(parsed.maxConcurrentPositions).toBe(4);
    expect(parsed.maxLeverage).toBe(14);
  });
});

describe('dailyLossHalted', () => {
  // cap = 5% of 1000 = 50 USDT
  it('does not halt while losses are within the cap', () => {
    expect(dailyLossHalted(-10, 5, 1000)).toBe(false);
    expect(dailyLossHalted(-49.99, 5, 1000)).toBe(false);
  });

  it('halts once realised loss reaches the cap', () => {
    expect(dailyLossHalted(-50, 5, 1000)).toBe(true);
    expect(dailyLossHalted(-80, 5, 1000)).toBe(true);
  });

  it('never halts on a profitable day', () => {
    expect(dailyLossHalted(120, 5, 1000)).toBe(false);
    expect(dailyLossHalted(0, 5, 1000)).toBe(false);
  });

  it('does not halt when equity or limit is non-positive (no spurious halt)', () => {
    expect(dailyLossHalted(-500, 5, 0)).toBe(false);
    expect(dailyLossHalted(-500, 0, 1000)).toBe(false);
  });

  it('does not halt on a non-finite PnL reading', () => {
    expect(dailyLossHalted(NaN, 5, 1000)).toBe(false);
  });
});
