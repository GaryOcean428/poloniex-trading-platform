"""forecast_horizons.py — qig-warp bridge + screening-based forecast horizons.

MIG-4 (2026-05-16). Replaces two unbounded heuristics in series:
  - hardcoded horizon-decay table ``{1h: 1.0, 4h: 0.85, 24h: 0.70}``
  - linear price extrapolation ``trend_strength * 0.01 * horizon_hours``

with a regime-aware, bounded substitution derived from a single
``qig_warp.WarpBubble.qig_regime(h, J, dim=2)`` call per tick. The bridge
exponent controls amplitude saturation; the screening length controls
the temporal decay of confidence and the saturation horizon.

Calibration surface (the only two operator knobs in the whole forecast
path — both surface in the per-tick derivation block):

  ``QIG_FORECAST_TEMPORAL_SCALE_HOURS``
    Dimensionless lattice ξ → hours conversion. Default 4.0 (calibrated
    for 15m candles). For 5m candles try ~1.5; for 1h candles try ~16.

  ``_AMPLITUDE_FLOOR``
    qig-warp's bridge exponent goes to 0 at the ORDERED regime
    (steady-state — no further amplification of the dynamical
    timescale). That is correct physics. But "no further amplification"
    does not mean "trends can't be extrapolated"; trending markets are
    the EASIEST to forecast linearly. The floor of 0.5 at ORDERED
    preserves trend extrapolation in a regime the bridge exponent
    alone would silence. This is a calibration override, not a
    frozen-fact derivation.

Path 2 (qig-compute observable governance) is folded in: the forecast
output is run through ``check_amplitude`` and ``check_regime_coverage``
before being returned. Critical findings downgrade confidence by 30
(floor 10); the warnings surface in the derivation block.

Fail-soft: if ``WarpBubble.qig_regime`` raises, every horizon returns
a NEUTRAL forecast at confidence 10 — the tick handler MUST NOT raise.
"""

from __future__ import annotations

import logging
import math
import os
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from typing import Any, Sequence

logger = logging.getLogger(__name__)


# ── Calibration surface (exactly two operator knobs) ─────────────

_TEMPORAL_SCALE_H = float(
    os.environ.get("QIG_FORECAST_TEMPORAL_SCALE_HOURS", "4.0"),
)

# Amplitude floors by qig_warp.Regime.value. Preserves trend
# extrapolation when α=0 (ORDERED). Calibration override; not derived
# from QIG frozen facts.
_AMPLITUDE_FLOOR: dict[str, float] = {
    "ordered":    0.5,
    "critical":   1.0,
    "disordered": 0.2,
}
_AMPLITUDE_FLOOR_DEFAULT = 0.3


# ── Non-tunable bounds (constants, not calibration) ──────────────

_CONFIDENCE_NEUTRAL_FLOOR = 45   # below this → direction forced to NEUTRAL
_XI_T_FLOOR_HOURS = 0.5          # min coherence horizon (avoid 1/0)
_GOVERNANCE_PENALTY = 30         # confidence downgrade on CRITICAL severity
_GOVERNANCE_FLOOR = 10           # absolute confidence floor after penalty
_CONFIDENCE_CEILING = 95
_REGIME_HISTORY_LEN = 50         # per-symbol rolling buffer for regime coverage
_AMPLITUDE_THRESHOLD = 10.0      # check_amplitude ratio threshold


# ── Per-symbol rolling regime history (for check_regime_coverage) ──

_HISTORY_LOCK = Lock()
_REGIME_HISTORY: dict[str, deque[float]] = defaultdict(
    lambda: deque(maxlen=_REGIME_HISTORY_LEN),
)


def _record_h(symbol: str, h_value: float) -> list[float]:
    """Append ``h`` to the per-symbol rolling buffer, return a snapshot."""
    with _HISTORY_LOCK:
        _REGIME_HISTORY[symbol].append(float(h_value))
        return list(_REGIME_HISTORY[symbol])


def _reset_history(symbol: str | None = None) -> None:
    """Test helper — clear regime history for one symbol or all."""
    with _HISTORY_LOCK:
        if symbol is None:
            _REGIME_HISTORY.clear()
        else:
            _REGIME_HISTORY.pop(symbol, None)


