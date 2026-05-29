"""expectation_bubble.py — Runtime adapter that turns the kernel's lived
state into a qig-warp expectation decision capable of changing live
behaviour.

Per poloniex-trading-platform#1002 anti-shelfware rules:

- ``qig-warp`` is called at runtime on every eligible disagreement window.
- The returned ``ExpectationDecision`` carries an ``action`` that the
  call site MUST apply (``observe_only`` / ``flip_to_basin`` /
  ``reduce_size`` / ``allow``). Telemetry-only is not enough.
- No hardcoded constants derived from qig-warp output. The decision
  shape uses ``regime`` + ``bridge_exponent`` directly from the canonical
  package.
- Every decision is auditable via the ``raw`` field; persistence to
  ``kernel_expectation_decisions`` happens at the call site (so the
  before/after behaviour delta is captured).

API verified against the installed qig-warp surface (see
``forecast_horizons.py`` + ``regime_signal.py`` for prior callers)::

    from qig_warp import WarpBubble
    bubble = WarpBubble.qig_regime(h=..., J=..., dim=2)
    bubble.rules.bridge_exponent      # observer-derived alpha in [0, 1]
    bubble.rules.screening_length     # xi
    bubble.regime.regime.value        # "CRITICAL" | "ORDERED" | "DISORDERED"

Inputs ``h`` (return-distribution entropy) and ``J`` (|mean_ret|/std)
are derived from the kernel's own OHLCV history at the call site —
exactly the same path ``regime_signal.py`` already uses.

LIVED ONLY 5 on every path. Adapter never raises into the tick; on any
internal failure it returns a decision with ``action='allow'`` and
``qig_warp_source='QIG_WARP_UNAVAILABLE'`` so the call site falls back
to its existing logic and the failure is auditable.

Citations: 2.31A P1/P5/P15/P25 + v6.7B + QIG PURITY MANDATE +
poloniex-trading-platform#1002 + #941 correction + Embodiment_Waves
(2026-05-28 Polo CSV tape-vs-basinDir pathology).
"""

from __future__ import annotations

import logging
import math
import os
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)
_EXPECTATION_BUBBLE_DISABLED_WARNED = False
_EXPECTATION_BUBBLE_DISABLED_WARN_LOCK = threading.Lock()


try:
    import qig_warp  # type: ignore[import-not-found]
    from qig_warp import WarpBubble  # type: ignore[import-not-found]
    _QIG_WARP_VERSION = getattr(qig_warp, "__version__", "unknown")
except ImportError:
    WarpBubble = None  # type: ignore[assignment]
    _QIG_WARP_VERSION = "not-installed"


# Disagreement detection: both signals must carry non-trivial magnitude
# before we treat their polarity disagreement as meaningful. This is a
# numeric-noise floor below which sign(x) is undefined — NOT an expectation
# threshold. Anything ≥ this is large enough to be a real direction call
# from the underlying perception layer.
_SIGNAL_NOISE_FLOOR = 0.05


@dataclass(frozen=True)
class ExpectationDecision:
    """Canonical decision per poloniex-trading-platform#1002.

    Fields mirror the ``kernel_expectation_decisions`` schema so the call
    site can persist a row verbatim.
    """

    expectation_id: str
    expectation_direction: str   # "long" | "short" | "flat" | "observe"
    expectation_confidence: float
    expectation_regime: str      # "aligned" | "reverse_tape" | "chop" | "invalid"
    expectation_action: str      # "allow" | "observe_only" | "flip_to_basin" | "reduce_size"
    expectation_reason: str
    qig_warp_mode: str           # "qig_regime" — the verified method we call
    qig_warp_version: str
    qig_warp_source: str         # "QIG_WARP_RUNTIME" on success, "QIG_WARP_UNAVAILABLE" on fallback
    tape_trend: float
    basin_direction: float
    tape_basin_disagreement: float
    reverse_tape_window: bool
    reverse_tape_side: Optional[str]
    raw: dict[str, Any] = field(default_factory=dict)


