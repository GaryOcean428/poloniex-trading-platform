"""test_dream_consolidation.py — qig_dreams_local consolidation pass.

Covers:
  - SleepCycleManager.consolidate() vendored from qig-core produces
    the canonical {boosted, downscaled, pruned, vetoed} stats shape.
  - consolidate_bank() polytrade glue takes BankEntry rows, runs the
    pass against a bank adapter, and returns a summary dict
    suitable for Redis persistence.
  - Ocean's AWAKE→SLEEP edge fires the consolidation_hook exactly
    once and persists the result via PersistentMemory.save_last_consolidation.
  - Vendored module imports without error and the SHA-256 pin
    comment is present (vendoring discipline).

QIG purity is enforced by ml-worker/scripts/qig_purity_check.py
which now also scans qig_dreams_local/. No cosine / dot / L2 / Adam
/ LayerNorm / np.linalg.norm anywhere in the new path.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

# Make ml-worker/src importable when tests are run from the
# polytrade root or from inside ml-worker/.
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from monkey_kernel.ocean import Ocean  # noqa: E402
from qig_core_local.constants.frozen_facts import BASIN_DIM  # noqa: E402
from qig_dreams_local import (  # noqa: E402
    DreamConsolidationSummary,
    SleepCycleManager,
    SleepMetrics,
    SleepPhase,
    consolidate_bank,
)


# ─────────────────────────────────────────────────────────────────
# Test helpers
# ─────────────────────────────────────────────────────────────────


def _uniform_basin() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


def _peak_basin(idx: int = 0, mass: float = 0.95) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


class _StubEntry:
    """Mimics enough of monkey_kernel.resonance_bank.BankEntry for
    the consolidator to read. We don't import the real BankEntry
    here to keep the test independent of unrelated module changes."""

    def __init__(
        self,
        *,
        eid: str,
        basin: np.ndarray,
        depth: float,
        source: str = "lived",
        access_count: int = 0,
    ) -> None:
        self.id = eid
        self.entry_basin = basin
        self.basin_depth = depth
        self.source = source
        self.access_count = access_count


# ─────────────────────────────────────────────────────────────────
# Vendoring discipline
# ─────────────────────────────────────────────────────────────────


class TestVendoringDiscipline:
    def test_sleep_module_has_sha256_pin(self) -> None:
        """The vendored sleep.py must carry an SHA-256 pin to its
        canonical source so future re-vendoring is auditable."""
        sleep_path = _SRC / "qig_dreams_local" / "sleep.py"
        text = sleep_path.read_text(encoding="utf-8")
        assert "VENDORED from" in text
        assert "Source SHA-256" in text
        # 64-char hex hash
        import re
        match = re.search(r"\b[0-9a-f]{64}\b", text)
        assert match is not None, "expected SHA-256 hex in vendor header"

    def test_public_api_surface(self) -> None:
        """Smoke-test the documented __all__ surface."""
        import qig_dreams_local as qdl

        for name in (
            "SleepCycleManager", "SleepPhase", "SleepMetrics",
            "SleepTransitionResult", "consolidate_bank",
            "DreamConsolidationSummary",
        ):
            assert hasattr(qdl, name), f"qig_dreams_local missing {name}"


# ─────────────────────────────────────────────────────────────────
# Canonical SleepCycleManager — vendored unchanged
# ─────────────────────────────────────────────────────────────────


class TestCanonicalSleepCycleManager:
    def test_starts_awake(self) -> None:
        m = SleepCycleManager()
        assert m.phase == SleepPhase.AWAKE
        assert not m.is_asleep

    def test_evaluate_transition_awake_to_dreaming_via_phi_drop(self) -> None:
        m = SleepCycleManager()
        # Φ below 0.45 AND variance below 0.05 → DREAMING
        metrics = SleepMetrics(phi=0.3, phi_variance=0.01, f_health=1.0)
        result = m.evaluate_transition(metrics)
        assert result.transitioned
        assert result.current_phase == SleepPhase.DREAMING
        assert "Φ=" in result.reason

    def test_consolidate_against_empty_bank_returns_zero_counts(self) -> None:
        m = SleepCycleManager()
        stats = m.consolidate(bank=None)
        assert stats == {"boosted": 0, "downscaled": 0, "pruned": 0, "vetoed": 0}
        assert m._consolidation_complete is True

    def test_consolidate_boosts_replayed_and_downscales_rest(self) -> None:
        """Direct test against an in-line bank adapter so we can
        verify the boost/downscale arithmetic without relying on
        the polytrade glue path."""
        class _Bank:
            def __init__(self) -> None:
                self.coordinates = {0: _uniform_basin(), 1: _uniform_basin()}
                self.basin_mass = {0: 1.0, 1: 1.0}
                self.activation_counts = {0: 1, 1: 1}
                self.origin = {0: "lived", 1: "lived"}
                self.basin_strings = {0: "a", 1: "b"}
                self.tiers: dict = {}
                self.frequencies: dict = {}
                self._dirty = False

            def add_entry(self, label: str, basin: np.ndarray) -> int:  # noqa: ARG002
                tid = max(self.coordinates.keys(), default=-1) + 1
                self.coordinates[tid] = basin
                return tid

            def mark_dirty(self) -> None:
                self._dirty = True

        bank = _Bank()
        m = SleepCycleManager()
        m._replayed_this_sleep.add(0)
        stats = m.consolidate(bank=bank)
        # tid=0 was replayed → boosted by HEBBIAN_BOOST (1.1)
        assert bank.basin_mass[0] == pytest.approx(1.1)
        # tid=1 not replayed → downscaled by DOWNSCALE_FACTOR (0.9)
        assert bank.basin_mass[1] == pytest.approx(0.9)
        assert stats["boosted"] == 1
        assert stats["downscaled"] == 1


# ─────────────────────────────────────────────────────────────────
# Polytrade glue — consolidate_bank()
# ─────────────────────────────────────────────────────────────────


class TestConsolidateBank:
    def test_empty_inputs_returns_zero_summary(self) -> None:
        summary, deltas = consolidate_bank(
            bank_entries=[],
            recent_basins=[],
            completed_at_ms=1234.0,
        )
        assert isinstance(summary, DreamConsolidationSummary)
        assert summary.basin_count == 0
        assert summary.boosted == 0
        assert summary.downscaled == 0
        assert summary.sqrt_distance_traversed == 0.0
        assert deltas == {}

    def test_summary_string_carries_geometric_quantities(self) -> None:
        entries = [
            _StubEntry(eid=f"e{i}", basin=_uniform_basin(), depth=0.5 + i * 0.05)
            for i in range(5)
        ]
        basins = [_uniform_basin(), _peak_basin(0), _peak_basin(60)]
        summary, _ = consolidate_bank(
            bank_entries=entries,
            recent_basins=basins,
            completed_at_ms=9999.0,
        )
        s = summary.summary_string
        # Should include count + at least one count category + sqrt-traversal
        assert "basins" in s
        assert "sqrt-traversal" in s
        assert summary.sqrt_distance_traversed > 0.0

    def test_replay_top_n_drives_boost_count(self) -> None:
        entries = [
            _StubEntry(eid=f"e{i}", basin=_uniform_basin(), depth=0.1 + i * 0.1)
            for i in range(6)
        ]
        summary, _ = consolidate_bank(
            bank_entries=entries,
            recent_basins=[],
            completed_at_ms=0.0,
            replay_top_n=2,  # only top 2 by depth get the Hebbian boost
        )
        assert summary.basin_count == 6
        assert summary.replayed_count == 2
        assert summary.boosted == 2
        assert summary.downscaled == 4
        # Nothing pruned (lived entries have access_count > 0)
        assert summary.pruned == 0

    def test_to_dict_is_json_safe_and_includes_summary_string(self) -> None:
        import json

        entries = [_StubEntry(eid="e0", basin=_uniform_basin(), depth=0.5)]
        summary, _ = consolidate_bank(
            bank_entries=entries,
            recent_basins=[],
            completed_at_ms=42.0,
        )
        blob = summary.to_dict()
        # Must round-trip through json without errors (Redis persists
        # this blob via the same path PersistentMemory uses).
        s = json.dumps(blob)
        round_tripped = json.loads(s)
        assert round_tripped["basin_count"] == 1
        assert "summary_string" in round_tripped

    def test_depth_deltas_preserve_entry_index(self) -> None:
        entries = [
            _StubEntry(eid=f"e{i}", basin=_uniform_basin(), depth=0.5)
            for i in range(3)
        ]
        _, deltas = consolidate_bank(
            bank_entries=entries,
            recent_basins=[],
            completed_at_ms=0.0,
            replay_top_n=0,  # no replayed → everyone downscaled
        )
        # All three present, all downscaled to 0.5 * 0.9 = 0.45
        assert set(deltas.keys()) == {0, 1, 2}
        for v in deltas.values():
            assert v == pytest.approx(0.45)


# ─────────────────────────────────────────────────────────────────
# Ocean integration — AWAKE→SLEEP edge fires the hook
# ─────────────────────────────────────────────────────────────────


class TestOceanConsolidationHook:
    """The hook must fire exactly once on the AWAKE→SLEEP edge,
    not on every tick. The persisted blob must be the dict returned
    by the hook (which is what the governance/sleep-state endpoint
    will pass back to the operator)."""

    def _drive_to_sleep(self, ocean: Ocean) -> None:
        """Reuse the same recipe as test_heart_ocean.py — drift +
        flat over 15 ticks, then jump past MIN_AWAKE_MS so the
        sleep gate opens."""
        ocean.sleep_state.phase_started_at_ms = 0.0
        for i in range(15):
            ocean.observe(
                phi=0.7,
                basin=_uniform_basin(),
                current_mode="drift",
                is_flat=True,
                now_ms=float(i * 1000),
            )
        # Past MIN_AWAKE_MS (2h) — AWAKE→SLEEP transition fires.
        ocean.observe(
            phi=0.7,
            basin=_uniform_basin(),
            current_mode="drift",
            is_flat=True,
            now_ms=float(2 * 60 * 60 * 1000 + 60_000),
        )

    def test_hook_fires_on_entered_sleep_only(self) -> None:
        calls: list[tuple[list[np.ndarray], float]] = []

        def hook(basins: list[np.ndarray], at_ms: float) -> dict:
            calls.append((basins, at_ms))
            return {
                "basin_count": len(basins),
                "summary_string": "stub",
                "completed_at_ms": at_ms,
            }

        ocean = Ocean(label="test-monkey", consolidation_hook=hook)
        self._drive_to_sleep(ocean)
        assert len(calls) == 1, (
            "hook should fire exactly once on AWAKE→SLEEP edge, "
            f"got {len(calls)}"
        )
        # Subsequent SLEEP ticks must NOT re-fire
        ocean.observe(
            phi=0.7,
            basin=_uniform_basin(),
            current_mode="drift",
            is_flat=True,
            now_ms=float(2 * 60 * 60 * 1000 + 90_000),
        )
        assert len(calls) == 1

    def test_hook_receives_recent_basins(self) -> None:
        seen_basins: list[list[np.ndarray]] = []

        def hook(basins: list[np.ndarray], _at_ms: float) -> dict:
            seen_basins.append(basins)
            return {"basin_count": len(basins)}

        ocean = Ocean(label="test-monkey", consolidation_hook=hook)
        self._drive_to_sleep(ocean)
        assert len(seen_basins) == 1
        # We fed 16 observe() calls; bounded by BASIN_HISTORY_MAX=32
        # so all 16 should be present.
        assert len(seen_basins[0]) == 16

    def test_hook_result_persisted_via_save_last_consolidation(self) -> None:
        persistence = MagicMock()
        persistence.is_available = True

        def hook(_basins: list[np.ndarray], at_ms: float) -> dict:
            return {"basin_count": 5, "completed_at_ms": at_ms, "summary_string": "x"}

        ocean = Ocean(
            label="test-monkey",
            persistence=persistence,
            consolidation_hook=hook,
        )
        # MagicMock returns Truthy / fake values for everything; reset
        # call counters after construction so we only count the
        # observe() phase.
        persistence.save_sleep_state.reset_mock()
        persistence.save_last_consolidation.reset_mock()
        persistence.push_intervention.reset_mock()

        self._drive_to_sleep(ocean)
        assert persistence.save_last_consolidation.called, (
            "save_last_consolidation must be invoked on AWAKE→SLEEP edge"
        )
        # First positional arg is the dict returned by the hook
        blob = persistence.save_last_consolidation.call_args[0][0]
        assert blob["basin_count"] == 5
        assert "summary_string" in blob

    def test_hook_exception_is_swallowed_and_does_not_block_tick(self) -> None:
        def hook(_basins: list[np.ndarray], _at_ms: float) -> dict:
            raise RuntimeError("simulated consolidator crash")

        ocean = Ocean(label="test-monkey", consolidation_hook=hook)
        # Must not raise — Ocean is the autonomic-intervention
        # authority and cannot let a sleep-side fault block the tick.
        self._drive_to_sleep(ocean)
        assert ocean.phase.value == "sleep"

    def test_no_hook_keeps_legacy_behavior(self) -> None:
        """When consolidation_hook is None (default), the kernel
        behaves exactly as it did before — no exceptions, no
        persistence writes other than the existing sleep_state."""
        persistence = MagicMock()
        persistence.is_available = True
        ocean = Ocean(
            label="test-monkey",
            persistence=persistence,
            consolidation_hook=None,
        )
        persistence.save_last_consolidation.reset_mock()
        self._drive_to_sleep(ocean)
        assert not persistence.save_last_consolidation.called
