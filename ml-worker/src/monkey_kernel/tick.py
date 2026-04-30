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
  KAPPA_STAR, kappa clamps      → registry-backed (physics.kappa_star)
  Identity basin refresh (50 samples / every 10 ticks) → kept as TS-
    compat constants for v0.8.3 parity. v0.8.6 replaces with adaptive
    derivation when working_memory / self_observation disciplining lands.
"""

from __future__ import annotations

import logging
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
from .emotions import compute_emotions
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
from .modes import MODE_PROFILES, MonkeyMode, detect_mode
from .motivators import compute_motivators
from .ocean import Ocean, ocean_interventions_live
from .persistence import PersistentMemory
from .parameters import get_registry
from .perception import OHLCVCandle, PerceptionInputs, perceive, refract
from .perception_scalars import basin_direction, trend_proxy
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
from .regime import RegimeReading, classify_regime
from .sensations import compute_sensations
from .state import BasinState as KernelBasinState
from .state import LaneType, NeurochemicalState

logger = logging.getLogger("monkey.tick")

_registry = get_registry()


# ── Input / output dataclasses ───────────────────────────────────

@dataclass
class LanePosition:
    """Single-lane position snapshot used by the lane-aware tick path
    (proposal #10). One ``LanePosition`` per (agent, symbol, lane) row
    that is currently ``status='open'`` in autonomous_trades.
    """
    lane: str  # "scalp" | "swing" | "trend"
    side: str  # "long" | "short"
    entry_price: float
    quantity: float
    trade_id: str


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
    # Proposal #3: rolling Kelly stats for the Kelly leverage cap.
    # Passed in by the caller (TS loop.ts queries autonomous_trades and
    # forwards). When None, the Kelly cap is a no-op (defers to the
    # geometric leverage formula). Tuple is (win_rate, avg_win, avg_loss).
    rolling_kelly_stats: Optional[tuple[float, float, float]] = None


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
    kappa: float = 64.0
    session_ticks: int = 0
    last_mode: Optional[str] = None
    basin_history: list[np.ndarray] = field(default_factory=list)
    phi_history: list[float] = field(default_factory=list)
    fhealth_history: list[float] = field(default_factory=list)
    drift_history: list[float] = field(default_factory=list)
    # Tier 1 motivators integration history — (phi, i_q) tuples per tick.
    # Used by compute_motivators for the CV(Φ × I_Q) integration motivator.
    integration_history: list[tuple[float, float]] = field(default_factory=list)
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
        _registry.get("physics.kappa_star", default=64.0)
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
    basin = refract(raw_basin, state.identity_basin, external_weight=0.30)

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
    kappa_star = _registry.get("physics.kappa_star", default=64.0)
    kappa_delta = (coupling_health - 0.5) * 5.0 - (bv - 0.2) * 10.0
    state.kappa = max(20.0, min(
        120.0, state.kappa * 0.8 + (kappa_star + kappa_delta) * 0.2,
    ))

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
    # Sleep state, DREAM/MUSHROOM_MICRO/ESCAPE triggers — all computed
    # here. Caller chemistry (autonomic) downstream consumes is_awake.
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
    )
    # Tier 4 sensations + drives (compressed/expanded/pressure/
    # stillness/drift/resonance + approach/avoidance/conservation).
    sen = compute_sensations(kernel_state, prev_basin=state.last_basin)
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
    emo = compute_emotions(
        motivators=mot,
        basin_distance=sen.drift,
        phi=phi,
        basin_velocity=bv,
        basin=basin,
        predicted_basin=fs.predicted_basin,
        foresight_weight=fs.weight,
    )
    # Tier 7 Heart — κ HRV monitor. Persistent; ephemeral fallback.
    if heart is None:
        heart = HeartMonitor()
    heart.append(state.kappa, now_ms)
    heart_state = heart.read()
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
    # MUSHROOM_MICRO is applied here (before basin_state is built) so
    # the κ perturbation takes effect this tick. DREAM and ESCAPE are
    # applied later in the action-decision block (they override the
    # action; basin_state computation isn't affected). With flag off,
    # interventions are logged but not applied.
    intervention_applied: dict[str, Any] = {
        "fired": ocean_state.intervention,
        "live": ocean_interventions_live(),
        "applied": [],
    }
    if (
        ocean_interventions_live()
        and ocean_state.intervention == "MUSHROOM_MICRO"
    ):
        # +5 perturbation per directive — small kick to break Φ plateau.
        state.kappa = state.kappa + 5.0
        intervention_applied["applied"].append("MUSHROOM_MICRO:+5kappa")

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
    if size_d["value"] == 0 and inputs.account.exchange_held_side is None:
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

    # PR 1 — Ocean DREAM / ESCAPE handlers. ESCAPE forces flatten,
    # DREAM forces hold (skip executive). MUSHROOM_MICRO already
    # applied above (κ perturbation; executive proceeds normally).
    # SLEEP/WAKE flow through autonomic.is_awake regardless of flag.
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
        state.regime_at_open_by_lane.pop(pre_lane, None)
        state.phi_at_open_by_lane.pop(pre_lane, None)
    elif flag_live and ocean_state.intervention == "DREAM":
        action = "hold"
        reason = (
            f"OCEAN.DREAM — phi={phi:.3f} below 0.5; "
            "consolidation tick, executive skipped"
        )
        intervention_applied["applied"].append("DREAM:hold")
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
    ):
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
        elif action in ("reverse_long", "reverse_short"):
            state.regime_at_open_by_lane[position_lane] = mode
            state.phi_at_open_by_lane[position_lane] = phi
    elif (
        MODE_PROFILES[mode_enum].can_enter
        and direction != "flat"
        and kernel_should_enter(emotions=emo)
        and size_d["value"] > 0
    ):
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
    scalp = should_scalp_exit(
        unrealized_pnl_usdt=unrealized_pnl,
        notional_usdt=position_notional,
        s=basin_state,
        mode=mode_enum,
        lane=position_lane,
    )
    derivation["scalp"] = {
        **scalp["derivation"],
        "unrealized_pnl": unrealized_pnl,
        "mark_price": last_price,
        "trade_id": trade_id,
    }
    if scalp["value"] and scalp["derivation"].get("exit_type_bit") == -1:
        return "scalp_exit", scalp["reason"], False, False

    # ── Held-position re-justification (this PR) ──────────────────
    # Three internal exit checks. Each fires immediately when the
    # kernel's current state contradicts the state that justified
    # entry. No streak counting, no hysteresis, no time-based stops.
    # All three are geometric: regime classifier output, Φ integration
    # measure, Layer 2B emotion stack.
    rejust: dict[str, Any] = {"checked": False}
    has_regime_anchor = position_lane in state.regime_at_open_by_lane
    has_phi_anchor = position_lane in state.phi_at_open_by_lane
    if has_regime_anchor and has_phi_anchor:
        rejust["checked"] = True
        regime_at_open = state.regime_at_open_by_lane[position_lane]
        phi_at_open = state.phi_at_open_by_lane[position_lane]
        phi_floor = phi_at_open / PHI_GOLDEN_FLOOR_RATIO
        rejust.update({
            "lane": position_lane,
            "regime_at_open": regime_at_open,
            "regime_now": mode_value,
            "phi_at_open": phi_at_open,
            "phi_now": phi,
            "phi_floor": phi_floor,
            "confidence": getattr(emotions, "confidence", 0.0),
            "anxiety": getattr(emotions, "anxiety", 0.0),
            "confusion": getattr(emotions, "confusion", 0.0),
        })
        # 1. REGIME CHECK — regime changed since open.
        if mode_value != regime_at_open:
            rejust["fired"] = "regime_change"
            derivation["rejustification"] = rejust
            reason = (
                f"regime_change: opened in {regime_at_open}, now {mode_value}"
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
        # supports the position. The moment current conviction fails
        # against hesitation, exit. No half-life, no streak.
        confidence = getattr(emotions, "confidence", 0.0)
        anxiety = getattr(emotions, "anxiety", 0.0)
        confusion = getattr(emotions, "confusion", 0.0)
        if confidence < anxiety + confusion:
            rejust["fired"] = "conviction_failed"
            derivation["rejustification"] = rejust
            reason = (
                f"conviction_failed: conf={confidence:.3f} < "
                f"anxiety+confusion={anxiety + confusion:.3f}"
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
