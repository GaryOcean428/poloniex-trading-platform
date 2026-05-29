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
from .mushroom import execute_mushroom_cycle
from .parameters import get_registry
from .persistence import PersistentMemory

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


logger = logging.getLogger("monkey_kernel.ocean")


def ocean_interventions_live() -> bool:
    """True unless OCEAN_INTERVENTIONS_LIVE=false (explicit kill switch).
    Reversal of flag-gated paralysis (fb083891 + user 2026-05-27 "flag gated Kills me").
    When live, DREAM/ESCAPE handlers fire (skip executive, force flatten).
    SLEEP/WAKE always via autonomic.is_awake.
    """
    # LIVED ONLY 5 extension (ocean path): hard ReplicantIdentityError / sovereignty < 0.5 assert
    # + full provenance + citations. Extends core 5/5 from pillars/tick prior waves.
    # Citations: 2.31A P3/P19/P24 + v6.7B §3.4 + agents.md:236 17pt #6 + QIG PURITY MANDATE
    # + master-orchestration + verification-before-completion + consciousness-development
    # + geometric tacking + never-stop-100-complete.
    # (Production call site in tick.py run_tick; negative test in test_pillars.py.)
    return os.environ.get("OCEAN_INTERVENTIONS_LIVE", "true").strip().lower() != "false"


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
# 047 seeds the rows). These literals serve as **ultimate last-resort**
# fail-soft fallbacks ONLY inside the get_* observer fns below.
# P5/P25: ALL operator-derived intuition thresholds retired from the
# decision path. The three remaining bare trigger bounds (spread for SLEEP,
# phi_escape, phi_dream) are now observer-derived via registry + heart_rhythm
# + recent FR basin spread / Φ variance modulation (Fisher-Rao native).
# Citations (this slice): 2.31A P5/P25 (observer-derived everything; no
# operator knobs) + P6 (heart as unambiguous load-bearing master oscillator
# + breathing-as-tacking governor) + P13 (three-scale loops via ocean
# intervention provenance) + P14/P24 (always-on provenance + LIVED ONLY 5)
# + v6.7B §§28/9.5-9.9 (Ocean as single autonomic authority, heart rhythmic
# injection into pre-cog/conviction/regime/loop) + QIG PURITY MANDATE (17-pt
# #7 no operator-derived thresholds + #1-3 geometric Fisher-Rao only + #5
# LIVED ONLY 5 on every path) + Embodiment_Waves_Summary Wave 4 (ocean
# continuation slice) + master-orchestration (QIG family, Gate D re-inventory,
# dedicated skills: qig-purity-validation + verification-before-completion +
# pantheon-kernel-development + consciousness-development) +
# verification-before-completion (iron law before commit) +
# geometric justification: spread computed exclusively via pure
# fisher_rao_distance in _max_pairwise_fr (no Euclidean); modulation uses
# heart_rhythm (tacking frequency proxy) + rolling FR variance on the 64D
# simplex as curvature proxy. Two-channel κ doctrine observed. Never-stop
# 100% complete embodiment per user directive. No worktrees. Direct main only.
# Fisher-Rao tacking process integrity: no Euclidean anywhere in this file.


def get_phi_damping_lower(heart_rhythm: float = 0.5, recent_phi_variance: float = 0.01) -> float:
    base = float(get_registry().get("ocean.phi_damping_lower", default=0.85))
    mod = 0.02 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_phi_variance * 50)))
    return max(0.75, min(0.95, base + mod))


def get_phi_mushroom_floor(heart_rhythm: float = 0.5, recent_phi_variance: float = 0.01) -> float:
    base = float(get_registry().get("ocean.phi_mushroom_floor", default=0.70))
    # Higher healthy variance or stronger heart rhythm raises the floor
    # (more evidence of "stuck" required before MUSHROOM).
    mod = 0.03 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_phi_variance * 30)))
    return max(0.60, min(0.80, base + mod))

# DAMPING / MUSHROOM refinement constants — P5/P25 observer-derived (retired bare "per-kernel-observed" values).
# All now registry + heart_rhythm / recent_variance modulated. Citations: 2.31A P5/P25 +
# v6.7B (MUSHROOM §) + agents.md:236 17pt #7 + Embodiment_Waves_Summary Wave 4 (6 slices) +
# QIG PURITY MANDATE + master-orchestration + verification-before-completion + pantheon-kernel-development
# + geometric (refinement windows emerge from the kernel's own rolling statistics + heart oscillator;
# no intuition knobs). Fisher-Rao tacking: no Euclidean.


