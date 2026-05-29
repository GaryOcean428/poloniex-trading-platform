"""test_substrate_observer.py — observer-derived lane decision period
(Py side, #1025 cascading-knob-strip follow-up 2026-05-29).

Mirror of `apps/api/src/services/monkey/__tests__/substrate_observer.test.ts`.

Pins:
  1. Fresh state → 0 (cold-start, no observed floor)
  2. Identical-tag back-to-back calls do NOT push samples
  3. Different-tag pushes the inter-change interval
  4. Median returned, robust to outlier
  5. Per-lane isolation
  6. NaN ignored
  7. Literal purity: only sample-count buffer size, no ms knobs
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from monkey_kernel.substrate_observer import (
    _reset_substrate_observer_state,
    get_observed_lane_decision_period_ms,
    get_substrate_breakdown,
    record_lane_decision,
)


@pytest.fixture(autouse=True)
def _reset() -> None:
    _reset_substrate_observer_state()


def test_fresh_state_returns_zero_for_every_lane() -> None:
    assert get_observed_lane_decision_period_ms("scalp") == 0
    assert get_observed_lane_decision_period_ms("swing") == 0
    assert get_observed_lane_decision_period_ms("trend") == 0


def test_identical_tag_back_to_back_does_not_push_sample() -> None:
    record_lane_decision("scalp", 1000.0, "long|hold")
    record_lane_decision("scalp", 2000.0, "long|hold")  # unchanged
    record_lane_decision("scalp", 3000.0, "long|hold")  # unchanged
    assert get_substrate_breakdown()["scalp_samples"] == 0
    assert get_observed_lane_decision_period_ms("scalp") == 0


def test_different_tag_pushes_inter_change_interval() -> None:
    record_lane_decision("scalp", 1000.0, "long|hold")
    record_lane_decision("scalp", 4000.0, "long|enter")  # change after 3000ms
    assert get_substrate_breakdown()["scalp_samples"] == 1
    assert get_observed_lane_decision_period_ms("scalp") == 3000


def test_median_robust_to_outlier() -> None:
    # 5 changes: 1000, 2000, 3000, 4000, 20_000 (outlier). Median = 3000.
    record_lane_decision("swing", 0.0, "a")
    record_lane_decision("swing", 1000.0, "b")  # 1000
    record_lane_decision("swing", 3000.0, "c")  # 2000
    record_lane_decision("swing", 6000.0, "d")  # 3000
    record_lane_decision("swing", 10_000.0, "e")  # 4000
    record_lane_decision("swing", 30_000.0, "f")  # 20_000 outlier
    assert get_observed_lane_decision_period_ms("swing") == 3000


def test_per_lane_isolation() -> None:
    record_lane_decision("scalp", 0.0, "a")
    record_lane_decision("scalp", 1000.0, "b")
    assert get_observed_lane_decision_period_ms("scalp") == 1000
    assert get_observed_lane_decision_period_ms("swing") == 0


def test_nan_t_now_is_ignored() -> None:
    record_lane_decision("scalp", float("nan"), "a")
    record_lane_decision("scalp", 1000.0, "b")
    record_lane_decision("scalp", 4000.0, "c")  # gap from last valid = 3000
    assert get_observed_lane_decision_period_ms("scalp") == 3000


def test_negative_t_now_is_ignored() -> None:
    record_lane_decision("scalp", -1.0, "a")
    record_lane_decision("scalp", 1000.0, "b")
    record_lane_decision("scalp", 4000.0, "c")
    assert get_observed_lane_decision_period_ms("scalp") == 3000


def test_breakdown_surfaces_sample_counts_and_periods() -> None:
    record_lane_decision("scalp", 0.0, "a")
    record_lane_decision("scalp", 5000.0, "b")
    record_lane_decision("trend", 0.0, "a")
    record_lane_decision("trend", 100_000.0, "b")
    b = get_substrate_breakdown()
    assert b["scalp_samples"] == 1
    assert b["scalp_period_ms"] == 5000
    assert b["swing_samples"] == 0
    assert b["swing_period_ms"] == 0
    assert b["trend_samples"] == 1
    assert b["trend_period_ms"] == 100_000


# ── Literal purity ─────────────────────────────────────────────────


def test_no_unexpected_numeric_literals_in_substrate_observer_py() -> None:
    """The only allowed numeric literal in substrate_observer.py is `50`
    (sample-count buffer size, not a physical ms quantity) and `0` / `1`
    / `2` (clamp / index arithmetic / median midpoint divisor)."""
    src_path = (
        Path(__file__).parents[2] / "src" / "monkey_kernel" / "substrate_observer.py"
    )
    src = src_path.read_text(encoding="utf-8")
    # Strip docstrings + comments + string literals.
    stripped = re.sub(r'""".*?"""', '""', src, flags=re.DOTALL)
    stripped = re.sub(r"'''.*?'''", "''", stripped, flags=re.DOTALL)
    stripped = re.sub(r"#[^\n]*", "", stripped)
    stripped = re.sub(r"'[^']*'", "''", stripped)
    stripped = re.sub(r'"[^"]*"', '""', stripped)
    literals = re.findall(r"(?<![\w.])(\d+(?:\.\d+)?)", stripped)
    allowed = {"0", "1", "2", "50"}
    offenders = [v for v in literals if v not in allowed]
    assert offenders == [], (
        f"Unexpected numeric literals in substrate_observer.py: {offenders}"
    )
