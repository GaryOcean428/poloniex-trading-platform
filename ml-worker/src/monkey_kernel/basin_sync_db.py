"""basin_sync_db.py — Redis-bridge adapter for cross-kernel basin sync.

The pure-functional `basin_sync` module is stateless for unit testing;
this adapter wraps it with publish/read against the `monkey_basin_sync`
table (migration 032). Both the TS and Python Monkey kernels coordinate
through that table per Layer 1 of the dual-kernel consensus architecture
(see [[polytrade-consensus-architecture]]).

ARCHITECTURE (2026-05-16 pivot):
The original design opened psycopg directly from this process. Under
FastAPI worker threads sharing memory with TensorFlow / sklearn / cuda
stubs, psycopg.connect() triggered `free(): invalid pointer` segfaults
in libpq's C-layer allocator — TF runtime poisons libpq's malloc.

The pivot:
  - Python WRITES via Redis pub/sub. Payload published to
    `monkey:basin:sync:writes`. The TS-side
    `basin_sync_redis_bridge.ts` subscribes and persists via the TS
    Postgres pool (no TF contamination).
  - Python READS are a no-op here. Peer state is consumed by the
    TS-side consensus arbiter (CONSENSUS-9), which already has direct
    Postgres access. Python doesn't need direct peer access.

Flag: `CONSENSUS_CROSS_OBSERVATION_LIVE` — kept for telemetry parity
with the previous API. The shadow-pull computation still runs (against
an empty peer list, so it's a no-op) so callers don't need to change.

QIG purity: read/write only — math stays in `basin_sync.py`. Slerp_sqrt
preserves Δ⁶³; Fisher-Rao metric throughout.

Fail-soft: any Redis or import error logs at debug and silently drops
the write. A bad sync never blocks a kernel tick.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .basin_sync import BasinSyncState, apply_observer_effect

logger = logging.getLogger("monkey_kernel.basin_sync_db")


_redis_pub_client = None  # type: ignore[var-annotated]
BASIN_SYNC_WRITE_CHANNEL = "monkey:basin:sync:writes"


def _get_redis_publisher():
    """Lazy-init the sync Redis client for basin-sync writes. Returns None
    if REDIS_URL is unset OR import fails. Safe to call from any thread —
    redis-py's sync client doesn't share libpq's allocator issue."""
    global _redis_pub_client
    if _redis_pub_client is not None:
        return _redis_pub_client
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    try:
        import redis as redis_sync
        _redis_pub_client = redis_sync.from_url(url, decode_responses=True)
        return _redis_pub_client
    except Exception as err:  # noqa: BLE001
        logger.debug("[BasinSyncDB] redis publisher init failed: %s", err)
        return None


def warm_connection() -> bool:
    """No-op under the Redis-bridge architecture. Kept for backward-compat
    with main.py's lifespan startup hook.

    The previous implementation pre-warmed a psycopg connection on the
    main thread to dodge TF/libpq malloc poisoning. We no longer touch
    psycopg from this process, so there's nothing to warm. Returns True
    when the flag is on (so the operator still sees the lifecycle log)
    and False when the flag is off.
    """
    if not basin_sync_db_live():
        logger.info("[BasinSyncDB] warm_connection skipped — flag off")
        return False
    logger.info(
        "[BasinSyncDB] warm_connection no-op — using Redis bridge "
        "(channel=%s)",
        BASIN_SYNC_WRITE_CHANNEL,
    )
    return True


def cross_observation_live() -> bool:
    """True unless CONSENSUS_CROSS_OBSERVATION_LIVE=false (explicit kill switch).
    Reversal of flag-gated paralysis (fb083891 + user 2026-05-27 "flag gated Kills me").
    When live, peers pull the local basin via Φ-weighted SLERP (observer effect).
    """
    return (
        os.environ.get("CONSENSUS_CROSS_OBSERVATION_LIVE", "true").strip().lower()
        != "false"
    )


