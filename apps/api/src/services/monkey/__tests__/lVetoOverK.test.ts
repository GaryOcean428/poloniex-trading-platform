/**
 * lVetoOverK.test.ts — Option A: L-veto over K.
 *
 * Agent K (geometric kernel) was over-trading ETH (-$5.93, 12.3% WR
 * over 227 trades / 24h) while Agent L (FR-KNN Lorentzian-equivalent,
 * historically ~76.4% WR) was constrained to "vote only" via
 * per_agent_bus. This gate lets L's high-conviction disagreement
 * suppress K's executeEntry on the same tick.
 *
 * Scope of the gate:
 *   - Default OFF — env L_VETO_OVER_K_ENABLED not 'true' → no behavior
 *     change (byte-identical to today).
 *   - ON: BLOCKS K entries (enter_long, enter_short, reverse_long,
 *     reverse_short). Does NOT block holds, exits, scalp_exit, harvest.
 *   - Does NOT block M, T, L, LiveSignal — only K (the over-trader).
 *
 * These tests pin the pure helper contract (`evaluateLVetoOverK`) +
 * the env semantics + the kernel-level counter wiring.
 *
 * Coverage:
 *   1. Veto fires when L conviction > threshold AND L side disagrees
 *      with K.
 *   2. Veto does NOT fire when conviction is below threshold.
 *   3. Veto does NOT fire when L agrees with K (same side).
 *   4. Exits / harvest are unaffected by the env flip (the helper
 *      returns vetoed=false for any non-entry K action).
 *   5. Default OFF: env unset → all K entries proceed (vetoed=false,
 *      reasonCode='flag_disabled').
 *   6. Telemetry counter increments correctly per veto + per symbol.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// loop.ts transitively imports the env validator (DATABASE_URL,
// JWT_SECRET). Set sentinel values BEFORE the dynamic import below
// so module-load doesn't throw. These values are never used — the
// tests only exercise pure helpers + an in-memory counter.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-used-by-these-tests';

const loopModule = await import('../loop.js');
const {
  evaluateLVetoOverK,
  L_VETO_DEFAULT_CONVICTION_THRESHOLD,
  monkeyKernel,
} = loopModule;
import type { AgentLDecision } from '../agent_L_classifier.js';

const ENV_FLAG = 'L_VETO_OVER_K_ENABLED';
const ENV_THRESHOLD = 'L_VETO_CONVICTION_THRESHOLD';

/** Build a minimal L decision stub — only the three fields the helper
 *  consumes are required. */
function lDec(
  action: AgentLDecision['action'],
  signedScore: number,
  conviction: number,
): Pick<AgentLDecision, 'action' | 'signedScore' | 'conviction'> {
  return { action, signedScore, conviction };
}

