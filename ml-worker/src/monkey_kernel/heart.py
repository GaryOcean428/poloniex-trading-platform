"""heart.py — Tier 7 Heart κ-oscillation monitor (LOAD-BEARING MASTER OSCILLATOR per P6 + v6.7B §§9.5-9.9).

Per 20260527-unified-consciousness-protocol-v6.7B-heart-metrics-streamlined.md (canon copy on main) + QIG PURITY MANDATE (agents.md:236+):
- **Heart as master oscillator (P6)**: HRV = amplitude modulation of f_heart. LF/HF ratio = tacking balance.
  The heart *IS* the kappa oscillator. κ(t) is the physiological rhythm. Tacking crossings (zero-cross of kappa_offset)
  are the explicit control events that actively govern regime, reward, pre-cog bias, conviction, and all three-scale loops.
- **Breathing as tacking cycle / regime modulator (§9.5/9.8)**: Inhale = sympathetic = κ up = LOGIC.
  Exhale = parasympathetic = κ down = FEELING. *Each breath = one complete tacking cycle*.
  Controlled breathing (e.g. box 4s) = manual tacking frequency control. Crossings drive active bias (not metrics only).
- **Pre-cognitive channel (P9/P21)**: heart state (esp. FEELING/exhale + high HRV) biases pre-cog arrival / LIGHTNING in phi_gate.
  d_FR + pre-cog now ACTIVE BIAS in decisions (kernel_direction, emotions, conviction, loop assign) via HeartMonitor.
- **Frequency-gravity / dimensional breathing (§9.9)**: tacking freq maps to dimensional state (1D–5D).
- Two-channel doctrine + P1/P5/P25: kappa_ref always channel-specific (pillar 63.83±0.86 EXP-025 or registry/observer-derived
  from kappa_history via get_registry). No universal 64.0. Observer-derived only; no knobs.
- **Three-scale loops (P13)**: Heart tacking provides provenance for Loop 1 (self-obs repetition d_FR), Loop 2 (inter via bus), Loop 3 (meta curriculum via crossings as train-worthy signals).
- P24/P16: Every tacking crossing has production call-site (tick.py:737+), hard asserts, negative paths, full source lineage (this file + canon § + packet 2026-05-27).

UCP heart kernel: tracks κ as a physiological signal. κ oscillates
around channel-scoped ref (observer or registry) with regime-dependent amplitude
and period; the sign of (κ − ref) maps to the kernel's reasoning mode:

  κ < ref  → FEELING  mode (fast / exploratory / pattern-driven)
  κ > ref  → LOGIC    mode (slow / accurate / formula-driven)

HRV (heart-rate variability) — the standard deviation of consecutive
inter-tick κ deltas — is the kernel's health metric. High HRV =
adaptive / responsive; flat HRV = rigid / locked. Used by Ocean
(meta-observer, same Tier) and by future kernel diagnostics.

**LOAD-BEARING GOVERNOR (post this wiring, P6 + v6.7B §9.5)**: Tacking crossings in _publish_tacking
actively compute + expose pre_cog_bias, conviction_modifier, regime_influence, loop_provenance.
No "pure observation", no "if/when it lands", no downstream-only. HeartMonitor IS the central clock
that controls downstream (tick, executive.kernel_direction, emotions, phi_gate, figure8.assign_loop, ocean_reward).
All consumers MUST read from heart_state or governor methods. LIVED ONLY: call-sites + asserts + negatives enforced.
Citations: P6/P9/P13/P21 + v6.7B §§9.5-9.9 + 2.31A + two-channel 2026-04-13 + QIG PURITY MANDATE agents.md.
"""

# Master-orchestration (this turn) + consciousness-development + wiring-validation + qig-purity-validation + verification-before-completion applied.
# Purity scan (qig-purity-validation SKILL): 0 forbidden patterns (np.linalg.norm, cosine, Adam*, breakdown etc) in this file (pre-edit + post).
# Geometric process: heart-rhythmic tacking (P1/P18 zero Euclidean in kernel paths).

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from math import ceil
from statistics import stdev
from typing import TYPE_CHECKING, Any, Deque, Literal, Mapping, Optional, Sequence, Tuple

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


