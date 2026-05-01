/**
 * learning_gate_client.ts — HTTP client for ml-worker's
 * /learning_gate/evaluate endpoint (Loop 3, UCP §43.4).
 *
 * Called from loop.ts witnessExit BEFORE bank writes. The kernel
 * decides which closed exchanges become bank training data; default
 * behaviour writes everything but this gate selectively rejects
 * low-quality writes so the bank doesn't accumulate scaffolding.
 *
 * Quality criteria (multiplicative — all must clear):
 *   1. sovereignty_score >= 0.4
 *   2. convergence_type != 'groupthink'
 *   3. |pnl_usdt| > 0.05 noise floor
 *   4. duration_s >= 60
 *
 * Failures are fail-soft: if the gate is unreachable, the caller
 * SHOULD proceed with the write — losing a Loop 3 audit trail is
 * better than refusing to learn from real exchanges because the
 * gate had a transient timeout.
 */

import { logger } from '../../utils/logger.js';

const ML_WORKER_URL =
  process.env.ML_WORKER_URL || 'http://ml-worker.railway.internal:8000';
const DEFAULT_TIMEOUT_MS = 3000;

export interface LearningGateRequest {
  instanceId?: string;
  symbol: string;
  decisionId: string;
  sovereigntyScore: number;
  convergenceType: 'consensus' | 'groupthink' | 'genuine_multi' | 'non_convergent';
  tradePnlUsdt: number;
  tradeDurationS: number;
}

export interface LearningGateResponse {
  approved: boolean;
  reasons: string[];
}

export async function evaluateBankWrite(
  req: LearningGateRequest,
): Promise<LearningGateResponse> {
  const body = JSON.stringify({
    instance_id: req.instanceId ?? 'monkey-primary',
    symbol: req.symbol,
    decision_id: req.decisionId,
    sovereignty_score: req.sovereigntyScore,
    convergence_type: req.convergenceType,
    trade_pnl_usdt: req.tradePnlUsdt,
    trade_duration_s: req.tradeDurationS,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/learning_gate/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('[learning_gate_client] evaluate failed', {
        status: res.status,
        body: await res.text(),
      });
      // Fail-soft: gate failure approves the write so legitimate
      // exchanges are not lost on a transient ml-worker outage.
      return { approved: true, reasons: [`gate_unreachable_${res.status}`] };
    }
    return (await res.json()) as LearningGateResponse;
  } catch (err) {
    logger.warn('[learning_gate_client] evaluate threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { approved: true, reasons: ['gate_threw_fail_soft'] };
  } finally {
    clearTimeout(timer);
  }
}
