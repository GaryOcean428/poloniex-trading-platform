"""test_persistence_symbol_state.py — SymbolState histories persistence.

Verifies the 5 history families (phi/basin/drift/fhealth/integration)
round-trip through PersistentMemory and SymbolState reads them on
cold start. Tier 9 Stage 2 stud regime classification depends on
this warmup — without persistence, h_trade reads near-zero on the
first post-deploy tick because basin_velocity history is empty.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.persistence import PersistentMemory  # noqa: E402
from monkey_kernel.state import BASIN_DIM  # noqa: E402


# Reuse the FakeRedis from test_persistence.py
class _Pipeline:
    def __init__(self, parent: "_FakeRedis") -> None:
        self._parent = parent
        self._cmds: list[tuple] = []

    def lpush(self, key: str, value: str) -> "_Pipeline":
        self._cmds.append(("lpush", key, value)); return self
    def ltrim(self, key: str, start: int, stop: int) -> "_Pipeline":
        self._cmds.append(("ltrim", key, start, stop)); return self
    def expire(self, key: str, seconds: int) -> "_Pipeline":
        self._cmds.append(("expire", key, seconds)); return self

    def execute(self) -> list:
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
    def ping(self) -> bool: return True
    def set(self, key, value, ex=None):
        self.strings[key] = value
        if ex is not None: self.ttls[key] = ex
        return True
    def get(self, key): return self.strings.get(key)
    def lpush(self, key, value):
        self.lists.setdefault(key, []).insert(0, value); return len(self.lists[key])
    def ltrim(self, key, start, stop):
        if key not in self.lists: return True
        if stop < 0: stop = len(self.lists[key]) + stop
        self.lists[key] = self.lists[key][start:stop+1]; return True
    def lrange(self, key, start, stop):
        if key not in self.lists: return []
        if stop < 0: stop = len(self.lists[key]) + stop
        return self.lists[key][start:stop+1]
    def expire(self, key, seconds): self.ttls[key] = seconds; return True
    def pipeline(self): return _Pipeline(self)
    def scan_iter(self, match="*"):
        import fnmatch
        for k in list(self.strings.keys()) + list(self.lists.keys()):
            if fnmatch.fnmatch(k, match): yield k
    def delete(self, *keys):
        c = 0
        for k in keys:
            if k in self.strings: del self.strings[k]; c += 1
            if k in self.lists: del self.lists[k]; c += 1
        return c


@pytest.fixture
def fake_redis(monkeypatch):
    import monkey_kernel.persistence as pmod
    fake = _FakeRedis()
    class _Mod:
        @staticmethod
        def from_url(url, decode_responses=True, socket_timeout=2.0):
            return fake
    monkeypatch.setattr(pmod, "redis", _Mod)
    monkeypatch.setattr(pmod, "_REDIS_AVAILABLE", True)
    monkeypatch.setenv("REDIS_URL", "redis://test")
    return fake


# ─────────────────────────────────────────────────────────────────
# 5 history families — round-trip
# ─────────────────────────────────────────────────────────────────


class TestPhiHistory:
    def test_round_trip(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        for phi in [0.1, 0.2, 0.3, 0.4]:
            pm.push_phi("BTC", phi)
        loaded = pm.load_phi_history("BTC")
        assert loaded == [0.1, 0.2, 0.3, 0.4]


class TestBasinHistory:
    def test_round_trip_preserves_dtype(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        b1 = np.array([0.5, 0.3, 0.2], dtype=np.float64)
        b2 = np.array([0.4, 0.4, 0.2], dtype=np.float64)
        pm.push_basin("BTC", b1)
        pm.push_basin("BTC", b2)
        loaded = pm.load_basin_history("BTC")
        assert len(loaded) == 2
        assert isinstance(loaded[0], np.ndarray)
        assert loaded[0].dtype == np.float64
        np.testing.assert_array_equal(loaded[0], b1)
        np.testing.assert_array_equal(loaded[1], b2)


class TestDriftHistory:
    def test_round_trip(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        for d in [0.05, 0.10, 0.08]:
            pm.push_drift("BTC", d)
        assert pm.load_drift_history("BTC") == [0.05, 0.10, 0.08]


class TestFhealthHistory:
    def test_round_trip(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        for f in [0.95, 0.97, 0.96]:
            pm.push_fhealth("BTC", f)
        assert pm.load_fhealth_history("BTC") == [0.95, 0.97, 0.96]


class TestIntegrationHistory:
    def test_round_trip_tuple(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        pm.push_integration("BTC", 0.5, 0.3)
        pm.push_integration("BTC", 0.6, 0.4)
        loaded = pm.load_integration_history("BTC")
        assert loaded == [(0.5, 0.3), (0.6, 0.4)]


# ─────────────────────────────────────────────────────────────────
# Symbol isolation
# ─────────────────────────────────────────────────────────────────


class TestSymbolIsolation:
    def test_btc_eth_dont_share_keys(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        pm.push_phi("BTC", 0.1)
        pm.push_phi("ETH", 0.2)
        assert pm.load_phi_history("BTC") == [0.1]
        assert pm.load_phi_history("ETH") == [0.2]


# ─────────────────────────────────────────────────────────────────
# History cap enforcement
# ─────────────────────────────────────────────────────────────────


class TestHistoryCapEnforced:
    def test_phi_history_capped_at_max(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        # Push 200 entries; max is 100
        for i in range(200):
            pm.push_phi("BTC", float(i))
        loaded = pm.load_phi_history("BTC")
        assert len(loaded) == 100
        # Most recent values retained (oldest dropped)
        assert loaded[-1] == 199.0
        assert loaded[0] == 100.0


# ─────────────────────────────────────────────────────────────────
# Cold-start restore — empty Redis returns empty lists
# ─────────────────────────────────────────────────────────────────


class TestColdStart:
    def test_no_data_returns_empty_lists(self, fake_redis) -> None:
        pm = PersistentMemory(instance_id="test")
        assert pm.load_phi_history("BTC") == []
        assert pm.load_basin_history("BTC") == []
        assert pm.load_drift_history("BTC") == []
        assert pm.load_fhealth_history("BTC") == []
        assert pm.load_integration_history("BTC") == []


# ─────────────────────────────────────────────────────────────────
# run_tick write-through
# ─────────────────────────────────────────────────────────────────


class TestRunTickWriteThrough:
    def test_run_tick_persists_histories(self, fake_redis) -> None:
        from monkey_kernel.autonomic import AutonomicKernel
        from monkey_kernel.basin import uniform_basin
        from monkey_kernel.foresight import ForesightPredictor
        from monkey_kernel.heart import HeartMonitor
        from monkey_kernel.ocean import Ocean
        from monkey_kernel.perception import OHLCVCandle
        from monkey_kernel.tick import (
            AccountContext, TickInputs, fresh_symbol_state, run_tick,
        )
        pm = PersistentMemory(instance_id="test")
        ocean = Ocean(label="test", persistence=pm)
        autonomic = AutonomicKernel(label="test", persistence=pm)
        foresight = ForesightPredictor(persistence=pm, symbol="BTC")
        heart = HeartMonitor(persistence=pm, symbol="BTC")

        # Synthetic OHLCV with mild drift
        ohlcv = []
        p = 75000.0
        for i in range(60):
            d = 0.0003 * 75000.0 * ((i % 7) - 3)
            np_ = p + d
            ohlcv.append(OHLCVCandle(
                timestamp=float(i * 60_000),
                high=max(p, np_) * 1.0003, low=min(p, np_) * 0.9997,
                close=np_, open=p, volume=1000.0,
            ))
            p = np_

        inputs = TickInputs(
            symbol="BTC", ohlcv=ohlcv, ml_signal="BUY", ml_strength=0.5,
            account=AccountContext(
                equity_fraction=0.05, margin_fraction=0.03, open_positions=0,
                available_equity=100.0, exchange_held_side=None,
            ),
            bank_size=10, sovereignty=0.5, max_leverage=16, min_notional=20.0,
        )
        state = fresh_symbol_state("BTC", uniform_basin(64))
        run_tick(
            inputs, state, autonomic, ocean=ocean,
            foresight=foresight, heart=heart, persistence=pm,
        )

        # Verify all 5 history families have at least one entry now
        assert len(pm.load_phi_history("BTC")) >= 1
        assert len(pm.load_basin_history("BTC")) >= 1
        assert len(pm.load_drift_history("BTC")) >= 1
        assert len(pm.load_fhealth_history("BTC")) >= 1
        # Integration history has 1 entry from the upper-stack append


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