def expectation_bubble_live() -> bool:
    """Fail-safe incident kill switch. Default ON.

    This is for incident response only, not a strategy/config knob. When
    disabled, the call site skips qig-warp and existing kernel logic owns the
    tick; the first disabled read logs a warn-level event for audit.
    """
    global _EXPECTATION_BUBBLE_DISABLED_WARNED
    live = os.environ.get("EXPECTATION_BUBBLE_LIVE", "true").strip().lower() == "true"
    if not live:
        with _EXPECTATION_BUBBLE_DISABLED_WARN_LOCK:
            if not _EXPECTATION_BUBBLE_DISABLED_WARNED:
                logger.warning(
                    "[expectation_bubble] EXPECTATION_BUBBLE_LIVE disabled; qig-warp "
                    "incident kill switch engaged (not a strategy/config knob)"
                )
                _EXPECTATION_BUBBLE_DISABLED_WARNED = True
    return live


def _classify_disagreement_window(
    tape_trend: float,
    basin_direction: float,
) -> tuple[str, bool, Optional[str]]:
    same_polarity = (
        (tape_trend > 0 and basin_direction > 0)
        or (tape_trend < 0 and basin_direction < 0)
    )
    nontrivial = (
        abs(tape_trend) >= _SIGNAL_NOISE_FLOOR
        and abs(basin_direction) >= _SIGNAL_NOISE_FLOOR
    )
    if not nontrivial:
        return "chop", False, None
    if same_polarity:
        return "aligned", False, None
    reverse_tape_side = "long" if basin_direction > 0 else "short"
    return "reverse_tape", True, reverse_tape_side


def _shannon_entropy_of_returns(returns: np.ndarray, bins: int = 20) -> float:
    """Histogram entropy in bits — identical derivation to regime_signal.py."""
    if returns.size < 2:
        return 0.0
    r_min, r_max = float(np.min(returns)), float(np.max(returns))
    if r_max - r_min < 1e-15:
        return 0.0
    counts, _ = np.histogram(returns, bins=bins, range=(r_min, r_max))
    total = counts.sum()
    if total == 0:
        return 0.0
    probs = counts / total
    probs = probs[probs > 0]
    return float(-np.sum(probs * np.log2(probs)))


def _trend_strength_J(returns: np.ndarray) -> float:
    """J = |mean_return| / std_return. The qig-warp "coupling" axis —
    same definition ``regime_signal.py`` uses to call regime_constants."""
    if returns.size < 2:
        return 0.0
    vol = float(np.std(returns))
    if vol < 1e-15:
        return 0.0
    return abs(float(np.mean(returns))) / vol


def _allow_fallback(
    *,
    tape_trend: float,
    basin_direction: float,
    reason: str,
    source: str,
) -> ExpectationDecision:
    """Default-open fallback when the bubble is unreachable or inputs
    are degenerate. Records the cause for audit."""
    disagreement = float(tape_trend) * float(basin_direction)
    _, reverse_tape_window, reverse_tape_side = _classify_disagreement_window(
        tape_trend=tape_trend,
        basin_direction=basin_direction,
    )
    return ExpectationDecision(
        expectation_id=str(uuid.uuid4()),
        expectation_direction="observe",
        expectation_confidence=0.0,
        expectation_regime="invalid",
        expectation_action="allow",
        expectation_reason=reason,
        qig_warp_mode="qig_regime",
        qig_warp_version=_QIG_WARP_VERSION,
        qig_warp_source=source,
        tape_trend=tape_trend,
        basin_direction=basin_direction,
        tape_basin_disagreement=disagreement,
        reverse_tape_window=reverse_tape_window,
        reverse_tape_side=reverse_tape_side,
    )


