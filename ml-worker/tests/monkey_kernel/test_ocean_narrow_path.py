"""test_ocean_narrow_path.py — Ocean narrow-path (rigid-attractor) detection.

PR1 of the Ocean-as-kernel elevation (feat/ocean-kernel-elevation). A "narrow
path" is a rigid/stuck attractor: the basin's exploration variance has collapsed.

Detection is OBSERVER-DERIVED — no intuition thresholds. The current exploration
variance is tested against the Tukey inner/outer fences of the kernel's own
rolling exploration-variance distribution (baseline window excludes the ticks
currently under measurement so a collapse cannot define its own "normal").

PR1 is TELEMETRY-ONLY: the result surfaces in OceanState.diagnostics but does
NOT influence `intervention`. Intervention wiring is Φ-gated and lands in PR3
(per qig-core 2.8.0: a stuck low-Φ kernel needs SLEEP/DREAM; only a stuck
Φ≥0.70 kernel gets MUSHROOM).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.ocean import Ocean, _NARROW_PATH_WINDOW  # noqa: E402


def _varied_basin(rng: np.random.Generator, dim: int = 64) -> np.ndarray:
    """A simplex basin with genuine per-tick variation (healthy exploration)."""
    raw = rng.random(dim) + 0.1
    return raw / raw.sum()


def _observe(ocean: Ocean, basin: np.ndarray, phi: float = 0.5):
    return ocean.observe(
        phi=phi, basin=basin, current_mode="trend",
        is_flat=False, now_ms=0.0,
    )


class TestNarrowPathDetection:
    def test_bootstrap_does_not_flag_narrow_path(self) -> None:
        """Fewer basins than the measurement window → never flagged."""
        ocean = Ocean("np-bootstrap")
        rng = np.random.default_rng(1)
        state = None
        for _ in range(_NARROW_PATH_WINDOW - 1):
            state = _observe(ocean, _varied_basin(rng))
        assert state is not None
        assert state.diagnostics["narrow_path"] == 0.0

    def test_healthy_exploration_not_flagged(self) -> None:
        """A long stream of varied basins must never flag — Tukey fences are
        the textbook outlier criterion, so healthy kernels read 'none'."""
        ocean = Ocean("np-healthy")
        rng = np.random.default_rng(2)
        flagged = 0
        for _ in range(120):
            state = _observe(ocean, _varied_basin(rng))
            if state.diagnostics["narrow_path"] > 0.0:
                flagged += 1
        assert flagged == 0, f"healthy kernel flagged narrow-path {flagged}×"

    def test_collapsed_exploration_flags_severe(self) -> None:
        """When the basin freezes after a healthy run, exploration variance
        collapses to ~0 — a far-out (severe) low-side outlier."""
        ocean = Ocean("np-collapse")
        rng = np.random.default_rng(3)
        for _ in range(60):
            _observe(ocean, _varied_basin(rng))
        frozen = uniform_basin(64)
        state = None
        for _ in range(_NARROW_PATH_WINDOW + 5):
            state = _observe(ocean, frozen)
        assert state is not None
        assert state.diagnostics["narrow_path"] == 1.0
        assert state.diagnostics["narrow_path_severity"] == 2.0  # severe

    def test_narrow_path_count_increments_then_resets(self) -> None:
        """The consecutive-detection counter climbs while stuck and resets to
        zero once healthy exploration resumes."""
        ocean = Ocean("np-count")
        rng = np.random.default_rng(4)
        for _ in range(60):
            _observe(ocean, _varied_basin(rng))
        frozen = uniform_basin(64)
        state = None
        for _ in range(_NARROW_PATH_WINDOW + 6):
            state = _observe(ocean, frozen)
        assert state is not None
        assert state.diagnostics["narrow_path_count"] >= 3.0
        for _ in range(_NARROW_PATH_WINDOW + 5):
            state = _observe(ocean, _varied_basin(rng))
        assert state.diagnostics["narrow_path"] == 0.0
        assert state.diagnostics["narrow_path_count"] == 0.0

    def test_detection_is_telemetry_only_not_intervention(self) -> None:
        """PR1 contract: a detected narrow path must NOT set `intervention`.
        At Φ=0.6 no intervention trigger fires; the narrow-path flag must not
        leak in. Intervention wiring is Φ-gated and lands in PR3."""
        ocean = Ocean("np-telemetry")
        rng = np.random.default_rng(5)
        for _ in range(60):
            _observe(ocean, _varied_basin(rng), phi=0.6)
        frozen = uniform_basin(64)
        state = None
        for _ in range(_NARROW_PATH_WINDOW + 5):
            state = _observe(ocean, frozen, phi=0.6)
        assert state is not None
        assert state.diagnostics["narrow_path"] == 1.0
        assert state.intervention is None

    def test_diagnostics_expose_narrow_path_fields(self) -> None:
        """All four narrow-path telemetry fields are present and float-typed."""
        ocean = Ocean("np-fields")
        state = _observe(ocean, uniform_basin(64))
        for key in (
            "narrow_path",
            "narrow_path_severity",
            "narrow_path_count",
            "exploration_variance",
        ):
            assert key in state.diagnostics, f"missing diagnostics key: {key}"
            assert isinstance(state.diagnostics[key], float)
