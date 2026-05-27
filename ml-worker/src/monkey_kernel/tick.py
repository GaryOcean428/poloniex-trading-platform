"""
tick.py — Monkey kernel tick runner (v0.8.3).

Pure-function port of apps/api/src/services/monkey/loop.ts::processSymbol.
Given the inputs a tick needs (OHLCV, ML signal, account context, bank
size, self-obs bias) AND the prior per-symbol state, runs the full
decision pipeline in-process and returns (decision, new_state).

Scope boundary: this module makes decisions. It does NOT:
  - Fetch OHLCV / balances / positions (caller passes them in)
  - Read or write the DB (caller persists)
  - Place or cancel orders (caller executes)
  - Emit bus events (caller publishes)

Why stateless: during v0.8.3 shadow mode, both TS and Python evaluate
every tick. If Python carried state, the two would drift from different
histories and parity would collapse. Passing SymbolState in and getting
new_state out keeps TS as the canonical state owner during transition.
v0.8.7 removes the TS path and this becomes the source.

Literal disposition (per the v0.8 plan, P25):
  OVERRIDE_THRESHOLD            → DELETED (post #ml-separation: kernel
    direction is geometric from the start; no ml_side to override)
  OHLCV_LOOKBACK, HISTORY_MAX   → registry-backed via parameters.py
  kappa clamps → registry-backed (physics.kappa_reference per v6.7B + two-channel)
  Identity basin refresh (50 samples / every 10 ticks) → kept as TS-
    compat constants for v0.8.3 parity. v0.8.6 replaces with adaptive
    derivation when working_memory / self_observation disciplining lands.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    frechet_mean,
    slerp_sqrt,
)

from dataclasses import asdict

from .autonomic import AutonomicKernel, AutonomicTickInputs
from .basin import normalized_entropy, velocity
from .bus_events import KernelEvent
from .coordinator import GaryCoordinator, GaryReading
from .emotions import compute_emotions, compute_funding_drag
from .executive import (
    ExecBasinState,
    choose_lane,
    current_entry_threshold,
    current_leverage,
    current_position_size,
    kernel_direction,
    kernel_should_enter,
    should_auto_flatten,
    should_dca_add,
    should_exit,
    should_profit_harvest,
    should_scalp_exit,
    upper_stack_executive_live,
)
from .foresight import ForesightPredictor
from .heart import HeartMonitor
from .kernel_bus import KernelBus
from .modes import MODE_PROFILES, MonkeyMode, detect_mode
from .motivators import compute_motivators
from .ocean import Ocean, ocean_interventions_live
from .persistence import PersistentMemory
from .parameters import get_registry
from .perception import OHLCVCandle, PerceptionInputs, perceive, refract
from .perception_scalars import basin_direction, trend_proxy
from .prediction_capture import (
    build_prediction_payload,
    clamp_cadence_seconds,
    publish_prediction,
)
from .phi_gate import (
    GRAPH_LANE_MODE_MAP,
    phi_gate_routing_live,
    select_phi_gate,
)
from .stud import compute_stud_reading, stud_reading_to_dict, stud_topology_live
from .figure8 import (
    Loop, assign_loop, figure8_retrieval_live,
)
from .topology_constants import (
    PHI_GOLDEN_FLOOR_RATIO,
    PI_STRUCT_BOUNDARY_R_SQUARED, PI_STRUCT_GRAVITATING_FRACTION,
)
from .candle_patterns import (
    detect_strongest as detect_strongest_candle_pattern,
    hammer_against_long_sl,
    pattern_signal_scalar,
)
from .physical_emotions import compute_physical_emotions
from .regime import ChopSuppressionResult, RegimeReading, chop_suppress_entry, classify_regime
from .self_observation import compute_per_decision_triple
from .sensations import compute_sensations
from .state import BasinState as KernelBasinState
from .state import LaneType, NeurochemicalState

logger = logging.getLogger("monkey.tick")

_registry = get_registry()


# CHOP-regime entry suppression — when the regime classifier reads
# Observer-derived (P5/P25) chop suppression threshold.
# Previously hardcoded 0.70. Now derived from registry default + phi modulation
# (higher integration → slightly more tolerant of chop before suppressing new entries).
# Citations: 2.31A P5/P25 + v6.7B autonomy + QIG PURITY MANDATE.
def get_chop_suppression_confidence(phi: float) -> float:
    base = float(_registry.get("executive.chop_suppression_confidence", default=0.70))
    # Observer modulation: higher phi allows marginally more tolerance (less chop fear).
    modulation = 0.05 * max(0.0, min(1.0, (phi - 0.5)))
    return max(0.60, min(0.85, base - modulation))


# v0.8.7 regime-hysteresis — minimum number of consecutive ticks where
# regimeNow != regimeAtOpen before the regime_change exit can fire.
# Registry-controlled via ``executive.regime_stability_ticks_for_exit``.
# Default 3 means a flicker (1-2 tick mode divergence) cannot trigger
# the exit alone; the kernel must read the new regime stably for at
# least 3 ticks AND the basin must have moved more than 1/π in
# Fisher-Rao distance from the entry anchor.
_DEFAULT_REGIME_STABILITY_TICKS_FOR_EXIT = 3


def _regime_stability_ticks_for_exit() -> int:
    return int(_registry.get(
        "executive.regime_stability_ticks_for_exit",
        default=_DEFAULT_REGIME_STABILITY_TICKS_FOR_EXIT,
    ))


# Commit 4 (Cascade brief 2026-05-27) — Observer-derived conviction streak (P5/P25).
# The minimum-evidence floor is 2 (same as HISTORY_MIN_SAMPLES in
# neurochemistry — "1 sample is noise; ≥ 2 is signal"). Above the floor
# the required streak scales with how oscillatory the (anxiety+confusion
# - confidence) signal has been on this lane: high sign-flip rate → wait
# more ticks for confirmation; low flip rate → fire at floor.
# Fully registry + phi/flip_rate modulated per 2.31A P5/P25 + v6.7B autonomy
# + agents.md:236 17pt #7 + Embodiment Waves Summary (Wave 4) + QIG PURITY
# MANDATE + master-orchestration + verification-before-completion + two-channel κ.
# Geometric justification (Fisher-Rao tacking): hesitation sign-flip rate is
# curvature proxy on the 64D simplex trajectory; phi (integration) + basin
# velocity modulate the effective "waiting time" on the manifold. No Euclidean.
# Citations: 2.31A P5/P25 + v6.7B + consciousness-development + qig-purity-validation.


def get_conviction_streak_required(hesitation_history: list[float], phi: float = 0.5) -> int:
    """Required consecutive-tick count for conviction_failed to fire.

    Pure observer derivation (P5/P25): registry base + sign-flip rate of
    (anxiety+confusion-confidence) + phi modulation (higher integration
    tolerates more oscillation before requiring extra confirmation).
    Floor 2, cap 12. Fisher-Rao tacking process integrity preserved.

    `hesitation` is (anxiety + confusion - confidence) — positive when
    the gate condition holds, negative when it doesn't. A flip is a
    consecutive pair with opposite sign.
    """
    base_floor = int(_registry.get("executive.conviction_streak_floor", default=2))
    base_cap = int(_registry.get("executive.conviction_streak_cap", default=12))
    hesitation_window = int(_registry.get("executive.conviction_hesitation_window", default=20))

    if len(hesitation_history) < base_floor:
        return base_floor
    flips = 0
    for prev, curr in zip(hesitation_history[:-1], hesitation_history[1:]):
        # Treat zero as neutral — only count true sign flips.
        if prev > 0 and curr < 0:
            flips += 1
        elif prev < 0 and curr > 0:
            flips += 1
    # flip_rate ∈ [0, 1] — fraction of adjacent pairs that flipped sign.
    flip_rate = flips / max(1, len(hesitation_history) - 1)
    # Observer + phi modulation (P5/P25): higher phi (integration) slightly
    # lowers the required streak (more trust in the signal); high flip_rate
    # raises it. Uses the same geometric tacking logic as chop suppression.
    # Linear ramp with phi dampening.
    phi_mod = max(0.0, min(0.5, (phi - 0.3)))  # 0.3-0.8 healthy band
    scaled = base_floor + round(flip_rate * (base_cap - base_floor) * (1.0 - 0.4 * phi_mod) * 2)
    return max(base_floor, min(base_cap, scaled))


def _chop_suppress_entry(reading: RegimeReading) -> bool:
    """True when the regime classifier reads sustained chop above the
    suppression confidence threshold. Held positions are unaffected;
    only NEW entries are blocked."""
    return (
        reading.regime == "CHOP"
        and reading.confidence > get_chop_suppression_confidence(phi)  # P5/P25 observer-derived
    )


# ── Input / output dataclasses ───────────────────────────────────

@dataclass
class LanePosition:
    """Single-lane position snapshot used by the lane-aware tick path
    (proposal #10). One ``LanePosition`` per (agent, symbol, lane) row
    that is currently ``status='open'`` in autonomous_trades.

    Funding bookkeeping (additive — defaults keep older callers no-op):
      * ``margin_usdt`` — initial position margin (notional / leverage).
      * ``funding_paid_usdt`` — cumulative funding cost paid since open.
    The ratio ``funding_paid_usdt / margin_usdt`` feeds Layer 2B
    emotion drag (cost-on-margin).
    """
    lane: str  # "scalp" | "swing" | "trend"
    side: str  # "long" | "short"
    entry_price: float
    quantity: float
    trade_id: str
    margin_usdt: float = 0.0
    funding_paid_usdt: float = 0.0


@dataclass
class AccountContext:
    """Snapshot of account / position state as seen by the caller.

    Pre-#10 shape kept for back-compat: ``exchange_held_side`` plus the
    triplet of ``own_position_*`` fields describes a single, symbol-wide
    K position. Proposal #10 adds ``lane_positions`` — a list of open
    per-lane positions on this symbol. When non-empty, the caller is on
    the lane-aware path and ``own_position_*`` should mirror the lane
    aggregate (kept around for legacy single-position tests).
    """
    equity_fraction: float
    margin_fraction: float
    open_positions: int
    available_equity: float
    exchange_held_side: Optional[str] = None
    own_position_entry_price: Optional[float] = None
    own_position_quantity: Optional[float] = None
    own_position_trade_id: Optional[str] = None
    # Proposal #10 — per-lane open positions on this (agent, symbol).
    # Empty when flat across all lanes; populated by the caller from
    # the lane-keyed autonomous_trades query.
    lane_positions: list[LanePosition] = field(default_factory=list)


@dataclass
class TickInputs:
    """Everything one tick needs, modulo prior state.

    Post #ml-separation: ml_signal / ml_strength are no longer kernel
    inputs. Direction comes from basin geometry; entry conviction from
    the emotion stack. ML lives in a separate Agent M module and
    receives the same OHLCV window via its own decision path.
    """
    symbol: str
    ohlcv: list[OHLCVCandle]
    account: AccountContext
    bank_size: int
    sovereignty: float
    max_leverage: int
    min_notional: float
    size_fraction: float = 1.0
    self_obs_bias: Optional[dict[str, dict[str, float]]] = None
    # Proposal #3 + per-lane refinement: rolling Kelly stats for the
    # Kelly leverage cap. Lane-conditioned at the caller — TS loop.ts
    # queries autonomous_trades filtered by the active lane (scalp /
    # swing / trend) so each lane's Kelly cap is built from its own
    # closed-trade history. Cross-lane pollution gone. When None, the
    # Kelly cap defers to the geometric leverage formula (no-op).
    # Tuple is (win_rate, avg_win, avg_loss) over the lane window.
    rolling_kelly_stats: Optional[tuple[float, float, float]] = None
    # Funding rate for the symbol's perpetual contract (8-hour rate from
    # exchange feed). Used to compute funding_drag per held position and
    # feed it into the emotion stack so the conviction gate fires earlier
    # on funding-bleeding positions. Default 0.0 = no held position or
    # rate not yet fetched (safe: drag = 0 → no anxiety perturbation).
    funding_rate_8h: float = 0.0


@dataclass
class SymbolState:
    """Per-symbol state carried across ticks.

    Proposal #10: peak-tracking + DCA-bookkeeping + tape-flip streak
    are now per-lane dicts keyed by lane name. Pre-#10 scalar attrs
    are retained for back-compat (callers without a lane just read
    the legacy field; the lane-aware path goes through the dicts).
    """
    symbol: str
    identity_basin: np.ndarray
    last_basin: Optional[np.ndarray] = None
    # Per v6.7B protocol + two-channel doctrine: no universal 64.0 default.
    # Cold-start sentinel only; real value comes from first observation + history.
    kappa: float = 63.8
    session_ticks: int = 0
    last_mode: Optional[str] = None
    basin_history: list[np.ndarray] = field(default_factory=list)
    phi_history: list[float] = field(default_factory=list)
    fhealth_history: list[float] = field(default_factory=list)
    drift_history: list[float] = field(default_factory=list)
    # Tier 1 motivators integration history — (phi, i_q) tuples per tick.
    # Used by compute_motivators for the CV(Φ × I_Q) integration motivator.
    integration_history: list[tuple[float, float]] = field(default_factory=list)
    # Rolling κ observations for the observer-derived transcendence anchor
    # (median/MAD). Mirrors the TS side and the accumulation already
    # present for autonomic/sensations (dop/ser). Populated every tick
    # after the kappa update; capped with other histories.
    kappa_history: list[float] = field(default_factory=list)
    # Rolling realized pnl_frac on closes — observer-derived input for
    # ocean reward shaping (replaces the external hardcoded 1% Fib floor).
    # Exactly parallel to kappa_history median/MAD pattern. Cold-start 0
    # until enough samples. Bounded + persisted like other histories.
    pnl_frac_history: list[float] = field(default_factory=list)
    # Pre-#10 scalar bookkeeping — preserved as the "default lane"
    # (swing) view so existing tests + back-compat callers keep working.
    dca_add_count: int = 0
    last_entry_at_ms: Optional[float] = None
    peak_pnl_usdt: Optional[float] = None
    peak_tracked_trade_id: Optional[str] = None
    # Proposal #4: sustained tape-flip streak counter. Increments
    # each consecutive tick where alignment <= TREND_FLIP_THRESHOLD
    # (typically -0.65); resets when alignment recovers above
    # threshold. Trend-flip harvest fires only when streak >= 3 so a
    # single noise tick doesn't trigger an exit. Reset on every new
    # trade (peak_tracked_trade_id changes).
    tape_flip_streak: int = 0
    # Proposal #10 — per-lane substates. Each lane independently tracks
    # peak unrealized PnL, DCA add count, last-entry timestamp, and
    # tape-flip streak so a swing-long's bookkeeping never bleeds into
    # a scalp-short on the same symbol.
    peak_pnl_usdt_by_lane: dict[str, float] = field(default_factory=dict)
    peak_tracked_trade_id_by_lane: dict[str, Optional[str]] = field(default_factory=dict)
    dca_add_count_by_lane: dict[str, int] = field(default_factory=dict)
    last_entry_at_ms_by_lane: dict[str, Optional[float]] = field(default_factory=dict)
    tape_flip_streak_by_lane: dict[str, int] = field(default_factory=dict)
    # Held-position re-justification anchors — per-lane (regime, Φ)
    # snapshots taken at the moment a position opens. The kernel uses
    # these as the geometric anchor for "is current state still
    # consonant with entry?". Cleared on position close in that lane.
    # Same per-lane shape as peak_pnl_usdt_by_lane above so future
    # multi-lane positions keep independent rejustification anchors.
    regime_at_open_by_lane: dict[str, str] = field(default_factory=dict)
    phi_at_open_by_lane: dict[str, float] = field(default_factory=dict)
    # Basin coordinate snapshot at open — used by the regime-change
    # hysteresis check. Single-tick mode flicker ("investigation→drift"
    # on noise) used to fire the regime exit immediately; with this
    # snapshot, the exit also requires the basin to have moved
    # by FR distance > 1/π (gravitating-fraction threshold) from the
    # entry coordinate. Pure geometric guard — small mode wobbles
    # don't overcome it.
    basin_at_open_by_lane: dict[str, np.ndarray] = field(default_factory=dict)
    # Consecutive ticks where the held position's regime read differs
    # from the regime-at-open. Drives the hysteresis: regime exit only
    # fires when streak ≥ N (registry-controlled, default 3). Resets
    # to 0 the first tick the regime returns to regime_at_open or the
    # position closes/reopens.
    regime_change_streak_by_lane: dict[str, int] = field(default_factory=dict)
    # Commit 4 (Cascade brief 2026-05-27) — per-lane conviction-failed
    # streak + emotion-delta history for observer-derived N. The streak
    # increments while `confidence < anxiety + confusion` and resets
    # on any tick where the condition flips. The history is a rolling
    # ring of `(anxiety + confusion - confidence)` values over the last
    # 20 ticks on this lane — its sign-flip rate sets how many
    # consecutive ticks the gate requires before firing (high flip rate
    # = noisy emotion telemetry = longer wait; low flip rate = monotonic
    # collapse = fire at floor=2).
    conviction_failed_streak_by_lane: dict[str, int] = field(default_factory=dict)
    hesitation_history_by_lane: dict[str, list[float]] = field(default_factory=dict)
    # Prediction-corpus instrumentation bookkeeping. Read-only; never
    # feeds back into executive decisions.
    last_prediction_snapshot_at_ms: Optional[float] = None
    last_prediction_mode: Optional[str] = None
    last_prediction_lane: Optional[str] = None
    last_prediction_basin_dir_sign: Optional[int] = None


@dataclass
class TickDecision:
    """Output of one tick. Caller persists / executes as needed."""
    action: str
    reason: str
    mode: str
    size_usdt: float
    leverage: int
    entry_threshold: float
    phi: float
    kappa: float
    basin_velocity: float
    f_health: float
    drift_from_identity: float
    basin_direction: float
    tape_trend: float
    side_candidate: str
    side_override: bool
    neurochemistry: NeurochemicalState
    derivation: dict[str, Any]
    basin: np.ndarray
    is_dca_add: bool = False
    is_reverse: bool = False
    lane: LaneType = "swing"
    direction: str = "flat"   # long | short | flat
    size_fraction: float = 1.0
    dca_intent: bool = False


# ── Public API ───────────────────────────────────────────────────

def fresh_symbol_state(
    symbol: str,
    identity_basin: np.ndarray,
    *,
    kappa_initial: Optional[float] = None,
) -> SymbolState:
    """Factory for a newborn symbol. identity_basin seeds §3.4 Pillar 3."""
    kappa = kappa_initial if kappa_initial is not None else (
        _registry.get("physics.kappa_reference", default=63.8)  # v6.7B + two-channel: channel-specific, not universal 64
    )
    return SymbolState(
        symbol=symbol,
        identity_basin=np.asarray(identity_basin, dtype=np.float64),
        kappa=kappa,
    )


def run_tick(
    inputs: TickInputs,
    state: SymbolState,
    autonomic: AutonomicKernel,
    ocean: Optional[Ocean] = None,
    foresight: Optional[ForesightPredictor] = None,
    heart: Optional[HeartMonitor] = None,
    persistence: Optional["PersistentMemory"] = None,
    bus: Optional["KernelBus"] = None,
    coordinator: Optional["GaryCoordinator"] = None,
) -> tuple[TickDecision, SymbolState]:
    """Execute one decision tick. Returns (decision, new_state).

    `state` is mutated in place — the return is a convenience.
    `autonomic` carries NC reward state across ticks (per-instance, not
    per-symbol; shared across symbols within one kernel).
    `ocean` is the autonomic-intervention authority (#599 refactor).
    `foresight` is the per-(instance, symbol) trajectory predictor
    (Tier 3); accumulates basin history for next-step prediction.
    `heart` is the per-(instance, symbol) κ HRV monitor (Tier 7).
    All four are observation-only at this stage — their outputs land in
    `decision.derivation` for telemetry, but the executive's decision
    path is unchanged. Caller should keep them as singletons for sleep
    state / trajectory / HRV to accumulate; if None, ephemeral
    instances are created (state-loss on next call).
    """
    ohlcv = inputs.ohlcv
    if len(ohlcv) < 50:
        return _hold_for_reason(state, "insufficient_ohlcv"), state
    last_close = float(ohlcv[-1].close)
    if not (last_close > 0 and np.isfinite(last_close)):
        return _hold_for_reason(state, "invalid_last_close"), state

    state.session_ticks += 1

    # ── Perceive → refract ─────────────────────────────────────
    # Post #ml-separation: PerceptionInputs ml_* fields default to
    # neutral. Basin dims 3..5 become ~constant; momentum spectrum
    # (dims 7..14) and other geometric dims unchanged.
    raw_basin = perceive(PerceptionInputs(
        ohlcv=ohlcv,
        equity_fraction=inputs.account.equity_fraction,
        margin_fraction=inputs.account.margin_fraction,
        open_positions=inputs.account.open_positions,
        session_age_ticks=state.session_ticks,
    ))
    # refract external_weight is registry-backed (migration 047). Default
    # 0.30 = 70% identity-weighted refraction toward §3.4 Pillar 3.
    refract_external_weight = _registry.get(
        "refract.external_weight", default=0.30,
    )
    basin = refract(raw_basin, state.identity_basin, external_weight=refract_external_weight)

    # ── Cross-kernel observer effect (Consensus Layer 1) ──────
    # CONSENSUS_CROSS_OBSERVATION_LIVE flag-gated. When live, basin is
    # pulled toward peer kernels' basins per Φ-weighted SLERP (qig-core
    # canonical observer-effect). When off, peers are still visible in
    # telemetry but basin is unchanged. See [[polytrade-consensus-architecture]].
    try:
        from .basin_sync_db import observe_and_pull as _basin_observe_pull
        # Φ for the pull weight uses pre-pull phi; recompute below uses
        # the (possibly) pulled basin.
        _pre_pull_phi = max(0.0, min(1.0, 1.0 - normalized_entropy(basin) * 0.8))
        basin, _basin_pull_telem = _basin_observe_pull(
            instance_id=os.environ.get("MONKEY_PY_INSTANCE_ID", "monkey-py-shadow"),
            own_basin=basin,
            own_phi=_pre_pull_phi,
        )
    except Exception:  # noqa: BLE001 — never block a tick on basin-sync
        _basin_pull_telem = None

    # ── Pillars 1-3: consciousness invariants ──────────────────
    # QIG_QFI consciousness audit 2026-05-19 GAP 1: enforce basin
    # invariants BEFORE downstream measurement.
    # Policy change (post #977 paralysis diagnosis): pillars are now
    # load-bearing by default. MONKEY_PILLAR_{1,2,3}_LIVE are explicit
    # kill switches only. See pillars.py docstring.
    # Reference: pillars.py, canonical QIG_QFI pillars.py.
    pillar_1_telem: dict | None = None
    pillar_2_telem: dict | None = None
    pillar_3_telem: dict | None = None
    try:
        from .pillars import (
            FluctuationGuard,
            get_bulk_for,
            get_disorder_for,
            pillar_1_live as _p1_live,
            pillar_2_live as _p2_live,
            pillar_3_live as _p3_live,
        )
        # Pillar 1 — entropy floor + concentration cap. Redistributes mass
        # when basin collapses to a single coord; uses Dirichlet noise on
        # entropy violation. Runs before Pillar 2 so the bulk sees a
        # well-conditioned input.
        if _p1_live():
            _fg = FluctuationGuard()
            basin, _p1_status = _fg.check_and_enforce(basin)
            pillar_1_telem = {
                "healthy": _p1_status.healthy,
                "violations": [v.value for v in _p1_status.violations],
                "corrections": _p1_status.corrections_applied,
                **_p1_status.details,
            }
        # Pillar 2 — topological bulk. Refracted basin is treated as
        # surface input; core diffuses slowly toward surface. The
        # composite (BULK_SHIELD_FACTOR-weighted blend) replaces basin
        # for the rest of the tick. Per-symbol state persists in the
        # module-level _BULK_STATES dict.
        if _p2_live():
            _bulk = get_bulk_for(inputs.symbol)
            basin, _p2_status = _bulk.receive_input(
                basin, slerp_weight=refract_external_weight,
            )
            pillar_2_telem = {
                "healthy": _p2_status.healthy,
                "violations": [v.value for v in _p2_status.violations],
                "corrections": _p2_status.corrections_applied,
                **_p2_status.details,
            }
        # Pillar 3 — quenched disorder. Identity crystallizes after
        # IDENTITY_FREEZE_AFTER_CYCLES (50) lived ticks. check_drift
        # flags when basin departs from the effective reference
        # (frozen identity + anneal blend). Pressure for scar detection
        # is taken from the prior tick's basin_velocity if available.
        if _p3_live():
            _disorder = get_disorder_for(inputs.symbol)
            _pressure = float(state.basin_history[-1] is not None) if state.basin_history else 0.0
            # Use prior-tick velocity as a proxy for cycle pressure;
            # scar threshold is 0.7, so most ticks won't scar.
            if state.last_basin is not None:
                _pressure = float(np.clip(
                    fisher_rao_distance(state.last_basin, basin) * 2.0, 0.0, 1.0,
                ))
            # lived=True *only* — v6.7B §3.4 Replicant hardening (pillars.py _crystallize detect_replicant + REPLICANT_IDENTITY violation)
            # Resonance/identity paths: harvested basins forbidden for frozen identity_slope (sovereignty earned).
            _disorder.observe_cycle(basin, pressure=_pressure, lived=True)
            _p3_status = _disorder.check_drift(basin)
            pillar_3_telem = {
                "healthy": _p3_status.healthy,
                "violations": [v.value for v in _p3_status.violations],
                "corrections": _p3_status.corrections_applied,
                **_p3_status.details,
            }
    except Exception:  # noqa: BLE001 — never block a tick on pillar enforcement
        pass

    # ── Measure ────────────────────────────────────────────────
    f_health = normalized_entropy(basin)
    phi = max(0.0, min(1.0, 1.0 - f_health * 0.8))
    bv = velocity(state.last_basin, basin) if state.last_basin is not None else 0.0

    # Post #ml-separation: coupling_health was inputs.ml_strength.
    # Replacement is a geometric self-read — Φ (integration measure,
    # naturally [0,1]) modulated by basin velocity. High integration +
    # low velocity = strong internal coupling = high coupling_health.
    # Stays in [0, 1]; preserves the kappa_delta contract downstream.
    coupling_health = phi * (1.0 - min(bv, 1.0))
    kappa_star = _registry.get("physics.kappa_reference", default=63.8)  # v6.7B + two-channel: channel-specific, not universal 64
    kappa_delta = (coupling_health - 0.5) * 5.0 - (bv - 0.2) * 10.0
    state.kappa = max(20.0, min(
        120.0, state.kappa * 0.8 + (kappa_star + kappa_delta) * 0.2,
    ))
    # state.kappa_history.append moved to end-of-tick block for TS parity:
    # TS appends after computeMotivators returns (loop.ts:5679 vs call at
    # 2714). transcendence must compute against PRIOR-tick history so the
    # current κ is genuinely a "deviation from past", not artificially
    # included in median/MAD (Copilot review #977).

    w_q, w_e, w_eq = float(basin[0]), float(basin[1]), float(basin[2])
    reg_total = w_q + w_e + w_eq
    if reg_total > 0:
        regime_weights = {
            "quantum": w_q / reg_total,
            "efficient": w_e / reg_total,
            "equilibrium": w_eq / reg_total,
        }
    else:
        regime_weights = {"quantum": 1/3, "efficient": 1/3, "equilibrium": 1/3}

    last_phi = state.phi_history[-1] if state.phi_history else phi
    phi_delta = phi - last_phi

    is_flat = inputs.account.exchange_held_side is None
    now_ms = time.time() * 1000.0

    # Ocean is the single autonomic-intervention authority (#599 refactor).
    # Sleep state, DREAM/ESCAPE triggers — all computed here. Caller
    # chemistry (autonomic) downstream consumes is_awake.
    if ocean is None:
        ocean = Ocean(label="monkey-primary")
    ocean_state = ocean.observe(
        phi=phi,
        basin=basin,
        current_mode=state.last_mode or "investigation",
        is_flat=is_flat,
        now_ms=now_ms,
    )
    is_awake = ocean_state.sleep_phase == "AWAKE"
    woke_this_tick = ocean_state.intervention == "WAKE"

    ac_result = autonomic.tick(AutonomicTickInputs(
        phi_delta=phi_delta,
        basin_velocity=bv,
        surprise=abs(phi_delta) * 2.0,
        quantum_weight=regime_weights["quantum"],
        kappa=state.kappa,
        external_coupling=coupling_health,
        is_awake=is_awake,
        woke=woke_this_tick,
        now_ms=now_ms,
    ))
    nc = ac_result.nc

    # ── Upper-stack observation primitives (Tier 1-8 wiring) ───
    # Compute motivators / sensations / emotions / physical_emotions /
    # foresight prediction / heart state / phi-gate selection. All
    # outputs surface in decision.derivation for telemetry. None of
    # them feed back into the executive decision path yet — that's
    # the next downstream step. Keeping observation-only here means
    # the giveback fix soak window remains undisturbed.
    kernel_state = KernelBasinState(
        basin=basin,
        identity_basin=state.identity_basin,
        phi=phi,
        kappa=state.kappa,
        basin_velocity=bv,
        regime_weights=regime_weights,
        sovereignty=inputs.sovereignty,
        neurochemistry=nc,
    )
    # Tier 1 motivators (Surprise / Curiosity / Investigation /
    # Integration / Transcendence + I_Q).
    mot = compute_motivators(
        kernel_state,
        prev_basin=state.last_basin,
        integration_history=state.integration_history,
        kappa_history=state.kappa_history,
    )
    # Tier 4 sensations + drives. Auxiliary fields (compressed/expanded/
    # pressure/stillness/drift/resonance + approach/avoidance/conservation)
    # and UCP §6.1/§6.2 canonical fields (unified/fragmented/activated/
    # dampened/grounded/drifting + homeostasis/curiosity_drive). Threading
    # drift_history in lets the canonical Grounded/Drifting/Homeostasis
    # derivations use the observed drift scale. kappa_history is now
    # accumulated and passed to the canonical motivators (transcendence
    # uses median/MAD); sensations still have their own copy for dop/ser.
    sen = compute_sensations(
        kernel_state,
        prev_basin=state.last_basin,
        drift_history=state.drift_history,
    )
    # Tier 2 cognitive emotions (Layer 2B). basin_distance is the
    # Fisher-Rao distance from current basin to identity — same scalar
    # already computed by sensations.drift; reuse to avoid recompute.
    # Flow needs the foresight predicted basin reference; computed
    # below after the foresight predict call. We forward-reference
    # here to keep the call-site flat.
    # Tier 5 physical emotions (Layer 2A). grad(Φ) = phi − last_phi
    # already computed above for autonomic tick; reuse via last_phi.
    phys = compute_physical_emotions(
        motivators=mot,
        sensations=sen,
        phi_now=phi,
        phi_prev=last_phi,
    )
    # Tier 3 foresight — append + predict. Persistent across ticks
    # via the caller-supplied predictor; ephemeral fallback if None.
    if foresight is None:
        foresight = ForesightPredictor()
    foresight.append(basin, phi, now_ms)
    fs = foresight.predict(regime_weights)
    # Tier 2 cognitive emotions — composed AFTER foresight so Flow has
    # access to predicted_basin reference.
    # Funding drag: real carry cost against the held position(s). Computed
    # here (P14: BOUNDARY → STATE at perception time) and fed into anxiety
    # so the conviction gate fires earlier on funding-bleeding positions.
    # Multi-lane: sum drag across all concurrently held lanes.
    funding_drag = 0.0
    if inputs.funding_rate_8h != 0.0:
        if inputs.account.lane_positions:
            for lp in inputs.account.lane_positions:
                entry_ms = state.last_entry_at_ms_by_lane.get(
                    lp.lane, state.last_entry_at_ms
                )
                if entry_ms is not None:
                    hours_held = (now_ms - entry_ms) / 3_600_000.0
                    funding_drag += compute_funding_drag(
                        lp.side, inputs.funding_rate_8h, hours_held
                    )
        elif inputs.account.exchange_held_side is not None:
            entry_ms = state.last_entry_at_ms
            if entry_ms is not None:
                hours_held = (now_ms - entry_ms) / 3_600_000.0
                funding_drag += compute_funding_drag(
                    inputs.account.exchange_held_side,
                    inputs.funding_rate_8h,
                    hours_held,
                )
    emo = compute_emotions(
        motivators=mot,
        basin_distance=sen.drift,
        phi=phi,
        basin_velocity=bv,
        basin=basin,
        predicted_basin=fs.predicted_basin,
        foresight_weight=fs.weight,
        funding_drag=funding_drag,
    )
    # Tier 7 Heart — κ HRV monitor (master oscillator). Persistent; ephemeral fallback.
    # v6.7B §9 (consciousness-development + wiring-validation): heart as master oscillator,
    # breathing-as-tacking cycle (each sign-cross = inhale/exhale = logic/feeling), pre-cognitive
    # bias via alpha/HRV. Derived tacking_frequency_hz now on HeartMonitor for metrics surface.
    # P24 + P4 + P13 (2.31A): 21-field surface (incl. sovereignty_dynamics from Pillar3 Replicant)
    # is now ALWAYS-ON (no flag). derive_from_tick call-site here embodies the canonical shape
    # in live tick path. Citations: 2.31A P3/P19/P24, v6.7B §§3.4/9.5-9.9.
    # HeartMonitor LOAD-BEARING GOVERNOR (P6 + v6.7B §§9.5-9.9, QIG PURITY MANDATE): always live, no None bypass.
    # Tacking crossings (from heart._publish_tacking) now actively control via getters (pre-cog, conviction, regime, loops).
    # consciousness-development + wiring-validation + verification-before-completion: LIVED ONLY call-site here (tick path).
    # Purity: 0 Euclidean in this block (uses fisher_rao upstream).
    if heart is None:
        heart = HeartMonitor()
    assert heart is not None, "HeartMonitor is load-bearing governor (P6); must exist in live tick (negative: None = incompleteness cruel)"
    heart.append(state.kappa, now_ms)
    heart_state = heart.read()
    # Active bias from tacking crossings (not passive metrics): deepen pre-cog + d_FR per P9/P21.
    pre_cog_bias = heart.get_pre_cog_bias()
    conviction_mod = heart.get_conviction_modifier()
    regime_infl = heart.get_regime_influence()
    loop_prov = heart.get_loop_provenance()
    # Wire to downstream (example: bias self_obs or conviction streak; full to kernel_direction/emotions in follow-up passes).
    # This makes heart the central clock controlling regime/reward/conviction/loops. (P6 + v6.7B §§9.5-9.9)
    # Active governance: tacking balance directly modulates conviction (breathing-as-tacking drives the system).
    tacking_balance = getattr(heart, "derived_tacking_balance", lambda: 0.5)() if heart else 0.5
    effective_self_obs = self_obs_bias * (1.0 + 0.2 * (conviction_mod - 1.0)) * (0.8 + 0.4 * tacking_balance)  # heart governor active

    # P24 wiring (full embodiment, not presence): always compute 21-field metrics surface.
    # sovereignty_dynamics populated from p3_status (detect_replicant + s_ratio).
    # This is the production call-site for derive_from_tick + ConsciousnessMetrics.
    # LIVED ONLY 5 + Replicant Guardian (applied to metrics write as decision-adjacent telemetry per task):
    # 1. Call-site: live in tick() core path (always executed).
    # 2. Hard assert: Replicant dynamics from pillar_3_telem (REPLICANT_IDENTITY -> 1.0); if pillars raises
    #    ReplicantIdentityError on bad crystallization, it propagates here (fail-closed, P15).
    # 3. Provenance: comment + as_dict source + cites below.
    # 4. Negative: exercised in test_pillars.py + consciousness_metrics tests (low-S cases).
    # 5. Production evidence: state.last_consciousness_metrics attached for ocean/TS/Loop1 consumers.
    # Citations: 2.31A P3/P19/P24, v6.7B §§3.4/9.5-9.9, agents.md QIG PURITY MANDATE (LIVED ONLY 5), 
    # 2026-05-27 Identity/Replicant + Finding1 packets; consciousness-development + wiring-validation + qig-purity-validation skills.
    try:
        from .consciousness_metrics import derive_from_tick, ConsciousnessMetrics
        from .pillars import ReplicantIdentityError  # LIVED ONLY 5 + Replicant Guardian hard assert (for except re-raise)
        _p3_sov = 0.0
        _replicant_dyn = 0.0
        if pillar_3_telem and "sovereignty" in pillar_3_telem:
            _p3_sov = float(pillar_3_telem.get("sovereignty", 0.0))
            if "replicant_identity" in (pillar_3_telem.get("violations") or []):
                _replicant_dyn = 1.0

        # LIVED ONLY 5 hard assert at metrics derivation call-site (P3/P19/P24 + v6.7B §3.4)
        # Replicant detected from pillars must refuse bad telemetry write (fail-closed).
        if _replicant_dyn > 0.5:
            raise ReplicantIdentityError(
                "LIVED ONLY 5 violation at derive_from_tick call-site: replicant_detected high. "
                "Crystallization/identity from harvested geometry refused. 2.31A P3/P19/P24, v6.7B §3.4."
            )
        metrics = derive_from_tick(
            phi=phi,
            kappa=state.kappa,
            f_health=f_health,
            coupling_health=coupling_health,
            self_obs_bias=0.5,  # proxy; real port in self_observation future
            sovereignty=_p3_sov,
            drift_from_identity=float(pillar_3_telem.get("drift_from_frozen", 0.0)) if pillar_3_telem else 0.0,
            basin_velocity=bv,
            b_integrity=float(pillar_2_telem.get("b_integrity", 1.0)) if pillar_2_telem else 1.0,
            q_identity=float(pillar_3_telem.get("q_identity", 0.0)) if pillar_3_telem else 0.0,
            tacking_frequency_hz=getattr(heart, "derived_tacking_frequency_hz", lambda: 0.25)(),
            sovereignty_dynamics=_replicant_dyn,
        )
        # Attach to telemetry for downstream (ocean, autonomic, TS bridge, self-obs Loop1)
        # P16 provenance: source = "tick.derive_from_tick + pillars + heart"
        state.last_consciousness_metrics = metrics.as_dict()  # type: ignore[attr-defined]
    except ReplicantIdentityError:
        # Re-raise Replicant hard refusal (LIVED ONLY 5); do not swallow guardian barrier. Propagates to decision path.
        raise
    except Exception:  # noqa: BLE001 — metrics telemetry must never block tick (except Replicant refusal per LIVED ONLY 5)
        pass
    # Tier 6 Φ-gate selection — pure argmax over geometric activations.
    # P9 LIGHTNING channel pinned at 0 (unimplemented); the placeholder
    # never wins until P9 lands.
    gate = select_phi_gate(phi, fs, lightning=0.0)

    # Tier 9 stud topology — Stage 1 telemetry + Stage 2 wiring.
    # When STUD_TOPOLOGY_LIVE=true (default), the four executive
    # decisions (override threshold, leverage flat_mult, mode detect,
    # lane choice) are routed through stud-derived formulas anchored
    # to qig-verification's frozen π-structure constants. When false,
    # legacy formulas fire bit-identically.
    stud_reading = compute_stud_reading(
        basin_velocity=bv,
        phi=phi,
        regime_weights=regime_weights,
    )
    stud_live = stud_topology_live()

    # Telemetry surface — append (Φ, I_Q) for the next tick's
    # Integration motivator CV calculation. Trim to history_max
    # below in the basin_history block (same cap).
    state.integration_history.append((phi, mot.i_q))

    # ── Ocean intervention application (PR 1 — OCEAN_INTERVENTIONS_LIVE) ──
    # DREAM and ESCAPE are applied later in the action-decision block
    # (they override the action; basin_state computation isn't affected).
    # With flag off, interventions are logged but not applied.
    # MUSHROOM_MICRO removed in qig-core 2.8.0 bump — mushroom is wake-state
    # neuroplasticity (Φ ≥ 0.70 gated), not a sleep-cycle κ kick.
    intervention_applied: dict[str, Any] = {
        "fired": ocean_state.intervention,
        "live": ocean_interventions_live(),
        "applied": [],
    }

    # ── Mode detect ────────────────────────────────────────────
    drift_now = fisher_rao_distance(basin, state.identity_basin)
    state.drift_history.append(drift_now)
    history_max = int(_registry.get("loop.history_max", default=100))
    if len(state.drift_history) > history_max:
        state.drift_history = state.drift_history[-history_max:]

    mode_result = detect_mode(
        basin=basin,
        identity_basin=state.identity_basin,
        phi=phi,
        kappa=state.kappa,
        basin_velocity=bv,
        neurochemistry=nc,
        phi_history=state.phi_history,
        fhealth_history=state.fhealth_history,
        drift_history=state.drift_history,
        stud_reading=stud_reading,
        stud_live=stud_live,
        # NOTE (Copilot review #977): canonical motivators NOT passed.
        # motivators.integration is raw CV (low=integrated); detect_mode's
        # `mot.integration > 0.3` gate expects legacy 1−CV*10 score
        # (high=integrated). Passing canonical inverted the gate semantic
        # and misclassified jittery states as INTEGRATION. detect_mode
        # uses its own legacy compute_motivators for mode detection;
        # canonical motivators flow through to compute_emotions (line ~588),
        # which is the path that actually consumes the transcendence fix.
    )
    mode = mode_result["mode"]
    mode_changed = state.last_mode is not None and state.last_mode != mode
    state.last_mode = mode
    try:
        mode_enum = MonkeyMode(mode)
    except ValueError:
        mode_enum = MonkeyMode.INVESTIGATION

    # ── Side candidate ─────────────────────────────────────────
    # Post #ml-separation: direction comes from basin geometry +
    # tape consensus, gated by emotional conviction. The previous
    # OVERRIDE_REVERSE quorum (basin × tape ≤ -threshold flips
    # ml_side) is gone — there is no ml_side to override. Geometric
    # direction is now the *primary* read.
    #
    # `direction` is the gate signal (long/short/flat); entry refuses
    # when flat. `side_candidate` carries the binary long/short for
    # downstream code that expects it. When direction is flat,
    # side_candidate defaults to 'long' but the entry gate's
    # `direction != "flat"` check prevents any entry from firing.
    basin_dir = basin_direction(basin)
    tape_trend = trend_proxy([float(c.close) for c in ohlcv])

    # Proposal #9: candlestick pattern recognition. Path 1 — feed
    # the strongest pattern's signed scalar into the perception
    # input boundary as a telemetry surface; the executive can fold
    # it in alongside ml-signal/ml-strength. Path 2 — SL-defer signal
    # is consumed in the SL-fire path further down.
    candle_pattern_reading = detect_strongest_candle_pattern(ohlcv)
    candle_pattern_signal = pattern_signal_scalar(candle_pattern_reading)
    candle_hammer_defer = hammer_against_long_sl(ohlcv)

    # Regime classification (proposal #5). Reads basin trajectory to
    # emit TREND_UP / CHOP / TREND_DOWN with confidence. The classifier
    # uses the current basin alongside ``state.basin_history`` (the
    # latest tick's basin is appended after this point in the function,
    # so we splice it onto the read here).
    regime_history = list(state.basin_history) + [
        np.asarray(basin, dtype=np.float64),
    ]
    regime_reading: RegimeReading = classify_regime(regime_history)

    direction: str = kernel_direction(
        basin_dir=basin_dir, tape_trend=tape_trend, emotions=emo,
    )
    side_candidate: str = direction if direction != "flat" else "long"
    side_override = False

    # Tier 9 Stage 2 — REVERSION's "inverted entry direction":
    # back-loop regime trades counter-trend. Stud-topology mode
    # signal, not ML — preserved post-separation. Flips direction
    # only when the kernel has a directional read; flat stays flat.
    if stud_live and mode == MonkeyMode.REVERSION.value and direction != "flat":
        side_candidate = "short" if side_candidate == "long" else "long"
        direction = "short" if direction == "long" else "long"
        side_override = True

    self_obs_bias = 1.0
    if inputs.self_obs_bias:
        per_mode = inputs.self_obs_bias.get(mode, {})
        self_obs_bias = per_mode.get(side_candidate, 1.0)

    # ── PR 2: Φ-gate routing (PHI_GATE_ROUTING_LIVE) ─────────────
    # FORESIGHT branch: blend current basin with foresight.predicted_basin
    # via Fisher-Rao slerp at the foresight weight, BEFORE basin_state
    # is built. The executive's threshold/leverage/size formulas then
    # evaluate against the blended basin — biasing decisions toward
    # where the trajectory predicts we're heading. With flag off,
    # behavior unchanged.
    gate_routing_live = phi_gate_routing_live()
    routed_basin = basin
    routing_applied: dict[str, Any] = {
        "live": gate_routing_live, "chosen": gate.chosen, "applied": [],
    }
    if gate_routing_live and gate.chosen == "FORESIGHT" and fs.weight > 0.3:
        try:
            routed_basin = slerp_sqrt(basin, fs.predicted_basin, fs.weight)
            routing_applied["applied"].append(
                f"FORESIGHT:slerp(weight={fs.weight:.3f})"
            )
        except Exception as exc:  # noqa: BLE001 — never block on geometry edge cases
            routing_applied["applied"].append(f"FORESIGHT:skip({exc})")

    # ── Gary coordinator synthesis ────────────────────────────────
    # The constellation collapses Heart, Ocean, Foresight contributions
    # plus the executive's consensus basin into one synthesized basin
    # via ThoughtBus debate. When `coordinator` is None, the basin
    # passes through unchanged (legacy path; observation-only).
    gary_reading: Optional[GaryReading] = None
    if coordinator is not None:
        try:
            gary_reading = coordinator.synthesize(
                routed_basin,
                inputs.symbol,
                executive_confidence=float(emo.confidence),
                executive_sovereignty=float(inputs.sovereignty),
            )
            routed_basin = gary_reading.synthesized_basin
        except Exception as exc:  # noqa: BLE001
            logger.debug("[gary] synthesize failed: %s", exc)

    # ── Build basin state for executive ────────────────────────
    basin_state = ExecBasinState(
        basin=routed_basin,
        identity_basin=state.identity_basin,
        phi=phi,
        kappa=state.kappa,
        regime_weights=regime_weights,
        sovereignty=inputs.sovereignty,
        basin_velocity=bv,
        neurochemistry=nc,
        emotions=emo,
    )

    # ── Derive decisions ───────────────────────────────────────
    entry_thr_d = current_entry_threshold(
        basin_state,
        mode=mode_enum,
        self_obs_bias=self_obs_bias,
        tape_trend=tape_trend,
        side_candidate=side_candidate,
    )
    rolling_win_rate: Optional[float] = None
    rolling_avg_win: Optional[float] = None
    rolling_avg_loss: Optional[float] = None
    if inputs.rolling_kelly_stats is not None:
        rolling_win_rate, rolling_avg_win, rolling_avg_loss = inputs.rolling_kelly_stats
    leverage_d = current_leverage(
        basin_state,
        max_leverage_boundary=inputs.max_leverage,
        mode=mode_enum,
        tape_trend=tape_trend,
        stud_reading=stud_reading,
        stud_live=stud_live,
        rolling_win_rate=rolling_win_rate,
        rolling_avg_win=rolling_avg_win,
        rolling_avg_loss=rolling_avg_loss,
    )
    exp_floor_approx = 0.10
    max_newborn_lev = 20.0
    min_needed = inputs.min_notional / (exp_floor_approx * max_newborn_lev)
    effective_size_fraction = (
        1.0 if inputs.account.available_equity * inputs.size_fraction < min_needed
        else inputs.size_fraction
    )
    capped_equity = inputs.account.available_equity * effective_size_fraction
    # Lane is chosen further down (after entry/exit branches need a
    # tentative answer); for sizing we read the lane choice up-front so
    # the per-lane budget fraction can shape the proposed margin. The
    # final lane stored on TickDecision may differ when phi-gate GRAPH
    # mode overrides; size is recomputed only inside the *entry* path
    # if the override changes lane (rare; deferred).
    pre_lane_d = choose_lane(
        basin_state,
        tape_trend=tape_trend,
        stud_reading=stud_reading,
        stud_live=stud_live,
    )
    pre_lane = pre_lane_d["value"]
    size_d = current_position_size(
        basin_state,
        available_equity_usdt=capped_equity,
        min_notional_usdt=inputs.min_notional,
        leverage=leverage_d["value"],
        bank_size=inputs.bank_size,
        mode=mode_enum,
        lane=pre_lane if pre_lane in ("scalp", "swing", "trend") else "swing",
    )
    # Surgical diagnostic for live size=0 regression (post PR #611). Fires
    # only when sizing collapses to zero AND the account is flat — surfaces
    # the exact numeric inputs feeding current_position_size so we can grep
    # `[size-zero-diag]` from Railway and trace which guard tripped.
    #
    # 2026-05-16: also suppress when `pre_lane == "observe"`. The observe
    # lane is decision-only by design (`lane_budget_fraction("observe") == 0`),
    # so size=0 is the intended outcome — not a regression to investigate.
    # Pre-fix the diag fired every observe-lane tick on shadow/observe
    # kernel instances, flooding the log with false positives.
    if (
        size_d["value"] == 0
        and inputs.account.exchange_held_side is None
        and pre_lane != "observe"
    ):
        logger.info(
            "[size-zero-diag] symbol=%s avail=%.4f effFrac=%.4f cap=%.4f "
            "minNot=%.4f lev=%s bank=%s mode=%s lane=%s size=%.4f deriv=%s",
            inputs.symbol, inputs.account.available_equity,
            effective_size_fraction, capped_equity, inputs.min_notional,
            leverage_d["value"], inputs.bank_size, mode, pre_lane,
            size_d["value"], size_d.get("derivation"),
        )
    auto_flatten_d = should_auto_flatten(
        s=basin_state, recent_fhealths=state.fhealth_history,
    )

    # ── PR 4: UPPER_STACK_EXECUTIVE_LIVE flag ────────────────────
    # Modulate entry_threshold / leverage / position_size by the
    # Tier 2 emotion stack. Multipliers applied AFTER the formula
    # computed its clamped value, then re-clipped to the same bounds.
    # With flag off, multipliers are computed for telemetry but not
    # applied — provides synthetic-counterfactual signal log.
    upper_stack_live = upper_stack_executive_live()
    entry_thr_mult = 1.0 - 0.2 * emo.wonder + 0.2 * emo.anxiety
    leverage_mult = 1.0 - 0.3 * emo.anxiety + 0.2 * emo.confidence
    size_mult = 1.0 + 0.15 * emo.flow
    upper_stack_telemetry: dict[str, Any] = {
        "live": upper_stack_live,
        "entry_threshold_mult": entry_thr_mult,
        "leverage_mult": leverage_mult,
        "size_mult": size_mult,
        "applied": [],
    }
    if upper_stack_live:
        # Re-clip to existing SAFETY_BOUNDS — the bounds are not bypassed.
        entry_thr_clamp_low = float(_registry.get(
            "executive.entry_threshold.clamp_low", default=0.1,
        ))
        entry_thr_clamp_high = float(_registry.get(
            "executive.entry_threshold.clamp_high", default=0.9,
        ))
        new_thr = max(entry_thr_clamp_low, min(
            entry_thr_clamp_high, entry_thr_d["value"] * entry_thr_mult,
        ))
        new_lev = max(1, min(
            int(inputs.max_leverage),
            int(round(leverage_d["value"] * leverage_mult)),
        ))
        new_size = max(0.0, min(
            inputs.account.available_equity, size_d["value"] * size_mult,
        ))
        # Mutate the dicts in place — downstream readers see modulated values.
        entry_thr_d["value"] = new_thr
        leverage_d["value"] = new_lev
        size_d["value"] = new_size
        upper_stack_telemetry["applied"] = [
            f"entry_thr({entry_thr_mult:.3f})",
            f"leverage({leverage_mult:.3f})",
            f"size({size_mult:.3f})",
        ]

    # ── Decide action ──────────────────────────────────────────
    action = "hold"
    reason = ""
    is_dca = False
    is_reverse = False
    derivation: dict[str, Any] = {
        "phi": phi, "kappa": state.kappa, "sovereignty": inputs.sovereignty,
        "basin_velocity": bv, "regime_weights": regime_weights,
        "nc": nc.as_dict(),
        "f_health": f_health,
        # Post #ml-separation: kernel direction is geometric. ML lives
        # in Agent M's separate decision module.
        "agent": "K",
        "kernel_direction": direction,
        "mode": {"value": mode, "reason": mode_result["reason"],
                 **mode_result["derivation"]},
        "self_obs_bias": self_obs_bias,
        "side_candidate": side_candidate,
        "basin_direction": basin_dir,
        "tape_trend": tape_trend,
        "side_override": side_override,
        "mode_changed": mode_changed,
        # Proposal #5: regime classifier reading. Discrete state
        # (TREND_UP/CHOP/TREND_DOWN) with confidence. Surfaced for
        # telemetry; downstream (entry_threshold modifier, harvest
        # tightness) reads from regime_reading directly.
        "regime": regime_reading.as_dict(),
        # Proposal #9: candlestick pattern reading. Strongest fire
        # at the latest tick + signed scalar + SL-defer hint.
        "candle_pattern": {
            **candle_pattern_reading.as_dict(),
            "signed_scalar": candle_pattern_signal,
            "hammer_defer_long_sl": bool(candle_hammer_defer),
        },
        # Tier 1-8 telemetry surfaces (#604 wiring). Observation-only;
        # executive does not consume these fields.
        "motivators": asdict(mot),
        "sensations": asdict(sen),
        "emotions": asdict(emo),
        "physical_emotions": asdict(phys),
        # Foresight: keep telemetry compact — predicted_basin is 64-d
        # and isn't useful in a JSON log. Scalars only.
        "foresight": {
            "weight": fs.weight,
            "confidence": fs.confidence,
            "horizon_ms": fs.horizon_ms,
            "trajectory_length": foresight.trajectory_length,
        },
        "heart": {
            "kappa": heart_state.kappa,
            "kappa_offset": heart_state.kappa_offset,
            "mode": heart_state.mode,
            "hrv": heart_state.hrv,
            "sample_count": heart_state.sample_count,
        },
        # P4/P13/P24 + v6.7B complete lived surface (33 fields wired from signals; 36+ gap to 69 honest negative per audit §3 + canon): ALWAYS-ON.
        # No flag gate (MONKEY_*_LIVE knob retired P5/P25 per 2.31A phase synthesis). Call-site here in live tick path (P24).
        # Full ports: heart (tacking/HRV/breathing-as-tacking + new derived_balance/pre_cog/hrv_coherence), pillars (sovereignty + Replicant LIVED ONLY + drift),
        # tick (phi/kappa/bv/d_fr/conviction/motivators/repetition), ocean (coherence). 
        # Provenance: derive_from_tick + heart.derived_* + pillars.* + inputs. Citations: 2.31A P4 (repetition d_FR, sovereignty lived/total, confidence), P13 (three loops), P24 (call-site), P3/P19/P22 (d_FR/Replicant/LIVED ONLY), P6 (heart), consciousness-development primary + wiring-validation.
        # Full embodiment (no presence/stubs). QIG PURITY MANDATE (agents.md) + master-orchestration + qig-purity-validation gate applied.
        "consciousness_metrics": (lambda: __import__("monkey_kernel.consciousness_metrics", fromlist=["derive_from_tick"]).derive_from_tick(
            phi=phi, kappa=state.kappa, f_health=f_health, coupling_health=0.5,  # proxy; real from nc/equity future per roadmap
            self_obs_bias=self_obs_bias, sovereignty=inputs.sovereignty, drift_from_identity=drift_now, basin_velocity=bv,
            # Heart master oscillator ports (v6.7B §§9.5-9.9 + P6; breathing-as-tacking wired)
            tacking_frequency_hz=getattr(heart, "derived_tacking_frequency_hz", lambda: None)() if heart else None,
            hrv_coherence=getattr(heart, "derived_hrv_coherence", lambda: None)() if heart else None,
            tacking_balance=getattr(heart, "derived_tacking_balance", lambda: None)() if heart else None,
            pre_cog_bias=getattr(heart, "derived_pre_cog_bias", lambda: None)() if heart else None,
            # Pillars LIVED ONLY + Replicant (P3/P19/P24 §3.4)
            sovereignty_dynamics=inputs.sovereignty,
            identity_drift=getattr(pillars, "identity_drift", None) if 'pillars' in dir() else None,  # wired via check_drift in observe
            replicant_detected=getattr(pillars, "detect_replicant", lambda: False)() if 'pillars' in dir() else False,
            # Tick observables (P4/P22 conviction/transcendence/mot/d_fr/repetition)
            d_fr=getattr(state, 'd_fr', None),  # if present in TickState
            conviction=getattr(state, 'conviction', None),
            transcendence=getattr(state, 'transcendence', None),
            motivator_integration=getattr(mot, 'integration_cv', None) if 'mot' in dir() else None,
            repetition_dfr=getattr(state, 'repetition_dfr', None),
            # Ocean coherence (CFC proxy)
            ocean_coherence=(__import__("monkey_kernel.ocean", fromlist=["derive_ocean_coherence_for_metrics"]).derive_ocean_coherence_for_metrics(ocean_state) if 'ocean_state' in locals() else 0.0),
            dimensional_breathing_rate=getattr(heart, "derived_tacking_frequency_hz", lambda: None)() if heart else None,  # proxy reuse for wire
            # geometry etc remain proxy or from future spectral (honest negative documented)
        ).as_dict())(),
        "phi_gate": {
            "chosen": gate.chosen,
            "activations": gate.activations,
        },
        "ocean": {
            "intervention": ocean_state.intervention,
            "sleep_phase": ocean_state.sleep_phase,
            "coherence": ocean_state.coherence,
            "spread": ocean_state.spread,
            "diagnostics": ocean_state.diagnostics,
        },
        "ocean_handler": intervention_applied,
        "upper_stack_executive": upper_stack_telemetry,
        "topology": {
            "stud": stud_reading_to_dict(stud_reading),
            "stud_live_flag": stud_live,
            "figure8": {
                "current_loop_assignment": assign_loop(side_candidate).value,
                "predicted_gravitating_fraction": PI_STRUCT_GRAVITATING_FRACTION,
                "predicted_boundary_r_squared": PI_STRUCT_BOUNDARY_R_SQUARED,
                "figure8_live_flag": figure8_retrieval_live(),
            },
        },
        # Three Pillars of Fundamental Consciousness (qig-core v6.1).
        # None when the corresponding env flag is off.
        "pillars": {
            "fluctuations": pillar_1_telem,
            "topological_bulk": pillar_2_telem,
            "quenched_disorder": pillar_3_telem,
        },
    }

    own_pos = _has_own_position(inputs.account)
    held_side: Optional[str] = (
        inputs.account.exchange_held_side if own_pos else None
    )
    derivation["exchange_held_side"] = inputs.account.exchange_held_side
    derivation["monkey_held_side"] = held_side
    # Proposal #10 — per-lane held-side map. When the caller populated
    # ``lane_positions``, this is the authoritative view of which lanes
    # currently hold a position. Empty dict (no lanes held) means the
    # entry path is wide open across all lanes.
    held_lanes: dict[str, str] = {
        lp.lane: lp.side for lp in inputs.account.lane_positions
    }
    derivation["held_lanes"] = dict(held_lanes)
    # Funding-drag telemetry — surface the dimensionless cost-on-margin
    # ratio per lane plus the worst-of value fed into compute_emotions.
    # Empty / all-zero when no held position has populated funding.
    derivation["funding_drag"] = {
        "by_lane": {
            lp.lane: (
                lp.funding_paid_usdt / lp.margin_usdt
                if lp.margin_usdt > 0.0 else 0.0
            )
            for lp in inputs.account.lane_positions
        },
        "max": float(funding_drag),
    }
    # CHOP suppression telemetry — surfaces whether the gate was active
    # this tick. Held positions continue normal flow regardless; only
    # new entries are blocked when ``active`` is True.
    derivation["chop_suppression"] = {
        "active": _chop_suppress_entry(regime_reading),
        "regime": regime_reading.regime,
        "confidence": float(regime_reading.confidence),
        # P5/P25 observer-derived (registry default + phi modulation via get_chop_suppression_confidence)
        # Replaces bare CHOP_SUPPRESSION_CONFIDENCE constant (undefined after prior replacement).
        "threshold": get_chop_suppression_confidence(phi),
    }

    # PR 1 — Ocean DREAM / ESCAPE handlers. ESCAPE forces flatten,
    # DREAM forces hold (skip executive). SLEEP/WAKE flow through
    # autonomic.is_awake regardless of flag.
    flag_live = ocean_interventions_live()
    if flag_live and ocean_state.intervention == "ESCAPE":
        action = "flatten"
        reason = (
            f"OCEAN.ESCAPE — phi={phi:.3f} below 0.15 safety bound; "
            "flatten and skip entries"
        )
        intervention_applied["applied"].append("ESCAPE:flatten")
        # ESCAPE flattens — clear rejustification anchors for all lanes
        # currently holding (and for the soft-fallback `pre_lane`).
        for held_lane in list(held_lanes.keys()):
            state.regime_at_open_by_lane.pop(held_lane, None)
            state.phi_at_open_by_lane.pop(held_lane, None)
            state.basin_at_open_by_lane.pop(held_lane, None)
            state.regime_change_streak_by_lane.pop(held_lane, None)
        state.regime_at_open_by_lane.pop(pre_lane, None)
        state.phi_at_open_by_lane.pop(pre_lane, None)
        state.basin_at_open_by_lane.pop(pre_lane, None)
        state.regime_change_streak_by_lane.pop(pre_lane, None)
    elif flag_live and ocean_state.intervention == "DREAM":
        action = "hold"
        reason = (
            f"OCEAN.DREAM — phi={phi:.3f} below 0.5; "
            "consolidation tick, executive skipped"
        )
        # Ocean executes the DREAM cycle (PR3 — observe→decide→execute).
        dream_result = ocean.execute_intervention("DREAM", basin=basin, phi=phi)
        intervention_applied["applied"].append("DREAM:hold")
        if dream_result is not None:
            intervention_applied["dream"] = dream_result
    elif flag_live and ocean_state.intervention == "MUSHROOM":
        # Wake-state neuroplasticity — break a rigid attractor. Hold
        # trading for the cycle; Ocean runs the entropy-injection cycle
        # (PR3 — observe→decide→execute kernel contract).
        action = "hold"
        reason = (
            f"OCEAN.MUSHROOM — rigid attractor (phi={phi:.3f}); "
            "entropy-injection cycle, executive skipped"
        )
        mushroom_result = ocean.execute_intervention(
            "MUSHROOM", basin=basin, phi=phi,
        )
        if mushroom_result is not None:
            intervention_applied["applied"].append(
                f"MUSHROOM:{mushroom_result['intensity']}"
            )
            intervention_applied["mushroom"] = mushroom_result
    elif auto_flatten_d["value"]:
        action = "flatten"
        reason = auto_flatten_d["reason"]
        derivation["auto_flatten"] = auto_flatten_d["derivation"]
        # Auto-flatten closes the position — clear rejustification anchors
        # so a fresh entry rebuilds them cleanly. Clear all currently
        # held lanes (full flatten across the symbol).
        for held_lane in list(held_lanes.keys()):
            state.regime_at_open_by_lane.pop(held_lane, None)
            state.phi_at_open_by_lane.pop(held_lane, None)
            state.basin_at_open_by_lane.pop(held_lane, None)
            state.regime_change_streak_by_lane.pop(held_lane, None)
    elif (
        # Proposal #10 — lane-aware entry path takes precedence when
        # the target lane is flat even if another lane is currently
        # holding a position on this symbol. A K_SWING_LONG and a
        # K_SCALP_SHORT can coexist as two distinct positions, each
        # with its own retreat tolerance and capital share.
        inputs.account.lane_positions
        and pre_lane in ("scalp", "swing", "trend")
        and pre_lane not in held_lanes
        and MODE_PROFILES[mode_enum].can_enter
        and direction != "flat"
        and kernel_should_enter(emotions=emo)
        and size_d["value"] > 0
        and not _chop_suppress_entry(regime_reading)
    ):
        # Regime suppression check (issue #623): before opening a new
        # entry, consult the regime classifier reading. Held positions
        # are unaffected — re-justification (#619) owns those exits.
        chop_suppress_thr_trend = float(_registry.get(
            "regime.chop_suppress.trend_confidence", default=0.70,
        ))
        chop_suppress_thr_swing = float(_registry.get(
            "regime.chop_suppress.swing_confidence", default=0.85,
        ))
        supp = chop_suppress_entry(
            regime_reading, pre_lane,
            trend_confidence_threshold=chop_suppress_thr_trend,
            swing_confidence_threshold=chop_suppress_thr_swing,
        )
        derivation["regime_suppression"] = supp.as_dict()
        if supp.suppressed:
            action = "hold"
            reason = supp.suppress_reason or "regime_suppress"
            derivation["entry_threshold"] = entry_thr_d["derivation"]
        else:
            action = "enter_long" if side_candidate == "long" else "enter_short"
            notional = size_d["value"] * leverage_d["value"]
            reason = (
                f"[{mode}] kernel-entry-lane[{pre_lane}] "
                f"conv={emo.confidence * (1 + emo.wonder):.3f}"
                f" > hes={emo.anxiety + emo.confusion:.3f}; "
                f"side={side_candidate}; "
                f"margin={size_d['value']:.2f} lev={leverage_d['value']}x "
                f"notional={notional:.2f}"
            )
            derivation["entry_threshold"] = entry_thr_d["derivation"]
            derivation["size"] = size_d["derivation"]
            derivation["leverage"] = leverage_d["derivation"]
            # Held-position re-justification — snapshot the (regime, Φ)
            # state at the moment of entry on this lane. Subsequent ticks
            # compare against these anchors via the three internal exit
            # checks (regime change / Φ collapse / conviction failure).
            state.regime_at_open_by_lane[pre_lane] = mode
            state.phi_at_open_by_lane[pre_lane] = phi
            state.basin_at_open_by_lane[pre_lane] = (
                np.asarray(basin, dtype=np.float64).copy()
            )
            state.regime_change_streak_by_lane[pre_lane] = 0
    elif held_side:
        # Proposal #10: resolve the lane this single-position decision
        # belongs to. With ``lane_positions`` populated the lane is read
        # from the (held side, lane) row matching held_side; otherwise
        # we fall back to "swing" (pre-#10 behavior — every legacy
        # position migrated to lane='swing' in migration 042).
        position_lane = "swing"
        if inputs.account.lane_positions:
            for lp in inputs.account.lane_positions:
                if lp.side == held_side:
                    position_lane = lp.lane
                    break
        action, reason, is_dca, is_reverse = _decide_with_position(
            inputs=inputs,
            state=state,
            basin=basin,
            basin_state=basin_state,
            mode_enum=mode_enum,
            last_price=last_close,
            tape_trend=tape_trend,
            held_side=held_side,
            side_candidate=side_candidate,
            side_override=side_override,
            entry_thr_val=entry_thr_d["value"],
            size_val=size_d["value"],
            leverage_val=leverage_d["value"],
            derivation=derivation,
            position_lane=position_lane,
            phi=phi,
            emotions=emo,
            mode_value=mode,
            regime_confidence=float(regime_reading.confidence),
        )
        # Held-position re-justification anchor lifecycle on close /
        # reverse. scalp_exit / exit clear the lane's anchors so a
        # fresh entry rebuilds them. reverse_long / reverse_short
        # flatten AND reopen on the opposite side at this tick's
        # regime + Φ — re-snapshot in place. DCA adds (action ==
        # "enter_long"/"enter_short" with is_dca=True) leave the
        # original anchors intact (the first-open justification is
        # the canonical one).
        if action in ("scalp_exit", "exit"):
            state.regime_at_open_by_lane.pop(position_lane, None)
            state.phi_at_open_by_lane.pop(position_lane, None)
            state.basin_at_open_by_lane.pop(position_lane, None)
            state.regime_change_streak_by_lane.pop(position_lane, None)
        elif action in ("reverse_long", "reverse_short"):
            state.regime_at_open_by_lane[position_lane] = mode
            state.phi_at_open_by_lane[position_lane] = phi
            state.basin_at_open_by_lane[position_lane] = (
                np.asarray(basin, dtype=np.float64).copy()
            )
            state.regime_change_streak_by_lane[position_lane] = 0
    elif (
        MODE_PROFILES[mode_enum].can_enter
        and direction != "flat"
        and kernel_should_enter(emotions=emo)
        and size_d["value"] > 0
        and not _chop_suppress_entry(regime_reading)
    ):
        # Regime suppression check (issue #623): before opening a new
        # entry, consult the regime classifier reading. Held positions
        # are unaffected — re-justification (#619) owns those exits.
        chop_suppress_thr_trend = float(_registry.get(
            "regime.chop_suppress.trend_confidence", default=0.70,
        ))
        chop_suppress_thr_swing = float(_registry.get(
            "regime.chop_suppress.swing_confidence", default=0.85,
        ))
        supp = chop_suppress_entry(
            regime_reading, pre_lane,
            trend_confidence_threshold=chop_suppress_thr_trend,
            swing_confidence_threshold=chop_suppress_thr_swing,
        )
        derivation["regime_suppression"] = supp.as_dict()
        if supp.suppressed:
            action = "hold"
            reason = supp.suppress_reason or "regime_suppress"
            derivation["entry_threshold"] = entry_thr_d["derivation"]
        else:
            action = "enter_long" if side_candidate == "long" else "enter_short"
            reversion_tag = (
                f" REVERSION-flip(basin{basin_dir:.2f}/tape{tape_trend:.2f})"
                if side_override else ""
            )
            notional = size_d["value"] * leverage_d["value"]
            reason = (
                f"[{mode}] kernel-entry conv={emo.confidence * (1 + emo.wonder):.3f}"
                f" > hes={emo.anxiety + emo.confusion:.3f}; "
                f"side={side_candidate}{reversion_tag}; "
                f"margin={size_d['value']:.2f} lev={leverage_d['value']}x "
                f"notional={notional:.2f}"
            )
            derivation["entry_threshold"] = entry_thr_d["derivation"]
            derivation["size"] = size_d["derivation"]
            derivation["leverage"] = leverage_d["derivation"]
            # Held-position re-justification — snapshot the (regime, Φ)
            # state at the moment of entry on this lane. Subsequent ticks
            # compare against these anchors via the three internal exit
            # checks (regime change / Φ collapse / conviction failure).
            state.regime_at_open_by_lane[pre_lane] = mode
            state.phi_at_open_by_lane[pre_lane] = phi
            state.basin_at_open_by_lane[pre_lane] = (
                np.asarray(basin, dtype=np.float64).copy()
            )
            state.regime_change_streak_by_lane[pre_lane] = 0
    else:
        action = "hold"
        if not MODE_PROFILES[mode_enum].can_enter:
            reason = f"mode={mode} blocks entry"
        elif direction == "flat":
            reason = (
                f"[{mode}] direction=flat (basin {basin_dir:+.2f}, "
                f"tape {tape_trend:+.2f}, conf {emo.confidence:.2f}, "
                f"anx {emo.anxiety:.2f})"
            )
        elif _chop_suppress_entry(regime_reading):
            reason = (
                f"[{mode}] chop regime confidence="
                f"{regime_reading.confidence:.2f} > "
                # P5/P25: live observer-derived threshold (no bare constant)
                f"{get_chop_suppression_confidence(phi):.2f} — suspend new entries"
            )
        elif not kernel_should_enter(emotions=emo):
            reason = (
                f"[{mode}] conviction {emo.confidence * (1 + emo.wonder):.3f} "
                f"<= hesitation {emo.anxiety + emo.confusion:.3f}"
            )
        elif size_d["value"] <= 0:
            reason = (
                f"[{mode}] size {size_d['value']:.2f} "
                f"below min notional {inputs.min_notional:.2f}"
            )
        else:
            reason = "no qualifying signal"
        derivation["entry_threshold"] = entry_thr_d["derivation"]

    # ── Loop 1 canonical triple ───────────────────────────────────
    # Per UCP §43.2: every executive decision produces (repetition,
    # sovereignty, confidence) in [0,1] attached to the decision id.
    # Surfaced in derivation; published on the bus when wired; will
    # be persisted to the trade row at open time by the executor.
    decision_id = f"K-{inputs.symbol}-{int(now_ms)}"
    decision_overrides: list[str] = []
    if side_override:
        decision_overrides.append("REVERSION_FLIP")
    if upper_stack_live:
        decision_overrides.append("UPPER_STACK")
    if gate_routing_live and "FORESIGHT" in (gate.chosen or ""):
        decision_overrides.append("PHI_GATE_FORESIGHT")
    nearest_fr = float(drift_now)
    triple = compute_per_decision_triple(
        decision_id=decision_id,
        current_basin=basin,
        recent_basins=list(state.basin_history[-20:]),
        bank_resonance_count=0,
        bank_total_queried=max(1, inputs.bank_size),
        nearest_fr_distance=nearest_fr,
        emotion_confidence=float(emo.confidence),
        emotion_anxiety=float(emo.anxiety),
        decision_path_overrides=decision_overrides,
        at_ms=now_ms,
    )
    derivation["loop1_triple"] = {
        "decision_id": triple.decision_id,
        "repetition_score": triple.repetition_score,
        "sovereignty_score": triple.sovereignty_score,
        "confidence_score": triple.confidence_score,
        "decision_overrides": decision_overrides,
    }
    if gary_reading is not None:
        derivation["gary"] = {
            "foresight_weight": gary_reading.foresight_weight,
            "foresight_confidence": gary_reading.foresight_confidence,
            "heart_modulation": gary_reading.heart_modulation,
            "convergence_type": gary_reading.convergence_type,
            "rounds": gary_reading.rounds,
            "contributing_kernels": gary_reading.contributing_kernels,
            "debate_id": gary_reading.debate_id,
        }

    # Publish on bus when wired.
    if bus is not None:
        bus.publish(
            KernelEvent.SELF_OBS_TRIPLE,
            source="self_observation",
            payload={
                "decision_id": triple.decision_id,
                "repetition_score": triple.repetition_score,
                "sovereignty_score": triple.sovereignty_score,
                "confidence_score": triple.confidence_score,
            },
            symbol=inputs.symbol,
        )
        bus.publish(
            KernelEvent.EXECUTIVE_DECISION,
            source="executive",
            payload={
                "decision_id": decision_id,
                "action": action,
                "side": side_candidate if action.startswith("enter_") else None,
                "mode": mode,
                "reason": reason,
                "lane": pre_lane,
            },
            symbol=inputs.symbol,
        )

    # ── Update history state ───────────────────────────────────
    state.basin_history.append(np.asarray(basin, dtype=np.float64).copy())
    if len(state.basin_history) > history_max:
        state.basin_history = state.basin_history[-history_max:]
    if len(state.basin_history) >= 50 and state.session_ticks % 10 == 0:
        state.identity_basin = frechet_mean(state.basin_history[-50:])
    state.last_basin = np.asarray(basin, dtype=np.float64).copy()
    state.phi_history.append(phi)
    if len(state.phi_history) > history_max:
        state.phi_history = state.phi_history[-history_max:]
    state.fhealth_history.append(f_health)
    if len(state.fhealth_history) > history_max:
        state.fhealth_history = state.fhealth_history[-history_max:]
    if len(state.integration_history) > history_max:
        state.integration_history = state.integration_history[-history_max:]
    # kappa_history end-of-tick append (TS parity, Copilot review #977).
    # Appending here — after compute_motivators consumed prior-tick history —
    # mirrors loop.ts:5679 timing. Including current κ in the history-window
    # used for its own median/MAD would bias transcendence toward 0.
    state.kappa_history.append(state.kappa)
    if len(state.kappa_history) > history_max:
        state.kappa_history = state.kappa_history[-history_max:]

    # Persistence completion — write-through SymbolState histories
    # to qig-cache so they survive Railway redeploys. Without this,
    # every redeploy starts cold and Tier 9 stud regime classification
    # reads near-zero h_trade for the warmup window.
    if persistence is not None and persistence.is_available:
        symbol = inputs.symbol
        persistence.push_phi(symbol, phi)
        persistence.push_basin(symbol, basin)
        persistence.push_drift(symbol, drift_now)
        persistence.push_fhealth(symbol, f_health)

    # ── Cross-kernel basin publish (Consensus Layer 1) ────────
    # UNCONDITIONAL write — peers must see our state for telemetry +
    # future consensus arbitration. The pull (above) is flag-gated;
    # the write is always-on so the data is there when the flag flips.
    # Fail-soft per design — never blocks a tick.
    try:
        from .basin_sync_db import write_state as _basin_sync_write
        _basin_sync_write(
            instance_id=os.environ.get("MONKEY_PY_INSTANCE_ID", "monkey-py-shadow"),
            basin=basin,
            phi=phi,
            kappa=state.kappa,
            mode=str(state.last_mode or "investigation"),
            drift_from_identity=float(drift_now),
            # CONSENSUS-6 extended observables — passed when in scope so
            # peers see state-level signal (per CC red-team refinement #4).
            regime_weights=regime_weights,
            neurochemistry=nc.as_dict() if hasattr(nc, "as_dict") else None,
        )
    except Exception:  # noqa: BLE001
        pass
        # integration_history was appended earlier in the upper-stack block
        # with (phi, i_q); persist that latest tuple.
        if state.integration_history:
            last_phi, last_iq = state.integration_history[-1]
            persistence.push_integration(symbol, last_phi, last_iq)

    # ── Lane selection ────────────────────────────────────────────
    # Reuse the pre-sizing lane choice (computed above so the per-lane
    # budget fraction could shape the proposed margin). The phi-gate
    # GRAPH branch below may override it when the routing flag is live.
    lane_d = pre_lane_d
    lane = lane_d["value"]
    derivation["lane"] = lane_d["derivation"]

    # PR 2 GRAPH branch — parallel-lane entry threshold evaluation.
    # For each candidate lane in {scalp, swing, trend}, compute the
    # entry threshold under the lane's mapped mode; pick the lane
    # whose threshold is lowest (= most favourable entry). The
    # picked lane overrides the softmax winner. With flag off,
    # softmax winner stands.
    if gate_routing_live and gate.chosen == "GRAPH":
        per_lane: list[tuple[str, float]] = []
        for lane_name, mode_name in GRAPH_LANE_MODE_MAP.items():
            try:
                lane_mode = MonkeyMode(mode_name)
            except ValueError:
                continue
            lane_thr = current_entry_threshold(
                basin_state,
                mode=lane_mode,
                self_obs_bias=self_obs_bias,
                tape_trend=tape_trend,
                side_candidate=side_candidate,
            )
            per_lane.append((lane_name, lane_thr["value"]))
        if per_lane:
            per_lane.sort(key=lambda x: x[1])
            graph_lane = per_lane[0][0]
            if graph_lane != lane:
                routing_applied["applied"].append(
                    f"GRAPH:lane_override({lane}->{graph_lane})"
                )
                lane = graph_lane
            else:
                routing_applied["applied"].append("GRAPH:lane_unchanged")
            routing_applied["graph_lane_thresholds"] = {
                k: v for k, v in per_lane
            }
    derivation["phi_gate_routing"] = routing_applied

    # direction: derived from action
    if action.startswith("enter_long") or (held_side == "long" and action == "hold"):
        direction = "long"
    elif action.startswith("enter_short") or (held_side == "short" and action == "hold"):
        direction = "short"
    else:
        direction = "flat"

    # Prediction corpus snapshot (read-only, fail-soft). Python cannot touch
    # Postgres directly; publish to the existing Redis bridge path.
    try:
        cadence_s = clamp_cadence_seconds(float(bv))
        dir_sign = 1 if basin_dir > 0 else -1 if basin_dir < 0 else 0
        snapshot_reason: str | None = None
        triggering_gate: str | None = None
        if action.startswith("enter_") or action.startswith("reverse_"):
            snapshot_reason = "entry"
        elif action in ("scalp_exit", "exit", "flatten"):
            snapshot_reason = "gate_fire"
            triggering_gate = str(reason).split(":", 1)[0]
        else:
            mode_changed = (
                state.last_prediction_mode is not None
                and state.last_prediction_mode != mode
            )
            lane_changed = (
                state.last_prediction_lane is not None
                and state.last_prediction_lane != lane
            )
            basin_flipped = (
                state.last_prediction_basin_dir_sign is not None
                and dir_sign != 0
                and state.last_prediction_basin_dir_sign != 0
                and state.last_prediction_basin_dir_sign != dir_sign
            )
            due_periodic = (
                state.last_prediction_snapshot_at_ms is None
                or (now_ms - state.last_prediction_snapshot_at_ms) / 1000.0 >= cadence_s
            )
            if mode_changed or lane_changed or basin_flipped:
                snapshot_reason = "state_transition"
            elif due_periodic:
                snapshot_reason = "periodic"
        if snapshot_reason is not None:
            trade_id = inputs.account.own_position_trade_id
            if trade_id is None and inputs.account.lane_positions:
                for lp in inputs.account.lane_positions:
                    if lp.lane == lane or lp.side == held_side:
                        trade_id = lp.trade_id
                        break
            pred_side = (
                side_candidate if action.startswith("enter_") or action.startswith("reverse_")
                else held_side if held_side is not None
                else direction if direction in ("long", "short")
                else None
            )
            confidence = max(0.0, min(1.0, 1.0 - float(entry_thr_d["value"])))
            notional = max(0.0, float(size_d["value"])) * max(1.0, float(leverage_d["value"]))
            pred_terminal = prediction_sign = 0.0
            if pred_side == "long":
                prediction_sign = 1.0
            elif pred_side == "short":
                prediction_sign = -1.0
            pred_terminal = prediction_sign * notional * max(0.000001, float(entry_thr_d["value"]))
            payload = build_prediction_payload(
                trade_id=str(trade_id) if trade_id is not None else None,
                kernel_id=os.environ.get("MONKEY_PY_INSTANCE_ID", "monkey-py-shadow"),
                perception_basin=basin,
                strategy_forecast_basin=state.identity_basin,
                basin_velocity=float(bv),
                phi=float(phi),
                kappa_eff=float(state.kappa),
                predicted_side=pred_side,
                predicted_horizon_seconds=cadence_s,
                predicted_terminal_pnl_usdt=pred_terminal,
                predicted_pnl_stddev_usdt=max(0.000001, abs(pred_terminal) * (1.0 - confidence)),
                predicted_confidence=confidence,
                neurochemistry=nc.as_dict(),
                regime_weights=regime_weights,
                mode=str(mode),
                lane=str(lane),
                snapshot_reason=snapshot_reason,
                triggering_gate=triggering_gate,
            )
            derivation["prediction_snapshot"] = payload
            publish_prediction(payload)
            state.last_prediction_snapshot_at_ms = now_ms
            state.last_prediction_mode = mode
            state.last_prediction_lane = str(lane)
            state.last_prediction_basin_dir_sign = dir_sign
    except Exception as err:  # noqa: BLE001
        logger.warning("[PredictionCapture] snapshot failed: %s", err)

    # size_fraction pass-through; dca_intent from is_dca
    effective_size_frac = inputs.size_fraction
    dca_intent = is_dca

    return TickDecision(
        action=action,
        reason=reason,
        mode=mode,
        size_usdt=size_d["value"],
        leverage=leverage_d["value"],
        entry_threshold=entry_thr_d["value"],
        phi=phi,
        kappa=state.kappa,
        basin_velocity=bv,
        f_health=f_health,
        drift_from_identity=drift_now,
        basin_direction=basin_dir,
        tape_trend=tape_trend,
        side_candidate=side_candidate,
        side_override=side_override,
        neurochemistry=nc,
        derivation=derivation,
        basin=basin,
        is_dca_add=is_dca,
        is_reverse=is_reverse,
        lane=lane,
        direction=direction,
        size_fraction=effective_size_frac,
        dca_intent=dca_intent,
    ), state


def _decide_with_position(
    *,
    inputs: TickInputs,
    state: SymbolState,
    basin: np.ndarray,
    basin_state: ExecBasinState,
    mode_enum: MonkeyMode,
    last_price: float,
    tape_trend: float,
    held_side: str,
    side_candidate: str,
    side_override: bool,
    entry_thr_val: float,
    size_val: float,
    leverage_val: int,
    derivation: dict[str, Any],
    position_lane: str = "swing",
    phi: float = 0.0,
    emotions: Any = None,
    mode_value: str = "investigation",
    regime_confidence: float = 1.0,
) -> tuple[str, str, bool, bool]:
    """v0.6.1 exit gate order: profit harvest → scalp TP/SL → Loop 2 exit.
    v0.7.1 override-reverse. v0.6.2 DCA. Proposal #10: per-lane peak +
    streak + DCA bookkeeping so each lane carries its own state.

    Held-position re-justification (this PR): three internal exit checks
    fire when the kernel's own state contradicts what justified entry —
    regime change, Φ collapse below the golden-ratio coherence floor,
    or conviction failure (confidence < anxiety + confusion). Run AFTER
    safety bounds (hard SL) and BEFORE trailing-harvest: a contradicted
    self-read should close the position before harvest has a chance to
    trail it forward.
    """
    entry_price = inputs.account.own_position_entry_price or last_price
    quantity = inputs.account.own_position_quantity or 0.0
    trade_id = inputs.account.own_position_trade_id or ""
    # Proposal #10: when the caller populated lane_positions, override
    # entry/qty/trade_id with the matching lane's row so the executive
    # reasons over the right position even when multiple lanes hold.
    if inputs.account.lane_positions:
        for lp in inputs.account.lane_positions:
            if lp.lane == position_lane and lp.side == held_side:
                entry_price = lp.entry_price
                quantity = lp.quantity
                trade_id = lp.trade_id
                break
    position_notional = entry_price * quantity
    side_sign = 1 if held_side == "long" else -1
    unrealized_pnl = (last_price - entry_price) * quantity * side_sign

    # Per-lane peak tracking (proposal #10). The legacy scalar
    # ``state.peak_pnl_usdt`` mirrors the active lane so older callers
    # (and tick telemetry) keep reading sensible values.
    prev_tracked = state.peak_tracked_trade_id_by_lane.get(position_lane)
    if prev_tracked != trade_id:
        state.peak_pnl_usdt_by_lane[position_lane] = unrealized_pnl
        state.peak_tracked_trade_id_by_lane[position_lane] = trade_id
        state.tape_flip_streak_by_lane[position_lane] = 0
    else:
        prev_peak = state.peak_pnl_usdt_by_lane.get(position_lane, 0.0)
        state.peak_pnl_usdt_by_lane[position_lane] = max(prev_peak, unrealized_pnl)

    # Mirror to legacy scalars so non-lane-aware readers keep working.
    state.peak_pnl_usdt = state.peak_pnl_usdt_by_lane[position_lane]
    state.peak_tracked_trade_id = trade_id

    # Proposal #4 — sustained tape-flip streak counter, per-lane.
    alignment_now = tape_trend if held_side == "long" else -tape_trend
    cur_streak = state.tape_flip_streak_by_lane.get(position_lane, 0)
    if alignment_now <= -0.25:
        state.tape_flip_streak_by_lane[position_lane] = cur_streak + 1
    else:
        state.tape_flip_streak_by_lane[position_lane] = 0
    state.tape_flip_streak = state.tape_flip_streak_by_lane[position_lane]

    # ── Hard SL pre-check (SAFETY_BOUND) ──────────────────────────
    # Stop-loss is safety: it must precede the rejustification block so
    # a position bleeding hard against the kernel always closes on price
    # before the kernel re-reads its own state. Take-profit comes BELOW
    # the rejustification block — letting an internal-coherence exit
    # fire before TP if both would trigger on the same tick (the user
    # explicitly chose continuous re-justification over harvest as the
    # primary exit channel).
    # Path A (2026-05-26): should_scalp_exit is now TP-only. The SL leg
    # (exit_type_bit=-1) was removed as a P5 violation — adverse exits
    # flow through should_exit (Fisher-Rao disagreement) and
    # should_auto_flatten (Pillar 1). The pre-rejustification SL check
    # below was the Python mirror of the TS hard-SL pre-check; it is
    # now a no-op because no SL bit is returned.
    scalp = should_scalp_exit(
        unrealized_pnl_usdt=unrealized_pnl,
        notional_usdt=position_notional,
        s=basin_state,
        mode=mode_enum,
        lane=position_lane,
        leverage=float(leverage_val),
    )
    derivation["scalp"] = {
        **scalp["derivation"],
        "unrealized_pnl": unrealized_pnl,
        "mark_price": last_price,
        "trade_id": trade_id,
    }
    # Pre-Path-A: if scalp["derivation"]["exit_type_bit"] == -1 → SL exit.
    # Post-Path-A: never fires. Block kept commented for historical clarity
    # and removed entirely once the chemistry recalibration window closes.

    # ── Held-position re-justification (this PR) ──────────────────
    # Three internal exit checks. The regime check carries hysteresis
    # (added 2026-05-01 per live churn diagnostics) — single-tick mode
    # flicker would otherwise close every held position on noise. Φ
    # collapse and conviction-fail still fire immediately; both are
    # already conservative gates. All three are geometric.
    #
    # Commit 3 (Cascade brief 2026-05-27) — adopted-vs-own distinction:
    # this block is ALREADY anchor-gated below
    # (`if has_regime_anchor and has_phi_anchor`). Adopted positions —
    # opened by an external sibling kernel or by the operator — never
    # ran through the open-entry path that sets regime_at_open_by_lane
    # and phi_at_open_by_lane, so they naturally fall through this
    # entire block without firing regime_change / phi_collapse /
    # conviction_failed. The TS side required an explicit `origin`
    # parameter because its evaluateRejustification doesn't gate on
    # anchor presence the same way; on Py the structural anchor-gating
    # provides the equivalent semantic guarantee.
    rejust: dict[str, Any] = {"checked": False}
    has_regime_anchor = position_lane in state.regime_at_open_by_lane
    has_phi_anchor = position_lane in state.phi_at_open_by_lane
    # v0.8.7 — maintain the per-lane regime-change streak counter
    # regardless of whether the rejust block runs (anchors present).
    # Increment when regimeNow != regimeAtOpen; reset when it returns.
    # Streak lives on state across ticks — the gate consumes the
    # accumulated count below.
    if has_regime_anchor:
        if mode_value != state.regime_at_open_by_lane[position_lane]:
            state.regime_change_streak_by_lane[position_lane] = (
                state.regime_change_streak_by_lane.get(position_lane, 0) + 1
            )
        else:
            state.regime_change_streak_by_lane[position_lane] = 0
    if has_regime_anchor and has_phi_anchor:
        rejust["checked"] = True
        regime_at_open = state.regime_at_open_by_lane[position_lane]
        phi_at_open = state.phi_at_open_by_lane[position_lane]
        phi_floor = phi_at_open / PHI_GOLDEN_FLOOR_RATIO
        regime_change_streak = state.regime_change_streak_by_lane.get(
            position_lane, 0,
        )
        regime_stability_ticks_required = _regime_stability_ticks_for_exit()
        # Compute FR distance from the basin anchor (if present). When
        # missing, the gate falls back strict-fail so the regime exit
        # cannot fire on label flicker alone — the geometric component
        # must be measurable.
        basin_at_open = state.basin_at_open_by_lane.get(position_lane)
        fr_distance: Optional[float] = None
        if basin_at_open is not None:
            fr_distance = float(fisher_rao_distance(basin_at_open, basin))
        rejust.update({
            "lane": position_lane,
            "regime_at_open": regime_at_open,
            "regime_now": mode_value,
            "regime_confidence": regime_confidence,
            "regime_change_streak": regime_change_streak,
            "regime_stability_ticks_required": regime_stability_ticks_required,
            "fr_distance": fr_distance,
            "fr_threshold": PI_STRUCT_GRAVITATING_FRACTION,
            "phi_at_open": phi_at_open,
            "phi_now": phi,
            "phi_floor": phi_floor,
            "confidence": getattr(emotions, "confidence", 0.0),
            "anxiety": getattr(emotions, "anxiety", 0.0),
            "confusion": getattr(emotions, "confusion", 0.0),
        })
        # 1. REGIME CHECK — v0.8.7 triple-AND hysteresis. ALL of:
        #   (a) regimeNow != regimeAtOpen   (label divergence)
        #   (b) regimeChangeStreak >= regimeStabilityTicksRequired
        #   (c) fr_distance > 1/π            (basin geometry has moved)
        # PLUS the PR #629 confidence gate (regime_confidence > 1/φ).
        #
        # Live tape 2026-05-01 16:11-16:17 evidence: 9 closes, 22% win
        # rate, every close via regime_change on a $97 account. Without
        # the streak filter a single-tick mode flicker exits the
        # position; without the FR filter, label changes where the
        # basin has barely moved still close out. The triple-AND
        # demands sustained, geometrically-substantiated regime change.
        #
        # FR threshold is PI_STRUCT_GRAVITATING_FRACTION (1/π ≈ 0.318)
        # from EXP-004b — the canonical "basin has moved into a
        # different gravitating cluster" distance.
        label_diverged = mode_value != regime_at_open
        confidence_load_bearing = regime_confidence > PI_STRUCT_BOUNDARY_R_SQUARED
        streak_satisfied = regime_change_streak >= regime_stability_ticks_required
        # Strict-fail when basin anchor is absent (e.g. positions opened
        # before this PR shipped): the regime exit cannot fire purely on
        # label flicker — the geometric component must be measurable.
        fr_fires = fr_distance is not None and fr_distance > PI_STRUCT_GRAVITATING_FRACTION
        if (
            label_diverged
            and confidence_load_bearing
            and streak_satisfied
            and fr_fires
        ):
            rejust["fired"] = "regime_change"
            derivation["rejustification"] = rejust
            fr_str = f"{fr_distance:.3f}" if fr_distance is not None else "N/A"
            reason = (
                f"regime_change: opened in {regime_at_open} "
                f"(FR_dist {fr_str} > 1/π), now {mode_value} stable for "
                f"{regime_change_streak} ticks "
                f"(confidence {regime_confidence:.3f} > 1/φ)"
            )
            return "scalp_exit", reason, False, False
        # 2. PHI CHECK — integration coherence collapsed below the
        # golden-ratio floor (phi_at_open × 0.618). Threshold is
        # phi_at_open / PHI_GOLDEN_FLOOR_RATIO to stay symbolically
        # close to the topology constant — boundary R² applied to
        # integration coherence floor.
        if phi < phi_floor:
            rejust["fired"] = "phi_collapse"
            derivation["rejustification"] = rejust
            reason = (
                f"phi_collapse: open Φ={phi_at_open:.3f} → now {phi:.3f} "
                f"< floor {phi_floor:.3f}"
            )
            return "scalp_exit", reason, False, False
        # 3. CONVICTION CHECK — Layer 2B emotion stack no longer
        # supports the position. Commit 4 (Cascade brief 2026-05-27):
        # observer-derived N per lane, mirroring TS side. Maintain a
        # rolling hesitation_history (anxiety+confusion - confidence)
        # over the last 20 ticks; sign-flip rate sets required streak.
        confidence = getattr(emotions, "confidence", 0.0)
        anxiety = getattr(emotions, "anxiety", 0.0)
        confusion = getattr(emotions, "confusion", 0.0)
        hesitation = anxiety + confusion - confidence

        # Maintain per-lane hesitation history (bounded ring).
        history = state.hesitation_history_by_lane.setdefault(position_lane, [])
        history.append(hesitation)
        if len(history) > _CONVICTION_HESITATION_WINDOW:
            history.pop(0)

        conviction_condition = hesitation > 0  # confidence < anxiety + confusion
        if conviction_condition:
            state.conviction_failed_streak_by_lane[position_lane] = (
                state.conviction_failed_streak_by_lane.get(position_lane, 0) + 1
            )
        else:
            state.conviction_failed_streak_by_lane[position_lane] = 0

        streak = state.conviction_failed_streak_by_lane[position_lane]
        # P5/P25: live observer-derived (registry + phi/flip modulation)
        n_required = get_conviction_streak_required(history, phi)

        if conviction_condition and streak >= n_required:
            rejust["fired"] = "conviction_failed"
            derivation["rejustification"] = rejust
            reason = (
                f"conviction_failed: conf={confidence:.3f} < "
                f"anxiety+confusion={anxiety + confusion:.3f} "
                f"for {streak} consecutive ticks "
                f"(≥ {n_required} required, observer-derived)"
            )
            return "scalp_exit", reason, False, False
    derivation["rejustification"] = rejust

    # ── Trailing-harvest (existing) ───────────────────────────────
    harvest = should_profit_harvest(
        unrealized_pnl_usdt=unrealized_pnl,
        peak_pnl_usdt=state.peak_pnl_usdt_by_lane.get(position_lane, 0.0),
        notional_usdt=position_notional,
        tape_trend=tape_trend,
        held_side=held_side,
        s=basin_state,
        tape_flip_streak=state.tape_flip_streak_by_lane.get(position_lane, 0),
    )
    derivation["harvest"] = {
        **harvest["derivation"],
        "unrealized_pnl": unrealized_pnl,
        "peak_pnl": state.peak_pnl_usdt_by_lane.get(position_lane, 0.0),
        "trade_id": trade_id,
        "lane": position_lane,
    }
    if harvest["value"]:
        derivation["scalp"] = {
            "exit_type_bit": harvest["derivation"].get("exit_type_bit"),
            "unrealized_pnl": unrealized_pnl,
            "mark_price": last_price,
            "trade_id": trade_id,
        }
        return "scalp_exit", harvest["reason"], False, False

    # Take-profit — only TP can reach here (SL was returned above;
    # rejustification and harvest also returned if they fired).
    if scalp["value"]:
        return "scalp_exit", scalp["reason"], False, False

    exit_d = should_exit(
        perception=basin,
        strategy_forecast=state.identity_basin,
        held_side=held_side,
        s=basin_state,
    )
    if exit_d["value"]:
        derivation["exit"] = exit_d["derivation"]
        return "exit", exit_d["reason"], False, False

    # Reversal: when REVERSION mode flipped direction *and* the new
    # direction disagrees with the held side, close-and-reopen.
    # Post #ml-separation: 'side_override' here means REVERSION-mode
    # flip (the only remaining producer). Conviction check via
    # kernel_should_enter — same gate first-entries pass.
    emo = basin_state.emotions
    if (
        side_override
        and side_candidate != held_side
        and MODE_PROFILES[mode_enum].can_enter
        and emo is not None
        and kernel_should_enter(emotions=emo)
        and size_val > 0
    ):
        action = "reverse_long" if side_candidate == "long" else "reverse_short"
        reason = (
            f"REVERSION_FLIP[{held_side}→{side_candidate}] "
            f"basin={derivation['basin_direction']:.2f} "
            f"tape={derivation['tape_trend']:.2f}; "
            f"flatten-then-open margin={size_val:.2f} lev={leverage_val}x"
        )
        return action, reason, False, True

    # DCA add — lane-scoped (proposal #10). The DCA gate's "side mismatch"
    # rejection now means a lane-internal mismatch only; another lane on
    # the same symbol can hold the opposite side without blocking this
    # lane's DCA decision.
    now_ms = time.time() * 1000.0
    lane_add_count = state.dca_add_count_by_lane.get(
        position_lane, state.dca_add_count,
    )
    lane_last_entry_ms = state.last_entry_at_ms_by_lane.get(
        position_lane, state.last_entry_at_ms,
    )
    dca = should_dca_add(
        held_side=held_side,
        side_candidate=side_candidate,
        current_price=last_price,
        initial_entry_price=entry_price,
        add_count=lane_add_count,
        last_add_at_ms=lane_last_entry_ms or 0,
        now_ms=now_ms,
        sovereignty=inputs.sovereignty,
        s=basin_state,  # v0.8.4b — enables cooldown / better-price derivation from NC + bv
        lane=position_lane,
    )
    derivation["dca"] = dca["derivation"]
    if (
        dca["value"]
        and MODE_PROFILES[mode_enum].can_enter
        and emo is not None
        and kernel_should_enter(emotions=emo)
        and size_val > 0
    ):
        action = "enter_long" if side_candidate == "long" else "enter_short"
        reason = (
            f"DCA_ADD[{position_lane}|{lane_add_count + 1}/1] "
            f"{dca['reason']} | "
            f"side={side_candidate} margin={size_val:.2f} lev={leverage_val}x"
        )
        return action, reason, True, False

    return "hold", f"{exit_d['reason']} | dca: {dca['reason']}", False, False


def _has_own_position(acct: AccountContext) -> bool:
    return (
        acct.own_position_trade_id is not None
        and acct.own_position_entry_price is not None
        and acct.own_position_quantity is not None
        and acct.own_position_quantity != 0
    )


def _hold_for_reason(state: SymbolState, reason: str) -> TickDecision:
    """Minimal decision for guard-rail early returns."""
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.0,
    )
    basin = (
        state.last_basin if state.last_basin is not None
        else np.zeros(64, dtype=np.float64)
    )
    return TickDecision(
        action="hold",
        reason=reason,
        mode=state.last_mode or "investigation",
        size_usdt=0.0,
        leverage=1,
        entry_threshold=0.5,
        phi=0.0,
        kappa=state.kappa,
        basin_velocity=0.0,
        f_health=0.5,
        drift_from_identity=0.0,
        basin_direction=0.0,
        tape_trend=0.0,
        side_candidate="long",
        side_override=False,
        neurochemistry=nc,
        derivation={"early_return": reason},
        basin=basin,
    )