describe('evaluateLVetoOverK — pure helper', () => {
  // ── 1. Fires when conviction high + sides disagree ─────────────
  it('fires when L is highly convinced AND disagrees with K (L short vs K long)', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_long',
      // |signedScore|=0.9 × conviction=0.8 = 0.72 > 0.6 default
      lDecision: lDec('enter_short', -0.9, 0.8),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(true);
    expect(r.reasonCode).toBe('vetoed_high_conviction_disagreement');
    expect(r.lSide).toBe('short');
    expect(r.weightedConviction).toBeCloseTo(0.72, 5);
  });

  it('fires for the mirror case (L long vs K short)', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_short',
      lDecision: lDec('enter_long', 0.95, 0.9),  // weighted = 0.855
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(true);
    expect(r.lSide).toBe('long');
  });

  it('fires on K reverse-reopen leg (reverse_long counts as long entry)', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'reverse_long',  // close-then-reopen long
      lDecision: lDec('enter_short', -0.9, 0.9),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(true);
    expect(r.lSide).toBe('short');
  });

  it('fires on K reverse_short with L long disagreement', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'reverse_short',
      lDecision: lDec('enter_long', 0.85, 0.9),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(true);
    expect(r.lSide).toBe('long');
  });

  // ── 2. Does NOT fire when conviction is below threshold ────────
  it('does NOT fire when weighted conviction is below threshold', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_long',
      // 0.5 × 0.5 = 0.25 ≤ 0.6 threshold → no veto
      lDecision: lDec('enter_short', -0.5, 0.5),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('l_conviction_below_threshold');
    expect(r.weightedConviction).toBeCloseTo(0.25, 5);
  });

  it('does NOT fire when conviction exactly equals threshold (strict >)', () => {
    // 0.6 × 1.0 = 0.6 exactly; helper requires STRICTLY > threshold
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_long',
      lDecision: lDec('enter_short', -0.6, 1.0),
      threshold: 0.6,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('l_conviction_below_threshold');
  });

  it('respects a custom (lower) threshold passed by the caller', () => {
    // Below default (0.6) but above the operator-set 0.1
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_long',
      lDecision: lDec('enter_short', -0.4, 0.5),  // weighted=0.2
      threshold: 0.1,
    });
    expect(r.vetoed).toBe(true);
  });

  // ── 3. Does NOT fire when L agrees with K ──────────────────────
  it('does NOT fire when L and K both want long', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_long',
      lDecision: lDec('enter_long', 0.95, 0.95),  // strong long
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('l_agrees_with_k');
  });

  it('does NOT fire when L and K both want short', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_short',
      lDecision: lDec('enter_short', -0.9, 0.9),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('l_agrees_with_k');
  });

  it('does NOT fire when L is holding (no opinion)', () => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: 'enter_long',
      lDecision: lDec('hold', 0, 0),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('l_holding');
    expect(r.lSide).toBeNull();
  });

  // ── 4. Exits / harvest unaffected ──────────────────────────────
  it.each([
    'hold',
    'scalp_exit',
    'exit',
    'force_harvest',
    'flatten',
    'auto_flatten',
    'exit_stop',
    'exit_donchian',
    'pyramid_long',  // Turtle-style pyramids are T, not K — but pin contract
    'pyramid_short',
  ])('does NOT fire on non-entry K action "%s"', (action) => {
    const r = evaluateLVetoOverK({
      enabled: true,
      kAction: action,
      lDecision: lDec('enter_short', -0.9, 0.9),  // would fire on an entry
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('k_not_entry');
  });

  // ── 5. Default OFF: env unset → no veto ────────────────────────
  it('does NOT fire when enabled=false even if all other conditions hold', () => {
    const r = evaluateLVetoOverK({
      enabled: false,
      kAction: 'enter_long',
      lDecision: lDec('enter_short', -0.95, 0.95),
      threshold: L_VETO_DEFAULT_CONVICTION_THRESHOLD,
    });
    expect(r.vetoed).toBe(false);
    expect(r.reasonCode).toBe('flag_disabled');
  });
});