# ── Output shapes ────────────────────────────────────────────────


@dataclass(frozen=True)
class HorizonForecast:
    """Per-horizon triple. Wire-compatible with the legacy response."""
    price: float
    confidence: int
    direction: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "price": self.price,
            "confidence": self.confidence,
            "direction": self.direction,
        }


@dataclass(frozen=True)
class ForecastBundle:
    """Multi-horizon forecast + a derivation block.

    The derivation block lets the operator reproduce a forecast by hand
    by reading a single ``/ml/predict`` response — no separate endpoint
    is needed for forecast introspection. Per directive acceptance
    criterion 5.
    """
    horizons: dict[str, HorizonForecast]
    derivation: dict[str, Any]


# ── Core entry point ─────────────────────────────────────────────


def compute_forecast(
    *,
    symbol: str,
    current_price: float,
    direction: str,                 # BULLISH / BEARISH / NEUTRAL (MIG-3)
    confidence_raw: float,          # [0, 1] from RegimeAdapter
    trend_strength: float,          # J = |mean/std| of returns (RegimeState)
    entropy: float,                 # h = Shannon entropy of returns (RegimeState)
    horizons: dict[str, int] | None = None,
) -> ForecastBundle:
    """Build the multi-horizon forecast bundle.

    Exactly one ``WarpBubble.qig_regime`` call per tick; all three
    horizons derive from the same xi / alpha / regime. No hardcoded
    decay factors and no linear extrapolation literals — see module
    docstring for the substitution semantics.
    """
    if horizons is None:
        horizons = {"1h": 1, "4h": 4, "24h": 24}

    # ── qig-warp constants in one call ──────────────────────────
    xi: float
    alpha: float
    regime_label: str
    try:
        from qig_warp import WarpBubble  # type: ignore[import-not-found]
        bubble = WarpBubble.qig_regime(h=entropy, J=trend_strength, dim=2)
        xi = float(bubble.rules.screening_length)
        alpha = float(bubble.rules.bridge_exponent)
        rc = bubble.regime
        regime_label = (
            getattr(rc.regime, "value", str(rc.regime))
            if rc is not None else "unknown"
        )
    except Exception as exc:  # noqa: BLE001 — tick handler must not raise
        logger.warning(
            "[forecast_horizons] WarpBubble.qig_regime failed (h=%.3f J=%.3f): %s",
            entropy, trend_strength, exc,
        )
        return _neutral_bundle(
            current_price=current_price, horizons=horizons,
            derivation={
                "error": f"qig_warp.WarpBubble.qig_regime raised: "
                         f"{type(exc).__name__}: {exc}",
                "h": entropy, "J": trend_strength,
            },
        )

    xi_t = max(xi * _TEMPORAL_SCALE_H, _XI_T_FLOOR_HOURS)
    amplitude = max(alpha, _AMPLITUDE_FLOOR.get(regime_label, _AMPLITUDE_FLOOR_DEFAULT))
    amplitude_floor_applied = amplitude != alpha

    sign = {"BULLISH": 1.0, "BEARISH": -1.0}.get(direction, 0.0)
    confidence_pct = int(min(max(confidence_raw * 100.0, 0), _CONFIDENCE_CEILING))

    horizons_out: dict[str, HorizonForecast] = {}
    horizon_decays: dict[str, float] = {}
    for label, hours in horizons.items():
        decay = math.exp(-hours / xi_t)
        horizon_decays[label] = decay
        h_conf = int(min(
            max(confidence_pct * decay, _GOVERNANCE_FLOOR),
            _CONFIDENCE_CEILING,
        ))
        h_dir = direction if h_conf >= _CONFIDENCE_NEUTRAL_FLOOR else "NEUTRAL"
        h_sign = sign if h_dir != "NEUTRAL" else 0.0
        pct = (
            h_sign * amplitude * trend_strength * 0.01 * xi_t
            * (1.0 - math.exp(-hours / xi_t))
        )
        predicted = round(current_price * (1.0 + pct), 8)
        horizons_out[label] = HorizonForecast(
            price=predicted, confidence=h_conf, direction=h_dir,
        )

    # ── qig-compute governance (Path 2 wrapper) ───────────────
    history = _record_h(symbol, entropy)
    governance_summary, governance_penalty_applied = _apply_governance(
        horizons_out=horizons_out,
        current_price=current_price,
        regime_history_h=history,
        trend_strength=trend_strength,
    )

    derivation: dict[str, Any] = {
        "regime": regime_label,
        "h": float(entropy),
        "J": float(trend_strength),
        "xi": xi,
        "alpha": alpha,
        "xi_temporal_hours": xi_t,
        "temporal_scale_env": _TEMPORAL_SCALE_H,
        "amplitude": amplitude,
        "amplitude_floor_applied": amplitude_floor_applied,
        "horizon_decays": horizon_decays,
        "governance": governance_summary,
        "governance_penalty_applied": governance_penalty_applied,
        "regime_history_len": len(history),
    }

    # MIG-4 mutates horizons_out in place via _apply_governance — re-snapshot
    return ForecastBundle(horizons=dict(horizons_out), derivation=derivation)


