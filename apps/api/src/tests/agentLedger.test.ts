import { describe, it, expect } from 'vitest';
import { engineModeSqlClause } from '../services/agentLedger.js';

/**
 * agentLedger — engine-mode SQL filter.
 *
 * Background: /api/agent/status summed pnl across EVERY engine (paper +
 * backtest + deleted FAT/LiveSignal rows, all-time, no filter) — surfacing
 * a meaningless cumulative "realized PnL" (operator saw −$4054). The fix
 * routes both /status and /performance through this single filter so a
 * "realized PnL" figure means the LIVE engine only.
 */
describe('engineModeSqlClause — autonomous_trades engine filter', () => {
  it("'live' yields a live-only engine_type clause", () => {
    expect(engineModeSqlClause('live')).toBe(" AND engine_type = 'live'");
  });

  it("'paper' yields a paper-only clause", () => {
    expect(engineModeSqlClause('paper')).toBe(" AND engine_type = 'paper'");
  });

  it("'backtest' yields a backtest-only clause", () => {
    expect(engineModeSqlClause('backtest')).toBe(
      " AND engine_type = 'backtest'",
    );
  });

  it("'all' yields no clause — every engine is summed", () => {
    expect(engineModeSqlClause('all')).toBe('');
  });

  it('an absent mode yields no clause', () => {
    expect(engineModeSqlClause(undefined)).toBe('');
    expect(engineModeSqlClause(null)).toBe('');
  });

  it('an unrecognised or hostile mode fails open to no clause — never interpolates caller input', () => {
    expect(engineModeSqlClause("'; DROP TABLE autonomous_trades; --")).toBe('');
    expect(engineModeSqlClause('LIVE')).toBe('');
    expect(engineModeSqlClause('')).toBe('');
  });
});
