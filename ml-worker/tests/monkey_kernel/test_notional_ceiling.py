"""test_notional_ceiling.py — v0.8.7 notional-ceiling fallback.

The Kelly cap is the primary brake on aggregate exposure but is
non-binding at cold start (no closed trades) and decays to no-op when
stats are uninformative. Live tape 2026-05-01: $77 → $386 escalating
notionals on a $97 account (4× balance) with every position closing
via single-tick regime_change at 22% win rate.

The notional ceiling is a hard cap: notional = margin × leverage <=
NOTIONAL_CEILING_RATIO × equity. Default 4.0. Applied AFTER the lane
margin cap so the ceiling is the final clamp.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    current_position_size,
)
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.state import NeurochemicalState  # noqa: E402


def _basin_state(*, phi: float = 0.6, sovereignty: float = 0.8) -> ExecBasinState:
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=0.6, serotonin=0.6,
        norepinephrine=0.5, gaba=0.4, endorphins=0.5,
    )
    basin = uniform_basin(64)
    return ExecBasinState(
        basin=basin,
        identity_basin=basin,
        phi=phi, kappa=64.0,
        regime_weights={"quantum": 0.34, "efficient": 0.33, "equilibrium": 0.33},
        sovereignty=sovereignty,
        basin_velocity=0.05,
        neurochemistry=nc,
    )


class TestNotionalCeilingLiveTapeScenario:
    """The exact 2026-05-01 16:11-16:17 scenario:
    account = $97, leverage near max boundary, kernel computing margin
    that yields notional > 4× balance. Without the ceiling the live
    tape recorded $386 notionals; with ceiling=4.0 the cap sits at
    $388 max."""

    def test_capped_at_4x_balance_on_live_scenario(self) -> None:
        # Account $97, leverage 20× (high edge of typical), enough phi
        # for the geometric formula to size aggressively.
        bs = _basin_state(phi=0.6, sovereignty=0.8)
        out = current_position_size(
            bs,
            available_equity_usdt=97.0,
            min_notional_usdt=5.0,
            leverage=20,
            bank_size=20,
            mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        # Without the ceiling: margin = 0.5 × 97 (lane cap) = 48.5,
        # notional = 48.5 × 20 = 970 → 10× balance. With ceiling 4×:
        # max notional = 388, max margin = 19.4.
        ceiling = 4.0 * 97.0  # 388
        assert out["derivation"]["notional"] <= ceiling + 1e-9
        assert out["derivation"]["capped_by_notional"] == 1
        assert out["derivation"]["margin"] * out["derivation"]["leverage"] <= ceiling + 1e-9

    def test_ceiling_surfaces_in_derivation(self) -> None:
        bs = _basin_state(phi=0.6, sovereignty=0.8)
        out = current_position_size(
            bs,
            available_equity_usdt=100.0,
            min_notional_usdt=5.0,
            leverage=10,
            bank_size=20,
            mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        # ratio + ceiling are both surfaced for telemetry parity with TS.
        assert out["derivation"]["notional_ceiling_ratio"] == 4.0
        assert out["derivation"]["notional_ceiling"] == 400.0


class TestNotionalCeilingNonBinding:
    """When the geometric formula already keeps notional below the
    ceiling, the cap is a no-op."""

    def test_low_leverage_no_cap(self) -> None:
        # Account $1000, leverage 2× → max notional via lane cap is
        # 0.5 × 1000 × 2 = 1000, well below 4 × 1000 = 4000 ceiling.
        bs = _basin_state(phi=0.4, sovereignty=0.5)
        out = current_position_size(
            bs,
            available_equity_usdt=1000.0,
            min_notional_usdt=10.0,
            leverage=2,
            bank_size=20,
            mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        assert out["derivation"]["capped_by_notional"] == 0
        assert out["derivation"]["notional"] <= 4000.0

    def test_zero_equity_no_crash(self) -> None:
        bs = _basin_state(phi=0.4, sovereignty=0.5)
        out = current_position_size(
            bs,
            available_equity_usdt=0.0,
            min_notional_usdt=10.0,
            leverage=10,
            bank_size=20,
            mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        # Zero equity → ceiling = 0 → margin × leverage > 0 fails the
        # condition (we cannot reduce margin further), but the existing
        # margin formula already produces 0 since frac × 0 = 0.
        assert out["derivation"]["notional"] == 0.0
        assert out["value"] == 0.0


class TestNotionalCeilingRatioRegistry:
    """Ceiling ratio is registry-controlled via
    executive.notional_ceiling_ratio (default 4.0)."""

    def test_default_ratio_is_four(self) -> None:
        bs = _basin_state(phi=0.6, sovereignty=0.8)
        out = current_position_size(
            bs,
            available_equity_usdt=100.0,
            min_notional_usdt=5.0,
            leverage=10,
            bank_size=20,
            mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        assert out["derivation"]["notional_ceiling_ratio"] == 4.0

    def test_ratio_override_via_registry(self) -> None:
        from monkey_kernel.parameters import (
            ParamValue,
            VariableCategory,
            get_registry,
        )
        registry = get_registry()
        key = "executive.notional_ceiling_ratio"
        # Force the cache to be considered loaded so direct cache writes
        # take effect without hitting the DB.
        with registry._lock:  # noqa: SLF001
            registry._loaded = True  # noqa: SLF001
            saved = registry._cache.get(key)  # noqa: SLF001
            registry._cache[key] = ParamValue(  # noqa: SLF001
                name=key,
                category=VariableCategory.OPERATIONAL,
                value=2.0,
                bounds_low=0.0, bounds_high=20.0,
                justification="test override", version=1,
            )
        try:
            bs = _basin_state(phi=0.6, sovereignty=0.8)
            out = current_position_size(
                bs,
                available_equity_usdt=100.0,
                min_notional_usdt=5.0,
                leverage=20,
                bank_size=20,
                mode=MonkeyMode.INVESTIGATION,
                lane="scalp",
            )
            assert out["derivation"]["notional_ceiling_ratio"] == 2.0
            assert out["derivation"]["notional_ceiling"] == 200.0
            assert out["derivation"]["notional"] <= 200.0 + 1e-9
        finally:
            with registry._lock:  # noqa: SLF001
                if saved is None:
                    registry._cache.pop(key, None)  # noqa: SLF001
                else:
                    registry._cache[key] = saved  # noqa: SLF001


class TestNotionalCeilingPrecedenceOrder:
    """Ceiling is applied AFTER the lane budget cap, so when the lane
    cap already binds tighter, ceiling is a no-op."""

    def test_lane_cap_binds_first(self) -> None:
        # Trend lane has budget_frac = 0.0 by default → lane cap forces
        # margin to 0; ceiling is moot.
        bs = _basin_state(phi=0.6, sovereignty=0.8)
        out = current_position_size(
            bs,
            available_equity_usdt=1000.0,
            min_notional_usdt=5.0,
            leverage=20,
            bank_size=20,
            mode=MonkeyMode.INVESTIGATION,
            lane="trend",
        )
        assert out["derivation"]["margin"] == 0
        # capped_by_notional may be 0 because the binding constraint
        # was the lane cap, not the ceiling.
