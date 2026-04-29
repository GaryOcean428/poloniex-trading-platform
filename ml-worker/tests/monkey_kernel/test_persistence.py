"""test_persistence.py — qig-cache Redis substrate for autonomic state.

Tests use a fakeredis stand-in (or a mock that implements the
subset of redis.Redis methods we need) to exercise the persistence
contract without requiring a live Redis instance.

Coverage per directive:
  1. Round-trip per key family (sleep, intervention, reward,
     kappa, foresight)
  2. Sleep elapsed during downtime — load returns AWAKE with correct
     timestamps when stored phase=SLEEP and elapsed >= duration
  3. Reward decay during downtime — entries with effective decay
     < 0.01 are dropped on load
  4. Redis unavailable — every method is a no-op + components
     construct cleanly with persistence disabled
  5. Concurrent instance isolation — two instance_ids don't pollute
     each other's keyspace
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.autonomic import AutonomicKernel  # noqa: E402
from monkey_kernel.foresight import ForesightPredictor  # noqa: E402
from monkey_kernel.heart import HeartMonitor  # noqa: E402
from monkey_kernel.ocean import Ocean, SleepPhase  # noqa: E402
from monkey_kernel.persistence import (  # noqa: E402
    MAX_FORESIGHT_TRAJECTORY,
    MAX_KAPPA_HISTORY,
    MAX_REWARD_QUEUE,
    PersistentMemory,
)


# ─────────────────────────────────────────────────────────────────
# Fake Redis — minimal subset of the sync redis.Redis API we use.
# ─────────────────────────────────────────────────────────────────


class _Pipeline:
    def __init__(self, parent: "_FakeRedis") -> None:
        self._parent = parent
        self._cmds: list[tuple] = []

    def lpush(self, key: str, value: str) -> "_Pipeline":
        self._cmds.append(("lpush", key, value))
        return self

    def ltrim(self, key: str, start: int, stop: int) -> "_Pipeline":
        self._cmds.append(("ltrim", key, start, stop))
        return self

    def expire(self, key: str, seconds: int) -> "_Pipeline":
        self._cmds.append(("expire", key, seconds))
        return self

    def execute(self) -> list[Any]:
        results = []
        for cmd in self._cmds:
            op = cmd[0]
            if op == "lpush":
                results.append(self._parent.lpush(cmd[1], cmd[2]))
            elif op == "ltrim":
                results.append(self._parent.ltrim(cmd[1], cmd[2], cmd[3]))
            elif op == "expire":
                results.append(self._parent.expire(cmd[1], cmd[2]))
        self._cmds = []
        return results


class _FakeRedis:
    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.lists: dict[str, list[str]] = {}
        self.ttls: dict[str, int] = {}

    def ping(self) -> bool:
        return True

    def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        self.strings[key] = value
        if ex is not None:
            self.ttls[key] = ex
        return True

    def get(self, key: str) -> Optional[str]:
        return self.strings.get(key)

    def lpush(self, key: str, value: str) -> int:
        self.lists.setdefault(key, []).insert(0, value)
        return len(self.lists[key])

    def ltrim(self, key: str, start: int, stop: int) -> bool:
        if key not in self.lists:
            return True
        if stop < 0:
            stop = len(self.lists[key]) + stop
        self.lists[key] = self.lists[key][start:stop + 1]
        return True

    def lrange(self, key: str, start: int, stop: int) -> list[str]:
        if key not in self.lists:
            return []
        if stop < 0:
            stop = len(self.lists[key]) + stop
        return self.lists[key][start:stop + 1]

    def expire(self, key: str, seconds: int) -> bool:
        self.ttls[key] = seconds
        return True

    def pipeline(self) -> _Pipeline:
        return _Pipeline(self)

    def scan_iter(self, match: str = "*"):
        import fnmatch
        all_keys = list(self.strings.keys()) + list(self.lists.keys())
        for k in all_keys:
            if fnmatch.fnmatch(k, match):
                yield k

    def delete(self, *keys: str) -> int:
        count = 0
        for k in keys:
            if k in self.strings:
                del self.strings[k]
                count += 1
            if k in self.lists:
                del self.lists[k]
                count += 1
        return count


@pytest.fixture
def fake_redis(monkeypatch):
    """Patch persistence module's `redis` to use FakeRedis."""
    import monkey_kernel.persistence as pmod
    fake = _FakeRedis()

    class _FakeRedisModule:
        @staticmethod
        def from_url(url, decode_responses=True, socket_timeout=2.0):
            return fake

    monkeypatch.setattr(pmod, "redis", _FakeRedisModule)
    monkeypatch.setattr(pmod, "_REDIS_AVAILABLE", True)
    monkeypatch.setenv("REDIS_URL", "redis://test")
    return fake