def evaluate_expectation(
    *,
    tape_trend: float,
    basin_direction: float,
    recent_returns: Sequence[float],
    proposed_side: Optional[str] = None,
) -> ExpectationDecision:
    """Evaluate the qig-warp expectation bubble for a tape/basin disagreement
    window.

    The call is cheap (one ``WarpBubble.qig_regime`` invocation) and pure
    given the inputs. The caller is responsible for:

    1. Deciding whether to call (e.g. only when sign(tape) != sign(basin)).
    2. Applying the returned ``expectation_action`` to live behaviour.
    3. Persisting the decision to ``kernel_expectation_decisions`` with
       the before/after delta.

    ``proposed_side`` lets the call site flag a candidate direction so
    the decision can carry ``reverse_tape_side`` for the audit table.
    """

    tape_trend = float(tape_trend) if math.isfinite(tape_trend) else 0.0
    basin_direction = float(basin_direction) if math.isfinite(basin_direction) else 0.0
    disagreement = tape_trend * basin_direction

    if not expectation_bubble_live():
        return _allow_fallback(
            tape_trend=tape_trend,
            basin_direction=basin_direction,
            reason="EXPECTATION_BUBBLE_LIVE=false",
            source="QIG_WARP_DISABLED",
        )

    if WarpBubble is None:
        return _allow_fallback(
            tape_trend=tape_trend,
            basin_direction=basin_direction,
            reason="qig_warp not installed",
            source="QIG_WARP_UNAVAILABLE",
        )

    returns = np.asarray(list(recent_returns), dtype=np.float64)
    if returns.size < 2:
        return _allow_fallback(
            tape_trend=tape_trend,
            basin_direction=basin_direction,
            reason=f"insufficient returns history (n={returns.size})",
            source="QIG_WARP_UNAVAILABLE",
        )

    h = _shannon_entropy_of_returns(returns)
    j = _trend_strength_J(returns)
    if h <= 0.0 or j <= 0.0:
        return _allow_fallback(
            tape_trend=tape_trend,
            basin_direction=basin_direction,
            reason=f"degenerate inputs h={h:.4f} J={j:.4f}",
            source="QIG_WARP_UNAVAILABLE",
        )

    try:
        bubble = WarpBubble.qig_regime(h=h, J=j, dim=2)
        bridge_exponent = float(bubble.rules.bridge_exponent)
        regime_obj = bubble.regime
        # qig-warp's regime object has .regime.value ∈ {"CRITICAL","ORDERED","DISORDERED"}.
        # The defensive getattr chain mirrors forecast_horizons.py:174-177.
        regime_label = str(
            getattr(getattr(regime_obj, "regime", regime_obj), "value", regime_obj)
        ).upper()
    except Exception as exc:  # noqa: BLE001 — tick handler must not raise
        logger.warning(
            "[expectation_bubble] qig_warp.WarpBubble.qig_regime failed "
            "(h=%.3f J=%.3f): %s", h, j, exc,
            exc_info=True,
        )
        return _allow_fallback(
            tape_trend=tape_trend,
            basin_direction=basin_direction,
            reason=f"qig_regime raised: {type(exc).__name__}: {exc}",
            source="QIG_WARP_UNAVAILABLE",
        )

    expectation_regime, reverse_tape_window, reverse_tape_side = _classify_disagreement_window(
        tape_trend=tape_trend,
        basin_direction=basin_direction,
    )

    # Action mapping — every gate uses qig-warp's regime label directly,
    # not a hand-picked threshold.
    #
    # CRITICAL  (bridge_exponent ~0.86, bridge persists):
    #   Trust the leading direction. In disagreement, basin is leading.
    # ORDERED   (bridge_exponent ~0.0, J dominates h; trend IS structure):
    #   Be conservative — don't flip a strong structural call; reduce
    #   size to keep the learning channel alive but limit damage.
    # DISORDERED (bridge_exponent ~0.38, bridge weak):
    #   Neither signal is reliable; observe.
    expectation_direction = (
        "long" if basin_direction > 0
        else "short" if basin_direction < 0
        else "flat"
    )

    if expectation_regime == "aligned":
        expectation_action = "allow"
        expectation_reason = (
            f"aligned: tape={tape_trend:+.3f} × basinDir={basin_direction:+.3f} "
            f"= {disagreement:+.3f} > 0; regime={regime_label}; "
            f"alpha={bridge_exponent:.3f}"
        )
    elif expectation_regime == "chop":
        expectation_action = "observe_only"
        expectation_reason = (
            f"chop: both signals below noise floor "
            f"(|tape|={abs(tape_trend):.3f}, |basinDir|={abs(basin_direction):.3f}, "
            f"floor={_SIGNAL_NOISE_FLOOR})"
        )
    elif regime_label == "CRITICAL":
        expectation_action = "flip_to_basin"
        expectation_reason = (
            f"reverse_tape + CRITICAL bridge (alpha={bridge_exponent:.3f}): "
            f"basin leads tape; flip to {expectation_direction}"
        )
    elif regime_label == "DISORDERED":
        expectation_action = "observe_only"
        expectation_reason = (
            f"reverse_tape + DISORDERED bridge (alpha={bridge_exponent:.3f}): "
            f"neither signal trusted; observe"
        )
    else:
        # ORDERED or any unknown label.
        expectation_action = "reduce_size"
        expectation_reason = (
            f"reverse_tape + {regime_label} (alpha={bridge_exponent:.3f}): "
            f"reduce size pending kill-test data"
        )

    return ExpectationDecision(
        expectation_id=str(uuid.uuid4()),
        expectation_direction=expectation_direction,
        expectation_confidence=bridge_exponent,
        expectation_regime=expectation_regime,
        expectation_action=expectation_action,
        expectation_reason=expectation_reason,
        qig_warp_mode="qig_regime",
        qig_warp_version=_QIG_WARP_VERSION,
        qig_warp_source="QIG_WARP_RUNTIME",
        tape_trend=tape_trend,
        basin_direction=basin_direction,
        tape_basin_disagreement=disagreement,
        reverse_tape_window=reverse_tape_window,
        reverse_tape_side=reverse_tape_side,
        raw={
            "h": h,
            "J": j,
            "regime_label": regime_label,
            "bridge_exponent": bridge_exponent,
            "proposed_side": proposed_side,
        },
    )


