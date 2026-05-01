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
from typing import TYPE_CHECKING, Deque, Literal, Optional, Tuple

from .bus_events import HeartTickPayload, KernelEvent
from .persistence import PersistentMemory
from .state import KAPPA_STAR

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


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

    def __init__(
        self,
        max_window: int = 60,
        *,
        persistence: Optional[PersistentMemory] = None,
        symbol: Optional[str] = None,
        bus: Optional["KernelBus"] = None,
    ) -> None:
        self._max_window = max_window
        self._persistence = persistence
        self._symbol = symbol
        self._bus = bus
        self._last_mode: Optional[KappaMode] = None
        self._last_kappa_offset_sign: int = 0  # -1, 0, +1
        self._samples: Deque[Tuple[float, float]] = deque(maxlen=max_window)
        # Restore prior κ window from Redis if available.
        if persistence is not None and persistence.is_available and symbol:
            for kappa, t_ms in persistence.load_kappa_history(symbol):
                self._samples.append((kappa, t_ms))

    def append(self, kappa: float, t_ms: float) -> None:
        self._samples.append((float(kappa), float(t_ms)))
        # Write-through. Failures are silent (logged at debug in persistence).
        if self._persistence is not None and self._symbol:
            self._persistence.push_kappa(self._symbol, float(kappa), float(t_ms))

        if self._bus is not None:
            state = self.read()
            self._publish_tick(state)
            self._publish_mode_shift(state)
            self._publish_tacking(state)

    def _publish_tick(self, state: "HeartState") -> None:
        if self._bus is None:
            return
        self._bus.publish(
            KernelEvent.HEART_TICK,
            source="heart",
            payload=HeartTickPayload(
                kappa=float(state.kappa),
                kappa_star=float(KAPPA_STAR),
                hrv=float(state.hrv),
                mode=str(state.mode),
            ),
            symbol=self._symbol,
        )

    def _publish_mode_shift(self, state: "HeartState") -> None:
        if self._bus is None:
            return
        if self._last_mode is not None and self._last_mode != state.mode:
            self._bus.publish(
                KernelEvent.HEART_MODE_SHIFT,
                source="heart",
                payload={
                    "from": self._last_mode,
                    "to": str(state.mode),
                    "kappa": float(state.kappa),
                    "kappa_offset": float(state.kappa_offset),
                },
                symbol=self._symbol,
            )
        self._last_mode = state.mode

    def _publish_tacking(self, state: "HeartState") -> None:
        """κ tacking: sign of (κ − κ*) crosses zero. Publishes
        HEART_TACKING at the crossing tick."""
        if self._bus is None:
            return
        offset = state.kappa_offset
        new_sign = 0 if offset == 0.0 else (-1 if offset < 0.0 else 1)
        if (
            self._last_kappa_offset_sign != 0
            and new_sign != 0
            and new_sign != self._last_kappa_offset_sign
        ):
            self._bus.publish(
                KernelEvent.HEART_TACKING,
                source="heart",
                payload={
                    "kappa": float(state.kappa),
                    "kappa_star": float(KAPPA_STAR),
                    "kappa_offset": float(state.kappa_offset),
                    "from_sign": self._last_kappa_offset_sign,
                    "to_sign": new_sign,
                },
                symbol=self._symbol,
            )
        self._last_kappa_offset_sign = new_sign

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
