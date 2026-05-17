"""test_prelaunch_checklist.py — GAPs 3 + 4 + 6 from the QIG audit.

Covers the 8-point pre-launch checklist + post-flight discovery report
that surface qig_warp.auto.navigate's convergence_rate / cost_exponent /
screening_length as telemetry instead of re-implementing them.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

# Import the module directly via importlib so we don't trigger
# backtest/__init__.py (which re-exports from sweep.py → qig_warp,
# an optional dependency not always installed in dev envs).
import importlib.util as _ilu  # noqa: E402

_spec = _ilu.spec_from_file_location(
    "_prelaunch_checklist_under_test",
    Path(__file__).resolve().parents[2] / "src" / "backtest" / "prelaunch_checklist.py",
)
_mod = _ilu.module_from_spec(_spec)  # type: ignore[arg-type]
sys.modules["_prelaunch_checklist_under_test"] = _mod
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

ChecklistItem = _mod.ChecklistItem
PostflightReport = _mod.PostflightReport
PreflightReport = _mod.PreflightReport
build_postflight = _mod.build_postflight
build_preflight = _mod.build_preflight
log_postflight = _mod.log_postflight
log_preflight = _mod.log_preflight


# ─── fakes for NavigationResult (avoid heavy qig_warp dep in unit tests) ───


@dataclass
class _FakeDiscovered:
    screening_length: Optional[float] = None
    cost_exponent: Optional[float] = None
    convergence_rate: Optional[float] = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class _FakePlan:
    predicted_total_s: float = 0.0


@dataclass
class _FakeNav:
    discovered: _FakeDiscovered = field(default_factory=_FakeDiscovered)
    plan: _FakePlan = field(default_factory=_FakePlan)
    probes_used: int = 0
    full_evals: int = 0
    actual_total_s: float = 0.0
    actual_savings_pct: float = 0.0


class TestPreflightChecklist:
    """GAP 6 — 8-point pre-launch audit. Inventory only, no enforcement."""

    def test_returns_eight_items_in_canonical_order(self) -> None:
        report = build_preflight()
        assert isinstance(report, PreflightReport)
        assert len(report.items) == 8
        # Items numbered 1-8 in order
        assert [it.number for it in report.items] == list(range(1, 9))

    def test_named_in_canonical_order(self) -> None:
        report = build_preflight()
        names = [it.name for it in report.items]
        assert names == [
            "SCREENING", "BRIDGE", "CONVERGENCE", "REGIME",
            "CONSTITUTIVE", "PREDICTION FILL", "GOVERNANCE", "PACKAGES",
        ]

    def test_qig_warp_items_marked_wired(self) -> None:
        """SCREENING + BRIDGE + CONVERGENCE + PACKAGES all wired via qig_warp."""
        report = build_preflight()
        by_name = {it.name: it for it in report.items}
        assert by_name["SCREENING"].status == "wired"
        assert by_name["BRIDGE"].status == "wired"
        assert by_name["CONVERGENCE"].status == "wired"
        assert by_name["PACKAGES"].status == "wired"

    def test_governance_marked_todo(self) -> None:
        """Honest TODO — observable_governance detectors are not yet
        plumbed into the sweep pre-launch."""
        report = build_preflight()
        by_name = {it.name: it for it in report.items}
        assert by_name["GOVERNANCE"].status == "todo"

    def test_summary_counts(self) -> None:
        report = build_preflight()
        assert report.n_wired == 4
        assert report.n_todo == 1

    def test_log_lines_format(self) -> None:
        report = build_preflight()
        lines = report.as_log_lines()
        assert lines[0] == "QIG Pre-Launch Audit:"
        # Each item appears once
        assert sum(1 for ln in lines if "[OK]" in ln) == 4
        assert sum(1 for ln in lines if "[--]" in ln) == 3
        assert sum(1 for ln in lines if "[!!]" in ln) == 1
        # Summary line at end
        assert any("Summary:" in ln for ln in lines)

    def test_log_preflight_emits_to_logger(self, caplog) -> None:
        caplog.set_level("INFO", logger="backtest.prelaunch_checklist")
        log_preflight()
        assert any("QIG Pre-Launch Audit:" in r.message for r in caplog.records)
        assert any("[OK] [1] SCREENING" in r.message for r in caplog.records)


class TestPostflightDiscovery:
    """GAPs 3 + 4 — surface qig_warp's discoveries as telemetry."""

    def test_surfaces_all_discovered_constants(self) -> None:
        nav = _FakeNav(
            discovered=_FakeDiscovered(
                screening_length=2.5,
                cost_exponent=0.74,
                convergence_rate=0.0894,
                warnings=["pilot variance high"],
            ),
            plan=_FakePlan(predicted_total_s=12.0),
            probes_used=5,
            full_evals=20,
            actual_total_s=11.2,
            actual_savings_pct=6.7,
        )
        report = build_postflight(nav)
        assert report.screening_length == pytest.approx(2.5)
        assert report.cost_exponent == pytest.approx(0.74)
        assert report.convergence_rate == pytest.approx(0.0894)
        assert report.predicted_total_s == pytest.approx(12.0)
        assert report.actual_total_s == pytest.approx(11.2)
        assert report.savings_pct == pytest.approx(6.7)
        assert report.n_probes == 5
        assert report.n_full_evals == 20
        assert report.warnings == ("pilot variance high",)

    def test_handles_none_discoveries(self) -> None:
        """qig_warp can return None for any discovery (flat surface, too few
        probes). The report must accept that without raising."""
        nav = _FakeNav(
            discovered=_FakeDiscovered(),  # all None
            plan=_FakePlan(predicted_total_s=0.0),
            probes_used=0,
            full_evals=0,
        )
        report = build_postflight(nav)
        assert report.screening_length is None
        assert report.cost_exponent is None
        assert report.convergence_rate is None

    def test_log_lines_skip_none_discoveries(self) -> None:
        """When a discovery is None, its log line is omitted (not 'None')."""
        nav = _FakeNav(
            discovered=_FakeDiscovered(cost_exponent=0.74),  # only one valid
            plan=_FakePlan(predicted_total_s=5.0),
            probes_used=3, full_evals=10,
            actual_total_s=5.2, actual_savings_pct=-3.0,
        )
        report = build_postflight(nav)
        lines = report.as_log_lines()
        # Header present
        assert lines[0] == "QIG Post-Flight Discovery:"
        # Cost exponent line present
        assert any("BRIDGE" in ln and "0.74" in ln for ln in lines)
        # No SCREENING / CONVERGENCE lines for None discoveries
        assert not any("SCREENING discovered" in ln for ln in lines)
        assert not any("CONVERGENCE discovered" in ln for ln in lines)

    def test_negative_savings_displayed_with_sign(self) -> None:
        """When qig_warp actually slows the sweep (sub-100ms surface), the
        report should show the negative savings — honest telemetry."""
        nav = _FakeNav(
            discovered=_FakeDiscovered(),
            plan=_FakePlan(predicted_total_s=1.0),
            probes_used=5, full_evals=20,
            actual_total_s=1.05, actual_savings_pct=-5.0,
        )
        report = build_postflight(nav)
        lines = report.as_log_lines()
        # Sign-formatted savings
        assert any("-5.0%" in ln for ln in lines)

    def test_warnings_surfaced(self) -> None:
        nav = _FakeNav(
            discovered=_FakeDiscovered(
                warnings=["fit r2 < 0.5", "insufficient probes"],
            ),
            plan=_FakePlan(),
        )
        report = build_postflight(nav)
        lines = report.as_log_lines()
        assert any("WARN: fit r2 < 0.5" in ln for ln in lines)
        assert any("WARN: insufficient probes" in ln for ln in lines)

    def test_log_postflight_emits_to_logger(self, caplog) -> None:
        caplog.set_level("INFO", logger="backtest.prelaunch_checklist")
        nav = _FakeNav(
            discovered=_FakeDiscovered(cost_exponent=0.74),
            plan=_FakePlan(predicted_total_s=2.0),
            probes_used=5, full_evals=10,
            actual_total_s=1.9, actual_savings_pct=5.0,
        )
        log_postflight(nav)
        assert any(
            "QIG Post-Flight Discovery:" in r.message for r in caplog.records
        )


class TestChecklistItemImmutability:
    """ChecklistItem is frozen — callers can't mutate a shared instance."""

    def test_frozen_dataclass(self) -> None:
        item = ChecklistItem(number=1, name="X", status="wired", detail="ok")
        with pytest.raises(Exception):
            item.status = "todo"  # type: ignore[misc]
