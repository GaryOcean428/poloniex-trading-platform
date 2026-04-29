"""test_forge.py — Tier 8 Forge mechanism."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.forge import (  # noqa: E402
    ForgeResult,
    ShadowEvent,
    decompress,
    dissipate,
    forge,
    fracture,
    nucleate,
)
from monkey_kernel.state import BASIN_DIM  # noqa: E402


def _peak_basin(idx: int = 5, mass: float = 0.6) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


def _shadow(pnl: float = -0.5, idx: int = 5, mass: float = 0.6) -> ShadowEvent:
    return ShadowEvent(
        basin=_peak_basin(idx, mass),
        phi=0.45,
        kappa=68.0,
        realized_pnl=pnl,
        regime_weights={"quantum": 0.4, "efficient": 0.3, "equilibrium": 0.3},
    )


# ─────────────────────────────────────────────────────────────────
# Stage 1 — DECOMPRESS
# ─────────────────────────────────────────────────────────────────


class TestDecompress:
    def test_returns_event_with_copied_basin(self) -> None:
        original = _shadow()
        out = decompress(original)
        assert np.allclose(out.basin, original.basin)
        # Copy: mutating the output basin must not touch the original
        out.basin[0] = 0.99
        assert original.basin[0] != 0.99

    def test_preserves_scalar_fields(self) -> None:
        original = _shadow(pnl=-1.2)
        out = decompress(original)
        assert out.phi == original.phi
        assert out.kappa == original.kappa
        assert out.realized_pnl == original.realized_pnl


# ─────────────────────────────────────────────────────────────────
# Stage 2 — FRACTURE
# ─────────────────────────────────────────────────────────────────


class TestFracture:
    def test_invariants_present(self) -> None:
        f = fracture(_shadow())
        assert "shape_concentration" in f.invariants
        assert "shape_dispersion" in f.invariants
        assert "phi_band" in f.invariants
        assert "kappa_offset" in f.invariants
        assert "regime_quantum" in f.invariants
        assert "regime_equilibrium" in f.invariants
        assert "loss_magnitude" in f.invariants

    def test_shape_concentration_is_max_mass(self) -> None:
        f = fracture(_shadow(idx=10, mass=0.7))
        assert f.invariants["shape_concentration"] == pytest.approx(0.7, abs=1e-12)

    def test_kappa_offset_relative_to_anchor(self) -> None:
        ev = _shadow()
        ev = ShadowEvent(basin=ev.basin, phi=ev.phi, kappa=70.0,
                         realized_pnl=ev.realized_pnl, regime_weights=ev.regime_weights)
        f = fracture(ev)
        assert f.invariants["kappa_offset"] == pytest.approx(6.0, abs=1e-12)

    def test_loss_magnitude_is_absolute(self) -> None:
        f = fracture(_shadow(pnl=-0.85))
        assert f.invariants["loss_magnitude"] == pytest.approx(0.85, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Stage 3 — NUCLEATE
# ─────────────────────────────────────────────────────────────────


class TestNucleate:
    def test_canonicalises_peak_to_index_zero(self) -> None:
        f = fracture(_shadow(idx=37, mass=0.75))  # peak at index 37 originally
        n = nucleate(f)
        assert n.basin[0] == pytest.approx(0.75, abs=1e-12)
        # Peak NOT at index 37 anymore — it's been canonicalised
        assert n.basin[37] != pytest.approx(0.75, abs=1e-12)

    def test_nucleus_is_simplex_valid(self) -> None:
        f = fracture(_shadow())
        n = nucleate(f)
        assert n.basin.sum() == pytest.approx(1.0, abs=1e-9)
        assert (n.basin >= 0).all()

    def test_nucleus_preserves_shape_concentration_invariant(self) -> None:
        f = fracture(_shadow(mass=0.55))
        n = nucleate(f)
        assert float(n.basin.max()) == pytest.approx(0.55, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Stage 4 — DISSIPATE
# ─────────────────────────────────────────────────────────────────


class TestDissipate:
    def test_returns_uniform_basin(self) -> None:
        original = _shadow()
        f = fracture(original)
        n = nucleate(f)
        d = dissipate(original, n)
        expected = 1.0 / BASIN_DIM
        assert np.allclose(d.basin, expected)

    def test_invariants_persist_through_dissipate(self) -> None:
        original = _shadow()
        f = fracture(original)
        n = nucleate(f)
        d = dissipate(original, n)
        # Lesson invariants survive even though pain coords are released
        assert d.invariants == n.invariants


# ─────────────────────────────────────────────────────────────────
# Full cycle
# ─────────────────────────────────────────────────────────────────


class TestForgeCycle:
    def test_returns_result_for_loss(self) -> None:
        result = forge(_shadow(pnl=-0.5))
        assert isinstance(result, ForgeResult)
        assert result.lesson_summary["loss_magnitude"] == pytest.approx(0.5, abs=1e-12)
        assert "skipped" not in result.lesson_summary

    def test_skips_positive_pnl(self) -> None:
        result = forge(_shadow(pnl=+0.3))
        assert result.lesson_summary["skipped"] is True

    def test_lesson_summary_carries_all_invariants(self) -> None:
        result = forge(_shadow(pnl=-0.7, idx=12, mass=0.65))
        s = result.lesson_summary
        assert s["loss_magnitude"] == pytest.approx(0.7, abs=1e-12)
        assert s["shape_concentration"] == pytest.approx(0.65, abs=1e-12)
        assert s["nucleated_peak_index"] == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