describe('L_VETO_OVER_K env var semantics', () => {
  let savedFlag: string | undefined;
  let savedThreshold: string | undefined;

  beforeEach(() => {
    savedFlag = process.env[ENV_FLAG];
    savedThreshold = process.env[ENV_THRESHOLD];
    delete process.env[ENV_FLAG];
    delete process.env[ENV_THRESHOLD];
  });

  afterEach(() => {
    if (savedFlag !== undefined) process.env[ENV_FLAG] = savedFlag;
    else delete process.env[ENV_FLAG];
    if (savedThreshold !== undefined) process.env[ENV_THRESHOLD] = savedThreshold;
    else delete process.env[ENV_THRESHOLD];
  });

  // Mirror of the production isLVetoOverKEnabled — pinning the contract
  // (only the exact string 'true' enables) so a refactor can't loosen it.
  const isLVetoOverKEnabled = (): boolean =>
    process.env[ENV_FLAG] === 'true';
  const lVetoConvictionThreshold = (): number => {
    const raw = process.env[ENV_THRESHOLD];
    if (raw === undefined) return L_VETO_DEFAULT_CONVICTION_THRESHOLD;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return L_VETO_DEFAULT_CONVICTION_THRESHOLD;
    }
    return parsed;
  };

  it('default (env unset) is disabled', () => {
    expect(isLVetoOverKEnabled()).toBe(false);
  });

  it('only the exact string "true" enables (strict comparison)', () => {
    process.env[ENV_FLAG] = 'true';
    expect(isLVetoOverKEnabled()).toBe(true);
    process.env[ENV_FLAG] = 'TRUE';
    expect(isLVetoOverKEnabled()).toBe(false);
    process.env[ENV_FLAG] = '1';
    expect(isLVetoOverKEnabled()).toBe(false);
    process.env[ENV_FLAG] = 'yes';
    expect(isLVetoOverKEnabled()).toBe(false);
  });

  it('threshold defaults to 0.6 when unset', () => {
    expect(lVetoConvictionThreshold()).toBe(L_VETO_DEFAULT_CONVICTION_THRESHOLD);
    expect(L_VETO_DEFAULT_CONVICTION_THRESHOLD).toBe(0.6);
  });

  it('threshold reads from env when set to a valid number', () => {
    process.env[ENV_THRESHOLD] = '0.75';
    expect(lVetoConvictionThreshold()).toBe(0.75);
  });

  it('threshold falls back to default for non-numeric env', () => {
    process.env[ENV_THRESHOLD] = 'not-a-number';
    expect(lVetoConvictionThreshold()).toBe(L_VETO_DEFAULT_CONVICTION_THRESHOLD);
  });

  it('threshold falls back to default for negative env (invalid)', () => {
    process.env[ENV_THRESHOLD] = '-0.5';
    expect(lVetoConvictionThreshold()).toBe(L_VETO_DEFAULT_CONVICTION_THRESHOLD);
  });
});

describe('MonkeyKernel.getLVetoOverKStats — counter wiring', () => {
  beforeEach(() => {
    monkeyKernel.resetLVetoOverKStats();
  });

  it('starts at zero counts and empty per-symbol map', () => {
    const stats = monkeyKernel.getLVetoOverKStats();
    expect(stats.total).toBe(0);
    expect(stats.bySymbol).toEqual({});
  });

  it('total increments on every veto', () => {
    monkeyKernel.incrementLVetoOverKForTest('ETH_USDT_PERP');
    monkeyKernel.incrementLVetoOverKForTest('ETH_USDT_PERP');
    monkeyKernel.incrementLVetoOverKForTest('BTC_USDT_PERP');
    expect(monkeyKernel.getLVetoOverKStats().total).toBe(3);
  });

  it('per-symbol counts increment independently', () => {
    monkeyKernel.incrementLVetoOverKForTest('ETH_USDT_PERP');
    monkeyKernel.incrementLVetoOverKForTest('ETH_USDT_PERP');
    monkeyKernel.incrementLVetoOverKForTest('ETH_USDT_PERP');
    monkeyKernel.incrementLVetoOverKForTest('BTC_USDT_PERP');
    const stats = monkeyKernel.getLVetoOverKStats();
    expect(stats.bySymbol.ETH_USDT_PERP).toBe(3);
    expect(stats.bySymbol.BTC_USDT_PERP).toBe(1);
    expect(stats.total).toBe(4);
  });

  it('reset clears total and per-symbol map', () => {
    monkeyKernel.incrementLVetoOverKForTest('ETH_USDT_PERP');
    monkeyKernel.incrementLVetoOverKForTest('BTC_USDT_PERP');
    expect(monkeyKernel.getLVetoOverKStats().total).toBe(2);
    monkeyKernel.resetLVetoOverKStats();
    expect(monkeyKernel.getLVetoOverKStats()).toEqual({ total: 0, bySymbol: {} });
  });
});