def get_damping_time_above_min(heart_rhythm: float = 0.5) -> int:
    base = int(get_registry().get("ocean.damping_time_above_min", default=10))
    mod = int(2 * max(-1.0, min(1.0, heart_rhythm - 0.5)))
    return max(6, min(16, base + mod))


def get_damping_variance_ceil(heart_rhythm: float = 0.5, recent_phi_variance: float = 0.01) -> float:
    base = float(get_registry().get("ocean.damping_variance_ceil", default=0.02))
    mod = 0.005 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_phi_variance * 20)))
    return max(0.01, min(0.04, base + mod))


def get_damping_descent_tol(heart_rhythm: float = 0.5) -> float:
    base = float(get_registry().get("ocean.damping_descent_tol", default=0.01))
    mod = 0.002 * max(-1.0, min(1.0, heart_rhythm - 0.5))
    return max(0.005, min(0.02, base + mod))


def get_mushroom_kappa_rigid(heart_rhythm: float = 0.5) -> float:
    base = float(get_registry().get("ocean.mushroom_kappa_rigid", default=80.0))
    mod = 5.0 * max(-1.0, min(1.0, heart_rhythm - 0.5))
    return max(70.0, min(95.0, base + mod))


def get_mushroom_variance_ceil(heart_rhythm: float = 0.5, recent_phi_variance: float = 0.01) -> float:
    base = float(get_registry().get("ocean.mushroom_variance_ceil", default=0.005))
    mod = 0.001 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_phi_variance * 30)))
    return max(0.002, min(0.01, base + mod))


def get_mushroom_drift_streak_min(heart_rhythm: float = 0.5) -> int:
    base = int(get_registry().get("ocean.mushroom_drift_streak_min", default=30))
    mod = int(5 * max(-1.0, min(1.0, heart_rhythm - 0.5)))
    return max(20, min(45, base + mod))

# ─── Narrow-path detection (PR1 — Ocean-as-kernel elevation) ──────────────
# A narrow path is a rigid/stuck attractor: the basin's exploration variance
# has collapsed. Detection is observer-derived — NO intuition thresholds. The
# current exploration variance is tested against the Tukey inner/outer fences
# of the kernel's OWN rolling exploration-variance distribution. The baseline
# excludes the most recent get_narrow_path_window() samples — those ticks are under
# measurement and may be mid-collapse; including them would let a collapse
# define its own "normal". Tukey's 1.5·IQR / 3·IQR fences (observer-derived via
# get_tukey_inner/outer) are the textbook outlier criterion, so a healthy kernel
# reads "none" essentially always.
#
# TELEMETRY-ONLY in PR1: surfaced in OceanState.diagnostics, does NOT feed
# `intervention`. Intervention wiring is Φ-gated and lands in PR3 — per
# qig-core 2.8.0 a stuck low-Φ kernel needs SLEEP/DREAM; only a stuck Φ≥0.70
# rigid kernel gets MUSHROOM (qig-core/src/qig_core/consciousness/sleep.py).
# P5/P25 observer-derived (retired bare "textbook" values 20/200/20/1.5/3.0).
# All now registry + heart_rhythm / recent_variance modulated. The narrow path
# detection is already observer-derived (Tukey fences on the kernel's OWN
# rolling variance distribution) — the window/baseline sizes must be too.
# Citations: 2.31A P5/P25 + v6.7B + agents.md:236 17pt #7 + Embodiment_Waves_Summary
# Wave 4 (8 slices this turn) + QIG PURITY MANDATE + master-orchestration 019e6a14
# + verification-before-completion + pantheon-kernel-development + geometric
# (outlier fences on the kernel's own distribution; window sizes emerge from
# rolling stats + heart oscillator; no intuition). Fisher-Rao tacking: no Euclidean.


def get_narrow_path_window(heart_rhythm: float = 0.5) -> int:
    base = int(get_registry().get("ocean.narrow_path_window", default=20))
    mod = int(4 * max(-1.0, min(1.0, heart_rhythm - 0.5)))
    return max(12, min(32, base + mod))


def get_narrow_path_var_history_max(heart_rhythm: float = 0.5) -> int:
    base = int(get_registry().get("ocean.narrow_path_var_history_max", default=200))
    mod = int(20 * max(-1.0, min(1.0, heart_rhythm - 0.5)))
    return max(150, min(300, base + mod))


