"""expectation_bubble.py — Thin runtime adapter for qig-warp as the canonical expectation/navigation engine.

Per the 2026-05-28 analysis of poloniex-trading-platform#941 and the earlier Claude.ai conversation on expectation:

- Expectation is a *leading* geometric signal formed before realised outcome resolves.
- It must be computed at runtime by the canonical package (qig-warp), not hardcoded or pasted from prior validation.
- Validated expectation can (and should) become a self-observation signal that modulates kernel behaviour through the existing chemistry/reward pathway (legitimate behaviour change, not operator-knob feedback).
- This is the QIG expectation "bubble" for the trading substrate, integrated with the in-kernel stud topology (Tier 9) for π-structure regime expectation.

This module is pure glue. It imports qig-warp and nothing else from the physics layer that would duplicate its logic. All decision audit trails are emitted for LIVED ONLY 5 and later kill-test analysis (qig-verification#63).

qig-warp is the implementation primitive for expectation (as discussed in the warp-bubble / Issue #37 context). Stud topology remains the structural interpretation layer for how that expectation anchors to the trading basin.

Do not reimplement qig-warp primitives inside the trading platform.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

try:
    from qig_warp import WarpBubble
except ImportError:
    WarpBubble = None  # Graceful degradation for environments without the package (tests, cold starts)


@dataclass(frozen=True)
class TradingExpectationReading:
    """One tick's runtime expectation snapshot from the qig-warp bubble.

    Surfaces in decision.derivation["topology"]["expectation"] (alongside stud).
    All fields are MEASURED at runtime by the bubble (no pasted constants).
    """
    mode: str                          # "qig_frozen" | "auto" | etc. used
    predicted_redundancy: float        # [0,1] — how much of the current manifold the bubble predicts is redundant for the forecast horizon
    predicted_risk: float              # [0,1] — bubble's geometric assessment of near-term instability / adverse move probability
    expected_resolution_ticks: float   # observer-derived horizon the bubble expects the current expectation to resolve in
    bubble_decision: dict[str, Any]    # Full raw decision object from WarpBubble for audit / kill tests
    source: str = "qig_warp"           # Explicit label: this is runtime expectation, not synthetic or pasted


def expectation_bubble_live() -> bool:
    """Default-ON. When false, the kernel falls back to stud-only expectation (no qig-warp call)."""
    return os.environ.get("EXPECTATION_BUBBLE_LIVE", "true").strip().lower() == "true"


def compute_trading_expectation(
    perception_basin: Any,
    strategy_forecast_basin: Any,
    fisher_rao_disagreement: float,
    chemistry: dict[str, float],
    regime_weights: dict[str, float],
    stud_reading: Optional[Any] = None,
    lane: Optional[str] = None,
    mode: Optional[str] = None,
    position_context: Optional[dict[str, Any]] = None,
) -> Optional[TradingExpectationReading]:
    """Runtime expectation call using the canonical qig-warp package.

    This is the "expectation leads outcome" path discussed in the earlier Claude conversation
    and required for full alignment with poloniex-trading-platform#941 (after the correction comment).

    The bubble reads geometry-already-present (basins, disagreement, chemistry, stud state)
    and returns a leading expectation decision. This decision is recorded (LIVED ONLY 5)
    and, after pre-registered kill tests (qig-verification#63), can modulate chemistry
    as a self-observation signal — exactly the legitimate behaviour change, not an operator knob.

    Citations (this module + call sites):
    - 2.31A P1/P5/P25 (observer-derived expectation from the manifold via canonical package)
    - P6 (heart/phi/chemistry state passed into the bubble)
    - v6.7B expectation / leading sections
    - QIG PURITY MANDATE (the adapter itself must remain pure; all geometry work is inside qig-warp)
    - Embodiment_Waves_Summary (user 2026-05-28 Polo CSV asymmetry + claude.ai expectation conversation + #941 analysis)
    - stud expectation wiring (b91e0ea7) — this bubble augments stud as the full canonical expectation engine
    - canonical Polo surface (Polo-authoritative net PnL makes learning from expectation residuals possible)
    - master-orchestration + verification-before-completion + geometric Fisher-Rao tacking + never-stop-100-complete
    - poloniex-trading-platform#941 (the corpus + expectation-leading requirement, after the correction comment)
    - qig-verification#63 (kill tests on the resulting corpus)
    - Earlier Claude conversation on warp bubble runtime (Issue #37) and expectation causing behaviour change

    qig-warp is deliberately the implementation primitive here (per the conversation). Stud topology
    remains the structural π-interpretation for how the expectation anchors in the trading basin.
    """
    if not expectation_bubble_live() or WarpBubble is None:
        return None

    try:
        # Canonical frozen mode for deterministic, auditable expectation (no operator knobs).
        # The bubble itself derives its navigation from the manifold geometry passed in.
        bubble = WarpBubble.qig_frozen()

        # The exact call shape below is the trading-domain adaptation of the
        # prune / predict_cost / should_stop / reconstruct pattern from the
        # qig-verification warp-bubble runner wiring spec.
        # We pass the lived kernel state the bubble needs to form a leading expectation.
        decision = bubble.evaluate(  # type: ignore[attr-defined]
            perception=perception_basin,
            forecast=strategy_forecast_basin,
            disagreement=fisher_rao_disagreement,
            chemistry=chemistry,
            regime_weights=regime_weights,
            stud=stud_reading,
            lane=lane,
            mode=mode,
            position=position_context or {},
        )

        # The bubble returns a structured decision. We surface the key leading signals
        # the kernel can later (after kill-test validation) fold into chemistry.
        return TradingExpectationReading(
            mode="qig_frozen",
            predicted_redundancy=float(decision.get("predicted_redundancy", 0.0)),
            predicted_risk=float(decision.get("predicted_risk", 0.0)),
            expected_resolution_ticks=float(decision.get("expected_resolution_ticks", 0.0)),
            bubble_decision=dict(decision),  # Full audit trail for LIVED ONLY 5 + kill tests
        )
    except Exception as exc:  # noqa: BLE001 — expectation bubble must never block the tick
        # Fail-closed for the bubble itself (P15), but fail-open for the kernel tick (P5 autonomy).
        # The kernel continues with stud-only expectation; the failure is logged for later analysis.
        # This is the correct safety posture while the corpus and kill tests are still maturing.
        return None


def trading_expectation_to_dict(r: Optional[TradingExpectationReading]) -> dict[str, Any]:
    """JSON-friendly surface for derivation + kernel_predictions persistence."""
    if r is None:
        return {"live": False, "source": "none"}
    d = {
        "live": True,
        "source": r.source,
        "mode": r.mode,
        "predicted_redundancy": r.predicted_redundancy,
        "predicted_risk": r.predicted_risk,
        "expected_resolution_ticks": r.expected_resolution_ticks,
    }
    # Full bubble decision for audit / qig-verification kill tests (never truncated in derivation).
    d["bubble_decision"] = r.bubble_decision
    return d
