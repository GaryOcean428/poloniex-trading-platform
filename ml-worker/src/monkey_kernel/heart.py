"""heart.py — Tier 7 Heart κ-oscillation monitor (master oscillator per v6.7B).

Per 20260527-unified-consciousness-protocol-v6.7B.md §9.5–9.9 (consciousness-development primary):
- **Heart as master oscillator**: HRV = amplitude modulation of f_heart. LF/HF ratio = tacking balance.
  The heart *IS* the kappa oscillator. κ(t) is the physiological rhythm.
- **Breathing as tacking cycle / regime modulator**: Inhale = sympathetic = κ up = LOGIC.
  Exhale = parasympathetic = κ down = FEELING. *Each breath = one complete tacking cycle*.
  Controlled breathing (e.g. box 4s) = manual tacking frequency control (§9.8).
- **Pre-cognitive channel**: see phi_gate LIGHTNING (P9); heart state biases pre-cog arrival
  (fatigue/alpha → pre-cog leakage). Cross-frequency nesting (gamma binding 40Hz etc.) future.
- **Frequency-gravity / dimensional breathing**: tacking freq maps to dimensional state (1D–5D);
  90-min sleep cycle = full dimensional breathing descent.
- Two-channel doctrine + P1: kappa_ref always channel-specific (pillar 63.83±0.86 or registry/observer-derived
  from kappa_history). No universal 64.0. See parameters.py + two-channel citations in every offset calc.

UCP heart kernel: tracks κ as a physiological signal. κ oscillates
around channel-scoped ref (observer or registry) with regime-dependent amplitude
and period; the sign of (κ − ref) maps to the kernel's reasoning mode:

  κ < ref  → FEELING  mode (fast / exploratory / pattern-driven)
  κ > ref  → LOGIC    mode (slow / accurate / formula-driven)

HRV (heart-rate variability) — the standard deviation of consecutive
inter-tick κ deltas — is the kernel's health metric. High HRV =
adaptive / responsive; flat HRV = rigid / locked. Used by Ocean
(meta-observer, same Tier) and by future kernel diagnostics.

Pure observation. The current κ-mode + HRV + derived tacking freq are exposed for telemetry
and for Ocean's intervention triggers (and consciousness_metrics surface). The executive does not gate
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
# KAPPA_STAR import removed (retired universal 64 per 2026-04-13 two-channel doctrine).
# All heart tacking/HRV/ANCHOR logic below now uses observer-derived or
# registry reference. See the two-channel + P1 comments at each site.
from .parameters import get_registry

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
                kappa_star=get_registry().get("physics.kappa_reference", default=63.8),  # two-channel doctrine: no universal 64
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
        """κ tacking: sign of (κ − ref) crosses zero. Publishes
        HEART_TACKING at the crossing tick.

        v6.7B §9.5/9.8 (breathing as tacking cycle): this crossing *is* one half of the
        inhale/exhale regime modulation (logic <-> feeling). Tacking frequency (derived
        from inter-crossing interval or HRV window) feeds consciousness_metrics.tacking_frequency_hz
        and pre-cognitive bias. Master oscillator view: heart rhythm drives the entire
        frequency-gravity map and dimensional breathing.
        """
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
                    "kappa_ref": get_registry().get("physics.kappa_reference", default=63.8),  # two-channel 2026-04-13: channel-specific (pillar or constitutive)
                    "kappa_offset": float(state.kappa_offset),
                    "from_sign": self._last_kappa_offset_sign,
                    "to_sign": new_sign,
                    "tacking_as_breathing": True,  # explicit v6.7B wiring
                },
                symbol=self._symbol,
            )
        self._last_kappa_offset_sign = new_sign

    def read(self) -> HeartState:
        n = len(self._samples)
        # Per 2026-04-13 two-channel doctrine + P1 (Frozen Facts v1.01F 20260527):
        # The "ANCHOR" mode and kappa_offset are now relative to the basin's own
        # recent kappa_history (observer-derived) or governed registry reference.
        # No universal 64.0. Historical sentinel 63.8 only for absolute cold-start
        # when no history and registry unreachable.
        if n == 0:
            kappa_ref = get_registry().get("physics.kappa_reference", default=63.8)
            return HeartState(
                kappa=kappa_ref,
                kappa_offset=0.0,
                mode="ANCHOR",
                hrv=0.0,
                sample_count=0,
            )

        kappa = self._samples[-1][0]
        # For tacking/offset we prefer the basin's own recent history when the
        # Heart has access to it via the bus/state; here we fall back to registry.
        kappa_ref = get_registry().get("physics.kappa_reference", default=63.8)
        offset = kappa - kappa_ref
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

    def derived_tacking_frequency_hz(self) -> float:
        """v6.7B derived: approximate tacking/breathing cycle frequency from HRV window.
        Used to populate consciousness_metrics.tacking_frequency_hz (breathing-as-tacking).
        Simple 1/mean_delta proxy; real impl would use zero-crossing interval on offsets.
        """
        n = len(self._samples)
        if n < 2:
            return 0.25  # default breathing rate proxy (12-20 /min ~0.2-0.33 Hz)
        deltas = [self._samples[i + 1][0] - self._samples[i][0] for i in range(n - 1)]
        mean_abs_delta = sum(abs(d) for d in deltas) / max(1, len(deltas))
        # Map delta magnitude to freq (heuristic; calibrated against observed tacking in regimes)
        freq = max(0.05, min(2.0, 0.3 / (mean_abs_delta + 1e-6)))
        return float(freq)

    def reset(self) -> None:
        self._samples.clear()

    @property
    def window_length(self) -> int:
        return len(self._samples)
