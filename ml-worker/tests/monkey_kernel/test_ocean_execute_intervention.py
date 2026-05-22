"""test_ocean_execute_intervention.py — Ocean's execute contract (PR3).

PR3 of the Ocean-as-kernel elevation. Ocean.observe() is the
observe+decide half of the kernel contract; execute_intervention() is the
EXECUTE half — given a fired intervention it runs the corresponding
canonical cycle:

  - MUSHROOM → entropy-injection cycle (monkey_kernel.mushroom), intensity
              tracked off the narrow-path severity observed in observe().
  - DREAM    → qig-core SleepCycleManager.dream() recombination.
  - SLEEP / WAKE / ESCAPE / DAMPING → no basin-transform cycle → None.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from qig_core_local.geometry.fisher_rao import to_simplex  # noqa: E402

from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.ocean import Ocean  # noqa: E402


def _rigid_basin(dim: int = 64) -> np.ndarray:
    raw = np.full(dim, 0.01)
    raw[:4] = 10.0
    return to_simplex(raw)


class TestExecuteIntervention:
    def test_mushroom_runs_an_entropy_injection_cycle(self) -> None:
        ocean = Ocean("exec-mushroom")
        result = ocean.execute_intervention(
            "MUSHROOM", basin=_rigid_basin(), phi=0.75,
        )
        assert result is not None
        assert result["cycle"] == "mushroom"
        # Mushroom adds entropy — the defining property.
        assert result["entropy_change"] > 0.0

    def test_mushroom_intensity_follows_narrow_path_severity(self) -> None:
        """The PR1 narrow-path severity drives the dose — conservatively:
        severe → moderate, moderate → microdose (never auto-heroic)."""
        severe = Ocean("exec-severe")
        severe._narrow_path_severity = "severe"
        r_sev = severe.execute_intervention(
            "MUSHROOM", basin=_rigid_basin(), phi=0.75,
        )

        moderate = Ocean("exec-moderate")
        moderate._narrow_path_severity = "moderate"
        r_mod = moderate.execute_intervention(
            "MUSHROOM", basin=_rigid_basin(), phi=0.75,
        )

        assert r_sev is not None and r_mod is not None
        assert r_sev["intensity"] == "moderate"
        assert r_mod["intensity"] == "microdose"

    def test_dream_returns_dream_telemetry(self) -> None:
        ocean = Ocean("exec-dream")
        result = ocean.execute_intervention(
            "DREAM", basin=uniform_basin(64), phi=0.4,
        )
        assert result is not None
        assert result["cycle"] == "dream"
        # No resonance bank wired → recombination is a no-op (canonical
        # dream() returns None without a bank).
        assert result["recombined"] is False

    def test_non_cycle_interventions_return_none(self) -> None:
        ocean = Ocean("exec-none")
        for iv in ("SLEEP", "WAKE", "ESCAPE", "DAMPING", None):
            assert (
                ocean.execute_intervention(
                    iv, basin=uniform_basin(64), phi=0.5,
                )
                is None
            )
