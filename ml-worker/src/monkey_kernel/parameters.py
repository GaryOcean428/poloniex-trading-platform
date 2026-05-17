"""
parameters.py — P14 + P25 parameter registry (v0.8.1).

Canonical Principles v2.2:
  P14 — "Every variable belongs to exactly one category. Moving between
         categories requires governance approval."
  P25 — "No operational threshold is a magic constant. All thresholds
         are derived from geometric state. Safety bounds are the only
         permitted hardcoded constants."

The DB table monkey_parameters holds the tiny remainder of values that
are NOT derivable from geometric state — SAFETY_BOUNDs (risk envelopes)
and OPERATIONAL envelopes (tick cadence, memory windows).

This module:
  - Defines the VariableCategory enum for code-level P14 annotation
  - Provides ParameterRegistry — cached read-through client to the DB
  - Provides a propose_change helper for governance-reviewed writes

Cache policy:
  - Read-through on first access, cache in-process.
  - Refresh on SIGHUP (future) or every `refresh_every_ticks` calls.
  - Fail-soft: if DB is unreachable, use cached value; if never seen,
    fall back to hardcoded default passed to .get(name, default).

Read path is tight (no DB hit on steady state). Write path is explicit
and audit-logged by the DB trigger in migration 034.
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import threading
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger("monkey.parameters")

# ── psycopg isolation executor ───────────────────────────────────
#
# 2026-05-14 fix: psycopg's synchronous connect() must NEVER run on
# the asyncio event-loop thread. ml-worker is a FastAPI/uvloop process
# with heavy native extensions (TensorFlow, scipy, sklearn, h5py); when
# psycopg3's sync `wait_conn` machinery runs on the event-loop thread
# in that environment it segfaults / aborts the whole process — and a
# native crash is NOT catchable by the try/except in _load(). Observed
# in production: every `/monkey/tick/run` request crashed ml-worker via
# Ocean.__init__ → parameters.get() → _load() → psycopg.connect().
#
# Routing every _load() through this single-worker executor guarantees
# the native connect always runs on a dedicated OS thread that is never
# the event loop — the supported way to use sync psycopg from async
# code. Single worker (max_workers=1) because registry loads are rare
# (startup + every refresh_every_ticks) and must not race each other.
_DB_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="param-registry-db",
)
# Hard ceiling on a single registry load — a hung connect must not
# wedge the executor forever. The caller falls back to cache/defaults.
_LOAD_TIMEOUT_S = 15.0


class VariableCategory(Enum):
    """P14 category annotation.

    STATE         — per-cycle, Fisher-Rao only. Basin coords, Φ, κ, NCs.
                    Derived each tick; never stored in registry.
    PARAMETER     — per-epoch, trainable. Learned weights (future).
                    Not stored in this registry yet.
    BOUNDARY      — external data. User input, exchange feeds, LLM out.
                    Sanitized on ingest; never in registry.
    SAFETY_BOUND  — hardcoded risk envelope permitted by P25. κ*, max
                    leverage, kill-switch drawdown, etc. Stored in DB
                    with version + rollback + audit trail.
    OPERATIONAL   — externally-chosen envelope (tick ms, history window).
                    Not a safety bound, but not geometry-derived either.
                    Stored in DB with the same governance discipline.
    """

    STATE = "STATE"
    PARAMETER = "PARAMETER"
    BOUNDARY = "BOUNDARY"
    SAFETY_BOUND = "SAFETY_BOUND"
    OPERATIONAL = "OPERATIONAL"


@dataclass
class ParamValue:
    name: str
    category: VariableCategory
    value: float
    bounds_low: Optional[float]
    bounds_high: Optional[float]
    justification: str
    version: int


class ParameterRegistry:
    """Cached read-through client to monkey_parameters.

    Usage:
        reg = get_registry()
        ticks_ms = int(reg.get("loop.default_tick_ms", default=30000))

    The `default` is the last-resort fallback if the DB is unreachable
    AND the name has never been cached. In steady state the default is
    never consulted — DB is the source of truth. Providing it makes
    bootstrapping (first run against fresh DB) safe.
    """

    def __init__(
        self,
        dsn: Optional[str] = None,
        refresh_every_ticks: int = 100,
    ):
        self._dsn = dsn or os.environ.get("DATABASE_URL")
        self._cache: dict[str, ParamValue] = {}
        self._lock = threading.Lock()
        self._tick_count = 0
        self._refresh_every = refresh_every_ticks
        self._loaded = False
        # True once _load() resolves to the intentional defaults-only
        # mode (no DSN, or MONKEY_PARAM_REGISTRY_DB off). In that mode an
        # empty cache is expected — every get() falls back to its default
        # by design, so per-parameter "missing" warnings are pure noise
        # (the mode is logged once at startup). Kept False in real DB
        # mode, where a genuinely missing parameter IS worth one warning.
        self._defaults_only = False
        self._warned_missing: set[str] = set()

    # ── Read path ────────────────────────────────────────────────

    def get(self, name: str, default: Optional[float] = None) -> float:
        """Fetch a parameter value, hitting the cache on the fast path.

        First call populates the cache with the whole table. Subsequent
        calls are pure in-memory lookups. Refresh happens every
        `refresh_every_ticks` calls via tick().

        If the name is not in the DB and a default is provided, the
        default is returned (and cached transiently). If no default and
        no row, raises KeyError.
        """
        with self._lock:
            if not self._loaded:
                self._load()
            entry = self._cache.get(name)
            if entry is None:
                if default is None:
                    raise KeyError(f"parameter '{name}' not in registry")
                # Defaults-only mode: empty cache is by design — stay
                # silent (startup already logged the mode). Real DB
                # mode: a missing parameter is a genuine signal, but
                # warn only once per name to avoid per-tick spam.
                if not self._defaults_only and name not in self._warned_missing:
                    self._warned_missing.add(name)
                    logger.warning(
                        "parameter '%s' missing from registry; using default=%s",
                        name, default,
                    )
                return float(default)
            return entry.value

    def get_entry(self, name: str) -> Optional[ParamValue]:
        """Return the full ParamValue (bounds, justification, version)."""
        with self._lock:
            if not self._loaded:
                self._load()
            return self._cache.get(name)

    def tick(self) -> None:
        """Call once per kernel tick. Triggers DB refresh every N ticks."""
        with self._lock:
            self._tick_count += 1
            if self._tick_count >= self._refresh_every:
                self._tick_count = 0
                self._load()

    def refresh(self) -> None:
        """Force an immediate DB refresh."""
        with self._lock:
            self._load()

    # ── Write path (governance-reviewed) ─────────────────────────

    def propose_change(
        self,
        name: str,
        new_value: float,
        actor: str,
        reason: str,
    ) -> bool:
        """Update a parameter value with full audit trail.

        The DB trigger in migration 034 auto-writes monkey_parameter_changes.
        We also pass the reason through a session-local GUC so the trigger
        can attribute it without a second INSERT.

        Returns True if the value was committed. Raises on bounds violation
        or missing name (the DB CHECK constraint enforces bounds_respected).
        """
        if self._dsn is None:
            raise RuntimeError("DATABASE_URL not set; cannot write registry")

        import psycopg

        with psycopg.connect(self._dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                # set_config(name, value, is_local) — transaction-local
                # equivalent of SET LOCAL but accepts bind parameters.
                cur.execute(
                    "SELECT set_config('monkey.change_reason', %s, true)",
                    (reason,),
                )
                cur.execute(
                    """
                    UPDATE monkey_parameters
                       SET value = %s,
                           version = version + 1,
                           updated_at = NOW(),
                           updated_by = %s
                     WHERE name = %s
                    RETURNING version
                    """,
                    (new_value, actor, name),
                )
                row = cur.fetchone()
                if row is None:
                    raise KeyError(f"parameter '{name}' not in registry")
                conn.commit()

        # Force-refresh the local cache so the next .get() sees the new value.
        self.refresh()
        logger.info(
            "parameter '%s' updated to %s by %s (reason: %s)",
            name, new_value, actor, reason,
        )
        return True

    def rollback(self, name: str, actor: str, reason: str) -> bool:
        """Roll back a parameter to its previous value.

        Finds the last monkey_parameter_changes row for this name and
        proposes the old_value as the new value. Creates a new audit
        row (rollbacks are forward-only — every write is an event).
        """
        if self._dsn is None:
            raise RuntimeError("DATABASE_URL not set; cannot rollback")

        import psycopg

        with psycopg.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT old_value FROM monkey_parameter_changes
                     WHERE name = %s AND old_value IS NOT NULL
                  ORDER BY at DESC
                     LIMIT 1
                    """,
                    (name,),
                )
                row = cur.fetchone()
                if row is None:
                    raise RuntimeError(
                        f"no prior value recorded for '{name}' — nothing to roll back to"
                    )
                old_value = row[0]

        return self.propose_change(
            name, old_value, actor,
            f"rollback: {reason}",
        )

    # ── Internal ─────────────────────────────────────────────────

    def _query_parameters_table(self) -> dict[str, ParamValue]:
        """Open a psycopg connection and read the whole parameters table.

        Runs ONLY inside the _DB_EXECUTOR worker thread (see _load) — it
        must never execute on the asyncio event-loop thread. Pure
        synchronous psycopg; raises on any DB/parse failure for _load to
        catch.

        Prior to MIG-1 (2026-05-16) this path appended sslmode=disable
        because psycopg[binary]'s bundled libpq+openssl could SEGFAULT
        during the TLS handshake when its openssl symbols collided with
        TensorFlow / scipy / sklearn / h5py loaded in the same process.
        MIG-1 stripped TF and the other native libs out of ml-worker, so
        the segfault path no longer exists. The DSN now passes through
        unchanged — psycopg defaults to sslmode=prefer, which TLS-handshakes
        opportunistically and falls back to plaintext on the private
        Railway internal network if SSL isn't offered.
        """
        import psycopg

        with psycopg.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT name, category, value, bounds_low, bounds_high,
                           justification, version
                      FROM monkey_parameters
                    """
                )
                new_cache: dict[str, ParamValue] = {}
                for row in cur.fetchall():
                    (name, category_str, value, b_low, b_high,
                     justification, version) = row
                    try:
                        cat = VariableCategory(category_str)
                    except ValueError:
                        logger.warning(
                            "registry row '%s' has unknown category '%s'; "
                            "skipping",
                            name, category_str,
                        )
                        continue
                    new_cache[name] = ParamValue(
                        name=name,
                        category=cat,
                        value=float(value),
                        bounds_low=float(b_low) if b_low is not None else None,
                        bounds_high=float(b_high) if b_high is not None else None,
                        justification=justification,
                        version=int(version),
                    )
        return new_cache

    def _load(self) -> None:
        """Reload the entire parameters table into the cache.

        The actual psycopg connect + query runs on the dedicated
        _DB_EXECUTOR thread — NEVER on the calling thread. This is
        load-bearing: if _load is reached from an async request handler
        (Ocean.__init__ → parameters.get() → _load), running sync
        psycopg on the uvloop event-loop thread segfaults the process
        (2026-05-14 production incident). Submitting to the executor and
        blocking on .result() keeps the native connect off the event
        loop; the brief block is acceptable (registry loads are rare and
        the startup pre-warm means request handlers hit the cache).
        """
        if self._dsn is None:
            if not self._loaded:
                logger.warning(
                    "DATABASE_URL not set; registry will use defaults only"
                )
                self._defaults_only = True
                self._loaded = True
            return

        # PARAM-1 (2026-05-17): the MONKEY_PARAM_REGISTRY_DB gate that
        # used to live here was added 2026-05-14 to guard against a
        # psycopg/libpq/openssl SEGFAULT that only manifested when the
        # ml-worker process had TensorFlow + scipy + sklearn loaded
        # alongside. MIG-1 (PR #743) stripped those out, eliminating the
        # crash path. The gate flipped to true on Railway 2026-05-17T01:51Z
        # and the live DB load has been clean since. The gate is removed
        # so the registry always loads when DATABASE_URL is present.

        try:
            future = _DB_EXECUTOR.submit(self._query_parameters_table)
            new_cache = future.result(timeout=_LOAD_TIMEOUT_S)
            self._cache = new_cache
            self._loaded = True
            logger.debug("parameter registry loaded: %d entries", len(new_cache))
        except Exception as exc:
            # Fail-soft: keep serving from existing cache / defaults.
            # Covers DB-unreachable, query errors, AND the executor
            # timeout — the process stays up either way. Setting
            # _defaults_only suppresses the per-parameter "missing from
            # registry" warning in get() so a failed load doesn't flood
            # the log with one WARN per get() call per tick.
            logger.warning("parameter registry load failed: %s", exc)
            if not self._loaded:
                self._loaded = True  # don't retry every .get() call
                self._defaults_only = True


# ── Process-global singleton ─────────────────────────────────────

_instance: Optional[ParameterRegistry] = None
_instance_lock = threading.Lock()


def get_registry() -> ParameterRegistry:
    """Return the process-wide registry. Lazy-init on first call."""
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = ParameterRegistry()
    return _instance


def _reset_registry_for_tests() -> None:
    """Test-only: wipe the singleton so tests start clean."""
    global _instance
    with _instance_lock:
        _instance = None
