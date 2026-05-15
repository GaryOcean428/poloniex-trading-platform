"""regime_shadow.py — shadow-mode parity probe for issue #695.

The bespoke ``RegimeDetector`` in ``regime.py`` produces a
``MarketRegime`` (CREATOR / PRESERVER / DISSOLVER) from Shannon entropy
+ trend strength. The published ``qig_warp.classify_regime(h, J, dim)``
produces a physics ``Regime`` (CRITICAL / DISORDERED / ORDERED) from
lattice transverse field ``h`` + coupling ``J``.

This module runs the published classifier in parallel with the live
one and logs the diff so the operator has evidence to promote (or
reject) the swap. The live trading path is unaffected — every call
here is fire-and-forget with broad exception handling, and the live
``MarketRegime`` continues to drive ``_regime_to_direction``.

Shadow only. Per the #689 discipline (translation-only PRs, parity
gating before cutover), the swap itself ships in a separate PR once
the parity-log accumulates a representative tape window.

Market → physics mapping (calibration v0, deliberately first-order
so the parity-log surfaces calibration error as a measurable signal):

  h  ← regime_state.entropy            (Shannon entropy of return distribution
                                        — analogue of disorder pressure)
  J  ← regime_state.trend_strength     (|mean / std| of returns
                                        — analogue of coupling strength)
  dim = 2                              (futures order-book is effectively 2D
                                        — bid + ask depth; matches the
                                        2D critical_ratio in qig_warp)

The mapping is intentionally a 1:1 metric-to-metric port; if it turns
out h or J need a scale factor (e.g. h × C_h, J × C_J) to land in the
range where qig_warp's CRITICAL_RATIO_2D is meaningful, the parity-log
distribution will show DISORDERED-only or ORDERED-only outputs, and
the cutover PR re-calibrates from there.

This module never raises. Any failure path returns ``None`` and is
recorded as a parity row with ``shadow_error`` populated.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from .regime import MarketRegime, RegimeState

logger = logging.getLogger(__name__)

# Module-local parity log. Same ring-buffer pattern as main.py's
# _PARITY_LOG / _record_parity but scoped to regime-shadow rows so
# the existing /governance/ml-predict-parity log isn't polluted.
_REGIME_PARITY_LOG: list[dict[str, Any]] = []
_REGIME_PARITY_LOG_MAX = 2_000
_REGIME_PARITY_LOG_LOCK = threading.Lock()


def _record_regime_parity(row: dict[str, Any]) -> None:
    """Append a parity-comparison row. Bounded ring buffer (FIFO eviction
    when full — drops the oldest 10% in one shot to amortise cost)."""
    with _REGIME_PARITY_LOG_LOCK:
        _REGIME_PARITY_LOG.append(row)
        if len(_REGIME_PARITY_LOG) > _REGIME_PARITY_LOG_MAX:
            del _REGIME_PARITY_LOG[: _REGIME_PARITY_LOG_MAX // 10]


def get_regime_parity_log() -> list[dict[str, Any]]:
    """Snapshot copy of the current parity log. Safe to call from any
    thread; returns a list copy, not the underlying buffer."""
    with _REGIME_PARITY_LOG_LOCK:
        return list(_REGIME_PARITY_LOG)


def shadow_classify(
    regime_state: Optional[RegimeState],
    symbol: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Run ``qig_warp.classify_regime`` against the live ``RegimeState``
    and emit a parity row. Returns the row (also recorded internally)
    or ``None`` when no live state is available.

    Never raises. Any error path returns a row with ``shadow_error``
    populated; the caller still gets a structured log entry.

    Cheap: a single function call into qig_warp + one ring-buffer
    insert. The live ``RegimeDetector.update`` already computed every
    quantity this function consumes — no recomputation of price-series
    statistics.
    """
    if regime_state is None:
        return None

    started = time.monotonic()
    live_regime_value = regime_state.regime.value
    h = float(regime_state.entropy)
    j = float(regime_state.trend_strength)

    shadow_regime: Optional[str] = None
    shadow_error: Optional[str] = None
    try:
        from qig_warp import classify_regime  # type: ignore[import-not-found]
        warp_regime = classify_regime(h=h, J=j, dim=2)
        # WarpRegime is an enum; .value (or .name) gives a stable string.
        shadow_regime = getattr(warp_regime, "value", None) or getattr(warp_regime, "name", str(warp_regime))
    except ImportError as exc:
        shadow_error = f"ImportError: {exc}"
    except Exception as exc:  # noqa: BLE001 — shadow must never break live
        shadow_error = f"{type(exc).__name__}: {exc}"

    row: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "symbol": symbol,
        "live_regime": live_regime_value,
        "shadow_regime": shadow_regime,
        "shadow_error": shadow_error,
        "h": h,
        "J": j,
        "dim": 2,
        # Live-side ancillary metrics — useful when post-hoc analysis
        # wants to see WHICH price-series shape produced a given diff.
        "live_confidence": float(regime_state.confidence),
        "live_volatility": float(regime_state.volatility),
        "live_fisher_info": float(regime_state.fisher_info),
        "live_is_transition": bool(regime_state.is_transition),
        "shadow_latency_ms": round((time.monotonic() - started) * 1000.0, 3),
    }
    _record_regime_parity(row)
    return row


# Compact equivalence map used by post-hoc analysis tooling. Not used
# at runtime — both regimes are logged raw so the operator can re-map.
# Conjectured first-order alignment (to be validated by the live tape):
#   CREATOR    ↔ DISORDERED  (high entropy → disorder)
#   PRESERVER  ↔ ORDERED     (trend present → coupling → order)
#   DISSOLVER  ↔ CRITICAL    (low entropy + no trend → near-critical edge)
SHADOW_EQUIVALENCE_GUESS: dict[str, str] = {
    MarketRegime.CREATOR.value: "DISORDERED",
    MarketRegime.PRESERVER.value: "ORDERED",
    MarketRegime.DISSOLVER.value: "CRITICAL",
}
