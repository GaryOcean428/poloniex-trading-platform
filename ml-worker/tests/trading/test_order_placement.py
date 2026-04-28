"""Tests for v0.8.7c-3 order placement port.

Convention: tests in ml-worker/tests/trading/ run as standalone scripts
(an empty __init__.py in this directory shadows the src/trading package
under pytest's rootdir importer). Each test class implements simple
assertion methods; the bottom-of-file runner walks Test* classes and
calls every test_* method.

Focus: circuit-breaker logic + activation flag. DB-IO functions are
exercised in integration tests (separate, not run here).
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trading.order_placement import (  # noqa: E402
    MAX_CONSECUTIVE_LOSSES,
    MAX_DAILY_LOSS_PERCENT,
    COOLDOWN_AFTER_TRIP_MS,
    get_circuit_breaker,
    record_trade_result,
    reset_circuit_breakers_for_test,
    trading_engine_py_enabled,
)


def _setup() -> None:
    reset_circuit_breakers_for_test()


# ────────────────────────────────────────────────────────────────
# Circuit breaker — win-reset behaviour
# ────────────────────────────────────────────────────────────────

class TestCircuitBreakerWinReset:
    def test_initial_state_clean(self) -> None:
        _setup()
        cb = get_circuit_breaker("user-A")
        assert cb.consecutive_losses == 0
        assert cb.daily_loss == 0.0
        assert cb.is_tripped is False

    def test_single_win_no_change(self) -> None:
        _setup()
        record_trade_result("user-A", pnl=0.05, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.consecutive_losses == 0
        assert cb.is_tripped is False

    def test_win_after_losses_resets_consecutive(self) -> None:
        _setup()
        for _ in range(3):
            record_trade_result("user-A", pnl=-0.05, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.consecutive_losses == 3
        assert cb.is_tripped is False
        record_trade_result("user-A", pnl=0.10, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.consecutive_losses == 0


# ────────────────────────────────────────────────────────────────
# Circuit breaker — tripping conditions
# ────────────────────────────────────────────────────────────────

class TestCircuitBreakerTripping:
    def test_consecutive_losses_trips_at_threshold(self) -> None:
        _setup()
        for _ in range(MAX_CONSECUTIVE_LOSSES):
            record_trade_result("user-A", pnl=-0.05, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.is_tripped is True
        assert cb.consecutive_losses == MAX_CONSECUTIVE_LOSSES
        assert cb.tripped_reason is not None
        assert "consecutive losses" in cb.tripped_reason

    def test_consecutive_losses_below_threshold_no_trip(self) -> None:
        _setup()
        for _ in range(MAX_CONSECUTIVE_LOSSES - 1):
            record_trade_result("user-A", pnl=-0.05, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.is_tripped is False

    def test_daily_loss_trips_at_threshold(self) -> None:
        _setup()
        # 10% of $100 = $10. $11 single-trade loss → daily-loss trip.
        record_trade_result("user-A", pnl=-11.0, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.is_tripped is True
        assert cb.tripped_reason is not None
        assert "Daily loss limit" in cb.tripped_reason

    def test_daily_loss_below_threshold_no_trip(self) -> None:
        _setup()
        record_trade_result("user-A", pnl=-9.0, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.is_tripped is False


# ────────────────────────────────────────────────────────────────
# Circuit breaker — per-user isolation
# ────────────────────────────────────────────────────────────────

class TestCircuitBreakerIsolation:
    def test_per_user_isolation(self) -> None:
        _setup()
        for _ in range(MAX_CONSECUTIVE_LOSSES):
            record_trade_result("user-A", pnl=-0.05, capital_base=100.0)
        # User A is tripped
        assert get_circuit_breaker("user-A").is_tripped is True
        # User B is independent
        assert get_circuit_breaker("user-B").is_tripped is False
        record_trade_result("user-B", pnl=0.10, capital_base=100.0)
        assert get_circuit_breaker("user-B").is_tripped is False


# ────────────────────────────────────────────────────────────────
# Cooldown auto-reset
# ────────────────────────────────────────────────────────────────

class TestCooldownReset:
    def test_cooldown_auto_untrip(self) -> None:
        _setup()
        for _ in range(MAX_CONSECUTIVE_LOSSES):
            record_trade_result("user-A", pnl=-0.05, capital_base=100.0)
        cb = get_circuit_breaker("user-A")
        assert cb.is_tripped is True
        # Simulate cooldown elapsed by rewinding tripped_at_ms.
        cb.tripped_at_ms = int(time.time() * 1000) - COOLDOWN_AFTER_TRIP_MS - 1
        # Next access untrips automatically.
        cb_after = get_circuit_breaker("user-A")
        assert cb_after.is_tripped is False
        assert cb_after.consecutive_losses == 0


# ────────────────────────────────────────────────────────────────
# Activation flag — TRADING_ENGINE_PY
# ────────────────────────────────────────────────────────────────

class TestActivationFlag:
    def _restore_env(self, prev: str | None) -> None:
        if prev is None:
            os.environ.pop("TRADING_ENGINE_PY", None)
        else:
            os.environ["TRADING_ENGINE_PY"] = prev

    def test_default_off(self) -> None:
        prev = os.environ.pop("TRADING_ENGINE_PY", None)
        try:
            assert trading_engine_py_enabled() is False
        finally:
            self._restore_env(prev)

    def test_explicit_false(self) -> None:
        prev = os.environ.get("TRADING_ENGINE_PY")
        try:
            os.environ["TRADING_ENGINE_PY"] = "false"
            assert trading_engine_py_enabled() is False
        finally:
            self._restore_env(prev)

    def test_explicit_true(self) -> None:
        prev = os.environ.get("TRADING_ENGINE_PY")
        try:
            os.environ["TRADING_ENGINE_PY"] = "true"
            assert trading_engine_py_enabled() is True
        finally:
            self._restore_env(prev)

    def test_case_insensitive(self) -> None:
        prev = os.environ.get("TRADING_ENGINE_PY")
        try:
            os.environ["TRADING_ENGINE_PY"] = "TRUE"
            assert trading_engine_py_enabled() is True
        finally:
            self._restore_env(prev)

    def test_random_value_false(self) -> None:
        prev = os.environ.get("TRADING_ENGINE_PY")
        try:
            os.environ["TRADING_ENGINE_PY"] = "1"
            assert trading_engine_py_enabled() is False
        finally:
            self._restore_env(prev)


# ────────────────────────────────────────────────────────────────
# Standalone runner (matches sibling test_*.py convention).
# ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import inspect
    passed = 0
    failed: list[str] = []
    for cls_name, cls in list(globals().items()):
        if not inspect.isclass(cls) or not cls_name.startswith("Test"):
            continue
        instance = cls()
        for name, fn in inspect.getmembers(cls, predicate=inspect.isfunction):
            if not name.startswith("test_"):
                continue
            try:
                fn(instance)
                passed += 1
                print(f"  ✓ {cls_name}.{name}")
            except AssertionError as exc:
                failed.append(f"{cls_name}.{name}: {exc}")
                print(f"  ✗ {cls_name}.{name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failed.append(f"{cls_name}.{name}: {type(exc).__name__}: {exc}")
                print(f"  ✗ {cls_name}.{name}: {type(exc).__name__}: {exc}")
    print(f"\n{passed} passed, {len(failed)} failed")
    sys.exit(0 if not failed else 1)
