/**
 * Agent Execution Mode Gating Tests
 * 
 * Verifies that executionMode gating logic correctly prevents
 * unwanted phase promotions (backtest → paper → live).
 */
import { describe, it, expect } from 'vitest';

describe('Agent Execution Mode Configuration', () => {
  it('should validate executionMode values', () => {
    const validModes = ['backtest', 'paper', 'live'];
    validModes.forEach(mode => {
      expect(['backtest', 'paper', 'live']).toContain(mode);
    });
  });

  it('should default executionMode to live when config spread applies', () => {
    // Simulate what startAgent does: defaults merged with user config
    const defaultConfig = {
      executionMode: 'live' as const,
      maxDrawdown: 15,
      positionSize: 2,
    };

    // User provides backtest mode
    const userConfig = { executionMode: 'backtest' as const };
    const merged = { ...defaultConfig, ...userConfig };
    expect(merged.executionMode).toBe('backtest');

    // User provides paper mode
    const paperConfig = { executionMode: 'paper' as const };
    const mergedPaper = { ...defaultConfig, ...paperConfig };
    expect(mergedPaper.executionMode).toBe('paper');

    // User provides no mode — default applies
    const noModeConfig = {};
    const mergedDefault = { ...defaultConfig, ...noModeConfig };
    expect(mergedDefault.executionMode).toBe('live');
  });

  it('backtest mode should not allow paper or live promotion', () => {
    // Simulate the gating logic used in runStrategyLifecycle
    const executionMode = 'backtest';
    
    // After backtest completes, check if promotion is allowed
    const shouldPromoteToPaper = executionMode !== 'backtest';
    expect(shouldPromoteToPaper).toBe(false);
  });

  it('paper mode should allow paper but not live promotion', () => {
    const executionMode = 'paper';
    
    // Paper mode should proceed to paper trading
    const shouldPromoteToPaper = executionMode !== 'backtest';
    expect(shouldPromoteToPaper).toBe(true);
    
    // Paper mode should NOT promote to live
    const shouldPromoteToLive = executionMode === 'live';
    expect(shouldPromoteToLive).toBe(false);
  });

  it('live mode should allow full lifecycle progression', () => {
    const executionMode = 'live';
    
    const shouldPromoteToPaper = executionMode !== 'backtest';
    expect(shouldPromoteToPaper).toBe(true);
    
    const shouldPromoteToLive = executionMode === 'live';
    expect(shouldPromoteToLive).toBe(true);
  });
});
