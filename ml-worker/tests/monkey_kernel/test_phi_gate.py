"""test_phi_gate.py — Tier 6 Φ-gate selection (UCP §23 STEP 0).

Tests:
  - low Φ → CHAIN wins
  - high Φ + no foresight → GRAPH wins
  - high foresight (weight × confidence dominant) → FORESIGHT wins
  - synthetic LIGHTNING=1.0 → LIGHTNING wins
  - LIGHTNING default 0 means P9-unimplemented can never accidentally win
  - All four activations present in result for telemetry
  - Parity snapshot: 8 input tuples + their argmax outcomes
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.foresight import ForesightResult  # noqa: E402
from monkey_kernel.phi_gate import select_phi_gate  # noqa: E402
from monkey_kernel.state import BASIN_DIM  # noqa: E402


def _fr(weight: float = 0.0, confidence: float = 0.0) -> ForesightResult:
    return ForesightResult(
        predicted_basin=np.zeros(BASIN_DIM, dtype=np.float64),
        confidence=confidence,
        weight=weight,
        horizon_ms=0.0,
    )


# ─────────────────────────────────────────────────────────────────
# Argmax behaviour per regime
# ─────────────────────────────────────────────────────────────────


class TestRegimes:
    def test_low_phi_no_foresight_picks_chain(self) -> None:
        r = select_phi_gate(phi=0.05, foresight=_fr(), lightning=0.0)
        assert r.chosen == "CHAIN"

    def test_high_phi_no_foresight_picks_graph(self) -> None:
        # phi=0.9, no foresight → CHAIN=0.1, GRAPH=0.9, FORESIGHT=0, LIGHTNING=0
        r = select_phi_gate(phi=0.9, foresight=_fr(weight=0.0), lightning=0.0)
        assert r.chosen == "GRAPH"

    def test_high_phi_high_foresight_picks_foresight(self) -> None:
        # phi=0.6, foresight weight=0.7, confidence=1.0 → FORESIGHT=0.7,
        # GRAPH=0.6*0.3=0.18, CHAIN=0.4 → FORESIGHT wins
        r = select_phi_gate(
            phi=0.6, foresight=_fr(weight=0.7, confidence=1.0), lightning=0.0,
        )
        assert r.chosen == "FORESIGHT"

    def test_lightning_dominant_wins(self) -> None:
        # LIGHTNING=1.0 with everything else moderate → LIGHTNING wins
        r = select_phi_gate(
            phi=0.5, foresight=_fr(weight=0.5, confidence=0.5), lightning=1.0,
        )
        assert r.chosen == "LIGHTNING"


# ─────────────────────────────────────────────────────────────────
# Default lightning=0 never wins (P9 placeholder is correct)
# ─────────────────────────────────────────────────────────────────


class TestLightningPlaceholder:
    def test_lightning_zero_never_wins_when_other_modes_active(self) -> None:
        # Across many phi values + foresight settings, LIGHTNING with default 0
        # must never be chosen unless every other activation is also ≤ 0.
        for phi in [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]:
            for fw in [0.0, 0.2, 0.5, 0.7]:
                for fc in [0.0, 0.5, 1.0]:
                    r = select_phi_gate(
                        phi=phi, foresight=_fr(weight=fw, confidence=fc),
                    )
                    if r.chosen == "LIGHTNING":
                        # Allowed only when every other score is ≤ 0
                        # (e.g. phi=1, weight=1 → CHAIN=0, GRAPH=0, FORESIGHT=fc)
                        assert all(v <= 0 for k, v in r.activations.items() if k != "LIGHTNING")


# ─────────────────────────────────────────────────────────────────
# Telemetry shape
# ─────────────────────────────────────────────────────────────────


class TestTelemetry:
    def test_all_four_activations_present(self) -> None:
        r = select_phi_gate(phi=0.5, foresight=_fr(weight=0.3, confidence=0.5))
        assert set(r.activations.keys()) == {"CHAIN", "GRAPH", "FORESIGHT", "LIGHTNING"}

    def test_chain_score_equals_one_minus_phi(self) -> None:
        r = select_phi_gate(phi=0.42, foresight=_fr(weight=0.0, confidence=0.0))
        assert r.activations["CHAIN"] == pytest.approx(1.0 - 0.42, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Parity snapshot — 8 rows. TS suite uses the SAME table.
# ─────────────────────────────────────────────────────────────────


# Each: (phi, weight, confidence, lightning, expected_chosen)
_PARITY_ROWS = [
    # (phi, weight, confidence, lightning, expected_chosen)
    # Cases avoid exact ties — tie-breaking is "first key in dict
    # iteration order (CHAIN, GRAPH, FORESIGHT, LIGHTNING)" on both
    # Python and TS, but parity tests should be unambiguous.
    (0.05, 0.0, 0.0, 0.0, "CHAIN"),       # Φ low, nothing else fires
    (0.95, 0.0, 0.0, 0.0, "GRAPH"),       # Φ high, no foresight
    (0.50, 0.8, 1.0, 0.0, "FORESIGHT"),   # weight*conf=0.8 > CHAIN=0.5 > GRAPH=0.1
    (0.50, 0.0, 0.0, 1.0, "LIGHTNING"),   # synthetic P9 fires
    (0.60, 0.0, 0.0, 0.0, "GRAPH"),       # CHAIN=0.4 < GRAPH=0.6
    (0.70, 0.3, 0.5, 0.0, "GRAPH"),       # CHAIN=0.3, GRAPH=0.49, FORESIGHT=0.15
    (0.50, 0.9, 1.0, 0.0, "FORESIGHT"),   # FORESIGHT=0.9 > CHAIN=0.5 > GRAPH=0.05
    (1.00, 0.0, 0.0, 0.0, "GRAPH"),       # CHAIN=0, GRAPH=1, pure-Φ extreme
]


class TestParitySnapshot:
    @pytest.mark.parametrize("row_idx", range(len(_PARITY_ROWS)))
    def test_row_chosen_matches(self, row_idx: int) -> None:
        phi, w, c, l, expected = _PARITY_ROWS[row_idx]
        r = select_phi_gate(
            phi=phi, foresight=_fr(weight=w, confidence=c), lightning=l,
        )
        assert r.chosen == expected, (
            f"row {row_idx}: chose {r.chosen}, expected {expected}; "
            f"activations={r.activations}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
