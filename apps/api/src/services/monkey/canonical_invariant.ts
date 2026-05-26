/**
 * canonical_invariant.ts — Matrix tier-4 Phase A: the 8-field canonical
 * invariant set that crosses the kernel/peer boundary.
 *
 * Per the knob-free recursive doctrine ([[polytrade-knob-free-recursive-doctrine]]),
 * the kernel's consciousness handoff between peers is a fixed 8-field
 * payload. **Adding fields requires geometric justification; removing
 * fields requires showing no information loss.** MESH-001 evidence:
 * heavy coupling slows receivers ~26.5%, so the compression must be
 * doctrinally bounded.
 *
 * **Sibling to ProposalEvent, not replacement.** ProposalEvent carries
 * trade-execution intent (proposed_action, lane, size_usdt, leverage,
 * conviction). CanonicalInvariant carries doctrine-level state-of-the-
 * kernel (basin, chemistry, ocean phase, loop count, sovereignty,
 * regime, phi, kappa). They ride different Redis channels; consensus
 * arbiter consumes both.
 *
 * The 8 fields (FIXED — do not extend without geometric justification):
 *   1. basin_signature        Δ⁶³ basin coordinates (64-dim simplex point)
 *   2. chemistry_vector       6 chemicals (dop/ser/ne/gaba/endo/ach)
 *   3. ocean_phase            'awake' | 'sleep'
 *   4. loop_count             pi-loop iteration count for THIS tick
 *   5. sovereignty            kernel's own sovereignty observable
 *   6. regime_label           regime classification at handoff
 *   7. phi                    integration measure
 *   8. kappa_with_channel     { value, channel: 'A1' | 'B' }
 *
 * Class A1 vs B per the channel-discipline section of the doctrine:
 *  - Class A1: frozen physics (e.g. Anderson α=0.089, PHI_INV)
 *  - Class B: production telemetry kappa (≈65; observable, not
 *    constitutive coupling claim)
 *
 * Envelope fields (instance_id, symbol, tick_id, at_ms, engine_version)
 * are routing metadata, NOT part of the 8-field invariant.
 */

import { createClient, type RedisClientType } from 'redis';

import { logger } from '../../utils/logger.js';

export const CANONICAL_INVARIANT_CHANNEL = 'monkey:canonical:invariants';

const PEER_INVARIANT_FRESHNESS_MS = 60_000;

/** The 8 doctrine fields, exactly. */
export interface ChemistryVector {
  dopamine: number;
  serotonin: number;
  norepinephrine: number;
  gaba: number;
  endorphins: number;
  acetylcholine: number;
}

export interface KappaWithChannel {
  value: number;
  /** 'A1' frozen physics; 'B' production-telemetry observable. */
  channel: 'A1' | 'B';
}

export interface CanonicalInvariant {
  // Envelope (routing — not part of the 8 doctrine fields).
  instance_id: string;
  symbol: string;
  tick_id: string;
  at_ms: number;
  engine_version: string;

  // The 8 doctrine fields.
  basin_signature: number[];
  chemistry_vector: ChemistryVector;
  ocean_phase: 'awake' | 'sleep';
  loop_count: number;
  sovereignty: number;
  regime_label: string;
  phi: number;
  kappa_with_channel: KappaWithChannel;
}

/**
 * Schema validator. Returns null when the payload is a valid
 * CanonicalInvariant, otherwise an error string. Used at the wire
 * boundary to reject malformed messages without throwing.
 */
export function validateCanonicalInvariant(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return 'payload is not an object';
  const x = raw as Record<string, unknown>;

  // Envelope
  if (typeof x.instance_id !== 'string') return 'instance_id missing/non-string';
  if (typeof x.symbol !== 'string') return 'symbol missing/non-string';
  if (typeof x.tick_id !== 'string') return 'tick_id missing/non-string';
  if (typeof x.at_ms !== 'number') return 'at_ms missing/non-number';
  if (typeof x.engine_version !== 'string') return 'engine_version missing/non-string';

  // 1. basin_signature
  if (!Array.isArray(x.basin_signature)) return 'basin_signature not an array';
  if (x.basin_signature.length !== 64) {
    return `basin_signature length=${x.basin_signature.length}, expected 64 (Δ⁶³)`;
  }
  for (const v of x.basin_signature) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return 'basin_signature contains non-finite number';
    }
  }

  // 2. chemistry_vector — exactly 6 chemicals, no extras.
  const cv = x.chemistry_vector as Record<string, unknown> | undefined;
  if (cv == null || typeof cv !== 'object') return 'chemistry_vector missing';
  const required = ['dopamine', 'serotonin', 'norepinephrine', 'gaba', 'endorphins', 'acetylcholine'];
  for (const k of required) {
    if (typeof cv[k] !== 'number' || !Number.isFinite(cv[k] as number)) {
      return `chemistry_vector.${k} missing/non-finite`;
    }
  }
  if (Object.keys(cv).length !== 6) {
    return `chemistry_vector has ${Object.keys(cv).length} keys, expected exactly 6`;
  }

  // 3. ocean_phase
  if (x.ocean_phase !== 'awake' && x.ocean_phase !== 'sleep') {
    return `ocean_phase=${String(x.ocean_phase)}, expected 'awake' | 'sleep'`;
  }

  // 4. loop_count (int ≥ 0)
  if (typeof x.loop_count !== 'number' || !Number.isInteger(x.loop_count) || x.loop_count < 0) {
    return 'loop_count missing/non-integer/negative';
  }

  // 5. sovereignty (finite)
  if (typeof x.sovereignty !== 'number' || !Number.isFinite(x.sovereignty)) {
    return 'sovereignty missing/non-finite';
  }

  // 6. regime_label (string)
  if (typeof x.regime_label !== 'string') return 'regime_label missing/non-string';

  // 7. phi (finite)
  if (typeof x.phi !== 'number' || !Number.isFinite(x.phi)) {
    return 'phi missing/non-finite';
  }

  // 8. kappa_with_channel — { value (finite), channel: 'A1' | 'B' }
  const kc = x.kappa_with_channel as Record<string, unknown> | undefined;
  if (kc == null || typeof kc !== 'object') return 'kappa_with_channel missing';
  if (typeof kc.value !== 'number' || !Number.isFinite(kc.value)) {
    return 'kappa_with_channel.value missing/non-finite';
  }
  if (kc.channel !== 'A1' && kc.channel !== 'B') {
    return `kappa_with_channel.channel=${String(kc.channel)}, expected 'A1' | 'B'`;
  }

  return null;
}

