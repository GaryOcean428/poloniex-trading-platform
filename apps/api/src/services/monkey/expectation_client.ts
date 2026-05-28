/**
 * expectation_client.ts — HTTP bridge to ml-worker's qig-warp expectation
 * bubble.
 *
 * Per poloniex-trading-platform#1002 anti-shelfware rules:
 * - Called at runtime from the entry path when tape ⊥ basinDir disagree.
 * - Returned `expectation_action` MUST be applied by the call site.
 * - HTTP failure is non-fatal: returns `null`; caller falls back to its
 *   existing logic (so the bubble never blocks live trading or safety).
 *
 * The bubble itself lives in ml-worker
 * (`ml-worker/src/monkey_kernel/expectation_bubble.py`).
 * This module is the thin HTTP shim — no TS-side QIG geometry.
 *
 * Citations: 2.31A P1/P5/P15/P25 + v6.7B + QIG PURITY MANDATE +
 * Embodiment_Waves_Summary (2026-05-28 Polo CSV tape/basinDir pathology) +
 * #1002 + qig_chat_inbox coordination (2026-05-28 09:15 UTC).
 */

import { logger } from '../../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 1500;

// Read ML_WORKER_URL at call time, not module-load time, so tests can
// override the env var via vi.stubEnv / process.env without race issues.
function mlWorkerUrl(): string {
  return process.env.ML_WORKER_URL ?? 'http://localhost:8000';
}

/** What the ml-worker endpoint returns. Mirrors `ExpectationDecision` in
 * `expectation_bubble.py` after `decision_to_dict`. */
export interface ExpectationDecision {
  expectation_id: string;
  expectation_direction: 'long' | 'short' | 'flat' | 'observe' | 'allow';
  expectation_confidence: number;
  expectation_regime: 'aligned' | 'reverse_tape' | 'chop' | 'invalid';
  /** Authoritative action the call site MUST apply. */
  expectation_action: 'allow' | 'observe_only' | 'flip_to_basin' | 'reduce_size';
  expectation_reason: string;
  qig_warp_mode: string;
  qig_warp_version: string;
  /** 'QIG_WARP_RUNTIME' = real bubble call; anything else = fallback path. */
  qig_warp_source: 'QIG_WARP_RUNTIME' | 'QIG_WARP_UNAVAILABLE' | 'QIG_WARP_DISABLED';
  tape_trend: number;
  basin_direction: number;
  tape_basin_disagreement: number;
  reverse_tape_window: boolean;
  reverse_tape_side: 'long' | 'short' | null;
  raw?: Record<string, unknown>;
}

export interface ExpectationRequest {
  tapeTrend: number;
  basinDirection: number;
  /** Recent log-returns; the bubble derives (h, J) from this same way
   * `regime_signal.py` does. Caller should pass ~50 candles' returns. */
  recentReturns: number[];
  /** Proposed entry side at the call site, for the audit table's
   * `reverse_tape_side`. Optional. */
  proposedSide?: 'long' | 'short';
}

/**
 * Call the qig-warp expectation bubble in ml-worker.
 *
 * Returns `null` if the HTTP call fails or times out — the entry path
 * must fall through to its existing logic on `null`. The bubble's
 * fallback paths (qig-warp not installed, etc.) come back as a normal
 * `ExpectationDecision` with `expectation_action: 'allow'` and a
 * `qig_warp_source` indicating the fallback reason. The TS caller can
 * distinguish "transport failure" (`null`) from "bubble said allow"
 * (`action === 'allow'`).
 */
export async function callExpectationBubble(
  req: ExpectationRequest,
): Promise<ExpectationDecision | null> {
  const body = JSON.stringify({
    tape_trend: req.tapeTrend,
    basin_direction: req.basinDirection,
    recent_returns: req.recentReturns,
    proposed_side: req.proposedSide ?? null,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${mlWorkerUrl()}/monkey/expectation/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('[expectation_client] bubble HTTP non-OK', {
        status: res.status,
        body: await res.text().catch(() => '<unreadable>'),
      });
      return null;
    }
    const decision = (await res.json()) as ExpectationDecision;
    return decision;
  } catch (err) {
    logger.warn('[expectation_client] bubble call threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