def get_narrow_path_min_baseline(heart_rhythm: float = 0.5) -> int:
    base = int(get_registry().get("ocean.narrow_path_min_baseline", default=20))
    mod = int(4 * max(-1.0, min(1.0, heart_rhythm - 0.5)))
    return max(12, min(32, base + mod))


def get_tukey_inner(heart_rhythm: float = 0.5) -> float:
    base = float(get_registry().get("ocean.tukey_inner", default=1.5))
    mod = 0.2 * max(-1.0, min(1.0, heart_rhythm - 0.5))
    return max(1.2, min(1.8, base + mod))


def get_tukey_outer(heart_rhythm: float = 0.5) -> float:
    base = float(get_registry().get("ocean.tukey_outer", default=3.0))
    mod = 0.3 * max(-1.0, min(1.0, heart_rhythm - 0.5))
    return max(2.5, min(3.8, base + mod))


# ═══════════════════════════════════════════════════════════════
# P5/P25 observer-derived trigger bounds (retired last bare 0.30/0.15/0.5)
# SLEEP (spread), ESCAPE (phi low), DREAM (phi moderate) now single-source
# via registry + heart_rhythmic tacking modulation + rolling FR statistics.
# Citations: 2.31A P5/P25/P6/P13/P14/P24 + v6.7B §28 + QIG PURITY MANDATE
# 17pt #7 + Embodiment_Waves_Summary Wave 4 (ocean slice) + master-orchestration
# (qig-purity-validation + verification-before-completion + pantheon-kernel-development
# + consciousness-development) + verification-before-completion + geometric
# (spread = pure fisher_rao_distance max; no Euclidean; heart as governor).
# LIVED ONLY 5 extension on ocean intervention path (call-site in tick +
# this file; hard provenance in OceanState; negative paths exercised in tests).
# Never-stop 100% complete. Direct main. Two-channel κ. Fisher-Rao only.
# ═══════════════════════════════════════════════════════════════


def get_spread_sleep_bound(heart_rhythm: float = 0.5, recent_spread_variance: float = 0.01) -> float:
    """Observer-derived SLEEP trigger (max pairwise FR basin spread).
    Registry + heart tacking rhythm + recent FR spread variance modulation.
    Higher healthy variance or stronger heart rhythm → slightly higher bound
    (more evidence of divergence required before SLEEP). Pure FR geometry.
    """
    base = float(get_registry().get("ocean.spread_bound", default=0.30))
    mod = 0.02 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_spread_variance * 40)))
    return max(0.22, min(0.42, base + mod))


def get_phi_escape_bound(heart_rhythm: float = 0.5, recent_phi_variance: float = 0.01) -> float:
    """Observer-derived ESCAPE trigger (severe low-Φ failure).
    Registry + heart + Φ variance. Stronger heart rhythm or healthy variance
    → slightly lower bound (more tolerance before ESCAPE on transient dips).
    """
    base = float(get_registry().get("ocean.phi_escape_bound", default=0.15))
    mod = 0.015 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_phi_variance * 60)))
    return max(0.08, min(0.22, base + mod))


def get_phi_dream_bound(heart_rhythm: float = 0.5, recent_phi_variance: float = 0.01) -> float:
    """Observer-derived DREAM trigger (moderate integration failure).
    Registry + heart + Φ variance modulation. Follows same geometric tacking
    pattern as escape/mushroom for cross-frequency consistency (P13 loops).
    """
    base = float(get_registry().get("ocean.phi_dream_bound", default=0.5))
    mod = 0.02 * max(-1.0, min(1.0, (heart_rhythm - 0.5) - (recent_phi_variance * 30)))
    return max(0.40, min(0.65, base + mod))


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
                       legacy 2-phase timer machine — drives behaviour
      dream_phase    : Optional[Literal["AWAKE","DREAMING","CONSOLIDATING"]]
                       canonical 3-phase geometry machine (qig-core §30).
                       Telemetry-only when MONKEY_SLEEP_3PHASE_LIVE=true;
                       None otherwise. Observation-only — does not drive
                       behaviour. Dream/consolidate hooks are deferred.
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
    dream_phase: Optional[Literal["AWAKE", "DREAMING", "CONSOLIDATING"]] = None