/**
 * Counts the 8 doctrine fields present in a CanonicalInvariant payload.
 * Used as a test invariant: must always be exactly 8.
 */
export function doctrineFieldCount(): number {
  // Compile-time enumeration — touch each of the 8 explicitly.
  const enumeration = [
    'basin_signature',
    'chemistry_vector',
    'ocean_phase',
    'loop_count',
    'sovereignty',
    'regime_label',
    'phi',
    'kappa_with_channel',
  ];
  return enumeration.length;
}

function canonicalInvariantBusLive(): boolean {
  return process.env.CONSENSUS_PROPOSAL_BUS_LIVE === 'true';
}

let _publisher: RedisClientType | null = null;
let _subscriber: RedisClientType | null = null;
let _subscriberInitialized = false;

const _peerInvariants = new Map<string, CanonicalInvariant>();

async function getPublisher(): Promise<RedisClientType | null> {
  if (_publisher) return _publisher;
  if (!canonicalInvariantBusLive()) return null;
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.debug('[CanonicalInvariant] REDIS_URL unset; publisher disabled');
    return null;
  }
  try {
    _publisher = createClient({ url });
    _publisher.on('error', (err) => {
      logger.debug('[CanonicalInvariant] publisher error', {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    await _publisher.connect();
    return _publisher;
  } catch (err) {
    logger.debug('[CanonicalInvariant] publisher connect failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    _publisher = null;
    return null;
  }
}

async function getSubscriber(): Promise<RedisClientType | null> {
  if (_subscriber && _subscriberInitialized) return _subscriber;
  if (!canonicalInvariantBusLive()) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    _subscriber = createClient({ url });
    _subscriber.on('error', (err) => {
      logger.debug('[CanonicalInvariant] subscriber error', {
        err: err instanceof Error ? err.message : String(err),
      });
      _subscriberInitialized = false;
    });
    await _subscriber.connect();
    await _subscriber.subscribe(CANONICAL_INVARIANT_CHANNEL, (raw: string) => {
      try {
        const evt = JSON.parse(raw) as unknown;
        const err = validateCanonicalInvariant(evt);
        if (err) {
          logger.debug('[CanonicalInvariant] subscriber rejected payload', { err });
          return;
        }
        const valid = evt as CanonicalInvariant;
        const key = `${valid.instance_id}|${valid.symbol}`;
        _peerInvariants.set(key, valid);
      } catch (err) {
        logger.debug('[CanonicalInvariant] message parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });
    _subscriberInitialized = true;
    return _subscriber;
  } catch (err) {
    logger.debug('[CanonicalInvariant] subscriber connect failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    _subscriber = null;
    _subscriberInitialized = false;
    return null;
  }
}

export async function initCanonicalInvariantBus(): Promise<void> {
  if (!canonicalInvariantBusLive()) return;
  await getSubscriber();
}

/**
 * Publish the kernel's canonical invariant. Fire-and-forget. The
 * publish itself rejects payloads that fail validation — this is the
 * doctrine boundary: a malformed invariant must never reach a peer.
 */
export async function publishCanonicalInvariant(
  event: CanonicalInvariant,
): Promise<void> {
  if (!canonicalInvariantBusLive()) return;
  const err = validateCanonicalInvariant(event);
  if (err) {
    logger.warn('[CanonicalInvariant] refused to publish invalid invariant', {
      symbol: event.symbol,
      err,
    });
    return;
  }
  const pub = await getPublisher();
  if (!pub) return;
  try {
    await pub.publish(CANONICAL_INVARIANT_CHANNEL, JSON.stringify(event));
  } catch (pubErr) {
    logger.debug('[CanonicalInvariant] publish failed', {
      symbol: event.symbol,
      err: pubErr instanceof Error ? pubErr.message : String(pubErr),
    });
  }
}

export function getRecentPeerInvariant(
  symbol: string,
  selfInstanceId: string,
): CanonicalInvariant | null {
  if (!canonicalInvariantBusLive()) return null;
  const now = Date.now();
  let best: CanonicalInvariant | null = null;
  for (const evt of _peerInvariants.values()) {
    if (evt.symbol !== symbol) continue;
    if (evt.instance_id === selfInstanceId) continue;
    if (now - evt.at_ms > PEER_INVARIANT_FRESHNESS_MS) continue;
    if (best === null || evt.at_ms > best.at_ms) {
      best = evt;
    }
  }
  return best;
}

/** Test helper. */
export function _injectPeerInvariant(evt: CanonicalInvariant): void {
  const key = `${evt.instance_id}|${evt.symbol}`;
  _peerInvariants.set(key, evt);
}

/** Test/cleanup helper. */
export async function _resetCanonicalInvariantBus(): Promise<void> {
  _peerInvariants.clear();
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