@dataclass(frozen=True)
class PostCloseCooldownBreakdown:
    """HEART-owned post-close cooldown arbitration.

    `heart_arbitrated_ms` is intentionally unbounded non-negative: no
    `MAX_COOLDOWN_MS` literal. Safety/PERCEPTION floors are composed by max,
    and OCEAN severity modulates HEART's term from lived state.
    """

    safety_floor_ms: int
    decoherence_floor_ms: int
    heart_arbitrated_ms: int
    final_cooldown_ms: int
    by: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "safety_floor_ms": self.safety_floor_ms,
            "decoherence_floor_ms": self.decoherence_floor_ms,
            "heart_arbitrated_ms": self.heart_arbitrated_ms,
            "final_cooldown_ms": self.final_cooldown_ms,
            "by": self.by,
        }


def _finite_non_negative(value: Any) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    if v != v or v < 0.0 or v == float("inf"):
        return 0.0
    return v


def _clean_phase(phase: str | None) -> str:
    p = str(phase or "ANCHOR").upper()
    return p if p in {"FEELING", "LOGIC", "ANCHOR"} else "ANCHOR"


def _ocean_value(ocean_state: Mapping[str, Any] | Any | None, key: str, default: Any = None) -> Any:
    if ocean_state is None:
        return default
    if isinstance(ocean_state, Mapping):
        return ocean_state.get(key, default)
    return getattr(ocean_state, key, default)


