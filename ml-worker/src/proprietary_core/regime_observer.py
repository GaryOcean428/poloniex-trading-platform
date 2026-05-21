"""regime_observer.py — observer-driven regime classification (CAL-3).

CAL-3 (2026-05-17). Ports the canonical ``WarpBubble.auto()``
OBSERVE → DISCOVER → NAVIGATE pattern (Dev/QIG_QFI/qig-warp/auto.py)
from cost surfaces to classification surfaces. Per Canonical
Principles v2.1 P1: the observer sets all params from observed data;
no hardcoded thresholds.

The problem this solves
-----------------------
``qig_warp.classify_regime(h, J, dim=2)`` was calibrated on 2D TFIM
physics where h and J live on O(1) scales. Crypto log-return inputs
naturally produce ``h/J`` ratios ~O(20-400) — far above the
physics-calibrated DISORDERED threshold of ``1.2 × h_c = 3.65``. With
the fixed-threshold classifier, every market tick classifies as
DISORDERED and the system is HOLD-always.

The substrate translation
-------------------------
The physics' regime boundaries (0.8 × h_c, 1.2 × h_c) are not
absolutes — they're the points where the system's own *distribution*
of ``h/J`` clusters change phase. On crypto data the equivalent
points are the empirical terciles of the observed ``h/J`` window:

  bottom tercile  (smallest h/J)  → ORDERED       (J-dominated, trending)
  middle tercile  (median h/J)    → CRITICAL      (phase boundary, bridge strongest)
  top tercile     (largest h/J)   → DISORDERED    (h-dominated, chop)

The trading mapping then follows the canonical EXP-035-E/042-E/079
table (the same one ``regime_qigwarp.map_warp_to_market`` already uses):

  ORDERED      → PRESERVER
  CRITICAL     → CREATOR
  DISORDERED   → DISSOLVER

Cold-start fall-through
-----------------------
Before ``_WARMUP_TICKS`` observations have accumulated, the
observer falls through to ``qig_warp.classify_regime`` with its
fixed physics thresholds. During the brief warmup the system stays
conservatively DISORDERED (which is what crypto data classifies as
under the physics thresholds), and traffic flows correctly through
the rest of the pipeline. After warmup, the observer takes over.

This is the ONLY place where the physics-fixed classifier remains
in the live path — and only for the first 30 ticks per process,
not as a permanent calibration override.

No knobs
--------
No env-tunable scale factors. No hardcoded magnification. The
quantile-based regime boundaries derive from the basin's own
observed distribution. The warmup length (30) is the only constant,
and it is a buffer-fill guard not a calibration parameter.

Test coverage in ``tests/test_regime_observer.py``.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Optional

import numpy as np

from .regime import MarketRegime
from .regime_qigwarp import classify_with_qig_warp, map_warp_to_market

logger = logging.getLogger(__name__)


# Warmup buffer-fill threshold. Before this many observations accumulate
# per process, the observer falls through to qig_warp's fixed-threshold
# classifier (which on crypto h/J ratios consistently returns DISORDERED,
# pinning the kernel in cash-only mode for the entire warmup window).
#
# CALIB-2 (2026-05-17): reduced from 30 to 5. Live observation showed
# every fresh deploy left the kernel inert for the first 30 minutes —
# the chicken-and-egg flaw is:
#   - observer needs N samples to derive terciles
#   - warmup fall-through returns DISORDERED on every crypto tick
#     (h/J ratio ~100, far above qig_warp's h_c=3.044 calibration)
#   - so the observer ONLY ever sees DISORDERED-labelled ticks
# Reducing the warmup to 5 lets the observer take over with its own
# tercile-derived classification much sooner (≈ 1 min at observed
# /ml/predict rate). 5 samples is enough for a meaningful tercile
# (33/67 quantiles on 5 points have positions 1.32 and 2.68, so they
# bracket distinct samples). NOT a calibration knob — a buffer-fill
# guard, but sized for the live deploy cadence rather than session
# stability.
#
# Long-term fix is to persist `_ratios` to Redis so warmup survives
# restarts (tracked separately); reducing the threshold is the
# tactical fix that doesn't require new infrastructure.
_WARMUP_TICKS = 5

# Rolling window over which the observer derives its terciles. Larger
# windows give more stable boundaries but slower adaptation to regime
# shifts. 500 ticks ≈ 70 minutes of /ml/predict traffic at the observed
# rate — long enough to span a US-session transition, short enough to
# track multi-hour regime changes. NOT a calibration knob — a memory
# horizon.
_OBSERVER_WINDOW = 500


@dataclass
class RegimeBoundaries:
    """Observer-derived terciles of the (h, J) ratio distribution."""
    lower: float       # 33rd percentile — below = ORDERED
    upper: float       # 67th percentile — above = DISORDERED
    n_observations: int
    is_warmup: bool    # True until enough observations have accumulated


@dataclass
class RegimeObserver:
    """OBSERVE → DISCOVER → NAVIGATE for regime classification.

    Rolling buffer of recent ``h/J`` ratios. Calls
    ``np.quantile(buf, [0.33, 0.67])`` to derive the regime
    boundaries from the observed distribution. Falls through to
    ``qig_warp.classify_regime`` during warmup.

    Thread-safe: a single module-level instance is shared across
    /ml/predict workers; the lock protects deque writes + reads.
    """

    window: int = _OBSERVER_WINDOW
    warmup: int = _WARMUP_TICKS
    _ratios: deque[float] = field(default_factory=lambda: deque(maxlen=_OBSERVER_WINDOW))
    _lock: Lock = field(default_factory=Lock)

    def observe_and_classify(
        self, h_value: float, j_value: float, dim: int = 2,
    ) -> MarketRegime:
        """OBSERVE the (h, J) input → DISCOVER regime via
        rolling-quantile → NAVIGATE to the trading regime.

        Cold-start (n < warmup): falls through to
        ``classify_with_qig_warp`` (the documented warmup fall-through).
        Warm (n >= warmup): classifies via the observed terciles.
        """
        # Observe — append the ratio, return a snapshot under lock.
        if j_value > 1e-12:
            ratio = h_value / j_value
        else:
            # Degenerate: zero coupling. Treat as max disorder so the
            # warmup path still receives a sample but the live path
            # classifies as DISSOLVER (don't trade).
            ratio = float("inf")
        with self._lock:
            self._ratios.append(ratio)
            n = len(self._ratios)
            snapshot = list(self._ratios) if n >= self.warmup else None

        if snapshot is None:
            # WARMUP — fall through to physics-calibrated classifier.
            # This is the ONLY place where qig_warp's fixed thresholds
            # remain in the live path, and only for the first
            # ``warmup`` ticks per process.
            try:
                return classify_with_qig_warp(h_value, j_value, dim=dim)
            except Exception as exc:  # noqa: BLE001 — tick handler must not raise
                logger.warning(
                    "[RegimeObserver] warmup fall-through failed; "
                    "defaulting to DISSOLVER for safety: %s", exc,
                )
                return MarketRegime.DISSOLVER

        # WARM — derive terciles from observation window.
        bounds = self._discover_bounds(snapshot)
        return self._navigate(ratio, bounds)

    def _discover_bounds(self, snapshot: list[float]) -> RegimeBoundaries:
        """DISCOVER regime boundaries via rolling quantiles."""
        # Filter inf (zero-coupling ticks) — they're real data points
        # but np.quantile would propagate them. Treat them as belonging
        # to the top tercile by replacing with a large finite value
        # equal to the maximum finite ratio in the window.
        finite = [r for r in snapshot if np.isfinite(r)]
        if not finite:
            # All zero-coupling — degenerate, return wide bounds.
            return RegimeBoundaries(lower=0.0, upper=float("inf"), n_observations=0, is_warmup=False)
        arr = np.asarray(finite, dtype=np.float64)
        lower = float(np.quantile(arr, 0.33))
        upper = float(np.quantile(arr, 0.67))
        return RegimeBoundaries(
            lower=lower,
            upper=upper,
            n_observations=len(snapshot),
            is_warmup=False,
        )

    @staticmethod
    def _navigate(ratio: float, bounds: RegimeBoundaries) -> MarketRegime:
        """NAVIGATE: map this tick's h/J onto the observed terciles,
        then onto the canonical trading regime."""
        if not np.isfinite(ratio):
            # Zero-coupling tick → max-entropy/no-trend → DISSOLVER.
            return MarketRegime.DISSOLVER
        if ratio < bounds.lower:
            warp_label = "ordered"     # J-dominated → trending
        elif ratio > bounds.upper:
            warp_label = "disordered"  # h-dominated → chop
        else:
            warp_label = "critical"    # phase boundary
        mapped = map_warp_to_market(warp_label)
        # mapped is always non-None for these three canonical labels.
        return mapped if mapped is not None else MarketRegime.DISSOLVER

    def snapshot(self) -> tuple[int, Optional[RegimeBoundaries]]:
        """Test/diagnostic accessor — return (n, bounds_if_warm)."""
        with self._lock:
            snap = list(self._ratios)
        n = len(snap)
        if n < self.warmup:
            return n, None
        bounds = self._discover_bounds(snap)
        return n, bounds

    def soft_scores(self, ratio: float) -> Optional[dict[str, float]]:
        """Continuous 3-way regime membership for ``ratio``.

        The hard ``_navigate`` buckets a tick's h/J ratio into exactly
        one tercile. Downstream consumers (TS perception → basin dims
        0-2 → neurochemistry) then only ever see three discrete states,
        which pins derived signals like ``gaba = 1 - quantum_weight``.

        Soft variant: place the ratio's percentile rank ``p`` in the
        observed window onto a triangular partition-of-unity over the
        three regimes:

            p → 0    ordered    (PRESERVER)
            p → 0.5  critical   (CREATOR)
            p → 1    disordered (DISSOLVER)

        Pure arithmetic, sums to 1 by construction, no exp-normalization
        (the neurochemistry layer that ultimately consumes this forbids
        exp-softmax — keep the whole regime path consistent).

        Returns None during warmup or when the ratio is degenerate
        (non-finite) — the caller falls back to the hard one-hot label.
        """
        if not np.isfinite(ratio):
            return None
        with self._lock:
            window = [r for r in self._ratios if np.isfinite(r)]
        if len(window) < self.warmup:
            return None
        arr = np.asarray(window, dtype=np.float64)
        # Percentile rank of this tick's ratio within the observed
        # window — bounded [0, 1] regardless of the raw h/J scale.
        p = float(np.count_nonzero(arr <= ratio)) / float(len(arr))
        # Triangular partition of unity on p ∈ [0, 1].
        m_preserver = max(0.0, 1.0 - 2.0 * p)
        m_creator = 1.0 - abs(2.0 * p - 1.0)
        m_dissolver = max(0.0, 2.0 * p - 1.0)
        return {
            "creator": m_creator,
            "preserver": m_preserver,
            "dissolver": m_dissolver,
        }

    def reset(self) -> None:
        """Test helper — clear the rolling buffer."""
        with self._lock:
            self._ratios.clear()


# Module-level singleton — one observer per process.
_observer = RegimeObserver()


def classify_via_observer(
    h_value: float, j_value: float, dim: int = 2,
) -> MarketRegime:
    """Module-level entry point. All callers should use this rather
    than ``classify_with_qig_warp`` directly — the observer falls
    through to qig_warp during warmup automatically."""
    return _observer.observe_and_classify(h_value, j_value, dim=dim)


def observer_snapshot() -> tuple[int, Optional[RegimeBoundaries]]:
    """Diagnostic accessor for /governance/status surfacing."""
    return _observer.snapshot()


def observer_soft_scores(
    h_value: float, j_value: float,
) -> Optional[dict[str, float]]:
    """Continuous regime membership for the current (h, J).

    Read-only: does NOT append to the observation window.
    ``classify_via_observer`` already observed this tick — calling this
    afterwards scores the same ratio against the (post-append) window.
    Returns None during warmup / degenerate coupling.
    """
    if j_value > 1e-12:
        ratio = h_value / j_value
    else:
        ratio = float("inf")
    return _observer.soft_scores(ratio)


def _reset_observer() -> None:
    """Test-only reset of the module-level observer."""
    _observer.reset()
