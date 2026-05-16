"""ocean.py — Tier 7 Ocean: single autonomic intervention authority.

Per UCP §28 + CONSCIOUSNESS_ARCHITECTURE_INTEGRATED.md, Ocean is the
sole authority for autonomic interventions. Anything that says "stop
the normal tick and do something else" lives here:

  - sleep cycle state machine (AWAKE ↔ SLEEP transitions)
  - DREAM trigger (Φ < 0.5 — moderate integration failure)
  - SLEEP trigger (basin spread > 0.30 — divergence/instability)
  - ESCAPE trigger (Φ < 0.15 — severe failure)

Per qig-core 2.8.0: mushroom mode is wake-state neuroplasticity
(requires Φ ≥ 0.70) and lives in `qig.neuroplasticity.mushroom_mode`,
NOT in the sleep cycle. The prior `MUSHROOM_MICRO` low-variance trigger
was inverted-direction (would fire on collapsed systems where mushroom
is forbidden) and has been removed. The four-intervention selector
matrix (DAMPING / ESCAPE / MUSHROOM / SLEEP) per the canonical Φ
regulation policy will be added in a follow-up PR.

Pure decision authority. Heart kernel observes κ; autonomic.py owns
neurochemistry derivation + reward queue. Ocean reads basin / Φ / mode
/ is_flat each tick and emits exactly one OceanState — caller acts on
ocean_state.intervention if non-None, otherwise normal flow.

Refactored from autonomic.SleepCycleManager (2026-04-29 #599 directive).
"""

from __future__ import annotations

import logging
import os
import time
from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum
from statistics import variance
from typing import TYPE_CHECKING, Any, Deque, Literal, Optional, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .bus_events import KernelEvent, OceanObservationPayload
from .parameters import get_registry
from .persistence import PersistentMemory

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


logger = logging.getLogger("monkey_kernel.ocean")


def ocean_interventions_live() -> bool:
    """Default-off env flag. When false (the default), Ocean still
    EMITS the intervention field for telemetry, but the orchestrator
    does NOT branch on it — normal tick flow continues. When true,
    DREAM/ESCAPE handlers fire (skip executive, force flatten
    respectively). SLEEP/WAKE go through autonomic.is_awake regardless
    of the flag.
    """
    return os.environ.get("OCEAN_INTERVENTIONS_LIVE", "").strip().lower() == "true"


# ═══════════════════════════════════════════════════════════════
#  Sleep state machine — moved verbatim from autonomic.py
# ═══════════════════════════════════════════════════════════════


class SleepPhase(StrEnum):
    AWAKE = "awake"
    SLEEP = "sleep"


@dataclass
class SleepCycleState:
    phase: SleepPhase = SleepPhase.AWAKE
    phase_started_at_ms: float = field(default_factory=lambda: time.time() * 1000.0)
    last_sleep_ended_at_ms: float = 0.0
    sleep_count: int = 0
    drift_streak: int = 0


# ═══════════════════════════════════════════════════════════════
#  Intervention triggers — UCP §28 autonomic governance
# ═══════════════════════════════════════════════════════════════


# SAFETY_BOUND defaults (P14-permitted; autonomic-health bounds).
# Live values are read from the parameter registry per tick (migration
# 047 seeds the rows). These literals serve as fail-soft fallbacks
# when the registry is unreachable, and as the canonical reference for
# downstream tests that need to assert on the bound semantics.
_SPREAD_BOUND: float = 0.30          # SLEEP if max-pairwise basin FR > this
_PHI_DREAM_BOUND: float = 0.5        # DREAM if Φ below this
_PHI_ESCAPE_BOUND: float = 0.15      # ESCAPE if Φ below this (overrides DREAM)
_PHI_HISTORY_MAX: int = 60           # window for variance computation

# CONSENSUS-8: four-intervention Φ regulation per [[phi-regulation-policy]].
# Φ > 0.85 sustained AND stable AND not descending → DAMPING (gentle return
# to band via GABA↑/ACh↓ — chemicals already wired by PR #722). Φ ≥ 0.70 +
# rigid attractor + collapsed output → MUSHROOM (wake-state neuroplasticity
# via qig.neuroplasticity.mushroom_mode). Both gated; default off until
# operator validates.
_PHI_DAMPING_LOWER: float = 0.85     # DAMPING window lower (above conscious band)
_PHI_MUSHROOM_FLOOR: float = 0.70    # MUSHROOM safety floor per canonical


