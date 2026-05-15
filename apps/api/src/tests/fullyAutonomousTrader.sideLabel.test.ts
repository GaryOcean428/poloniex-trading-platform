/**
 * Tests for the FAT (FullyAutonomousTrader) HEDGE-mode side labeling fix.
 *
 * Background (2026-04-30, post PR #611 HEDGE flip):
 *   The `[FAT] {symbol} LONG/SHORT pnl=… priceMove=… roi=… lev=…` log line
 *   was mislabelling SHORT positions as LONG. Production evidence:
 *     [FAT] ETH_USDT_PERP LONG pnl=-0.0636u priceMove=0.305% roi=-5.63% lev=20x
 *     [FAT] pnl formula divergence: priceMove=0.305% vs roi/lev=-0.281% Δ=0.586%
 *   priceMove +0.305% with roi -5.63% at 20x is unambiguously a SHORT
 *   losing as price rises; the divergence WARN was the parity invariant
 *   detecting the mislabel.
 *
 *   Root cause: managePositions read `qty > 0` to derive `isLong`, but
 *   in v3 HEDGE responses the position object can carry positive `qty`
 *   magnitude alongside a `posSide=SHORT` field. Same class of bug as
 *   the loop.ts/stateReconciliationService fixes — the canonical
 *   resolution order is `posSide` field first, `Math.sign(qty)` fallback.
 *
 * Coverage:
 *   1. LONG label — positive qty (one-way OR HEDGE+posSide=LONG).
 *   2. SHORT label — negative qty (one-way) AND HEDGE+posSide=SHORT
 *      with positive qty magnitude (the production failure shape).
 *   3. Divergence WARN suppression — once side is correctly labeled,
 *      the priceMove and roi/leverage agree on sign, so the parity
 *      invariant no longer fires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock heavy dependencies (mirrors fullyAutonomousTraderPyBridge.test.ts) ──
vi.mock('../db/connection.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }
}));
vi.mock('../services/poloniexFuturesService.js', () => ({
  default: {
    getPositions: vi.fn(),
    closePosition: vi.fn().mockResolvedValue({}),
    normalizeSymbol: vi.fn((s: string) => s),
    getAccountBalance: vi.fn().mockResolvedValue({ eq: '10000' }),
  }
}));
vi.mock('../services/riskService.js', () => ({ default: {} }));
vi.mock('../services/mlPredictionService.js', () => ({ default: {} }));
vi.mock('../services/apiCredentialsService.js', () => ({
  apiCredentialsService: { getCredentials: vi.fn() }
}));
vi.mock('../utils/marketDataValidator.js', () => ({ validateMarketData: vi.fn() }));
vi.mock('../services/marketCatalog.js', () => ({ getPrecisions: vi.fn() }));
vi.mock('../services/monitoringService.js', () => ({
  monitoringService: { recordPipelineHeartbeat: vi.fn(), recordTradeEvent: vi.fn() }
}));
vi.mock('../utils/engineVersion.js', () => ({ getEngineVersion: () => 'v-test' }));
vi.mock('../services/backtestingEngine.js', () => ({ default: {} }));
vi.mock('../services/simpleMlService.js', () => ({ default: {} }));
vi.mock('../services/monkey/kernel_client.js', () => ({
  callExitDecide: vi.fn(),
  callReconcile: vi.fn(),
  isExitShadowEnabled: vi.fn(() => false),
  logExitParityDiff: vi.fn(),
  logReconcileParityDiff: vi.fn(),
}));
vi.mock('../services/signalGenome.js', () => ({
  buildIndicatorMap: vi.fn(() => new Map()),
  evaluateGenomeEntry: vi.fn(() => ({ action: 'HOLD', score: 0 })),
}));

import { FullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { logger } from '../utils/logger.js';

/** Access private members for testing without TS complaints. */
function priv(t: FullyAutonomousTrader) {
  return t as unknown as {
    managePositions: (
      userId: string,
      analyses: Map<string, unknown>,
    ) => Promise<void>;
    configs: Map<string, unknown>;
  };
}

const USER = 'test-user-side-label';

/** Capture every logger.info / logger.warn call into structured records. */
function captureLogs() {
  const infos: string[] = [];
  const warns: string[] = [];
  const infoSpy = vi.spyOn(logger, 'info').mockImplementation(((msg: unknown) => {
    if (typeof msg === 'string') infos.push(msg);
  }) as typeof logger.info);
  const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(((msg: unknown) => {
    if (typeof msg === 'string') warns.push(msg);
  }) as typeof logger.warn);
  return { infos, warns, infoSpy, warnSpy };
}