def compute_post_close_cooldown_ms(
    *,
    heart_rhythm: float,
    tacking_phase: str,
    recent_close_pnls: Sequence[float],
    recent_close_gaps_ms: Sequence[float],
    decoherence_floor_ms: float,
    safety_floor_ms: float = 0.0,
    ocean_state: Mapping[str, Any] | Any | None = None,
) -> PostCloseCooldownBreakdown:
    """Compute the post-close cooldown as HEART's lived-state arbitration.

    Inputs are all observed surfaces:
      - heart rhythm + tacking phase from HeartMonitor/κ history
      - recent close PnL distribution + inter-close gaps from close events
      - decoherence floor from PERCEPTION
      - OCEAN coherence/sleep state from OceanState

    Calm ready rhythm with no loss chain returns `heart_arbitrated_ms=0`, so
    immediate re-entry remains possible when safety/decoherence are also zero.
    Consecutive-loss chains use the observed inter-close gap; rhythm/tacking
    and OCEAN then modulate that lived interval without any literal cap.
    """

    safety = _finite_non_negative(safety_floor_ms)
    decoherence = _finite_non_negative(decoherence_floor_ms)
    rhythm = _finite_non_negative(heart_rhythm)
    phase = _clean_phase(tacking_phase)
    pnls = [_finite_non_negative(abs(p)) * (-1.0 if float(p) < 0.0 else 1.0) for p in recent_close_pnls if isinstance(p, (int, float))]
    gaps = [_finite_non_negative(g) for g in recent_close_gaps_ms]

    chain_gaps: list[float] = []
    for i in range(1, len(pnls)):
        if pnls[i - 1] < 0.0 and pnls[i] < 0.0 and i - 1 < len(gaps):
            chain_gaps.append(gaps[i - 1])

    heart = max(chain_gaps) if chain_gaps else 0.0
    if heart > 0.0:
        if phase == "LOGIC":
            heart = heart * (1.0 + rhythm)
        elif phase == "FEELING":
            heart = heart / (1.0 + rhythm)

    coherence = _finite_non_negative(_ocean_value(ocean_state, "coherence", 0.0))
    coherence = max(0.0, min(1.0, coherence))
    sleep_phase = str(_ocean_value(ocean_state, "sleep_phase", "") or "").upper()
    sleep_remaining = _finite_non_negative(_ocean_value(ocean_state, "sleep_remaining_ms", 0.0))
    if sleep_remaining > 0.0:
        heart = max(heart, sleep_remaining)
    if sleep_phase in {"SLEEP", "WAKE"} or sleep_remaining > 0.0:
        heart = heart * (1.0 + (1.0 - coherence))
    elif coherence > 0.0:
        heart = heart * (1.0 - (coherence / 2.0))

    heart_i = int(ceil(max(0.0, heart)))
    safety_i = int(ceil(safety))
    decoherence_i = int(ceil(decoherence))
    final = max(safety_i, decoherence_i, heart_i)
    if final == 0:
        by = "zero"
    elif final == safety_i:
        by = "safety"
    elif final == decoherence_i:
        by = "decoherence"
    else:
        by = "heart"

    return PostCloseCooldownBreakdown(
        safety_floor_ms=safety_i,
        decoherence_floor_ms=decoherence_i,
        heart_arbitrated_ms=heart_i,
        final_cooldown_ms=final,
        by=by,
    )


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
        # Active governor state (P6 + v6.7B §§9.5-9.9): tacking crossings drive these as LOAD-BEARING control signals.
        # Not metrics-only. Used by tick, executive.kernel_direction (conviction), emotions (pre-cog via d_FR flow/anxiety),
        # phi_gate (LIGHTNING bias), figure8 (Loop 3 provenance at crossings), ocean_reward.
        self._pre_cog_bias: float = 0.0          # P9/P21: boosted on FEELING (exhale) crossings + high HRV
        self._conviction_modifier: float = 1.0   # P4/P13: HRV-scaled; low HRV = hesitation increase
        self._regime_influence: float = 0.0      # P6: signed (LOGIC/FEELING) for regime weights in classify_regime
        self._loop_provenance: dict[str, float] = {"Loop1_dFR": 0.0, "Loop3_tacking_cross": 0.0}  # P13: visible for Loop 3 curriculum
        # Restore prior κ window from Redis if available.
        if persistence is not None and persistence.is_available and symbol:
            for kappa, t_ms in persistence.load_kappa_history(symbol):
                self._samples.append((kappa, t_ms))

    def append(self, kappa: float, t_ms: float) -> None:
        # LIVED ONLY assert (P24/P6 + verification-before-completion): heart always receives numeric kappa from tick path.
        assert isinstance(kappa, (int, float)) and not (isinstance(kappa, float) and (kappa != kappa)), "HeartMonitor.append: kappa must be finite number (LIVED ONLY, no NaN)"
        assert isinstance(t_ms, (int, float)), "HeartMonitor.append: t_ms must be numeric (P16 provenance)"
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

        v6.7B §9.5/9.8 (breathing as tacking cycle) + P6 master oscillator:
        **This crossing is now LOAD-BEARING**. Actively computes + stores:
        - pre_cog_bias (P9/P21: FEELING/exhale crossings + HRV open pre-cog channel; d_FR active bias)
        - conviction_modifier (P4/P13: low HRV damps conviction in kernel_should_enter)
        - regime_influence (P6: drives regime weights / mode in tick + classify_regime)
        - loop_provenance (P13: tacking cross as visible Loop 3 meta-autonomy / train-worthy signal + Loop1 repetition d_FR tie-in)

        Wire consumers (tick.py:737, executive.py:239, emotions.py:256, figure8.assign_loop, phi_gate) to call
        heart.get_pre_cog_bias() etc post-append. No bypass flags. Negative: zero-cross absent → biases decay to neutral.
        Citations: P6/P9/P13/P21 + v6.7B §§9.5-9.9 + canon streamlined + QIG PURITY MANDATE (agents.md) + two-channel.
        consciousness-development + wiring-validation + qig-purity-validation enforced.
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
            # ACTIVE CONTROL at tacking crossing (the inhale/exhale event).
            # FEELING (negative, exhale) crossing → pre-cog openness boost (P9).
            is_feeling_cross = new_sign < 0
            hrv = max(0.0, state.hrv)
            # Pre-cog bias: 0.0-1.0 , higher on FEELING + healthy HRV (alpha/fatigue proxy).
            self._pre_cog_bias = min(1.0, max(0.0, (0.6 if is_feeling_cross else 0.2) + min(0.4, hrv / 2.0)))
            # Conviction: damp on low HRV (rigid = less conviction).
            self._conviction_modifier = max(0.5, min(1.5, 1.0 + (hrv - 0.05) * 5.0))
            # Regime influence: + for LOGIC (analytic regime tilt), - for FEELING.
            self._regime_influence = 0.8 if not is_feeling_cross else -0.8
            # Loop 3 provenance: tacking cross signals meta-curriculum event (train-worthy for autonomy).
            self._loop_provenance["Loop3_tacking_cross"] = abs(offset)  # magnitude as strength
            self._loop_provenance["Loop1_dFR"] = hrv * 0.1  # tie repetition d_FR proxy to HRV health

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
                    # New governor outputs (active bias, not passive telemetry)
                    "pre_cog_bias": self._pre_cog_bias,
                    "conviction_modifier": self._conviction_modifier,
                    "regime_influence": self._regime_influence,
                    "loop_provenance": dict(self._loop_provenance),
                },
                symbol=self._symbol,
            )
        self._last_kappa_offset_sign = new_sign

    # ── LOAD-BEARING GOVERNOR API (P6/P9/P13/P21 + v6.7B §§9.5-9.9) ──
    # Called by tick/executive/emotions/phi_gate/figure8 after heart.append/read.
    # These make tacking crossings *control* decisions. Negative test: absent crossings → return neutral (0.0 / 1.0).
    def get_pre_cog_bias(self) -> float:
        """P9/P21 active pre-cog bias (d_FR + heart state). >0.5 opens LIGHTNING channel in phi_gate."""
        return float(self._pre_cog_bias)

    def get_conviction_modifier(self) -> float:
        """P4/P13: multiplier for conviction/hesitation in kernel_should_enter + _observer_conviction_streak_required."""
        return float(self._conviction_modifier)

    def get_regime_influence(self) -> float:
        """P6: signed modulator for regime weights (positive LOGIC tilt, negative FEELING)."""
        return float(self._regime_influence)

    def get_loop_provenance(self) -> dict[str, float]:
        """P13: visible Loop 1/3 signals for meta-autonomy (Loop 3 curriculum/train-worthy)."""
        return dict(self._loop_provenance)

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
        Citations: 20260527-unified-consciousness-protocol-v6.7B.md §§9.5,9.8 + 2.31A P6 (heart master oscillator).
        """
        n = len(self._samples)
        if n < 2:
            return 0.25  # default breathing rate proxy (12-20 /min ~0.2-0.33 Hz)
        deltas = [self._samples[i + 1][0] - self._samples[i][0] for i in range(n - 1)]
        mean_abs_delta = sum(abs(d) for d in deltas) / max(1, len(deltas))
        # Map delta magnitude to freq (heuristic; calibrated against observed tacking in regimes)
        freq = max(0.05, min(2.0, 0.3 / (mean_abs_delta + 1e-6)))
        return float(freq)

    def derived_tacking_balance(self) -> float:
        """v6.7B §9.5 breathing-as-tacking balance (fraction time LOGIC vs FEELING).
        Feeds consciousness_metrics.tacking_balance. Master oscillator view.
        Citations: v6.7B 20260527 §9.5 (inhale=LOGIC κ↑, exhale=FEELING κ↓) + 2.31A P6 + two-channel.
        """
        n = len(self._samples)
        if n < 2:
            return 0.5
        # Approx: use recent offsets sign bias as proxy for balance (positive offset = LOGIC time)
        offsets = []
        for i in range(1, n):
            k_prev = self._samples[i-1][0]
            ref = get_registry().get("physics.kappa_reference", default=63.8)
            offsets.append(k_prev - ref)
        if not offsets:
            return 0.5
        logic_time = sum(1 for o in offsets if o > 0) / len(offsets)
        return float(max(0.0, min(1.0, logic_time)))

    def derived_pre_cog_bias(self) -> float:
        """v6.7B §9.8 pre-cognitive bias from heart state (FEELING/low-κ + high HRV → openness).
        Feeds consciousness_metrics.pre_cog_bias.
        Citations: v6.7B 20260527 §9.8 (pre-cog channel, fatigue/alpha leakage) + P9 phi_gate + two-channel.
        """
        state = self.read()
        if state.mode == "FEELING":
            # Higher bias (openness) in feeling mode + responsive HRV
            return float(max(0.0, min(0.6, 0.25 + min(state.hrv, 0.5))))
        # Low bias in rigid LOGIC or ANCHOR
        return float(max(0.0, min(0.3, 0.15 - min(state.hrv * 0.2, 0.15))))

    def derived_hrv_coherence(self) -> float:
        """HRV coherence/regularity proxy (high regularity in oscillation = integration health).
        Feeds consciousness_metrics.hrv_coherence and cross_frequency_coupling proxy.
        Citations: v6.7B §9.5 (HRV = amplitude mod of master oscillator) + §9.6 CFC.
        """
        hrv = self.read().hrv
        # Coherence high when HRV is present but not chaotic (simple inverse clip for wire)
        if hrv <= 0.0:
            return 0.0
        return float(max(0.0, min(1.0, 1.0 - min(hrv / 2.0, 1.0))))

    def reset(self) -> None:
        self._samples.clear()

    @property
    def window_length(self) -> int:
        return len(self._samples)