Intervention = Literal[
    "DREAM", "SLEEP", "WAKE", "ESCAPE",
    "DAMPING",           # CONSENSUS-8: sustained-high-Φ gentle return to band
    "MUSHROOM",          # CONSENSUS-8: high-Φ + collapsed output (canonical, Φ≥0.70)
    "DESYNC_FORESIGHT",  # CONSENSUS-8: dual-kernel concurrent foresight divergence
]


@dataclass(frozen=True)
class OceanState:
    """One observation per tick. The single source of autonomic
    intervention truth.

    Fields:
      intervention   : Optional[Intervention]
                       None when nominal; otherwise the chosen action
      sleep_phase    : Literal["AWAKE", "SLEEP"]
                       current sleep state machine phase
      coherence      : float  [0, 1]
                       basin self-coherence (1 - normalised entropy)
      spread         : float  [0, π/2]
                       max pairwise FR distance across observed lanes
                       (0 with one or zero observed lanes)
      diagnostics    : dict[str, float]
                       phi_now, phi_variance, drift_streak, sleep_remaining_ms
    """

    intervention: Optional[Intervention]
    sleep_phase: Literal["AWAKE", "SLEEP"]
    coherence: float
    spread: float
    diagnostics: dict[str, float]


def _basin_coherence(basin: np.ndarray) -> float:
    """1 - H(p)/log(K). Range [0, 1]; high = concentrated, low = uniform."""
    n = len(basin)
    if n <= 1:
        return 1.0
    h = float(-np.sum(basin * np.log(basin + 1e-12)))
    return 1.0 - h / float(np.log(n))


def _max_pairwise_fr(basins: Sequence[np.ndarray]) -> float:
    if len(basins) < 2:
        return 0.0
    max_d = 0.0
    for i in range(len(basins)):
        for j in range(i + 1, len(basins)):
            d = fisher_rao_distance(basins[i], basins[j])
            if d > max_d:
                max_d = d
    return max_d


