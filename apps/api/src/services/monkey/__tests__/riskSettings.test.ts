/**
 * riskSettings.test.ts — operator risk-profile parsing.
 *
 * The kernel only acts on `maxLeverage` (the audited 15× safety cap).
 * The daily-loss + max-concurrent halts were removed 2026-05-25 —
 * the kernel self-regulates via neurochemistry, not operator gates.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRiskSettingsRow,
  DEFAULT_RISK_SETTINGS,
} from '../risk_settings.js';

describe('parseRiskSettingsRow', () => {
  it('returns defaults for a null/undefined row', () => {
    expect(parseRiskSettingsRow(null)).toEqual(DEFAULT_RISK_SETTINGS);
    expect(parseRiskSettingsRow(undefined)).toEqual(DEFAULT_RISK_SETTINGS);
  });

  it('parses a well-formed row (the aggressive UI preset)', () => {
    const parsed = parseRiskSettingsRow({
      max_drawdown: 25,
      max_position_size: 5,
      max_concurrent_positions: 5,
      stop_loss: 8,
      take_profit: 12,
      daily_loss_limit: 10,
      max_leverage: 15,
      risk_level: 'aggressive',
    });
    expect(parsed).toEqual({
      maxDrawdown: 25,
      maxPositionSize: 5,
      maxConcurrentPositions: 5,
      stopLoss: 8,
      takeProfit: 12,
      dailyLossLimit: 10,
      maxLeverage: 15,
      riskLevel: 'aggressive',
    });
  });

  it('parses numeric strings (pg NUMERIC columns arrive as strings)', () => {
    const parsed = parseRiskSettingsRow({
      max_drawdown: '15',
      max_position_size: '2',
      max_concurrent_positions: '3',
      stop_loss: '5',
      take_profit: '8',
      daily_loss_limit: '5',
      max_leverage: '15',
      risk_level: 'balanced',
    });
    expect(parsed.maxDrawdown).toBe(15);
    expect(parsed.maxLeverage).toBe(15);
  });

  it('clamps out-of-range values so a corrupt row cannot break a gate', () => {
    const parsed = parseRiskSettingsRow({
      max_drawdown: 500,
      max_position_size: -10,
      max_concurrent_positions: 999,
      stop_loss: 0.001,
      take_profit: 1000,
      daily_loss_limit: 200,
      max_leverage: 250,
      risk_level: 'aggressive',
    });
    expect(parsed.maxDrawdown).toBe(100);
    expect(parsed.maxLeverage).toBe(100);
  });

  it('falls back per-field on non-numeric / wrong-typed values', () => {
    const parsed = parseRiskSettingsRow({
      max_drawdown: 'not-a-number',
      max_position_size: null,
      max_concurrent_positions: undefined,
      stop_loss: '',
      take_profit: false,
      daily_loss_limit: {},
      risk_level: 42,
    });
    expect(parsed.maxDrawdown).toBe(DEFAULT_RISK_SETTINGS.maxDrawdown);
    expect(parsed.maxPositionSize).toBe(DEFAULT_RISK_SETTINGS.maxPositionSize);
    expect(parsed.riskLevel).toBe(DEFAULT_RISK_SETTINGS.riskLevel);
  });

  it('rounds max_concurrent_positions and max_leverage to integers', () => {
    const parsed = parseRiskSettingsRow({
      max_concurrent_positions: 3.7,
      max_leverage: 14.4,
    });
    expect(parsed.maxConcurrentPositions).toBe(4);
    expect(parsed.maxLeverage).toBe(14);
  });
});
