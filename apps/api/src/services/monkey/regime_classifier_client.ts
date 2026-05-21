/**
 * regime_classifier_client.ts — TS client for the canonical
 * regime classifier (PERCEPTION-1).
 *
 * Single source of truth: calls ml-worker's POST /regime/classify_prices
 * which is backed by the observer-driven classifier introduced in
 * CAL-3. Per-symbol cache with short TTL (default 15s) to avoid one
 * HTTP hop per Monkey tick — fresh enough that the classification
 * reflects current market state, cached enough that perception
 * latency stays in-line with prior behaviour.
 *
 * Returns null when the ml-worker is unreachable or returns
 * unexpected shape — perception falls through to the legacy basin
 * construction in that case (fail-soft per tick-handler contract).
 */

import { logger } from '../../utils/logger.js';

const ML_WORKER_URL = (process.env.ML_WORKER_URL ?? '').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = Number(process.env.REGIME_CLASSIFIER_CACHE_TTL_MS ?? '15000');

export type CanonicalRegime = 'creator' | 'preserver' | 'dissolver';

export interface RegimeClassification {
  regime: CanonicalRegime;
  /**
   * Continuous 3-way regime membership from the soft observer (CAL-3).
   * Sums to ~1. `null` during the observer's warmup or when the
   * ml-worker omits it — perception then falls back to a one-hot of
   * the hard `regime` label. Encoding this continuously on basin dims
   * 0-2 is what keeps downstream neurochemistry off the rails (e.g.
   * `gaba = 1 - quantumWeight` was binary while the regime was one-hot).
   */
  scores: { creator: number; preserver: number; dissolver: number } | null;
  h: number;
  j: number;
  observer: {
    n: number;
    warm: boolean;
    lower: number | null;
    upper: number | null;
  };
  source: 'fetched' | 'cached';
  fetchedAt: number;
}

interface CacheEntry {
  classification: RegimeClassification;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** Test/cleanup helper. */
export function _resetClassifierCache(): void {
  _cache.clear();
}

/**
 * Parse + validate the optional soft 3-way regime membership from an
 * ml-worker response. Returns null unless all three components are
 * finite, non-negative, and sum to > 0 — a partial / NaN / all-zero
 * payload must not poison the continuous encoding (perception then
 * falls back to the hard one-hot label). Exported for unit testing.
 */
export function parseRegimeScores(
  rs: unknown,
): { creator: number; preserver: number; dissolver: number } | null {
  if (!rs || typeof rs !== 'object') return null;
  const o = rs as Record<string, unknown>;
  const c = Number(o.creator);
  const p = Number(o.preserver);
  const d = Number(o.dissolver);
  if ([c, p, d].every((x) => Number.isFinite(x) && x >= 0) && c + p + d > 0) {
    return { creator: c, preserver: p, dissolver: d };
  }
  return null;
}

/**
 * Fetch the canonical regime classification for a price window.
 * Returns null on any failure — caller falls through to legacy.
 */
export async function classifyPrices(
  symbol: string,
  prices: readonly number[],
): Promise<RegimeClassification | null> {
  if (!ML_WORKER_URL) {
    return null;
  }
  if (prices.length < 2) {
    return null;
  }

  // Per-symbol cache check.
  const cached = _cache.get(symbol);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { ...cached.classification, source: 'cached' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_WORKER_URL}/regime/classify_prices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol, prices: Array.from(prices) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.debug('[regime_classifier_client] HTTP non-2xx', {
        status: res.status, symbol,
      });
      return null;
    }
    const body = await res.json() as {
      regime?: string;
      regime_scores?: { creator?: number; preserver?: number; dissolver?: number } | null;
      h?: number;
      j?: number;
      observer_state?: { n?: number; warm?: boolean; lower?: number | null; upper?: number | null };
    };
    const regime = body.regime as CanonicalRegime | undefined;
    if (regime !== 'creator' && regime !== 'preserver' && regime !== 'dissolver') {
      logger.debug('[regime_classifier_client] unexpected regime label', { regime, symbol });
      return null;
    }
    const classification: RegimeClassification = {
      regime,
      scores: parseRegimeScores(body.regime_scores),
      h: Number(body.h ?? 0),
      j: Number(body.j ?? 0),
      observer: {
        n: Number(body.observer_state?.n ?? 0),
        warm: Boolean(body.observer_state?.warm ?? false),
        lower: body.observer_state?.lower ?? null,
        upper: body.observer_state?.upper ?? null,
      },
      source: 'fetched',
      fetchedAt: now,
    };
    _cache.set(symbol, {
      classification,
      expiresAt: now + CACHE_TTL_MS,
    });
    return classification;
  } catch (err) {
    logger.debug('[regime_classifier_client] fetch failed', {
      symbol, err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
