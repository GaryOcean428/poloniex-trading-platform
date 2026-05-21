/**
 * proposal_bus.ts — Redis pub/sub bridge for cross-kernel proposal exchange.
 *
 * Layer 1.5 of the dual-kernel consensus architecture per
 * [[polytrade-consensus-architecture]]. Basin-level state already flows
 * via monkey_basin_sync (PR CONSENSUS-1). This module adds low-latency
 * proposal-level exchange via Redis pub/sub — the consensus arbiter
 * (PR CONSENSUS-7) will subscribe to both TS + Py proposals and emit
 * a consensus decision.
 *
 * Channel: `monkey:consensus:proposal`
 *
 * Flag: CONSENSUS_PROPOSAL_BUS_LIVE — default off. When off, neither
 * publisher nor subscriber connects (no Redis traffic). When on,
 * proposals stream across the bus and recent peer proposals are
 * available via getRecentPeerProposal().
 *
 * Fail-soft: any Redis error logs at debug and returns silently. A
 * dead Redis never blocks a tick.
 */

import { createClient, type RedisClientType } from 'redis';

import { logger } from '../../utils/logger.js';

export const PROPOSAL_CHANNEL = 'monkey:consensus:proposal';

const PEER_PROPOSAL_FRESHNESS_MS = 60_000;

export interface ProposalEvent {
  instance_id: string;
  symbol: string;
  tick_id: string;
  proposed_action: 'enter_long' | 'enter_short' | 'exit' | 'hold';
  side: 'long' | 'short' | null;
  lane: string;
  size_usdt: number;
  leverage: number;
  entry_threshold: number;
  conviction: number;
  basin_signature: number[];
  phi: number;
  kappa: number;
  regime_label: string | null;
  mode: string;
  at_ms: number;
  engine_version: string;
}

function consensusBusLive(): boolean {
  return process.env.CONSENSUS_PROPOSAL_BUS_LIVE === 'true';
}

let _publisher: RedisClientType | null = null;
let _subscriber: RedisClientType | null = null;
let _subscriberInitialized = false;

// Most-recent peer proposal by (peer_instance_id, symbol). The consensus
// arbiter consumes this via getRecentPeerProposal(symbol, selfId).
const _peerProposals = new Map<string, ProposalEvent>();

async function getPublisher(): Promise<RedisClientType | null> {
  if (_publisher) return _publisher;
  if (!consensusBusLive()) return null;
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.debug('[ProposalBus] REDIS_URL unset; publisher disabled');
    return null;
  }
  try {
    _publisher = createClient({ url });
    _publisher.on('error', (err) => {
      logger.debug('[ProposalBus] publisher error', {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    await _publisher.connect();
    return _publisher;
  } catch (err) {
    logger.debug('[ProposalBus] publisher connect failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    _publisher = null;
    return null;
  }
}

async function getSubscriber(): Promise<RedisClientType | null> {
  if (_subscriber && _subscriberInitialized) return _subscriber;
  if (!consensusBusLive()) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    _subscriber = createClient({ url });
    _subscriber.on('error', (err) => {
      logger.debug('[ProposalBus] subscriber error', {
        err: err instanceof Error ? err.message : String(err),
      });
      _subscriberInitialized = false;
    });
    await _subscriber.connect();
    await _subscriber.subscribe(PROPOSAL_CHANNEL, (raw: string) => {
      try {
        const evt = JSON.parse(raw) as ProposalEvent;
        const key = `${evt.instance_id}|${evt.symbol}`;
        _peerProposals.set(key, evt);
      } catch (err) {
        logger.debug('[ProposalBus] message parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });
    _subscriberInitialized = true;
    return _subscriber;
  } catch (err) {
    logger.debug('[ProposalBus] subscriber connect failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    _subscriber = null;
    _subscriberInitialized = false;
    return null;
  }
}

/**
 * Initialize the subscriber. Call once at kernel boot; idempotent.
 * No-op when CONSENSUS_PROPOSAL_BUS_LIVE is unset.
 */
export async function initProposalBus(): Promise<void> {
  if (!consensusBusLive()) return;
  await getSubscriber();
}

/**
 * Publish this kernel's proposal for the given tick. Fire-and-forget;
 * Redis errors are swallowed (logged at debug) so they never block
 * the orchestrator. No-op when flag is off.
 */
export async function publishProposal(event: ProposalEvent): Promise<void> {
  if (!consensusBusLive()) return;
  const pub = await getPublisher();
  if (!pub) return;
  try {
    await pub.publish(PROPOSAL_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.debug('[ProposalBus] publish failed', {
      symbol: event.symbol,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Return the most-recent peer proposal for `symbol` from any kernel
 * instance OTHER than `selfInstanceId`, provided it's fresh enough.
 * Returns null when:
 *  - flag is off
 *  - no peer proposals received yet
 *  - all peer proposals stale beyond PEER_PROPOSAL_FRESHNESS_MS
 */
export function getRecentPeerProposal(
  symbol: string,
  selfInstanceId: string,
): ProposalEvent | null {
  if (!consensusBusLive()) return null;
  const now = Date.now();
  let best: ProposalEvent | null = null;
  for (const evt of _peerProposals.values()) {
    if (evt.symbol !== symbol) continue;
    if (evt.instance_id === selfInstanceId) continue;
    if (now - evt.at_ms > PEER_PROPOSAL_FRESHNESS_MS) continue;
    if (best === null || evt.at_ms > best.at_ms) {
      best = evt;
    }
  }
  return best;
}

/**
 * Test helper — directly inject a proposal into the in-process peer-proposal
 * map without going through Redis. Used for unit tests that need to simulate
 * a peer proposal being received without a live Redis connection.
 */
export function _injectPeerProposal(evt: ProposalEvent): void {
  const key = `${evt.instance_id}|${evt.symbol}`;
  _peerProposals.set(key, evt);
}

/** Test/cleanup helper — disconnect and reset state. */
export async function _resetProposalBus(): Promise<void> {
  _peerProposals.clear();
  if (_publisher) {
    try { await _publisher.disconnect(); } catch { /* ignore */ }
    _publisher = null;
  }
  if (_subscriber) {
    try { await _subscriber.disconnect(); } catch { /* ignore */ }
    _subscriber = null;
    _subscriberInitialized = false;
  }
}
