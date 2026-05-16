"""basin_sync_db.py — Postgres adapter for cross-kernel basin sync.

The pure-functional `basin_sync` module is stateless for unit testing;
this adapter wraps it with read/write against the `monkey_basin_sync`
table (migration 032). Both the TS and Python Monkey kernels write to
the same table, enabling cross-process basin observation per Layer 1
of the dual-kernel consensus architecture (see
[[polytrade-consensus-architecture]]).

Flag: `CONSENSUS_CROSS_OBSERVATION_LIVE` — default off.
  - Writer ALWAYS runs (every tick) so peers are visible in telemetry.
  - Observer effect (basin pull) only fires when the flag is true.

QIG purity: read/write only — math stays in `basin_sync.py`. Slerp_sqrt
preserves Δ⁶³; Fisher-Rao metric throughout.

Fail-soft: any DB error logs at debug and returns the unchanged basin /
empty peer list. A bad sync never blocks a kernel tick.

CONNECTION DISCIPLINE (2026-05-16 segfault fix):
The initial implementation opened a fresh `psycopg.connect()` on every
tick. Under FastAPI worker threads sharing memory with TensorFlow /
sklearn / cuda stubs, the fresh-per-call connection triggered
`free(): invalid pointer` segfaults in the C-layer libpq client — the
TF runtime and libpq's memory allocators interfered when libpq was
opened/closed repeatedly inside a request thread.

Fix: use a module-level singleton psycopg connection guarded by a
threading.Lock. One TCP connection, reused across ticks. Reconnects
lazily on the first call after a connection failure. Same fail-soft
semantics — a bad sync never blocks a tick.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .basin_sync import BasinSyncState, apply_observer_effect

logger = logging.getLogger("monkey_kernel.basin_sync_db")

# Singleton connection — opened lazily on first call, reused across
# all ticks within a process. Thread-safe via _conn_lock.
_conn = None  # type: ignore[var-annotated]
_conn_lock = threading.Lock()


def _get_conn():
    """Return the shared psycopg connection. Lazy-init + auto-reconnect.

    Returns None when DATABASE_URL is unset OR the connection cannot
    be established (caller treats None as fail-soft no-op).

    IMPORTANT: should ideally be called via warm_connection() at startup
    BEFORE TensorFlow loads. If first called from a request thread
    after TF init, psycopg.connect() can segfault due to libpq malloc
    corruption from TF runtime. warm_connection() makes the FIRST
    connect happen on the main thread at process startup.
    """
    global _conn
    dsn = os.environ.get("DATABASE_URL")
    if dsn is None:
        return None
    with _conn_lock:
        if _conn is not None:
            # Health check — psycopg connections expose `closed` flag.
            try:
                if not _conn.closed:
                    return _conn
            except Exception:  # noqa: BLE001
                pass
            # Connection is dead — drop and re-init below.
            try:
                _conn.close()
            except Exception:  # noqa: BLE001
                pass
            _conn = None
        try:
            import psycopg
            _conn = psycopg.connect(dsn, autocommit=True)
            return _conn
        except Exception as err:  # noqa: BLE001
            logger.debug("[BasinSyncDB] connect failed: %s", err)
            _conn = None
            return None


def warm_connection() -> bool:
    """Pre-warm the psycopg connection on the calling thread.

    Call this from FastAPI lifespan startup (main thread) BEFORE TF /
    sklearn / cuda stubs are loaded. The first psycopg.connect() then
    happens in a clean malloc context — once the connection exists,
    subsequent reads/writes from request threads only need to grab the
    existing connection + execute a cursor, which doesn't trigger the
    libpq malloc path that TF poisons.

    Returns True if the connection was successfully opened OR was
    already open. Returns False if DATABASE_URL is unset, the flag is
    off, or the connect failed.
    """
    if not basin_sync_db_live():
        logger.info("[BasinSyncDB] warm_connection skipped — flag off")
        return False
    conn = _get_conn()
    if conn is None:
        logger.warning("[BasinSyncDB] warm_connection failed — DB unreachable or DSN missing")
        return False
    logger.info("[BasinSyncDB] warm_connection succeeded — singleton ready on main thread")
    return True


def cross_observation_live() -> bool:
    """Default-off flag. When false, peers are visible (writer fires)
    but the observer effect is NOT applied to the local basin."""
    return (
        os.environ.get("CONSENSUS_CROSS_OBSERVATION_LIVE", "").strip().lower()
        == "true"
    )


def basin_sync_db_live() -> bool:
    """Master enable for ALL DB ops in this module. Default OFF.

    SEGFAULT GUARD (2026-05-16T14:21Z): even with all consensus flags
    off, the previous unconditional `write_state` call from tick.py
    triggered `free(): invalid pointer` segfaults during
    psycopg.connect() inside a FastAPI request thread sharing memory
    with TensorFlow + sklearn. The singleton-connection fix in PR #738
    didn't help because the FIRST connect from the request thread is
    what segfaults — TF runtime poisons libpq's allocator.

    Until the TF/libpq interaction is properly isolated (e.g. move DB
    writes to a separate process via redis-mediated queue, or warm
    the connection at startup before TF loads), this flag must remain
    off in production. Set MONKEY_PY_BASIN_SYNC_DB_LIVE=true ONLY in
    environments where TF is not loaded.
    """
    return (
        os.environ.get("MONKEY_PY_BASIN_SYNC_DB_LIVE", "").strip().lower()
        == "true"
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
    """UPSERT this kernel instance's geometric + autonomic state. Fail-soft.

    regime_weights + neurochemistry added in CONSENSUS-6 — extended
    observables per CC red-team refinement #4 so the consensus arbiter
    sees state-level peer signal, not just basin geometry. Both
    optional for back-compat; None leaves the column NULL.
    """
    if not basin_sync_db_live():
        return
    conn = _get_conn()
    if conn is None:
        return
    try:
        basin_json = json.dumps([float(x) for x in np.asarray(basin).ravel()])
        regime_json = json.dumps(regime_weights) if regime_weights else None
        nc_json = json.dumps(neurochemistry) if neurochemistry else None
        with _conn_lock:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO monkey_basin_sync
                        (instance_id, basin, phi, kappa, mode,
                         drift_from_identity, regime_weights,
                         neurochemistry, updated_at)
                    VALUES (%s, %s::jsonb, %s, %s, %s, %s,
                            %s::jsonb, %s::jsonb, NOW())
                    ON CONFLICT (instance_id)
                    DO UPDATE SET
                        basin = EXCLUDED.basin,
                        phi = EXCLUDED.phi,
                        kappa = EXCLUDED.kappa,
                        mode = EXCLUDED.mode,
                        drift_from_identity = EXCLUDED.drift_from_identity,
                        regime_weights = EXCLUDED.regime_weights,
                        neurochemistry = EXCLUDED.neurochemistry,
                        updated_at = NOW()
                    """,
                    (
                        instance_id,
                        basin_json,
                        float(phi),
                        float(kappa),
                        str(mode),
                        float(drift_from_identity),
                        regime_json,
                        nc_json,
                    ),
                )
                # autocommit=True on connection — no explicit commit needed
    except Exception as err:  # noqa: BLE001 — fail-soft per design
        logger.debug("[BasinSyncDB] write_state failed: %s", err)
        # Drop conn so next call re-inits — connection may be poisoned
        global _conn
        with _conn_lock:
            if _conn is conn:
                try:
                    _conn.close()
                except Exception:  # noqa: BLE001
                    pass
                _conn = None