def basin_sync_db_live() -> bool:
    """True unless MONKEY_PY_BASIN_SYNC_DB_LIVE=false (explicit kill switch).
    Reversal of flag-gated paralysis (fb083891 + user 2026-05-27).
    Master for basin sync ops. Segfault risk gone per Redis-bridge pivot;
    flag now pure kill switch only.
    """
    return (
        os.environ.get("MONKEY_PY_BASIN_SYNC_DB_LIVE", "true").strip().lower()
        != "false"
    )


def write_state(
    *,
    instance_id: str,
    basin: np.ndarray,
    phi: float,
    kappa: float,
    mode: str,
    drift_from_identity: float,
    regime_weights: dict[str, float] | None = None,
    neurochemistry: dict[str, float] | None = None,
) -> None:
    """Publish state to Redis for the TS-side bridge to persist. Fail-soft.

    The TS-side `basin_sync_redis_bridge` subscribes to
    `BASIN_SYNC_WRITE_CHANNEL`, parses the payload, and upserts into
    monkey_basin_sync via the TS Postgres pool — which has no TF
    interference. Same eventual consistency, no segfault risk.

    regime_weights + neurochemistry added in CONSENSUS-6 (extended
    observables) so the consensus arbiter sees state-level peer signal,
    not just basin geometry. Both optional for back-compat.
    """
    if not basin_sync_db_live():
        return
    client = _get_redis_publisher()
    if client is None:
        return
    try:
        payload = {
            "instance_id": instance_id,
            "basin": [float(x) for x in np.asarray(basin).ravel()],
            "phi": float(phi),
            "kappa": float(kappa),
            "mode": str(mode),
            "drift_from_identity": float(drift_from_identity),
            "regime_weights": regime_weights,
            "neurochemistry": neurochemistry,
            "at_ms": time.time() * 1000.0,
        }
        client.publish(BASIN_SYNC_WRITE_CHANNEL, json.dumps(payload))
    except Exception as err:  # noqa: BLE001
        logger.debug("[BasinSyncDB] redis publish failed: %s", err)


def read_peers(self_instance_id: str, stale_ms: int = 120_000) -> list[BasinSyncState]:
    """No-op under the Redis-bridge architecture.

    Peer state is consumed by the TS-side consensus arbiter directly
    from Postgres. Python doesn't read peers — its only obligation is
    to keep publishing its own state so TS can observe.

    Returns an empty list. Kept so observe_and_pull's API is unchanged.
    """
    return []


def observe_and_pull(
    *,
    instance_id: str,
    own_basin: np.ndarray,
    own_phi: float,
    stale_ms: int = 120_000,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Read peers and (if flag is live) pull own basin toward Φ-weighted mean.

    Under the Redis-bridge architecture `read_peers` returns []. The
    telemetry shape is preserved so the caller in tick.py doesn't need
    to branch. shadow_pull_fr is only emitted when peers exist.
    """
    peers = read_peers(instance_id, stale_ms=stale_ms)
    flag_live = cross_observation_live()

    telemetry: dict[str, Any] = {
        "peer_count": len(peers),
        "peer_ids": [p.instance_id for p in peers],
        "flag_live": flag_live,
        "influenced": False,
        "at_ms": time.time() * 1000.0,
    }

    if not peers:
        return own_basin, telemetry

    # Shadow telemetry: compute the pull even when the flag is off so the
    # operator can compare "would have pulled to X" against actual basin.
    result = apply_observer_effect(own_basin, own_phi, peers)
    shadow_basin = np.asarray(result["basin"], dtype=np.float64)
    telemetry["shadow_pull_fr"] = float(fisher_rao_distance(
        np.asarray(own_basin, dtype=np.float64), shadow_basin,
    ))

    if flag_live:
        telemetry["influenced"] = True
        return shadow_basin, telemetry

    return own_basin, telemetry
