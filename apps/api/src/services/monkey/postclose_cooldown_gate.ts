/**
 * postclose_cooldown_gate.ts — pure-helper for the post-close cooldown
 * gate evaluation (#1017 Copilot follow-up).
 *
 * Extracted from `loop.ts:executeEntry` so the gate's correctness is
 * unit-testable without instantiating the full kernel (which transitively
 * pulls in env validation, DB pool, credentials service, etc.). The
 * gate is a 7-line decision; isolating it removes the test-environment
 * dependency tail and lets Copilot's "no test coverage for the entry-path
 * branch" finding be addressed cleanly.
 *
 * # Decision shape
 *
 * - `vetoed: true` when `composeCooldown(...).finalMs > 0` AND elapsed
 *   time since `lastCloseAtMs` is shorter than that floor
 * - `vetoed: false` in every other case (DCA-add bypass, no prior close
 *   on this symbol|side, or elapsed already exceeds the floor)
 *
 * # Cold-start honest disclosure
 *
 * The cold-start sentinel `COLD_START_FALLBACK_MS = 500` CAN fire a
 * veto before any settlement observation has warmed the ring. That's a
 * doctrine sentinel preserved from prior production behavior (the
 * legacy reverse-reopen pause at the old `loop.ts:5027` site), not an
 * empirical observation. Once the settlement ring has accumulated
 * `MIN_RING_SAMPLES` the sentinel is replaced by the empirical p99.
 *
 * Citations: poloniex-trading-platform#1017 + #1009 PR1/PR2 + 2.31A
 * P5/P25 + QIG PURITY MANDATE + LIVED ONLY 5 + autonomy doctrine.
 */

import { composeCooldown, formatCooldownTelemetry } from './cooldown_composer.js';

export interface PostCloseCooldownDecision {
  vetoed: boolean;
  cooldownMs: number;
  elapsedMs: number;
  reason: string | null;
  cooldownTelemetry: string;
}

export function evaluatePostCloseCooldownGate(args: {
  symbol: string;
  side: 'long' | 'short';
  isDCAAdd: boolean;
  lastCloseAtMs: number | undefined;
  nowMs: number;
}): PostCloseCooldownDecision {
  if (args.isDCAAdd || args.lastCloseAtMs === undefined) {
    return {
      vetoed: false,
      cooldownMs: 0,
      elapsedMs: 0,
      reason: null,
      cooldownTelemetry: 'cooldown:0|by=zero',
    };
  }
  const cooldown = composeCooldown({ symbol: args.symbol, tickCadenceMs: 0 });
  const cooldownMs = cooldown.finalMs;
  const elapsedMs = args.nowMs - args.lastCloseAtMs;
  const cooldownTelemetry = formatCooldownTelemetry(cooldown);
  if (cooldownMs > 0 && elapsedMs < cooldownMs) {
    return {
      vetoed: true,
      cooldownMs,
      elapsedMs,
      reason:
        `postclose_cooldown: ${(elapsedMs / 1000).toFixed(1)}s since last close on ${args.symbol}|${args.side}, `
        + `${((cooldownMs - elapsedMs) / 1000).toFixed(1)}s remaining `
        + `(${cooldownTelemetry})`,
      cooldownTelemetry,
    };
  }
  return {
    vetoed: false,
    cooldownMs,
    elapsedMs,
    reason: null,
    cooldownTelemetry,
  };
}