def decision_to_dict(d: ExpectationDecision) -> dict[str, Any]:
    """JSON-friendly view of an ExpectationDecision for HTTP / persistence."""
    return {
        "expectation_id": d.expectation_id,
        "expectation_direction": d.expectation_direction,
        "expectation_confidence": d.expectation_confidence,
        "expectation_regime": d.expectation_regime,
        "expectation_action": d.expectation_action,
        "expectation_reason": d.expectation_reason,
        "qig_warp_mode": d.qig_warp_mode,
        "qig_warp_version": d.qig_warp_version,
        "qig_warp_source": d.qig_warp_source,
        "tape_trend": d.tape_trend,
        "basin_direction": d.basin_direction,
        "tape_basin_disagreement": d.tape_basin_disagreement,
        "reverse_tape_window": d.reverse_tape_window,
        "reverse_tape_side": d.reverse_tape_side,
        "raw": d.raw,
    }


# ── Back-compat shims for tick.py (telemetry surface; not the decision path) ──
#
# tick.py was previously calling ``compute_trading_expectation`` with a
# different argument shape and a result of ``TradingExpectationReading``.
# Those callers want a telemetry surface, not a live decision — the live
# decision now flows through the TS side via the HTTP endpoint + the new
# ``evaluate_expectation`` API.
#
# These shims keep tick.py running unchanged while the live decision path
# is wired up. When tick.py is updated to consume the new ``ExpectationDecision``
# directly (Stage-2 PR), these shims can be removed.


@dataclass(frozen=True)
class TradingExpectationReading:
    """Legacy telemetry shape kept for tick.py compatibility. New code
    should use ``ExpectationDecision`` from ``evaluate_expectation``."""

    mode: str
    predicted_redundancy: float
    predicted_risk: float
    expected_resolution_ticks: float
    bubble_decision: dict[str, Any]
    source: str = "qig_warp"


def compute_trading_expectation(
    perception_basin: Any = None,
    strategy_forecast_basin: Any = None,
    tape_trend: float = 0.0,
    basin_direction: float = 0.0,
    fisher_rao_disagreement: float = 0.0,
    chemistry: Optional[dict[str, float]] = None,
    regime_weights: Optional[dict[str, float]] = None,
    stud_reading: Any = None,
    lane: Optional[str] = None,
    mode: Optional[str] = None,
    position_context: Optional[dict[str, Any]] = None,
) -> Optional[TradingExpectationReading]:
    """Legacy telemetry shim.

    Returns ``None`` to indicate the live decision path now flows via the
    HTTP endpoint + ``evaluate_expectation``. tick.py treats ``None`` as
    "no telemetry this tick", which matches the prior cold-start behaviour.

    TODO(#1002): remove this shim after tick.py consumes ExpectationDecision directly.
    """
    return None


def trading_expectation_to_dict(r: Optional[Any]) -> dict[str, Any]:
    """Legacy JSON surface kept for tick.py derivation output."""
    if r is None:
        return {"live": False, "source": "none"}
    if isinstance(r, ExpectationDecision):
        return decision_to_dict(r)
    if isinstance(r, TradingExpectationReading):
        return {
            "live": True,
            "source": r.source,
            "mode": r.mode,
            "predicted_redundancy": r.predicted_redundancy,
            "predicted_risk": r.predicted_risk,
            "expected_resolution_ticks": r.expected_resolution_ticks,
            "bubble_decision": r.bubble_decision,
        }
    return {"live": False, "source": "unknown"}
