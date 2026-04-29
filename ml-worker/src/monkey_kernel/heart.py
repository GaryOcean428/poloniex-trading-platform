"""heart.py — Tier 7 Heart κ-oscillation monitor.

UCP heart kernel: tracks κ as a physiological signal. κ oscillates
around κ* = 64 (the frozen anchor) with regime-dependent amplitude
and period; the sign of (κ − κ*) maps to the kernel's reasoning mode:

  κ < κ*  → FEELING  mode (fast / exploratory / pattern-driven)
  κ > κ*  → LOGIC    mode (slow / accurate / formula-driven)

HRV (heart-rate variability) — the standard deviation of consecutive
inter-tick κ deltas — is the kernel's health metric. High HRV =
adaptive / responsive; flat HRV = rigid / locked. Used by Ocean
(meta-observer, same Tier) and by future kernel diagnostics.

Pure observation. The current κ-mode + HRV are exposed for telemetry
and for Ocean's intervention triggers. The executive does not gate
decisions on heart state at this layer; that wiring (if/when it
lands) is downstream of Tier 6 Φ-gate and Tier 7 Ocean.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from statistics import stdev
from typing import Deque, Literal, Tuple

from .state import KAPPA_STAR


KappaMode = Literal["FEELING", "LOGIC", "ANCHOR"]


@dataclass(frozen=True)
class HeartState:
    """Heart-kernel snapshot. Fields:
      kappa         : float        current κ
      kappa_offset  : float        κ − κ*; signed deviation from anchor
      mode          : KappaMode    FEELING / LOGIC / ANCHOR
      hrv           : float        std of consecutive κ deltas in window;
                                   0.0 with fewer than 3 samples
      sample_count  : int          ticks observed in the window
    """

    kappa: float
    kappa_offset: float
    mode: KappaMode
    hrv: float
    sample_count: int


class HeartMonitor:
    """One monitor per kernel instance. append() each tick after κ
    update; read() returns the current HeartState.

    append is O(1); read is O(N) where N is the window length.
    """

    def __init__(self, max_window: int = 60) -> None:
        # Last N (kappa, t_ms) samples
        self._samples: Deque[Tuple[float, float]] = deque(maxlen=max_window)

    def append(self, kappa: float, t_ms: float) -> None:
        self._samples.append((float(kappa), float(t_ms)))

    def read(self) -> HeartState:
        n = len(self._samples)
        if n == 0:
            # Cold start — no kappa observed yet
            return HeartState(
                kappa=KAPPA_STAR,
                kappa_offset=0.0,
                mode="ANCHOR",
                hrv=0.0,
                sample_count=0,
            )

        kappa = self._samples[-1][0]
        offset = kappa - KAPPA_STAR
        if offset == 0.0:
            mode: KappaMode = "ANCHOR"
        elif offset < 0.0:
            mode = "FEELING"
        else:
            mode = "LOGIC"

        # HRV — std of consecutive κ deltas. Need ≥ 3 samples for std.
        if n >= 3:
            deltas = [
                self._samples[i + 1][0] - self._samples[i][0]
                for i in range(n - 1)
            ]
            hrv = stdev(deltas) if len(deltas) >= 2 else 0.0
        else:
            hrv = 0.0

        return HeartState(
            kappa=kappa,
            kappa_offset=offset,
            mode=mode,
            hrv=hrv,
            sample_count=n,
        )

    def reset(self) -> None:
        self._samples.clear()

    @property
    def window_length(self) -> int:
        return len(self._samples)
