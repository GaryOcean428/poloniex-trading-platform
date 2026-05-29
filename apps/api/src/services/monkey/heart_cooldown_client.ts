/**
 * heart_cooldown_client.ts — TS bridge to Python HEART cooldown ownership.
 *
 * The lived close observations are ingested in loop.ts/heart_arbitrator.ts,
 * but the post-close cooldown arbitration surface is `heart.py` as required
 * by #1009. This client refreshes a per-symbol cached HEART/PERCEPTION
 * contribution from ml-worker and lets the synchronous cooldown composer
 * consume the latest HEART-owned value without restoring a hardcoded wall.
 */

import { logger } from '../../utils/logger.js';
import {
  getHeartCooldownInputs,
  heartArbitratedMs as localHeartFallbackMs,
} from './heart_arbitrator.js';

function mlWorkerUrl(): string {
  return (process.env.ML_WORKER_URL ?? 'http://localhost:8000').replace(/\/$/, '');
}

export interface HeartCooldownRefreshArgs {
  symbol: string;
  safetyFloorMs: number;
  decoherenceFloorMs: number;
  heartRhythm: number;
  tackingPhase: string;
  oceanCoherence?: number;
  oceanSleepPhase?: string;
  oceanSleepRemainingMs?: number;
}

export interface HeartCooldownResponse {
  safety_floor_ms: number;
  decoherence_floor_ms: number;
  heart_arbitrated_ms: number;
  final_cooldown_ms: number;
  by: string;
}

const cache = new Map<string, HeartCooldownResponse>();

function finiteNonNegative(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseResponse(payload: unknown): HeartCooldownResponse | null {
  if (payload === null || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const safety = finiteNonNegative(obj.safety_floor_ms);
  const decoherence = finiteNonNegative(obj.decoherence_floor_ms);
  const heart = finiteNonNegative(obj.heart_arbitrated_ms);
  const final = finiteNonNegative(obj.final_cooldown_ms);
  if (safety === null || decoherence === null || heart === null || final === null) return null;
  return {
    safety_floor_ms: safety,
    decoherence_floor_ms: decoherence,
    heart_arbitrated_ms: heart,
    final_cooldown_ms: final,
    by: typeof obj.by === 'string' ? obj.by : 'heart',
  };
}

export async function refreshHeartCooldown(args: HeartCooldownRefreshArgs): Promise<void> {
  const closeInputs = getHeartCooldownInputs(args.symbol);
  try {
    const res = await fetch(`${mlWorkerUrl()}/monkey/heart/post_close_cooldown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: args.symbol,
        safety_floor_ms: args.safetyFloorMs,
        decoherence_floor_ms: args.decoherenceFloorMs,
        heart_rhythm: args.heartRhythm,
        tacking_phase: args.tackingPhase,
        recent_close_pnls: closeInputs.recentClosePnls,
        recent_close_gaps_ms: closeInputs.recentCloseGapsMs,
        ocean_state: {
          coherence: args.oceanCoherence,
          sleep_phase: args.oceanSleepPhase,
          sleep_remaining_ms: args.oceanSleepRemainingMs,
        },
      }),
    });
    if (!res.ok) return;
    const parsed = parseResponse(await res.json());
    if (parsed) cache.set(args.symbol, parsed);
  } catch (err) {
    logger.debug('[heart_cooldown] ml-worker refresh failed', {
      symbol: args.symbol,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function cachedHeartCooldownMs(symbol: string): number {
  return cache.get(symbol)?.heart_arbitrated_ms ?? localHeartFallbackMs(symbol);
}

export function cachedDecoherenceFloorMs(symbol: string): number {
  return cache.get(symbol)?.decoherence_floor_ms ?? 0;
}

export function _resetHeartCooldownCache(): void {
  cache.clear();
}