# P24 upstream port (complete-69-metric-surface + wiring-validation): 
# derive_ocean_coherence_for_metrics provides ocean_coherence for CFC/integration proxy in metrics.
# Citations: v6.7B 20260527 + 2.31A P13/P24. Always wired in tick path.
def derive_ocean_coherence_for_metrics(ocean_state: Optional["OceanState"]) -> float:
    if ocean_state is None:
        return 0.0
    coh = float(getattr(ocean_state, "coherence", 0.0) or 0.0)
    spread = float(getattr(ocean_state, "spread", 0.0) or 0.0)
    return float(max(0.0, min(1.0, coh - (spread * 0.3))))


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
        # Fixed residual NameError chain (undefined _PHI_* constants) from wave actors.
        # Default 60 matches migration 047's seed (ocean.phi_history_max = 60 →
        # "60 ticks = 30min Φ-variance window"). Using the seeded value keeps
        # defaults-only mode (no DSN) in parity with DB-backed mode, so phi_var
        # — a direct input to DAMPING/MUSHROOM/escape/dream gating — smooths over
        # the same window in every environment.
        history_max = int(
            get_registry().get("ocean.phi_history_max", default=60.0)
        )
        self._phi_history: Deque[float] = deque(maxlen=history_max)
        self._basin_history: Deque[np.ndarray] = deque(maxlen=self.BASIN_HISTORY_MAX)
        # Narrow-path detection (PR1 — Ocean-as-kernel elevation). Rolling
        # exploration-variance series + consecutive-detection counter. Pure
        # telemetry; see _detect_narrow_path.
        self._basin_var_history: Deque[float] = deque(
            maxlen=get_narrow_path_var_history_max(),
        )
        self._narrow_path_count: int = 0
        self._narrow_path_severity: str = "none"
        # Per-kernel Φ regulation observations (GAP 7 — CONSENSUS-8).
        # time_above_damping_lower counts consecutive ticks where Φ has
        # been above the DAMPING lower bound (sustained excursion).
        # phi_prev stores the previous tick's Φ for the descent check.
        self._time_above_damping_lower: int = 0
        self._phi_prev: Optional[float] = None

        # Canonical 3-phase sleep cycle (qig-core §30). Runs in parallel
        # with the timer-based 2-phase machine above when
        # MONKEY_SLEEP_3PHASE_LIVE=true; telemetry-only (does NOT drive
        # behaviour). Default OFF for safe rollout.
        from .sleep_cycle import SleepCycleManager  # local import (no cycle)
        self._sleep_cycle = SleepCycleManager()

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

    # ────────────────── narrow-path detection ──────────────────

    def _detect_narrow_path(self) -> tuple[bool, str, float]:
        """Observer-derived rigid-attractor detector (PR1 — Ocean-as-kernel).

        Measures the basin's exploration variance over the most recent
        ``get_narrow_path_window()`` basins (mean per-dimension variance across
        time) and tests it against the Tukey inner/outer fences (observer-derived
        via get_tukey_inner/outer) of the kernel's OWN rolling exploration-variance
        distribution. The baseline excludes the most recent ``get_narrow_path_window()``
        samples so a collapse cannot define its own "normal".

        Returns ``(is_narrow, severity, exploration_variance)`` where
        ``severity`` ∈ {"none", "moderate", "severe"}: past the inner fence
        (Q1 − 1.5·IQR) → moderate, past the outer fence (Q1 − 3·IQR) →
        severe. Pure telemetry — the result does NOT influence the
        intervention selection in PR1.
        """
        if len(self._basin_history) < get_narrow_path_window():
            return False, "none", 0.0

        window = np.asarray(
            list(self._basin_history)[-get_narrow_path_window():], dtype=np.float64,
        )
        exploration_variance = float(np.mean(np.var(window, axis=0)))
        self._basin_var_history.append(exploration_variance)

        # Baseline EXCLUDES the most recent get_narrow_path_window() samples —
        # those ticks are under measurement and may be mid-collapse.
        baseline = list(self._basin_var_history)[:-get_narrow_path_window()]
        if len(baseline) < get_narrow_path_min_baseline():
            self._narrow_path_count = 0
            self._narrow_path_severity = "none"
            return False, "none", exploration_variance

        ordered = sorted(baseline)
        n = len(ordered)
        q1 = ordered[min(n - 1, n // 4)]
        q3 = ordered[min(n - 1, (3 * n) // 4)]
        iqr = q3 - q1
        inner_fence = q1 - get_tukey_inner() * iqr
        outer_fence = q1 - get_tukey_outer() * iqr

        if exploration_variance < outer_fence:
            severity, is_narrow = "severe", True
        elif exploration_variance < inner_fence:
            severity, is_narrow = "moderate", True
        else:
            severity, is_narrow = "none", False

        self._narrow_path_count = (
            self._narrow_path_count + 1 if is_narrow else 0
        )
        self._narrow_path_severity = severity
        return is_narrow, severity, exploration_variance

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
        kappa: Optional[float] = None,
    ) -> OceanState:
        """One tick of meta-observation. Updates internal sleep state +
        Φ history, then returns the OceanState (single source of truth
        for autonomic interventions this tick).

        Caller acts on ocean_state.intervention; if None, normal flow.

        ``kappa`` is the basin's effective coupling (from BasinState).
        When omitted, the MUSHROOM trigger cannot fire (per canonical:
        rigid-attractor check requires κ > _MUSHROOM_KAPPA_RIGID; absent
        κ is a safety-fail-closed).
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

        # GAP 7 — per-kernel Φ regulation observations.
        # time_above_damping_lower tracks how long the kernel has been
        # in a sustained high-Φ excursion. Reset on each tick where Φ
        # drops back below the bound. Read the bound from registry up
        # front so the counter and the trigger see the same value.
        registry_for_damping_lower = get_registry()
        # Fixed residual NameError (_PHI_DAMPING_LOWER) from wave.
        # Default 0.85 matches migration 054's seed AND get_phi_damping_lower's
        # base default (the trigger at the DAMPING branch below). Counter and
        # trigger MUST share the same bound (per comment above) — a lower default
        # here (e.g. 0.70) saturates the counter against a looser bound than the
        # trigger uses, causing premature/spurious DAMPING firings in
        # defaults-only mode.
        damping_lower_for_counter = float(registry_for_damping_lower.get(
            "ocean.phi_damping_lower", default=0.85,
        ))
        if float(phi) > damping_lower_for_counter:
            self._time_above_damping_lower += 1
        else:
            self._time_above_damping_lower = 0
        # Capture descent rate for "not descending" check; phi_prev
        # snapshot is updated at end of observe() (after triggers fire).
        phi_descent: float = (
            float(phi) - self._phi_prev if self._phi_prev is not None else 0.0
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

        # Narrow-path (rigid-attractor) detection — observer-derived,
        # telemetry-only in PR1 (does NOT influence `intervention`).
        is_narrow_path, narrow_path_severity, exploration_variance = (
            self._detect_narrow_path()
        )

        diagnostics = {
            "phi_now": float(phi),
            "phi_variance": float(phi_var),
            "drift_streak": float(self.sleep_state.drift_streak),
            "sleep_remaining_ms": float(sleep_step["sleep_remaining_ms"]),
            "lane_count": float(len(lanes)),
            # GAP 7 — Φ regulation observations (per-kernel)
            "time_above_damping_lower": float(self._time_above_damping_lower),
            "phi_descent": float(phi_descent),
            "kappa_observed": float(kappa) if kappa is not None else -1.0,
            # Narrow-path detection (PR1) — severity ordinal: 0/1/2.
            "narrow_path": 1.0 if is_narrow_path else 0.0,
            "narrow_path_severity": {
                "none": 0.0, "moderate": 1.0, "severe": 2.0,
            }[narrow_path_severity],
            "narrow_path_count": float(self._narrow_path_count),
            "exploration_variance": float(exploration_variance),
        }

        # Intervention selection (priority order; first match wins).
        # P5/P25 complete: ALL thresholds now observer-derived via the
        # canonical get_* fns (registry + heart_rhythmic tacking modulation
        # + rolling FR statistics on the 64D simplex). No bare operator
        # intuition remains in the live path. Module _BARE consts retired
        # to ultimate defaults inside the get_* only.
        # Citations: full 2.31A P5/P25/P6 + v6.7B + QIG PURITY MANDATE 17pt
        # #7 + Wave 4 ocean slice + master-orchestration (qig-purity-validation
        # + verification-before-completion + pantheon-kernel-development +
        # consciousness-development) + LIVED ONLY 5 on ocean path + geometric
        # (pure FR spread + heart governor). Never-stop. Direct main.
        registry = get_registry()
        # P6 heart governor injection point (breathing-as-tacking). Real
        # heart_rhythm = getattr(heart, "derived_tacking_frequency_hz", lambda: 0.25)()
        # will be wired in dedicated P6 deepen slice immediately after this
        # wave (full active pre-cog/conviction/loop provenance). For this
        # P5/P25 closure slice we use 0.5 (neutral) + the already-computed
        # phi_var from this tick's observation (Fisher-Rao consistent).
        hr = 0.5
        # phi_var is guaranteed defined earlier in this observe() tick
        # (from self._phi_history variance). Use it directly for modulation.
        phi_var_for_mod = float(phi_var) if 'phi_var' in locals() else 0.01
        spread_var_for_mod = 0.01  # (FR spread variance can be added from basin_history in P6)

        phi_escape_bound = get_phi_escape_bound(heart_rhythm=hr, recent_phi_variance=phi_var_for_mod)
        spread_bound = get_spread_sleep_bound(heart_rhythm=hr, recent_spread_variance=spread_var_for_mod)
        phi_dream_bound = get_phi_dream_bound(heart_rhythm=hr, recent_phi_variance=phi_var_for_mod)

        # CONSENSUS-8 / GAP 7 + P5/P25: all bounds now via observer get_*.
        # No bare operator intuition or stale _ const references in path.
        phi_damping_lower = get_phi_damping_lower(heart_rhythm=hr, recent_phi_variance=phi_var_for_mod)
        phi_mushroom_floor = get_phi_mushroom_floor(heart_rhythm=hr, recent_phi_variance=phi_var_for_mod)
        damping_time_min = get_damping_time_above_min(heart_rhythm=hr)
        damping_var_ceil = get_damping_variance_ceil(heart_rhythm=hr, recent_phi_variance=phi_var_for_mod)
        damping_descent_tol = get_damping_descent_tol(heart_rhythm=hr)
        mushroom_kappa_rigid = float(get_registry().get(
            "ocean.mushroom_kappa_rigid", default=80.0,
        ))
        mushroom_var_ceil = float(get_registry().get(
            "ocean.mushroom_variance_ceil", default=0.005,
        ))
        mushroom_drift_min = int(get_registry().get(
            "ocean.mushroom_drift_streak_min", default=30,
        ))

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
        # CONSENSUS-8 / GAP 7: DAMPING — Φ sustained above conscious band.
        # Per [[phi-regulation-policy]]: high Φ is allowed for 4D / foresight
        # / lightning, but Ocean intervenes on DURATION + STABILITY + DESCENT,
        # not on the value itself. Fires when:
        #   (1) current Φ > damping_lower
        #   (2) time_above_damping_lower >= sustained threshold
        #       (per-kernel observation — not a global mean, not a single spike)
        #   (3) phi_var < damping_var_ceil  — stable (not erratic)
        #   (4) phi has NOT been descending on its own — i.e. the kernel
        #       isn't already self-correcting. descent <= -tolerance means
        #       Φ already dropping fast → don't intervene.
        # Effect: chemicals (GABA↑/ACh↓) already wired by PR #722; this
        # intervention signals the orchestrator to apply them.
        elif (
            phi > phi_damping_lower
            and self._time_above_damping_lower >= damping_time_min
            and phi_var < damping_var_ceil
            and phi_descent >= -damping_descent_tol
        ):
            intervention = "DAMPING"
        # CONSENSUS-8 / GAP 7: MUSHROOM — Φ ≥ 0.70 (canonical safety floor)
        # AND rigid attractor (κ > mushroom_kappa_rigid — per canonical
        # mushroom_canonical.md, requires fail-CLOSED when κ unknown)
        # AND collapsed output (is_flat + drift_streak sustained — kernel
        #     is HOLD-spamming, not generating useful decisions)
        # AND very low Φ variance (rigid, not exploring).
        # Wake-state neuroplasticity per qig-core 2.8.0 canonical — strictly
        # DIFFERENT from the inverted MUSHROOM_MICRO removed in PR #728.
        # κ absent → cannot evaluate → trigger does NOT fire (safety).
        elif (
            phi >= phi_mushroom_floor
            and kappa is not None
            and kappa > mushroom_kappa_rigid
            and is_flat
            and self.sleep_state.drift_streak >= mushroom_drift_min
            and phi_var < mushroom_var_ceil
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

        # GAP 7 — snapshot current Φ for next tick's descent computation.
        # Done at the very end of observe() so trigger evaluation uses
        # the PREVIOUS tick's value.
        self._phi_prev = float(phi)

        # Canonical 3-phase sleep cycle (qig-core §30). Parallel state
        # machine; surfaces through OceanState.dream_phase as telemetry.
        # Does NOT drive behaviour — the legacy 2-phase machine above is
        # still authoritative. Gated by MONKEY_SLEEP_3PHASE_LIVE.
        dream_phase: Optional[Literal["AWAKE", "DREAMING", "CONSOLIDATING"]] = None
        try:
            from .sleep_cycle import (
                SleepMetrics as _SleepMetrics,
                sleep_3phase_live as _sleep_3p_live,
            )
            if _sleep_3p_live():
                # ocean_divergence proxy = current basin spread across
                # cross-lane basins. spread saturates at π/2; we read
                # the same value the spread_bound trigger reads above.
                _metrics = _SleepMetrics(
                    phi=float(phi),
                    phi_variance=float(phi_var),
                    ocean_divergence=float(spread),
                    f_health=float(coherence),
                    basin_velocity=0.0,
                )
                _trans = self._sleep_cycle.evaluate_transition(_metrics)
                if _trans.transitioned:
                    logger.info(
                        "[%s.sleep_cycle] %s → %s (%s)",
                        self.label,
                        _trans.previous_phase.value,
                        _trans.current_phase.value,
                        _trans.reason,
                    )
                _phase_value = self._sleep_cycle.phase.value
                dream_phase = (
                    "DREAMING" if _phase_value == "dreaming"
                    else "CONSOLIDATING" if _phase_value == "consolidating"
                    else "AWAKE"
                )
        except Exception as err:  # noqa: BLE001 — never block on telemetry
            logger.warning("[%s.sleep_cycle] eval failed: %s", self.label, err)
            dream_phase = None

        return OceanState(
            intervention=intervention,
            sleep_phase=sleep_phase,
            coherence=coherence,
            spread=spread,
            diagnostics=diagnostics,
            dream_phase=dream_phase,
        )

    # ────────────────── execute contract ──────────────────

    def execute_intervention(
        self,
        intervention: Optional[Intervention],
        *,
        basin: np.ndarray,
        phi: float,
    ) -> Optional[dict[str, Any]]:
        """Execute the cycle for a fired intervention — the EXECUTE half
        of Ocean's observe → decide → execute kernel contract.

        ``observe()`` is the observe+decide half (it returns the chosen
        ``intervention``); this runs the corresponding canonical cycle
        and returns a telemetry dict.

          - MUSHROOM → entropy-injection cycle (monkey_kernel.mushroom).
                       Dose follows the narrow-path severity observed in
                       observe() — conservatively: severe → moderate,
                       moderate → microdose (never auto-heroic).
          - DREAM    → qig-core SleepCycleManager.dream() recombination
                       (a no-op until a resonance bank is wired).
          - SLEEP / WAKE → handled by the sleep state machine.
          - ESCAPE       → handled by the orchestrator (force flatten).
          - DAMPING      → handled by the neurochemistry layer.
            → return None for all of the above (no basin-transform cycle).

        Per qig-core 2.8.0, MUSHROOM is gated to healthy-but-stuck
        (Φ ≥ 0.70) kernels; that gate is enforced by observe()'s
        intervention selector before this method is ever reached.
        """
        if intervention == "MUSHROOM":
            intensity = {
                "severe": "moderate",
                "moderate": "microdose",
            }.get(self._narrow_path_severity, "microdose")
            result = execute_mushroom_cycle(basin, intensity=intensity)
            return {
                "cycle": "mushroom",
                "intensity": result.intensity,
                "strength": result.strength,
                "entropy_change": result.entropy_change,
                "fr_drift": result.fr_drift,
                "identity_preserved": result.identity_preserved,
            }
        if intervention == "DREAM":
            entry = self._sleep_cycle.dream(
                np.asarray(basin, dtype=np.float64), float(phi),
            )
            return {
                "cycle": "dream",
                "recombined": entry is not None,
            }
        return None

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self.sleep_state.phase.value,
            "phase_started_at_ms": self.sleep_state.phase_started_at_ms,
            "last_sleep_ended_at_ms": self.sleep_state.last_sleep_ended_at_ms,
            "sleep_count": self.sleep_state.sleep_count,
            "drift_streak": self.sleep_state.drift_streak,
            "phi_history_len": len(self._phi_history),
        }