def read_peers(self_instance_id: str, stale_ms: int = 120_000) -> list[BasinSyncState]:
    """Read all OTHER instances' rows fresher than `stale_ms`. Fail-soft."""
    if not basin_sync_db_live():
        return []
    conn = _get_conn()
    if conn is None:
        return []
    try:
        with _conn_lock:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT instance_id, basin, phi, kappa, mode,
                           drift_from_identity,
                           EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_ms
                      FROM monkey_basin_sync
                     WHERE instance_id != %s
                       AND updated_at > NOW()
                           - (%s::int * INTERVAL '1 millisecond')
                    """,
                    (self_instance_id, int(stale_ms)),
                )
                rows = cur.fetchall()
    except Exception as err:  # noqa: BLE001
        logger.debug("[BasinSyncDB] read_peers failed: %s", err)
        # Drop conn so next call re-inits — connection may be poisoned
        global _conn
        with _conn_lock:
            if _conn is conn:
                try:
                    _conn.close()
                except Exception:  # noqa: BLE001
                    pass
                _conn = None
        return []

    out: list[BasinSyncState] = []
    for row in rows:
        try:
            inst_id, basin_raw, phi, kappa, mode, drift, upd_ms = row
            basin = _basin_from_jsonb(basin_raw)
            out.append(BasinSyncState(
                instance_id=str(inst_id),
                basin=basin,
                phi=float(phi),
                kappa=float(kappa),
                mode=str(mode),
                drift_from_identity=float(drift),
                updated_at_ms=float(upd_ms),
            ))
        except Exception as err:  # noqa: BLE001
            logger.debug("[BasinSyncDB] row parse failed: %s", err)
    return out


def observe_and_pull(
    *,
    instance_id: str,
    own_basin: np.ndarray,
    own_phi: float,
    stale_ms: int = 120_000,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Read peers and (if flag is live) pull own basin toward Φ-weighted mean.

    Returns (basin, telemetry). When the flag is off, basin is unchanged
    but telemetry still reports peer_count + would_have_been_influenced
    for shadow validation.

    The Φ-weighted SLERP math lives in `basin_sync.apply_observer_effect`
    (qig-canonical). This function is the DB+flag wrapper.
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

    # Always compute the shadow result for telemetry, even when the flag
    # is off — operator can compare "would have pulled to X" against
    # "kernel actually went to Y" without committing live behavior.
    result = apply_observer_effect(own_basin, own_phi, peers)
    shadow_basin = np.asarray(result["basin"], dtype=np.float64)
    # Fisher-Rao distance — qig-canonical "how far the pull would take us"
    telemetry["shadow_pull_fr"] = float(fisher_rao_distance(
        np.asarray(own_basin, dtype=np.float64), shadow_basin,
    ))

    if flag_live:
        telemetry["influenced"] = True
        return shadow_basin, telemetry

    return own_basin, telemetry


def _basin_from_jsonb(raw: Any) -> np.ndarray:
    """Decode a basin field. psycopg returns list (jsonb) or str (json)."""
    if isinstance(raw, list):
        return np.asarray(raw, dtype=np.float64)
    if isinstance(raw, str):
        return np.asarray(json.loads(raw), dtype=np.float64)
    if isinstance(raw, np.ndarray):
        return raw.astype(np.float64, copy=False)
    raise ValueError(f"unrecognized basin payload type: {type(raw).__name__}")
