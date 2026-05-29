import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOOP_TS = readFileSync(join(__dirname, '..', 'loop.ts'), 'utf8');
const SERVICE_JS = readFileSync(join(__dirname, '..', '..', 'poloniexFuturesService.js'), 'utf8');
const MIGRATION_063 = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '063_polo_reward_ledger_full_net.sql'),
  'utf8',
);

describe('Polo reward-ledger hardening', () => {
  it('treats feeAmt as a magnitude and retries unindexed close fills', () => {
    expect(LOOP_TS).toContain('Math.abs(feeAmt)');
    expect(LOOP_TS).toContain('const MAX_ATTEMPTS = 3');
    expect(LOOP_TS).toContain('const RETRY_DELAY_MS = 200');
    expect(LOOP_TS).toContain("apiCache.invalidatePrefix('GET:/trade/order/trades')");
  });

  it('writes distinct pnl_source values and full-net telemetry columns', () => {
    expect(LOOP_TS).toContain("'polo_gross_minus_close_fees'");
    expect(LOOP_TS).toContain("'polo_net_full'");
    expect(LOOP_TS).toContain('pnl_net_close_fees_only = $5');
    expect(LOOP_TS).toContain('pnl_net_full = $6');
    expect(LOOP_TS).toContain('open_fees_paid = $7');
    expect(LOOP_TS).toContain('funding_paid = $8');
  });

  it('has an authenticated funding-history path for full-net PnL', () => {
    expect(SERVICE_JS).toContain('async getFundingHistory(credentials, params = {})');
    expect(SERVICE_JS).toContain("'/trade/funding'");
    expect(LOOP_TS).toContain('poloniexFuturesService.getFundingHistory');
  });

  it('expands and backfills the pnl_source constraint in migration 063', () => {
    expect(MIGRATION_063).toContain('polo_gross_minus_close_fees');
    expect(MIGRATION_063).toContain('polo_net_full');
    expect(MIGRATION_063).toContain("SET pnl_source = 'polo_gross_minus_close_fees'");
    expect(MIGRATION_063).toContain('pnl_net_close_fees_only');
    expect(MIGRATION_063).toContain('pnl_net_full');
  });
});