# ─────────────────────────────────────────────────────────────────
# 1. Round-trip per key family
# ─────────────────────────────────────────────────────────────────


class TestRoundTrip:
    def test_sleep_state_set_and_load(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        snapshot = {
            "phase": "awake",
            "phase_started_at_ms": 1000.0,
            "last_sleep_ended_at_ms": 0.0,
            "sleep_count": 3,
            "drift_streak": 5,
            "phi_history_len": 10,
        }
        assert pm.save_sleep_state(snapshot) is True
        loaded = pm.load_sleep_state(sleep_duration_ms=15 * 60 * 1000.0)
        assert loaded["phase"] == "awake"
        assert loaded["sleep_count"] == 3

    def test_intervention_history_lpush_and_load(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        for i in range(5):
            pm.push_intervention({"intervention": "DREAM", "phi": 0.3, "at_ms": float(i)})
        history = pm.load_intervention_history()
        assert len(history) == 5
        # LPUSH order — newest first
        assert history[0]["at_ms"] == 4.0
        assert history[-1]["at_ms"] == 0.0

    def test_reward_queue_push_and_load_keeps_recent(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        now_ms = time.time() * 1000.0
        pm.push_reward({
            "source": "own_close", "symbol": "BTC", "dopamine_delta": 0.1,
            "serotonin_delta": 0.05, "endorphin_delta": 0.0,
            "realized_pnl_usdt": 0.5, "pnl_fraction": 0.05, "at_ms": now_ms,
        })
        loaded = pm.load_reward_queue(half_life_ms=20 * 60 * 1000.0)
        assert len(loaded) == 1
        assert loaded[0]["source"] == "own_close"

    def test_kappa_history_round_trip_oldest_first(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        for i, k in enumerate([60.0, 62.0, 64.0, 66.0, 68.0]):
            pm.push_kappa("BTC", k, float(i))
        loaded = pm.load_kappa_history("BTC")
        assert len(loaded) == 5
        # Returned oldest-first
        assert loaded[0] == (60.0, 0.0)
        assert loaded[-1] == (68.0, 4.0)

    def test_foresight_trajectory_round_trip_basin_dtype_preserved(
        self, fake_redis,
    ) -> None:
        pm = PersistentMemory(instance_id="test")
        b = np.array([0.5, 0.3, 0.2], dtype=np.float64)
        pm.push_foresight_step("BTC", b, 0.4, 1000.0)
        loaded = pm.load_foresight_trajectory("BTC")
        assert len(loaded) == 1
        basin, phi, t_ms = loaded[0]
        assert isinstance(basin, np.ndarray)
        assert basin.dtype == np.float64
        np.testing.assert_array_equal(basin, b)
        assert phi == 0.4
        assert t_ms == 1000.0


# ─────────────────────────────────────────────────────────────────
# 2. Sleep elapsed during downtime
# ─────────────────────────────────────────────────────────────────


class TestSleepElapsedDuringDowntime:
    def test_sleep_elapsed_returns_awake_with_corrected_timestamps(
        self, fake_redis,
    ) -> None:
        pm = PersistentMemory(instance_id="test")
        sleep_duration_ms = 15 * 60 * 1000.0
        # Simulate state stored 30 minutes ago in SLEEP phase
        thirty_min_ago = time.time() * 1000.0 - 30 * 60 * 1000.0
        pm.save_sleep_state({
            "phase": "sleep",
            "phase_started_at_ms": thirty_min_ago,
            "last_sleep_ended_at_ms": 0.0,
            "sleep_count": 2,
            "drift_streak": 0,
        })
        loaded = pm.load_sleep_state(sleep_duration_ms=sleep_duration_ms)
        assert loaded["phase"] == "awake"
        # Wake time = phase_started + duration; corrected, not now
        assert loaded["phase_started_at_ms"] == pytest.approx(
            thirty_min_ago + sleep_duration_ms, abs=1.0,
        )
        # sleep_count incremented
        assert loaded["sleep_count"] == 3
        assert loaded["drift_streak"] == 0

    def test_sleep_not_yet_elapsed_returns_sleep_unchanged(
        self, fake_redis,
    ) -> None:
        pm = PersistentMemory(instance_id="test")
        sleep_duration_ms = 15 * 60 * 1000.0
        # Stored 5 min ago (still 10 min remaining)
        five_min_ago = time.time() * 1000.0 - 5 * 60 * 1000.0
        pm.save_sleep_state({
            "phase": "sleep",
            "phase_started_at_ms": five_min_ago,
            "last_sleep_ended_at_ms": 0.0,
            "sleep_count": 1,
            "drift_streak": 0,
        })
        loaded = pm.load_sleep_state(sleep_duration_ms=sleep_duration_ms)
        assert loaded["phase"] == "sleep"
        assert loaded["phase_started_at_ms"] == pytest.approx(five_min_ago, abs=1.0)
        assert loaded["sleep_count"] == 1


# ─────────────────────────────────────────────────────────────────
# 3. Reward decay during downtime
# ─────────────────────────────────────────────────────────────────


class TestRewardDecayDuringDowntime:
    def test_decayed_to_zero_rewards_dropped_on_load(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        half_life_ms = 20 * 60 * 1000.0
        now_ms = time.time() * 1000.0
        # Reward from 3 hours ago: decay = 0.5^(180/20) = 0.5^9 ≈ 0.002
        # → effectively zero, drop on load.
        pm.push_reward({
            "source": "old", "symbol": None, "dopamine_delta": 0.1,
            "serotonin_delta": 0.0, "endorphin_delta": 0.0,
            "realized_pnl_usdt": 0.0, "pnl_fraction": 0.0,
            "at_ms": now_ms - 3 * 60 * 60 * 1000.0,
        })
        # Reward from 5 minutes ago: decay = 0.5^0.25 ≈ 0.84 → keep.
        pm.push_reward({
            "source": "fresh", "symbol": None, "dopamine_delta": 0.1,
            "serotonin_delta": 0.0, "endorphin_delta": 0.0,
            "realized_pnl_usdt": 0.0, "pnl_fraction": 0.0,
            "at_ms": now_ms - 5 * 60 * 1000.0,
        })
        loaded = pm.load_reward_queue(half_life_ms=half_life_ms)
        sources = [r["source"] for r in loaded]
        assert "fresh" in sources
        assert "old" not in sources


# ─────────────────────────────────────────────────────────────────
# 4. Redis unavailable — fallthrough
# ─────────────────────────────────────────────────────────────────


class TestRedisUnavailable:
    def test_construction_succeeds_without_redis_url(self, monkeypatch) -> None:
        monkeypatch.delenv("REDIS_URL", raising=False)
        pm = PersistentMemory(instance_id="test")
        assert pm.is_available is False

    def test_all_methods_no_op_when_unavailable(self, monkeypatch) -> None:
        monkeypatch.delenv("REDIS_URL", raising=False)
        pm = PersistentMemory(instance_id="test")
        assert pm.save_sleep_state({"phase": "awake"}) is False
        assert pm.load_sleep_state(sleep_duration_ms=900_000.0) is None
        assert pm.push_intervention({"x": 1}) is False
        assert pm.load_intervention_history() == []
        assert pm.push_reward({"x": 1}) is False
        assert pm.load_reward_queue(half_life_ms=1000) == []
        assert pm.push_kappa("BTC", 64.0, 0.0) is False
        assert pm.load_kappa_history("BTC") == []

    def test_components_construct_with_unavailable_persistence(
        self, monkeypatch,
    ) -> None:
        monkeypatch.delenv("REDIS_URL", raising=False)
        pm = PersistentMemory(instance_id="test")
        # All four components must accept the unavailable PM
        ocean = Ocean(label="t", persistence=pm)
        autonomic = AutonomicKernel(label="t", persistence=pm)
        heart = HeartMonitor(persistence=pm, symbol="BTC")
        foresight = ForesightPredictor(persistence=pm, symbol="BTC")
        # Construction succeeded with sensible defaults
        assert ocean.is_awake is True  # default fresh state
        assert heart.windowLength if hasattr(heart, "windowLength") else heart.window_length == 0
        assert foresight.trajectory_length == 0
        # Reward queue empty
        assert len(autonomic._pending_rewards) == 0


# ─────────────────────────────────────────────────────────────────
# 5. Instance isolation
# ─────────────────────────────────────────────────────────────────


class TestInstanceIsolation:
    def test_two_instances_dont_share_keys(self, fake_redis) -> None:
        pm_a = PersistentMemory(instance_id="instance-a")
        pm_b = PersistentMemory(instance_id="instance-b")
        pm_a.save_sleep_state({"phase": "sleep", "phase_started_at_ms": 1000.0,
                               "last_sleep_ended_at_ms": 0.0,
                               "sleep_count": 5, "drift_streak": 0})
        # Load from B should return None — different keyspace
        loaded_b = pm_b.load_sleep_state(sleep_duration_ms=900_000.0)
        assert loaded_b is None


# ─────────────────────────────────────────────────────────────────
# Integration — Ocean wired to PersistentMemory restores across boundaries
# ─────────────────────────────────────────────────────────────────


class TestOceanPersistenceIntegration:
    def test_ocean_restores_sleep_state_from_redis(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="kernel-1")
        # Pretend a previous container wrote AWAKE state with sleep_count=4
        pm.save_sleep_state({
            "phase": "awake",
            "phase_started_at_ms": time.time() * 1000.0 - 60_000,
            "last_sleep_ended_at_ms": 0.0,
            "sleep_count": 4,
            "drift_streak": 0,
        })
        # New container construction loads it
        new_ocean = Ocean(label="kernel-1", persistence=pm)
        assert new_ocean.sleep_state.sleep_count == 4
        assert new_ocean.is_awake is True

    def test_heart_restores_kappa_history_from_redis(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="kernel-1")
        for i, k in enumerate([60.0, 62.0, 64.0, 66.0]):
            pm.push_kappa("BTC", k, float(i))
        new_heart = HeartMonitor(persistence=pm, symbol="BTC")
        assert new_heart.window_length == 4
        # State.kappa accessible via read
        h = new_heart.read()
        assert h.kappa == 66.0  # most recent

    def test_foresight_restores_trajectory_from_redis(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="kernel-1")
        b1 = np.array([0.5, 0.3, 0.2])
        b2 = np.array([0.4, 0.4, 0.2])
        pm.push_foresight_step("BTC", b1, 0.5, 1000.0)
        pm.push_foresight_step("BTC", b2, 0.6, 2000.0)
        new_foresight = ForesightPredictor(persistence=pm, symbol="BTC")
        assert new_foresight.trajectory_length == 2

    def test_autonomic_restores_decayed_reward_queue(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="kernel-1")
        now_ms = time.time() * 1000.0
        pm.push_reward({
            "source": "fresh", "symbol": "BTC", "dopamine_delta": 0.2,
            "serotonin_delta": 0.05, "endorphin_delta": 0.1,
            "realized_pnl_usdt": 1.0, "pnl_fraction": 0.1,
            "at_ms": now_ms - 60_000.0,  # 1 min ago
        })
        new_autonomic = AutonomicKernel(label="kernel-1", persistence=pm)
        assert len(new_autonomic._pending_rewards) == 1
        assert new_autonomic._pending_rewards[0].source == "fresh"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