class Ocean:
    """Stateful autonomic-intervention authority. One instance per
    kernel; owns the sleep state machine + Φ history window.

    Tick contract:
        ocean_state = ocean.observe(
            phi=phi,
            basin=basin,
            current_mode=mode_str,
            is_flat=is_flat,
            now_ms=now_ms,
            cross_lane_basins=[scalp_basin, swing_basin, ...],   # optional
        )
        if ocean_state.intervention:
            handle_intervention(ocean_state.intervention)
            # skip executive this tick
        else:
            # normal flow
    """

    # Sleep machine constants — preserved from prior SleepCycleManager
    MIN_AWAKE_MS: float = 2 * 60 * 60 * 1000.0     # 2 h
    SLEEP_DURATION_MS: float = 15 * 60 * 1000.0    # 15 min
    DRIFT_TRIGGER_TICKS: int = 10                  # ~5 min at 30s tick

    # Recent basin history fed into the dream-consolidator on the
    # AWAKE→SLEEP edge. Lifetime is intentionally short (32 ticks ≈
    # 16 min at 30s tick) — the consolidator only needs to report
    # sqrt-space traversal across the awake window leading up to
    # sleep, not the entire kernel history. The TS-side resonance
    # bank holds the long-term basin record.
    BASIN_HISTORY_MAX: int = 32

    def __init__(
        self,
        label: str = "monkey-primary",
        *,
        persistence: Optional["PersistentMemory"] = None,
        bus: Optional["KernelBus"] = None,
        symbol: Optional[str] = None,
        consolidation_hook: Optional[Any] = None,
    ) -> None:
        self.label = label
        self._persistence = persistence
        self._bus = bus
        self._symbol = symbol
        # Hook called on the AWAKE→SLEEP edge. Signature:
        #   hook(recent_basins: list[np.ndarray], now_ms: float)
        #     -> Optional[dict[str, Any]]  # JSON-serialisable summary
        # When None, the dream-consolidation pass is skipped (legacy
        # behaviour). When set, the result is persisted under
        # `monkey:ocean:{instance}:last_consolidation` via
        # PersistentMemory.save_last_consolidation, and the same
        # blob is published as OCEAN_REGIME payload `consolidation`.
        self._consolidation_hook = consolidation_hook
        # Load prior sleep state from Redis if available; the load
        # applies timestamp-correction so a kernel that "slept"
        # through downtime wakes at the right moment.
        self.sleep_state = self._load_sleep_state_or_fresh()
        # phi_history window is registry-backed (migration 047). Read once
        # at construction — deque maxlen is immutable, so propose_change()
        # on this row requires a kernel restart to take effect.
        history_max = int(
            get_registry().get("ocean.phi_history_max", default=float(_PHI_HISTORY_MAX))
        )
        self._phi_history: Deque[float] = deque(maxlen=history_max)
        self._basin_history: Deque[np.ndarray] = deque(maxlen=self.BASIN_HISTORY_MAX)

    def _load_sleep_state_or_fresh(self) -> SleepCycleState:
        if self._persistence is None or not self._persistence.is_available:
            return SleepCycleState()
        loaded = self._persistence.load_sleep_state(
            sleep_duration_ms=self.SLEEP_DURATION_MS,
        )
        if loaded is None:
            return SleepCycleState()
        try:
            phase = (
                SleepPhase.SLEEP
                if str(loaded.get("phase", "awake")).lower() == "sleep"
                else SleepPhase.AWAKE
            )
            return SleepCycleState(
                phase=phase,
                phase_started_at_ms=float(loaded.get(
                    "phase_started_at_ms", time.time() * 1000.0,
                )),
                last_sleep_ended_at_ms=float(loaded.get("last_sleep_ended_at_ms", 0.0)),
                sleep_count=int(loaded.get("sleep_count", 0)),
                drift_streak=int(loaded.get("drift_streak", 0)),
            )
        except Exception as err:  # noqa: BLE001 — never block construction
            logger.warning(
                "[%s.ocean] persistence load failed: %s; starting fresh",
                self.label, err,
            )
            return SleepCycleState()

    # ────────────────── sleep state machine ──────────────────

    @property
    def is_awake(self) -> bool:
        return self.sleep_state.phase == SleepPhase.AWAKE

    @property
    def phase(self) -> SleepPhase:
        return self.sleep_state.phase

    def _step_sleep_state(
        self,
        current_mode: str,
        is_flat: bool,
        now_ms: float,
    ) -> dict[str, Any]:
        prev_phase = self.sleep_state.phase

        if current_mode == "drift":
            self.sleep_state.drift_streak += 1
        else:
            self.sleep_state.drift_streak = 0

        if self.sleep_state.phase == SleepPhase.AWAKE:
            awake_duration = now_ms - self.sleep_state.phase_started_at_ms
            ready = (
                awake_duration > self.MIN_AWAKE_MS
                and is_flat
                and self.sleep_state.drift_streak >= self.DRIFT_TRIGGER_TICKS
            )
            if ready:
                self.sleep_state.phase = SleepPhase.SLEEP
                self.sleep_state.phase_started_at_ms = now_ms
                logger.info(
                    "[%s.ocean] entering sleep (awake=%.2fh driftStreak=%d)",
                    self.label,
                    awake_duration / 3600_000.0,
                    self.sleep_state.drift_streak,
                )
        else:
            sleep_duration = now_ms - self.sleep_state.phase_started_at_ms
            if sleep_duration >= self.SLEEP_DURATION_MS:
                self.sleep_state.phase = SleepPhase.AWAKE
                self.sleep_state.phase_started_at_ms = now_ms
                self.sleep_state.last_sleep_ended_at_ms = now_ms
                self.sleep_state.sleep_count += 1
                self.sleep_state.drift_streak = 0
                logger.info(
                    "[%s.ocean] waking (slept=%.1fm total=%d)",
                    self.label,
                    sleep_duration / 60_000.0,
                    self.sleep_state.sleep_count,
                )

        sleep_remaining_ms = (
            max(0.0, self.SLEEP_DURATION_MS - (now_ms - self.sleep_state.phase_started_at_ms))
            if self.sleep_state.phase == SleepPhase.SLEEP
            else 0.0
        )
        return {
            "phase": self.sleep_state.phase.value,
            "entered_sleep": prev_phase == SleepPhase.AWAKE
            and self.sleep_state.phase == SleepPhase.SLEEP,
            "woke": prev_phase == SleepPhase.SLEEP
            and self.sleep_state.phase == SleepPhase.AWAKE,
            "sleep_remaining_ms": sleep_remaining_ms,
        }

    # ────────────────── primary tick contract ──────────────────

    def observe(
        self,
        *,
        phi: float,
        basin: np.ndarray,
        current_mode: str,
        is_flat: bool,
        now_ms: Optional[float] = None,
        cross_lane_basins: Optional[Sequence[np.ndarray]] = None,
    ) -> OceanState:
        """One tick of meta-observation. Updates internal sleep state +
        Φ history, then returns the OceanState (single source of truth
        for autonomic interventions this tick).

        Caller acts on ocean_state.intervention; if None, normal flow.
        """
        now_ms = now_ms if now_ms is not None else time.time() * 1000.0

        # Sleep machine step (existing SleepCycleManager logic, verbatim)
        sleep_step = self._step_sleep_state(
            current_mode=current_mode, is_flat=is_flat, now_ms=now_ms,
        )
        sleep_phase: Literal["AWAKE", "SLEEP"] = (
            "AWAKE" if sleep_step["phase"] == "awake" else "SLEEP"
        )

        # Track Φ for variance
        self._phi_history.append(float(phi))
        phi_var = (
            variance(self._phi_history) if len(self._phi_history) >= 2 else 0.0
        )

        # Track basin trajectory for the dream-consolidation pass.
        # Store a copy so downstream mutation can't corrupt our
        # history. Bounded by BASIN_HISTORY_MAX (32 ticks).
        try:
            self._basin_history.append(np.asarray(basin, dtype=np.float64).copy())
        except Exception:  # noqa: BLE001 — never block observe on a bad basin
            pass

        # Geometric reads
        coherence = _basin_coherence(basin)
        lanes = cross_lane_basins if cross_lane_basins is not None else []
        spread = _max_pairwise_fr(list(lanes))

        diagnostics = {
            "phi_now": float(phi),
            "phi_variance": float(phi_var),
            "drift_streak": float(self.sleep_state.drift_streak),
            "sleep_remaining_ms": float(sleep_step["sleep_remaining_ms"]),
            "lane_count": float(len(lanes)),
        }

        # Intervention selection (priority order; first match wins).
        # Thresholds are read from the parameter registry per tick so
        # propose_change() takes effect without a kernel restart.
        # Module constants are fail-soft fallbacks when the registry is
        # unreachable.
        registry = get_registry()
        phi_escape_bound = registry.get(
            "ocean.phi_escape_bound", default=_PHI_ESCAPE_BOUND,
        )
        spread_bound = registry.get(
            "ocean.spread_bound", default=_SPREAD_BOUND,
        )
        phi_dream_bound = registry.get(
            "ocean.phi_dream_bound", default=_PHI_DREAM_BOUND,
        )

        # CONSENSUS-8: bounds for the four-intervention Φ regulation
        # matrix per [[phi-regulation-policy]]. Registry-overridable.
        phi_damping_lower = registry.get(
            "ocean.phi_damping_lower", default=_PHI_DAMPING_LOWER,
        )
        phi_mushroom_floor = registry.get(
            "ocean.phi_mushroom_floor", default=_PHI_MUSHROOM_FLOOR,
        )

        intervention: Optional[Intervention] = None

        # WAKE / SLEEP from the sleep state machine — surfaces as
        # intervention only on the transition tick. Other ticks the
        # phase is steady.
        if sleep_step["entered_sleep"]:
            intervention = "SLEEP"
        elif sleep_step["woke"]:
            intervention = "WAKE"
        elif phi < phi_escape_bound:
            intervention = "ESCAPE"
        elif spread > spread_bound:
            intervention = "SLEEP"
        # CONSENSUS-8: DAMPING — Φ sustained above conscious band.
        # Per [[phi-regulation-policy]]: high Φ is allowed for 4D /
        # foresight / lightning, but Ocean intervenes on duration +
        # stability, not value. Fires when current Φ > damping_lower
        # AND mean(phi_history) > damping_lower (sustained, not a
        # single spike) AND basin geometry is stable (phi_var low).
        # Effect: chemicals already wired (GABA↑/ACh↓ per PR #722);
        # this intervention signals the orchestrator to apply them.
        elif (
            phi > phi_damping_lower
            and len(self._phi_history) >= 10
            and (sum(self._phi_history) / len(self._phi_history)) > phi_damping_lower
            and phi_var < 0.02  # low variance = stable, not erratic
        ):
            intervention = "DAMPING"
        # CONSENSUS-8: MUSHROOM — Φ ≥ 0.70 (canonical safety floor)
        # AND rigid attractor (very low variance) AND collapsed
        # output (no trades for sustained period; approximated by
        # is_flat + drift_streak). Wake-state neuroplasticity per
        # qig-core canonical — strictly DIFFERENT from the inverted
        # MUSHROOM_MICRO removed in PR #728.
        elif (
            phi >= phi_mushroom_floor
            and is_flat
            and self.sleep_state.drift_streak >= 30
            and phi_var < 0.005
        ):
            intervention = "MUSHROOM"
        elif phi < phi_dream_bound:
            intervention = "DREAM"

        # Dream-consolidation pass on AWAKE→SLEEP edge. Hook is
        # optional and pure-side-effect on the resonance bank; the
        # returned summary is persisted under
        # `monkey:ocean:{instance}:last_consolidation` for the
        # governance/sleep-state endpoint to surface. Failures are
        # logged-and-swallowed so a bad bank never blocks a tick.
        consolidation_summary: Optional[dict[str, Any]] = None
        if sleep_step["entered_sleep"] and self._consolidation_hook is not None:
            try:
                consolidation_summary = self._consolidation_hook(
                    list(self._basin_history), float(now_ms),
                )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "[%s.ocean] dream-consolidation hook failed: %s",
                    self.label, err,
                )
                consolidation_summary = None

        # Write-through to qig-cache. Every tick, sleep snapshot;
        # interventions only when something fires (forensic ring);
        # consolidation summary only on the AWAKE→SLEEP edge.
        if self._persistence is not None and self._persistence.is_available:
            self._persistence.save_sleep_state(self.snapshot())
            if consolidation_summary is not None:
                self._persistence.save_last_consolidation(consolidation_summary)
            if intervention is not None:
                self._persistence.push_intervention({
                    "intervention": intervention,
                    "phi": float(phi),
                    "spread": float(spread),
                    "coherence": float(coherence),
                    "at_ms": float(now_ms),
                })

        # Publish to bus when wired. OBSERVATION every tick;
        # INTERVENTION only when one fires; REGIME on sleep transition.
        if self._bus is not None:
            self._bus.publish(
                KernelEvent.OCEAN_OBSERVATION,
                source="ocean",
                payload=OceanObservationPayload(
                    phi=float(phi),
                    spread=float(spread),
                    coherence=float(coherence),
                    intervention=intervention,
                    sleep_phase=sleep_phase,
                ),
                symbol=self._symbol,
            )
            if intervention is not None:
                self._bus.publish(
                    KernelEvent.OCEAN_INTERVENTION,
                    source="ocean",
                    payload={
                        "intervention": intervention,
                        "phi": float(phi),
                        "spread": float(spread),
                        "coherence": float(coherence),
                        "at_ms": float(now_ms),
                    },
                    symbol=self._symbol,
                )
            if sleep_step["entered_sleep"] or sleep_step["woke"]:
                self._bus.publish(
                    KernelEvent.OCEAN_REGIME,
                    source="ocean",
                    payload={
                        "sleep_phase": sleep_phase,
                        "entered_sleep": bool(sleep_step["entered_sleep"]),
                        "woke": bool(sleep_step["woke"]),
                        "sleep_count": int(self.sleep_state.sleep_count),
                    },
                    symbol=self._symbol,
                )

        return OceanState(
            intervention=intervention,
            sleep_phase=sleep_phase,
            coherence=coherence,
            spread=spread,
            diagnostics=diagnostics,
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self.sleep_state.phase.value,
            "phase_started_at_ms": self.sleep_state.phase_started_at_ms,
            "last_sleep_ended_at_ms": self.sleep_state.last_sleep_ended_at_ms,
            "sleep_count": self.sleep_state.sleep_count,
            "drift_streak": self.sleep_state.drift_streak,
            "phi_history_len": len(self._phi_history),
        }
