"""
observable_governance.py — Detector wrappers around the ensemble predictor.

Per audit 2026-04-21 P2: wire qig-compute's governance detectors to
catch the next "2664 BUYs / 0 SELLs / 0 HOLDs" class of model bias on
day one. Failure modes the detectors catch:

  AMPLITUDE_COLLAPSE   observable amplitude varies > 10× (wrong channel)
  REGIME_SINGLE        only one regime sampled (coverage gap)
  OBSERVABLE_PROXY     the scalar summary masks a deeper distribution

Usage: the ensemble predictor's get_trading_signal pushes each tick's
raw_drift_pct into a GovernanceBuffer. Every N ticks (default 50) the
buffer runs detectors and returns a list of flagged observations.
Callers log them + surface via /monkey/governance/status.

Purity: this module does NOT touch basin coordinates. It operates on
scalar ensemble outputs (amplitudes, regime labels). Therefore NOT
under the qig_purity_check ML-prediction allowlist — but we still
avoid Euclidean vector ops as a defensive practice.

Graceful degradation: if qig-compute is not installed, detectors
return empty lists and log a one-time warning.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("observable_governance")

# Import qig-compute detectors lazily / defensively.
_GOVERNANCE_AVAILABLE = False
_check_amplitude = None
_check_regime_coverage = None
try:
    from qig_compute import check_amplitude, check_regime_coverage  # type: ignore
    _check_amplitude = check_amplitude
    _check_regime_coverage = check_regime_coverage
    _GOVERNANCE_AVAILABLE = True
    logger.info("qig-compute governance detectors loaded")
except ImportError as exc:
    logger.warning(
        "qig-compute not installed; governance detectors will no-op "
        "(base wheel: pip install qig-compute). Reason: %s",
        exc,
    )


@dataclass
class GovernanceBuffer:
    """Ring buffers of recent ensemble observables.

    Fields:
      raw_drift_pct      — mean signed predicted return, per tick
      signal_str         — final signal string ('BUY'/'SELL'/'HOLD')
      regime             — MarketRegime label from RegimeAdapter
      bridge_exponent    — qig-warp α (MIG-5)
      screening_length   — qig-warp ξ (MIG-5)
      warp_regime        — qig-warp Regime.value (MIG-5)
      gr_direction       — qig-warp gr_direction (MIG-5)
      regime_confidence  — qig-warp RegimeConstants.confidence (MIG-5)
    """

    capacity: int = 200
    raw_drift_pct: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    signal_str: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    regime: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    bridge_exponent: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    screening_length: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    warp_regime: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    gr_direction: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    regime_confidence: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    # Diagnostic (2026-05-17): the raw (h, J) lattice inputs that
    # qig_warp.regime_constants was called with. Critical for
    # diagnosing scale mismatches between market data and qig_warp's
    # physics-calibrated h_c=3.044J threshold. If h/J consistently
    # exceeds 3.65 the system pins to DISORDERED regardless of market
    # activity — operator watches the rolling h, J stats in
    # warp_telemetry to confirm whether the inputs themselves vary or
    # whether the qig_warp output is being quantized away.
    h_input: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    j_input: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    # Unbounded monotonic tick counter (2026-05-17). The rolling buffers
    # above cap at ``capacity`` so ``len(deque)`` plateaus at 200 once
    # full and can no longer signal freshness — external freshness
    # checks must use this counter instead. Incremented once per
    # successful ``record()`` call.
    tick_count_total: int = 0

    def record(
        self,
        *,
        raw_drift_pct: float,
        signal: str,
        regime: Optional[str] = None,
        bridge_exponent: Optional[float] = None,
        screening_length: Optional[float] = None,
        warp_regime: Optional[str] = None,
        gr_direction: Optional[str] = None,
        regime_confidence: Optional[str] = None,
        h_input: Optional[float] = None,
        j_input: Optional[float] = None,
    ) -> None:
        self.tick_count_total += 1
        self.raw_drift_pct.append(float(raw_drift_pct))
        self.signal_str.append(str(signal))
        if regime is not None:
            self.regime.append(str(regime))
        if bridge_exponent is not None:
            self.bridge_exponent.append(float(bridge_exponent))
        if screening_length is not None:
            self.screening_length.append(float(screening_length))
        if warp_regime is not None:
            self.warp_regime.append(str(warp_regime))
        if gr_direction is not None:
            self.gr_direction.append(str(gr_direction))
        if regime_confidence is not None:
            self.regime_confidence.append(str(regime_confidence))
        if h_input is not None:
            self.h_input.append(float(h_input))
        if j_input is not None:
            self.j_input.append(float(j_input))


@dataclass
class GovernanceReport:
    available: bool
    sample_count: int             # current rolling-buffer length (caps at capacity)
    tick_count_total: int         # unbounded monotonic — use this for freshness
    amplitude_violations: list[dict[str, Any]]
    regime_violations: list[dict[str, Any]]
    # Local heuristic checks (always run, even without qig-compute)
    signal_distribution: dict[str, int]
    directional_bias_ratio: float  # |BUY - SELL| / total in [0, 1]
    drift_mean: float
    drift_stddev: float
    # MIG-5: qig-warp regime telemetry surface
    warp_telemetry: dict[str, Any] = field(default_factory=dict)


def run_governance_check(buf: GovernanceBuffer) -> GovernanceReport:
    """One-shot audit of the current buffer contents.

    Returns a GovernanceReport — always populated with local
    heuristics. qig-compute detectors fill the amplitude/regime
    violation arrays when the package is available.
    """
    samples = list(buf.raw_drift_pct)
    signals = list(buf.signal_str)
    regimes = list(buf.regime)
    n = len(samples)

    # Signal distribution + directional-bias local heuristic.
    dist: dict[str, int] = {}
    for s in signals:
        dist[s] = dist.get(s, 0) + 1
    buy = dist.get("BUY", 0)
    sell = dist.get("SELL", 0)
    total_directional = buy + sell
    bias = abs(buy - sell) / total_directional if total_directional > 0 else 0.0

    # Drift mean / stddev — catches the "drift persistently >0" case
    # that was the 2664-BUY root symptom.
    import numpy as _np

    drift_arr = _np.asarray(samples, dtype=_np.float64) if samples else _np.empty(0)
    drift_mean = float(drift_arr.mean()) if drift_arr.size > 0 else 0.0
    drift_std = float(drift_arr.std()) if drift_arr.size > 1 else 0.0

    amplitude_violations: list[dict[str, Any]] = []
    regime_violations: list[dict[str, Any]] = []

    if _GOVERNANCE_AVAILABLE and _check_amplitude is not None and n >= 10:
        try:
            result = _check_amplitude(samples)
            # qig-compute conventions: either returns list of violations,
            # a bool, or an object with .violations. Handle defensively.
            if isinstance(result, list):
                amplitude_violations.extend(result)
            elif hasattr(result, "violations"):
                amplitude_violations.extend(list(result.violations))
            elif result:
                amplitude_violations.append({"type": "AMPLITUDE_COLLAPSE", "raw": str(result)})
        except Exception as exc:
            logger.debug("check_amplitude raised: %s", exc)

    if _GOVERNANCE_AVAILABLE and _check_regime_coverage is not None and regimes:
        try:
            unique_regimes = set(regimes)
            result = _check_regime_coverage(regimes, J=len(unique_regimes) or 1)
            if isinstance(result, list):
                regime_violations.extend(result)
            elif hasattr(result, "violations"):
                regime_violations.extend(list(result.violations))
            elif result:
                regime_violations.append({"type": "REGIME_SINGLE", "raw": str(result)})
        except Exception as exc:
            logger.debug("check_regime_coverage raised: %s", exc)

    # Local AMPLITUDE_COLLAPSE heuristic even when qig-compute absent:
    # |drift_mean| > 3 × drift_std = systematically one-sided.
    if drift_std > 0 and abs(drift_mean) > 3.0 * drift_std and n >= 20:
        amplitude_violations.append({
            "type": "AMPLITUDE_COLLAPSE_LOCAL",
            "drift_mean": drift_mean,
            "drift_stddev": drift_std,
            "n": n,
            "note": "|mean| > 3σ — model output systematically one-sided",
        })

    # Local REGIME_SINGLE heuristic: only one regime seen in ≥ 50 ticks.
    if regimes and len(set(regimes)) == 1 and len(regimes) >= 50:
        regime_violations.append({
            "type": "REGIME_SINGLE_LOCAL",
            "regime": regimes[0],
            "n": len(regimes),
            "note": "Only one regime observed across large window",
        })

    # MIG-5: surface qig-warp regime telemetry rolling state. Mean
    # alpha / xi give an at-a-glance read of "is the bridge strong?
    # are correlations long-ranged?" — physics observables that
    # supplement the distributional bias / regime coverage detectors.
    alphas = list(buf.bridge_exponent)
    xis = list(buf.screening_length)
    warp_regimes = list(buf.warp_regime)
    warp_telemetry: dict[str, Any] = {}
    if alphas:
        alpha_arr = _np.asarray(alphas, dtype=_np.float64)
        warp_telemetry["bridge_exponent"] = {
            "mean": float(alpha_arr.mean()),
            "stddev": float(alpha_arr.std()) if alpha_arr.size > 1 else 0.0,
            "min": float(alpha_arr.min()),
            "max": float(alpha_arr.max()),
            "samples": int(alpha_arr.size),
        }
    if xis:
        xi_arr = _np.asarray(xis, dtype=_np.float64)
        warp_telemetry["screening_length"] = {
            "mean": float(xi_arr.mean()),
            "stddev": float(xi_arr.std()) if xi_arr.size > 1 else 0.0,
            "min": float(xi_arr.min()),
            "max": float(xi_arr.max()),
            "samples": int(xi_arr.size),
        }
    if warp_regimes:
        warp_dist: dict[str, int] = {}
        for label in warp_regimes:
            warp_dist[label] = warp_dist.get(label, 0) + 1
        warp_telemetry["regime_distribution"] = warp_dist
    if buf.gr_direction:
        gr_dist: dict[str, int] = {}
        for label in buf.gr_direction:
            gr_dist[label] = gr_dist.get(label, 0) + 1
        warp_telemetry["gr_direction_distribution"] = gr_dist
    if buf.regime_confidence:
        conf_dist: dict[str, int] = {}
        for label in buf.regime_confidence:
            conf_dist[label] = conf_dist.get(label, 0) + 1
        warp_telemetry["regime_confidence_distribution"] = conf_dist

    # Diagnostic add (2026-05-17): raw (h, J) lattice inputs +
    # their ratio h/J. If h/J consistently exceeds 3.65 the qig_warp
    # classifier pins to DISORDERED; if h/J stddev is tiny the inputs
    # themselves are stuck (not just the regime quantization). h_j_ratio
    # makes the "do we sit above the h_c threshold" question one number
    # the operator can read.
    h_vals = list(buf.h_input)
    j_vals = list(buf.j_input)
    if h_vals:
        h_arr = _np.asarray(h_vals, dtype=_np.float64)
        warp_telemetry["h_input"] = {
            "mean": float(h_arr.mean()),
            "stddev": float(h_arr.std()) if h_arr.size > 1 else 0.0,
            "min": float(h_arr.min()),
            "max": float(h_arr.max()),
            "samples": int(h_arr.size),
        }
    if j_vals:
        j_arr = _np.asarray(j_vals, dtype=_np.float64)
        warp_telemetry["j_input"] = {
            "mean": float(j_arr.mean()),
            "stddev": float(j_arr.std()) if j_arr.size > 1 else 0.0,
            "min": float(j_arr.min()),
            "max": float(j_arr.max()),
            "samples": int(j_arr.size),
        }
    if h_vals and j_vals and len(h_vals) == len(j_vals):
        ratios = []
        for h_v, j_v in zip(h_vals, j_vals):
            if j_v > 1e-12:
                ratios.append(h_v / j_v)
        if ratios:
            r_arr = _np.asarray(ratios, dtype=_np.float64)
            warp_telemetry["h_j_ratio"] = {
                "mean": float(r_arr.mean()),
                "stddev": float(r_arr.std()) if r_arr.size > 1 else 0.0,
                "min": float(r_arr.min()),
                "max": float(r_arr.max()),
                "samples": int(r_arr.size),
                # h_c=3.044 for 2D; DISORDERED above 1.2*h_c=3.65
                "above_disordered_threshold_frac": float(
                    sum(1 for r in ratios if r > 3.653) / len(ratios)
                ),
            }

    return GovernanceReport(
        available=_GOVERNANCE_AVAILABLE,
        sample_count=n,
        tick_count_total=buf.tick_count_total,
        amplitude_violations=amplitude_violations,
        regime_violations=regime_violations,
        signal_distribution=dist,
        directional_bias_ratio=bias,
        drift_mean=drift_mean,
        drift_stddev=drift_std,
        warp_telemetry=warp_telemetry,
    )


# ── Process-global buffer (ml-worker is single-process) ──

_buffer = GovernanceBuffer(capacity=200)


def record_tick(
    *,
    raw_drift_pct: float,
    signal: str,
    regime: Optional[str] = None,
    bridge_exponent: Optional[float] = None,
    screening_length: Optional[float] = None,
    warp_regime: Optional[str] = None,
    gr_direction: Optional[str] = None,
    regime_confidence: Optional[str] = None,
    h_input: Optional[float] = None,
    j_input: Optional[float] = None,
) -> None:
    """Record one tick into the rolling governance buffer.

    MIG-5 (2026-05-16): the bridge_exponent / screening_length /
    warp_regime / gr_direction / regime_confidence fields are the
    qig-warp regime telemetry surface. Callers (RegimeAdapter,
    forecast_horizons.compute_forecast) supply them per tick so the
    /governance/status report can display the rolling distribution
    alongside the existing distributional-bias detectors.

    Diagnostic add (2026-05-17): h_input / j_input let the operator
    see the raw lattice inputs qig_warp was called with — surfaces
    scale-mismatch issues where h/J consistently exceeds 3.65 and
    pins the regime to DISORDERED regardless of market activity.
    """
    _buffer.record(
        raw_drift_pct=raw_drift_pct,
        signal=signal,
        regime=regime,
        bridge_exponent=bridge_exponent,
        screening_length=screening_length,
        warp_regime=warp_regime,
        gr_direction=gr_direction,
        regime_confidence=regime_confidence,
        h_input=h_input,
        j_input=j_input,
    )


def report() -> GovernanceReport:
    return run_governance_check(_buffer)


def report_as_dict() -> dict[str, Any]:
    r = report()
    return {
        "available": r.available,
        "sample_count": r.sample_count,
        "tick_count_total": r.tick_count_total,
        "amplitude_violations": r.amplitude_violations,
        "regime_violations": r.regime_violations,
        "signal_distribution": r.signal_distribution,
        "directional_bias_ratio": r.directional_bias_ratio,
        "drift_mean": r.drift_mean,
        "drift_stddev": r.drift_stddev,
        "warp_telemetry": r.warp_telemetry,
    }
