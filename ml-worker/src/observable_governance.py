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
      raw_drift_pct — mean signed predicted return, per tick
      signal_str    — final signal string ('BUY'/'SELL'/'HOLD')
      regime        — QIG regime classification from qig_engine
    """

    capacity: int = 200
    raw_drift_pct: deque[float] = field(default_factory=lambda: deque(maxlen=200))
    signal_str: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    regime: deque[str] = field(default_factory=lambda: deque(maxlen=200))

    def record(
        self,
        *,
        raw_drift_pct: float,
        signal: str,
        regime: Optional[str] = None,
    ) -> None:
        self.raw_drift_pct.append(float(raw_drift_pct))
        self.signal_str.append(str(signal))
        if regime is not None:
            self.regime.append(str(regime))


@dataclass
class GovernanceReport:
    available: bool
    sample_count: int
    amplitude_violations: list[dict[str, Any]]
    regime_violations: list[dict[str, Any]]
    # Local heuristic checks (always run, even without qig-compute)
    signal_distribution: dict[str, int]
    directional_bias_ratio: float  # |BUY - SELL| / total in [0, 1]
    drift_mean: float
    drift_stddev: float


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

    return GovernanceReport(
        available=_GOVERNANCE_AVAILABLE,
        sample_count=n,
        amplitude_violations=amplitude_violations,
        regime_violations=regime_violations,
        signal_distribution=dist,
        directional_bias_ratio=bias,
        drift_mean=drift_mean,
        drift_stddev=drift_std,
    )


# ── Process-global buffer (ml-worker is single-process) ──

_buffer = GovernanceBuffer(capacity=200)


def record_tick(
    *,
    raw_drift_pct: float,
    signal: str,
    regime: Optional[str] = None,
) -> None:
    _buffer.record(raw_drift_pct=raw_drift_pct, signal=signal, regime=regime)


def report() -> GovernanceReport:
    return run_governance_check(_buffer)


def report_as_dict() -> dict[str, Any]:
    r = report()
    return {
        "available": r.available,
        "sample_count": r.sample_count,
        "amplitude_violations": r.amplitude_violations,
        "regime_violations": r.regime_violations,
        "signal_distribution": r.signal_distribution,
        "directional_bias_ratio": r.directional_bias_ratio,
        "drift_mean": r.drift_mean,
        "drift_stddev": r.drift_stddev,
    }