describe('FAT [FAT] side-label — HEDGE-mode fix', () => {
  let trader: FullyAutonomousTrader;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
    vi.mocked(apiCredentialsService.getCredentials).mockResolvedValue({
      apiKey: 'k', apiSecret: 's',
    } as never);
    // Set a baseline config so managePositions doesn't bail on missing user.
    priv(trader).configs.set(USER, {
      stopLossPercent: 99,         // wide enough to never trigger
      takeProfitPercent: 99,       // wide enough to never trigger
      initialCapital: 10_000,
    });
    // Disable ROI gates so the test focuses on the [FAT] log line + parity.
    process.env.ROI_TP_PERCENT = '999';
    process.env.ROI_SL_PERCENT = '999';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ROI_TP_PERCENT;
    delete process.env.ROI_SL_PERCENT;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. LONG label — winning long with positive qty (one-way OR HEDGE+LONG).
  // ──────────────────────────────────────────────────────────────────────────
  it('labels positive-qty position as LONG', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      {
        symbol: 'BTC_USDT_PERP',
        qty: '0.001',                   // positive magnitude
        posSide: 'LONG',
        markPx: '50500',
        openAvgPx: '50000',
        upl: '0.5',
        uplRatio: '0.05',               // +5% ROI on margin
        lever: '5',
      },
    ] as never);
    const { infos } = captureLogs();
    await priv(trader).managePositions(USER, new Map());

    const fatLine = infos.find(s => s.startsWith('[FAT] BTC_USDT_PERP'));
    expect(fatLine).toBeDefined();
    expect(fatLine).toContain('LONG');
    expect(fatLine).not.toContain('SHORT');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. SHORT label — the production HEDGE failure shape.
  //
  // Poloniex v3 HEDGE response: positive qty magnitude + posSide=SHORT.
  // Pre-fix code computed `isLong = qty > 0` → mislabel LONG.
  // Post-fix: posSide is read first; falls back to qty-sign for ONE_WAY.
  // ──────────────────────────────────────────────────────────────────────────
  it('labels HEDGE-mode SHORT (positive qty + posSide=SHORT) as SHORT', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      {
        symbol: 'ETH_USDT_PERP',
        qty: '0.05',                    // positive magnitude (HEDGE shape)
        posSide: 'SHORT',
        markPx: '2259.4',
        openAvgPx: '2252.54',
        upl: '-0.0636',
        uplRatio: '-0.0563',            // -5.63% ROI — losing
        lever: '20',
      },
    ] as never);
    const { infos } = captureLogs();
    await priv(trader).managePositions(USER, new Map());

    const fatLine = infos.find(s => s.startsWith('[FAT] ETH_USDT_PERP'));
    expect(fatLine).toBeDefined();
    expect(fatLine).toContain('SHORT');
    expect(fatLine).not.toContain(' LONG ');
  });

  it('labels ONE_WAY-mode short (negative qty, no posSide) as SHORT', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      {
        symbol: 'ETH_USDT_PERP',
        qty: '-0.05',                   // negative magnitude (ONE_WAY shape)
        markPx: '2259.4',
        openAvgPx: '2252.54',
        upl: '-0.0636',
        uplRatio: '-0.0563',
        lever: '20',
      },
    ] as never);
    const { infos } = captureLogs();
    await priv(trader).managePositions(USER, new Map());

    const fatLine = infos.find(s => s.startsWith('[FAT] ETH_USDT_PERP'));
    expect(fatLine).toBeDefined();
    expect(fatLine).toContain('SHORT');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Divergence WARN suppression.
  //
  // Once the side label is correct, priceMove and roi/leverage agree
  // (within float noise), so the "pnl formula divergence" parity invariant
  // no longer fires on this position.
  //
  // Using the exact production numbers:
  //   entry=2252.54 mark=2259.4 → priceMove (correctly as SHORT) = -0.305%
  //   roi=-5.63%, lev=20 → impliedPriceMove = -0.281%
  //   |Δ| = 0.024% < 0.5% threshold → no WARN.
  //
  // The check itself stays active (it's load-bearing for future Poloniex
  // shape drift), but doesn't fire on this corrected case.
  // ──────────────────────────────────────────────────────────────────────────
  it('does NOT emit divergence WARN once SHORT is labeled correctly', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      {
        symbol: 'ETH_USDT_PERP',
        qty: '0.05',
        posSide: 'SHORT',
        markPx: '2259.4',
        openAvgPx: '2252.54',
        upl: '-0.0636',
        uplRatio: '-0.0563',
        lever: '20',
      },
    ] as never);
    const { warns } = captureLogs();
    await priv(trader).managePositions(USER, new Map());

    const divergenceWarn = warns.find(s => s.includes('pnl formula divergence'));
    expect(divergenceWarn).toBeUndefined();
  });
});
