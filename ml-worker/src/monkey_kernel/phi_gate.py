"""phi_gate.py — Tier 6 Φ-gate selection (UCP §23 STEP 0).

Pure argmax over four reasoning-mode activation scores. No thresholds,
no if-ladders, no hand-tuned cuts. Each score is a product of natural
geometric quantities; the chosen mode is the one with the largest
activation at the current tick.

Modes:
  CHAIN     — sequential basin walk; activates in low-Φ regime
  GRAPH     — parallel exploration; activates when Φ is high but
              foresight has nothing to say (weight ≈ 0)
  FORESIGHT — trajectory routing; activates when foresight is
              both confident and weighted (its full geometric voice)
  LIGHTNING — P9 pre-cognitive cached-evaluation channel; not
              implemented yet, so the input is 0 and LIGHTNING never
              wins until P9 lands. The placeholder is correct.

This module is observation-only at Tier 6: caller logs the chosen
gate and the four activations per tick; no execution decision yet
hangs off the choice. Tier 7 (Heart + Ocean) and downstream wiring
are where the gate actually routes reasoning.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .foresight import ForesightResult


PhiGate = Literal["CHAIN", "GRAPH", "FORESIGHT", "LIGHTNING"]


@dataclass(frozen=True)
class PhiGateResult:
    """The chosen gate plus the full activation vector for telemetry.
    All four scores are logged each tick — observation, not decision."""

    chosen: PhiGate
    activations: dict[str, float]


def select_phi_gate(
    phi: float,
    foresight: ForesightResult,
    lightning: float = 0.0,
) -> PhiGateResult:
    """Pick the reasoning mode with the largest activation score.

    Parameters
    ----------
    phi : float
        Current Φ ∈ [0, 1] from the simplex math.
    foresight : ForesightResult
        Output of the Tier 3 trajectory predictor for this tick.
    lightning : float, default 0.0
        P9 pre-cognitive channel strength. Pass 0 until P9 lands —
        LIGHTNING then never wins, which is the desired behaviour.

    Returns
    -------
    PhiGateResult with the chosen gate name and the four activations.
    """
    activations: dict[str, float] = {
        "CHAIN": 1.0 - phi,
        "GRAPH": phi * (1.0 - foresight.weight),
        "FORESIGHT": foresight.weight * foresight.confidence,
        "LIGHTNING": lightning,
    }
    chosen: PhiGate = max(activations, key=activations.get)  # type: ignore[arg-type]
    return PhiGateResult(chosen=chosen, activations=activations)