# ── Helpers ──────────────────────────────────────────────────────


def _neutral_bundle(
    *,
    current_price: float,
    horizons: dict[str, int],
    derivation: dict[str, Any],
) -> ForecastBundle:
    """Emit a NEUTRAL bundle for every horizon — used on qig-warp failure."""
    return ForecastBundle(
        horizons={
            label: HorizonForecast(
                price=current_price,
                confidence=_GOVERNANCE_FLOOR,
                direction="NEUTRAL",
            )
            for label in horizons
        },
        derivation=derivation,
    )


def _apply_governance(
    *,
    horizons_out: dict[str, HorizonForecast],
    current_price: float,
    regime_history_h: list[float],
    trend_strength: float,
) -> tuple[dict[str, Any] | None, bool]:
    """Run qig-compute observable checks; downgrade confidence on CRITICAL.

    Returns (summary_dict_or_None, penalty_applied).
    """
    try:
        from qig_compute.observable import (  # type: ignore[import-not-found]
            GovernanceReport,
            check_amplitude, check_observable_proxy, check_regime_coverage,
        )
    except Exception as exc:  # noqa: BLE001 — governance is best-effort
        logger.debug("[forecast_horizons] qig_compute.observable unavailable: %s", exc)
        return None, False

    report = GovernanceReport()

    # AMPLITUDE: catch pathological cross-horizon spread.
    price_changes = [
        hf.price - current_price for hf in horizons_out.values()
    ]
    warning = check_amplitude(price_changes, threshold_ratio=_AMPLITUDE_THRESHOLD)
    if warning is not None:
        report.add(warning)

    # OBSERVABLE PROXY: structural sanity check that we're not using the
    # wrong observable. Price-on-homogeneous never matches the
    # magnetisation-on-inhomogeneous failure mode this detector targets,
    # so the call is defensive (a non-None return would surface a
    # physics-level mismatch — never expected here, but worth surfacing).
    warning = check_observable_proxy(
        observable="price",
        coupling_structure="homogeneous",
    )
    if warning is not None:
        report.add(warning)

    # REGIME COVERAGE: surface if all recent h values stayed in one regime.
    if len(regime_history_h) >= 5:
        # J floor avoids div-by-zero inside check_regime_coverage's ratio.
        warning = check_regime_coverage(
            list(regime_history_h),
            J=max(float(trend_strength), 1e-6),
        )
        if warning is not None:
            report.add(warning)

    penalty_applied = False
    if report.has_critical:
        penalty_applied = True
        for label, hf in list(horizons_out.items()):
            new_conf = max(
                hf.confidence - _GOVERNANCE_PENALTY, _GOVERNANCE_FLOOR,
            )
            new_dir = hf.direction if new_conf >= _CONFIDENCE_NEUTRAL_FLOOR else "NEUTRAL"
            horizons_out[label] = HorizonForecast(
                price=hf.price, confidence=new_conf, direction=new_dir,
            )

    summary: dict[str, Any] | None = None
    if report.warnings:
        summary = {
            "warnings": [
                {
                    "id": w.id,
                    "severity": w.severity.name,
                    "message": w.message,
                }
                for w in report.warnings
            ],
            "has_critical": report.has_critical,
            "has_warnings": report.has_warnings,
        }

    return summary, penalty_applied
