/**
 * peer_kernel_client.ts — HTTP client for the Python consensus peer kernel.
 *
 * Fans each TS tick out to `/monkey/tick/run` on ml-worker so the Python
 * kernel can publish its own ProposalEvent to the consensus bus. The TS
 * consensus arbiter then picks up the Python proposal via
 * `getRecentPeerProposal()` on the next tick.
 *
 * Architecture decision (Task 1, 2026-05-21):
 *   - TS-driven fanout (not an independent Python loop) — pairs each
 *     Python proposal deterministically with the TS tick that consults
 *     it and trivially satisfies PEER_PROPOSAL_FRESHNESS_MS.
 *   - Uses /monkey/tick/run (persistent state) — not /monkey/k-shadow/tick
 *     (ephemeral). A consensus peer with amnesiac state is not a
 *     meaningful second opinion.
 *   - Python instance_id = 'monkey-py-peer' — distinct from the TS self id
 *     so _symbol_states[('monkey-py-peer', symbol)] accumulates an
 *     independent trajectory.
 *
 * Feature-flagged via CONSENSUS_PEER_FANOUT_LIVE (default off). When off,
 * fanoutToPeerKernel() is a no-op — nothing changes in production until
 * the flag is flipped.
 *
 * Fire-and-forget: never throws on network / HTTP error. The TS tick
 * orchestrator must not be blocked by Python kernel latency.
 *
 * Mirrors autonomic_client.ts for shape and error-handling pattern.
 */

import { logger } from '../../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 5000;

/** Lazily read so tests can override ML_WORKER_URL at runtime. */
function getMLWorkerURL(): string {
  return process.env.ML_WORKER_URL || 'http://ml-worker.railway.internal:8000';
}

/** The peer instance_id used when fanning out to the Python kernel. */
export const PEER_INSTANCE_ID = 'monkey-py-peer';

export interface OHLCVInput {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AccountInput {
  equity_fraction: number;
  margin_fraction: number;
  open_positions: number;
  available_equity: number;
  exchange_held_side?: string | null;
  own_position_entry_price?: number | null;
  own_position_quantity?: number | null;
  own_position_trade_id?: string | null;
}

export interface PeerKernelFanoutInputs {
  /** TS caller's own instance_id (e.g. 'monkey-primary'). NOT used as the
   * Python peer instance_id — the peer always registers as 'monkey-py-peer'. */
  instanceId: string;
  symbol: string;
  ohlcv: OHLCVInput[];
  account: AccountInput;
  bankSize: number;
  sovereignty: number;
  maxLeverage: number;
  minNotional: number;
  sizeFraction: number;
  rollingKellyStats?: [number, number, number] | null;
  selfObsBias?: unknown;
  prevState?: unknown;
}

/** Returns true when the TS→Python peer fanout is enabled. */
export function isPeerFanoutLive(): boolean {
  return process.env.CONSENSUS_PEER_FANOUT_LIVE === 'true';
}

/**
 * Fan this tick's inputs to the Python peer kernel. Fire-and-forget —
 * never throws, never awaited by the caller's orchestrator.
 *
 * No-op when CONSENSUS_PEER_FANOUT_LIVE is off.
 */
export async function fanoutToPeerKernel(
  inputs: PeerKernelFanoutInputs,
): Promise<void> {
  if (!isPeerFanoutLive()) return;

  const body = JSON.stringify({
    instance_id: PEER_INSTANCE_ID,
    inputs: {
      symbol: inputs.symbol,
      ohlcv: inputs.ohlcv,
      account: inputs.account,
      bank_size: inputs.bankSize,
      sovereignty: inputs.sovereignty,
      max_leverage: inputs.maxLeverage,
      min_notional: inputs.minNotional,
      size_fraction: inputs.sizeFraction,
      ...(inputs.rollingKellyStats != null
        ? { rolling_kelly_stats: inputs.rollingKellyStats }
        : {}),
      ...(inputs.selfObsBias != null
        ? { self_obs_bias: inputs.selfObsBias }
        : {}),
    },
    // Pass null for prev_state — the peer uses its own in-process
    // _symbol_states cache keyed by (PEER_INSTANCE_ID, symbol).
    // PY_INDEPENDENT_STATE_LIVE=true on the Python side makes the peer
    // accumulate an independent trajectory rather than echoing TS state.
    prev_state: inputs.prevState ?? null,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${getMLWorkerURL()}/monkey/tick/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.debug('[PeerKernelClient] fanout non-OK response', {
        symbol: inputs.symbol,
        status: res.status,
      });
    }
  } catch (err) {
    // Fire-and-forget: network errors are logged at debug only so they
    // never surface in the orchestrator's error path.
    logger.debug('[PeerKernelClient] fanout failed', {
      symbol: inputs.symbol,
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}
