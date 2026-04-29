"""persistence.py — qig-cache substrate for the autonomic stack.

Ocean owns autonomic authority. Ocean owns autonomic memory.
This module implements the Redis-backed persistence layer that
Ocean / Heart / Foresight / Autonomic read on construction and
write through on every state transition. Survives Railway redeploys
so the kernel actually accumulates the histories it depends on.

The flag-flip just shipped (OCEAN_INTERVENTIONS_LIVE=true) is
toothless without this — Ocean's intervention triggers fire on
windowed Φ history that resets every redeploy. With persistence,
the autonomic substrate behaves the way the canon describes:
continuous, accumulating, regenerative across the deploy boundary.

Architecture:
  PersistentMemory wraps a sync Redis client (since Ocean.observe,
  Heart.read, etc. are sync — making them async would cascade
  through run_tick and the FastAPI handler chain).

  When REDIS_URL is unset OR the Redis connection fails, every
  method becomes a no-op + warning log (once per instance lifetime,
  not per call) and the kernel falls through to in-memory-only
  mode. Persistence is a feature, not a hard requirement.

Keyspace (per directive):
  monkey:ocean:{instance}:sleep_state              string (JSON), no TTL
  monkey:ocean:{instance}:intervention_history     list,  1000 max, 7d TTL
  monkey:ocean:{instance}:reward_queue             list,  50 max,   1h TTL
  monkey:symbol:{instance}:{symbol}:kappa_history  list,  60 max,  24h TTL
  monkey:symbol:{instance}:{symbol}:foresight_traj list,  32 max,  24h TTL

  Deferred to follow-up:
    monkey:symbol:{instance}:{symbol}:phi_history    (lives on SymbolState)
    monkey:symbol:{instance}:{symbol}:basin_history  (lives on SymbolState)
    monkey:wm:{instance}:{symbol}:bubbles            (working_memory module)

Critical: load-time correctness for time-elapsed during downtime.
Sleep state restored from Redis is timestamp-corrected so a kernel
that "slept" through a 30-minute redeploy wakes up immediately on
load instead of starting a fresh 15-minute sleep cycle.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Iterable, Optional

import numpy as np

logger = logging.getLogger(__name__)


# Reuse the sync redis client. The `redis` package supports both;
# redis.asyncio is what outcome_publisher.py uses, sync is what
# this module needs (orchestrator is sync).
try:
    import redis  # type: ignore[import-untyped]
    _REDIS_AVAILABLE = True
except ImportError:
    redis = None  # type: ignore[assignment]
    _REDIS_AVAILABLE = False


# Default TTLs per directive (seconds)
TTL_SLEEP_STATE: Optional[int] = None         # always read latest
TTL_INTERVENTION_HISTORY: int = 7 * 86400      # 7d forensic
TTL_REWARD_QUEUE: int = 3600                   # 1h covers 20-min half-life long tail
TTL_KAPPA_HISTORY: int = 86400                 # 24h restart window
TTL_FORESIGHT_TRAJECTORY: int = 86400          # 24h
TTL_PHI_HISTORY: int = 86400
TTL_BASIN_HISTORY: int = 86400
TTL_WORKING_MEMORY_BUBBLES: int = 15 * 60       # 15min default lifetime

# List caps per directive
MAX_INTERVENTION_HISTORY: int = 1000
MAX_REWARD_QUEUE: int = 50
MAX_PHI_HISTORY: int = 100
MAX_BASIN_HISTORY: int = 100
MAX_KAPPA_HISTORY: int = 60
MAX_FORESIGHT_TRAJECTORY: int = 32


def _basin_to_jsonable(b: Any) -> Any:
    """Convert np.ndarray basins to list[float] for JSON; preserve scalars."""
    if isinstance(b, np.ndarray):
        return b.tolist()
    return b


def _basin_from_jsonable(b: Any) -> Any:
    """Convert list[float] back to np.float64 ndarray when needed."""
    if isinstance(b, list):
        return np.asarray(b, dtype=np.float64)
    return b


class PersistentMemory:
    """Redis-backed qig-cache substrate. One instance per kernel
    process; passed to Ocean / Heart / Foresight / Autonomic
    constructors so each component reads its own state on init and
    writes through on update.

    When Redis is unreachable, every method is a no-op + a single
    warning log per instance lifetime. The kernel then runs as it
    did before persistence shipped — in-memory only — without
    raising errors that would crash the tick.
    """

    def __init__(self, instance_id: str = "monkey-primary") -> None:
        self.instance_id = instance_id
        self._client: Optional["redis.Redis"] = None
        self._warned_unavailable = False
        self._connect()

    def _connect(self) -> None:
        url = os.environ.get("REDIS_URL")
        if not url:
            self._warn_unavailable("REDIS_URL unset; in-memory-only mode")
            return
        if not _REDIS_AVAILABLE:
            self._warn_unavailable("redis package not importable; in-memory-only mode")
            return
        try:
            client = redis.from_url(url, decode_responses=True, socket_timeout=2.0)
            client.ping()
            self._client = client
            logger.info(
                "[persistence] connected to Redis for instance=%s",
                self.instance_id,
            )
        except Exception as err:  # noqa: BLE001 — never block kernel on Redis
            self._warn_unavailable(f"Redis connect failed: {err}")

    def _warn_unavailable(self, reason: str) -> None:
        if not self._warned_unavailable:
            logger.warning(
                "[persistence] in-memory-only — %s; "
                "Ocean/Heart/Foresight state will reset on redeploy.",
                reason,
            )
            self._warned_unavailable = True

    @property
    def is_available(self) -> bool:
        return self._client is not None

    # ── Low-level helpers ────────────────────────────────────────

    def _set_json(
        self, key: str, value: Any, ttl_seconds: Optional[int] = None,
    ) -> bool:
        if self._client is None:
            return False
        try:
            payload = json.dumps(value, default=_basin_to_jsonable)
            if ttl_seconds is None:
                self._client.set(key, payload)
            else:
                self._client.set(key, payload, ex=ttl_seconds)
            return True
        except Exception as err:  # noqa: BLE001
            logger.debug("[persistence] set_json %s failed: %s", key, err)
            return False

    def _get_json(self, key: str) -> Optional[Any]:
        if self._client is None:
            return None
        try:
            raw = self._client.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception as err:  # noqa: BLE001
            logger.debug("[persistence] get_json %s failed: %s", key, err)
            return None

    def _lpush_json(
        self, key: str, value: Any,
        max_len: int, ttl_seconds: Optional[int] = None,
    ) -> bool:
        if self._client is None:
            return False
        try:
            payload = json.dumps(value, default=_basin_to_jsonable)
            pipe = self._client.pipeline()
            pipe.lpush(key, payload)
            pipe.ltrim(key, 0, max_len - 1)
            if ttl_seconds is not None:
                pipe.expire(key, ttl_seconds)
            pipe.execute()
            return True
        except Exception as err:  # noqa: BLE001
            logger.debug("[persistence] lpush_json %s failed: %s", key, err)
            return False

    def _lrange_json(self, key: str, count: int) -> list[Any]:
        if self._client is None:
            return []
        try:
            raw = self._client.lrange(key, 0, count - 1)
            return [json.loads(r) for r in raw]
        except Exception as err:  # noqa: BLE001
            logger.debug("[persistence] lrange_json %s failed: %s", key, err)
            return []

    # ── Ocean: sleep state ───────────────────────────────────────

    def _sleep_key(self) -> str:
        return f"monkey:ocean:{self.instance_id}:sleep_state"

    def save_sleep_state(self, snapshot: dict[str, Any]) -> bool:
        """Write-through called from Ocean.observe() at the end of each tick."""
        return self._set_json(self._sleep_key(), snapshot, TTL_SLEEP_STATE)

    def load_sleep_state(
        self, sleep_duration_ms: float,
    ) -> Optional[dict[str, Any]]:
        """Load + apply timestamp-correction for time elapsed during downtime.

        If the stored phase is SLEEP and (now - phase_started_at) >=
        sleep_duration_ms, the sleep already completed during downtime —
        return an AWAKE snapshot with the wake timestamp set correctly.
        Otherwise return the snapshot as-is.

        Returns None when Redis unavailable or no prior state stored.
        """
        raw = self._get_json(self._sleep_key())
        if raw is None:
            return None

        phase = str(raw.get("phase", "awake")).lower()
        phase_started_at_ms = float(raw.get("phase_started_at_ms", time.time() * 1000.0))
        sleep_count = int(raw.get("sleep_count", 0))

        if phase == "sleep":
            now_ms = time.time() * 1000.0
            elapsed = now_ms - phase_started_at_ms
            if elapsed >= sleep_duration_ms:
                wake_time_ms = phase_started_at_ms + sleep_duration_ms
                logger.info(
                    "[persistence] sleep elapsed during downtime "
                    "(elapsed=%.1fm > %.1fm sleep duration); "
                    "loading as AWAKE",
                    elapsed / 60_000.0,
                    sleep_duration_ms / 60_000.0,
                )
                return {
                    "phase": "awake",
                    "phase_started_at_ms": wake_time_ms,
                    "last_sleep_ended_at_ms": wake_time_ms,
                    "sleep_count": sleep_count + 1,
                    "drift_streak": 0,
                }
        return raw

    # ── Ocean: intervention history (forensic ring buffer) ───────

    def push_intervention(self, event: dict[str, Any]) -> bool:
        return self._lpush_json(
            f"monkey:ocean:{self.instance_id}:intervention_history",
            event,
            MAX_INTERVENTION_HISTORY,
            TTL_INTERVENTION_HISTORY,
        )

    def load_intervention_history(self) -> list[dict[str, Any]]:
        return self._lrange_json(
            f"monkey:ocean:{self.instance_id}:intervention_history",
            MAX_INTERVENTION_HISTORY,
        )

    # ── Autonomic: reward queue (decay-aware load) ───────────────

    def push_reward(self, reward: dict[str, Any]) -> bool:
        return self._lpush_json(
            f"monkey:ocean:{self.instance_id}:reward_queue",
            reward,
            MAX_REWARD_QUEUE,
            TTL_REWARD_QUEUE,
        )

    def load_reward_queue(
        self, half_life_ms: float, min_decay: float = 0.01,
    ) -> list[dict[str, Any]]:
        """Drop entries whose effective decay falls below min_decay."""
        raw_list = self._lrange_json(
            f"monkey:ocean:{self.instance_id}:reward_queue", MAX_REWARD_QUEUE,
        )
        if not raw_list:
            return []
        now_ms = time.time() * 1000.0
        kept: list[dict[str, Any]] = []
        for r in raw_list:
            at_ms = float(r.get("at_ms", now_ms))
            age_ms = now_ms - at_ms
            decay = 0.5 ** (age_ms / half_life_ms) if half_life_ms > 0 else 0.0
            if decay < min_decay:
                continue
            kept.append(r)
        return kept

    # ── Heart: κ history ─────────────────────────────────────────

    def push_kappa(self, symbol: str, kappa: float, t_ms: float) -> bool:
        return self._lpush_json(
            f"monkey:symbol:{self.instance_id}:{symbol}:kappa_history",
            {"kappa": kappa, "t_ms": t_ms},
            MAX_KAPPA_HISTORY,
            TTL_KAPPA_HISTORY,
        )

    def load_kappa_history(self, symbol: str) -> list[tuple[float, float]]:
        """Returns oldest-first list of (kappa, t_ms) tuples."""
        raw = self._lrange_json(
            f"monkey:symbol:{self.instance_id}:{symbol}:kappa_history",
            MAX_KAPPA_HISTORY,
        )
        # LPUSH gives newest-first; reverse to oldest-first for HeartMonitor.
        return [
            (float(r["kappa"]), float(r["t_ms"]))
            for r in reversed(raw)
        ]

    # ── Foresight: trajectory ────────────────────────────────────

    def push_foresight_step(
        self, symbol: str, basin: np.ndarray, phi: float, t_ms: float,
    ) -> bool:
        return self._lpush_json(
            f"monkey:symbol:{self.instance_id}:{symbol}:foresight_traj",
            {
                "basin": _basin_to_jsonable(basin),
                "phi": phi,
                "t_ms": t_ms,
            },
            MAX_FORESIGHT_TRAJECTORY,
            TTL_FORESIGHT_TRAJECTORY,
        )

    def load_foresight_trajectory(
        self, symbol: str,
    ) -> list[tuple[np.ndarray, float, float]]:
        """Returns oldest-first list of (basin, phi, t_ms) tuples."""
        raw = self._lrange_json(
            f"monkey:symbol:{self.instance_id}:{symbol}:foresight_traj",
            MAX_FORESIGHT_TRAJECTORY,
        )
        return [
            (
                _basin_from_jsonable(r["basin"]),
                float(r["phi"]),
                float(r["t_ms"]),
            )
            for r in reversed(raw)
        ]

    # ── Test/diagnostic helpers ─────────────────────────────────

    def clear_instance(self) -> int:
        """Delete all keys for this instance. Returns count deleted.
        Test-only; production code should never call this."""
        if self._client is None:
            return 0
        patterns = [
            f"monkey:ocean:{self.instance_id}:*",
            f"monkey:symbol:{self.instance_id}:*:*",
            f"monkey:wm:{self.instance_id}:*",
        ]
        deleted = 0
        for pat in patterns:
            try:
                keys = list(self._client.scan_iter(match=pat))
                if keys:
                    deleted += self._client.delete(*keys)
            except Exception:  # noqa: BLE001
                pass
        return deleted
