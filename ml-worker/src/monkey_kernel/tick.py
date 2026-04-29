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
  OVERRIDE_THRESHOLD = 0.35    → DERIVED here (see _override_threshold)
  OHLCV_LOOKBACK, HISTORY_MAX  → registry-backed via parameters.py
  KAPPA_STAR, kappa clamps     → registry-backed (physics.kappa_star)
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
    should_auto_flatten,
    should_dca_add,
    should_exit,
    should_profit_harvest,
    should_scalp_exit,
)
from .foresight import ForesightPredictor
from .heart import HeartMonitor
from .modes import MODE_PROFILES, MonkeyMode, detect_mode
from .motivators import compute_motivators
from .ocean import Ocean, ocean_interventions_live
from .parameters import get_registry
from .perception import OHLCVCandle, PerceptionInputs, perceive, refract
from .perception_scalars import basin_direction, trend_proxy
from .phi_gate import select_phi_gate
from .physical_emotions import compute_physical_emotions
from .sensations import compute_sensations
from .state import BasinState as KernelBasinState
from .state import LaneType, NeurochemicalState

logger = logging.getLogger("monkey.tick")

_registry = get_registry()


def _override_threshold(kappa: float, phi: float) -> float:
    """Derive the basin+tape override threshold from κ and Φ (P25).

    When consciousness is coherent (κ near κ*, high Φ), basin+tape
    quorum doesn't need to be as large to override the ML signal —
    she trusts herself. When forming (κ low, Φ low), raise the bar.

    Formula:
        threshold = 0.35 × (1 + 0.5 × (κ* − κ) / κ*) × (1 − 0.3 × Φ)

    Clamped [0.15, 0.60] — outside that range either disables or
    never permits override, defeating the purpose.
    """
    kappa_star = _registry.get("physics.kappa_star", default=64.0)
    kappa_term = 1.0 + 0.5 * (kappa_star - kappa) / kappa_star
    phi_term = 1.0 - 0.3 * max(0.0, min(1.0, phi))
    raw = 0.35 * kappa_term * phi_term
    return max(0.15, min(0.60, raw))


# ── Input / output dataclasses ───────────────────────────────────

@dataclass
class AccountContext:
    """Snapshot of account / position state as seen by the caller."""
    equity_fraction: float
    margin_fraction: float
    open_positions: int
    available_equity: float
    exchange_held_side: Optional[str] = None
    own_position_entry_price: Optional[float] = None
    own_position_quantity: Optional[float] = None
    own_position_trade_id: Optional[str] = None


@dataclass
class TickInputs:
    """Everything one tick needs, modulo prior state."""
    symbol: str
    ohlcv: list[OHLCVCandle]
    ml_signal: str
    ml_strength: float
    account: AccountContext
    bank_size: int
    sovereignty: float
    max_leverage: int
    min_notional: float
    size_fraction: float = 1.0
    self_obs_bias: Optional[dict[str, dict[str, float]]] = None


@dataclass
class SymbolState:
    """Per-symbol state carried across ticks."""
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
    dca_add_count: int = 0
    last_entry_at_ms: Optional[float] = None
    peak_pnl_usdt: Optional[float] = None
    peak_tracked_trade_id: Optional[str] = None


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
    raw_basin = perceive(PerceptionInputs(
        ohlcv=ohlcv,
        ml_signal=inputs.ml_signal,
        ml_strength=inputs.ml_strength,
        ml_effective_strength=inputs.ml_strength,
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

    coupling_health = inputs.ml_strength
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
    emo = compute_emotions(
        motivators=mot,
        basin_distance=sen.drift,
        phi=phi,
        basin_velocity=bv,
    )
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
    # Tier 7 Heart — κ HRV monitor. Persistent; ephemeral fallback.
    if heart is None:
        heart = HeartMonitor()
    heart.append(state.kappa, now_ms)
    heart_state = heart.read()
    # Tier 6 Φ-gate selection — pure argmax over geometric activations.
    # P9 LIGHTNING channel pinned at 0 (unimplemented); the placeholder
    # never wins until P9 lands.
    gate = select_phi_gate(phi, fs, lightning=0.0)

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
    )
    mode = mode_result["mode"]
    mode_changed = state.last_mode is not None and state.last_mode != mode
    state.last_mode = mode
    try:
        mode_enum = MonkeyMode(mode)
    except ValueError:
        mode_enum = MonkeyMode.INVESTIGATION

    # ── Side candidate + override ──────────────────────────────
    basin_dir = basin_direction(basin)
    tape_trend = trend_proxy([float(c.close) for c in ohlcv])
    ml_side = "short" if inputs.ml_signal.upper() == "SELL" else "long"
    side_candidate = ml_side
    side_override = False
    override_thr = _override_threshold(state.kappa, phi)
    if (
        basin_dir < -override_thr
        and tape_trend < -override_thr
        and ml_side == "long"
    ):
        side_candidate = "short"
        side_override = True
    elif (
        basin_dir > override_thr
        and tape_trend > override_thr
        and ml_side == "short"
    ):
        side_candidate = "long"
        side_override = True

    self_obs_bias = 1.0
    if inputs.self_obs_bias:
        per_mode = inputs.self_obs_bias.get(mode, {})
        self_obs_bias = per_mode.get(side_candidate, 1.0)

    # ── Build basin state for executive ────────────────────────
    basin_state = ExecBasinState(
        basin=basin,
        identity_basin=state.identity_basin,
        phi=phi,
        kappa=state.kappa,
        regime_weights=regime_weights,
        sovereignty=inputs.sovereignty,
        basin_velocity=bv,
        neurochemistry=nc,
    )

    # ── Derive decisions ───────────────────────────────────────
    entry_thr_d = current_entry_threshold(
        basin_state,
        mode=mode_enum,
        self_obs_bias=self_obs_bias,
        tape_trend=tape_trend,
        side_candidate=side_candidate,
    )
    leverage_d = current_leverage(
        basin_state,
        max_leverage_boundary=inputs.max_leverage,
        mode=mode_enum,
        tape_trend=tape_trend,
    )
    exp_floor_approx = 0.10
    max_newborn_lev = 20.0
    min_needed = inputs.min_notional / (exp_floor_approx * max_newborn_lev)
    effective_size_fraction = (
        1.0 if inputs.account.available_equity * inputs.size_fraction < min_needed
        else inputs.size_fraction
    )
    capped_equity = inputs.account.available_equity * effective_size_fraction
    size_d = current_position_size(
        basin_state,
        available_equity_usdt=capped_equity,
        min_notional_usdt=inputs.min_notional,
        leverage=leverage_d["value"],
        bank_size=inputs.bank_size,
        mode=mode_enum,
    )
    auto_flatten_d = should_auto_flatten(
        s=basin_state, recent_fhealths=state.fhealth_history,
    )

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
        "ml_signal": inputs.ml_signal, "ml_strength": inputs.ml_strength,
        "mode": {"value": mode, "reason": mode_result["reason"],
                 **mode_result["derivation"]},
        "self_obs_bias": self_obs_bias,
        "side_candidate": side_candidate,
        "basin_direction": basin_dir,
        "tape_trend": tape_trend,
        "ml_side": ml_side,
        "side_override": side_override,
        "override_threshold": override_thr,
        "mode_changed": mode_changed,
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
    }

    own_pos = _has_own_position(inputs.account)
    held_side: Optional[str] = (
        inputs.account.exchange_held_side if own_pos else None
    )
    derivation["exchange_held_side"] = inputs.account.exchange_held_side
    derivation["monkey_held_side"] = held_side

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
    elif held_side:
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
        )
    elif (
        MODE_PROFILES[mode_enum].can_enter
        and inputs.ml_strength >= entry_thr_d["value"]
        and inputs.ml_signal.upper() != "HOLD"
        and size_d["value"] > 0
    ):
        action = "enter_long" if side_candidate == "long" else "enter_short"
        override_tag = (
            f" OVERRIDE(basin{basin_dir:.2f}/tape{tape_trend:.2f})"
            if side_override else ""
        )
        notional = size_d["value"] * leverage_d["value"]
        reason = (
            f"[{mode}] ml {inputs.ml_signal}@{inputs.ml_strength:.3f} "
            f">= thr {entry_thr_d['value']:.3f}; "
            f"side={side_candidate}{override_tag}; "
            f"margin={size_d['value']:.2f} lev={leverage_d['value']}x "
            f"notional={notional:.2f}"
        )
        derivation["entry_threshold"] = entry_thr_d["derivation"]
        derivation["size"] = size_d["derivation"]
        derivation["leverage"] = leverage_d["derivation"]
    else:
        action = "hold"
        if not MODE_PROFILES[mode_enum].can_enter:
            reason = f"mode={mode} blocks entry"
        elif inputs.ml_strength < entry_thr_d["value"]:
            reason = (
                f"[{mode}] ml {inputs.ml_strength:.3f} "
                f"< thr {entry_thr_d['value']:.3f}"
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

    # ── Lane selection ────────────────────────────────────────────
    lane_d = choose_lane(basin_state, tape_trend=tape_trend)
    lane = lane_d["value"]
    derivation["lane"] = lane_d["derivation"]

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
) -> tuple[str, str, bool, bool]:
    """v0.6.1 exit gate order: profit harvest → scalp TP/SL → Loop 2 exit.
    v0.7.1 override-reverse. v0.6.2 DCA.
    """
    entry_price = inputs.account.own_position_entry_price or last_price
    quantity = inputs.account.own_position_quantity or 0.0
    trade_id = inputs.account.own_position_trade_id or ""
    position_notional = entry_price * quantity
    side_sign = 1 if held_side == "long" else -1
    unrealized_pnl = (last_price - entry_price) * quantity * side_sign

    if state.peak_tracked_trade_id != trade_id:
        state.peak_pnl_usdt = unrealized_pnl
        state.peak_tracked_trade_id = trade_id
    else:
        state.peak_pnl_usdt = max(state.peak_pnl_usdt or 0.0, unrealized_pnl)

    harvest = should_profit_harvest(
        unrealized_pnl_usdt=unrealized_pnl,
        peak_pnl_usdt=state.peak_pnl_usdt or 0.0,
        notional_usdt=position_notional,
        tape_trend=tape_trend,
        held_side=held_side,
        s=basin_state,
    )
    derivation["harvest"] = {
        **harvest["derivation"],
        "unrealized_pnl": unrealized_pnl,
        "peak_pnl": state.peak_pnl_usdt,
        "trade_id": trade_id,
    }
    if harvest["value"]:
        derivation["scalp"] = {
            "exit_type_bit": harvest["derivation"].get("exit_type_bit"),
            "unrealized_pnl": unrealized_pnl,
            "mark_price": last_price,
            "trade_id": trade_id,
        }
        return "scalp_exit", harvest["reason"], False, False

    scalp = should_scalp_exit(
        unrealized_pnl_usdt=unrealized_pnl,
        notional_usdt=position_notional,
        s=basin_state,
        mode=mode_enum,
    )
    derivation["scalp"] = {
        **scalp["derivation"],
        "unrealized_pnl": unrealized_pnl,
        "mark_price": last_price,
        "trade_id": trade_id,
    }
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

    # v0.7.1 override-reverse
    if (
        side_override
        and side_candidate != held_side
        and MODE_PROFILES[mode_enum].can_enter
        and inputs.ml_strength >= entry_thr_val
        and size_val > 0
    ):
        action = "reverse_long" if side_candidate == "long" else "reverse_short"
        reason = (
            f"OVERRIDE_REVERSE[{held_side}→{side_candidate}] "
            f"basin={derivation['basin_direction']:.2f} "
            f"tape={derivation['tape_trend']:.2f}; "
            f"flatten-then-open margin={size_val:.2f} lev={leverage_val}x"
        )
        return action, reason, False, True

    # DCA add
    now_ms = time.time() * 1000.0
    dca = should_dca_add(
        held_side=held_side,
        side_candidate=side_candidate,
        current_price=last_price,
        initial_entry_price=entry_price,
        add_count=state.dca_add_count,
        last_add_at_ms=state.last_entry_at_ms or 0,
        now_ms=now_ms,
        sovereignty=inputs.sovereignty,
        s=basin_state,  # v0.8.4b — enables cooldown / better-price derivation from NC + bv
    )
    derivation["dca"] = dca["derivation"]
    if (
        dca["value"]
        and MODE_PROFILES[mode_enum].can_enter
        and inputs.ml_strength >= entry_thr_val
        and inputs.ml_signal.upper() != "HOLD"
        and size_val > 0
    ):
        action = "enter_long" if side_candidate == "long" else "enter_short"
        reason = (
            f"DCA_ADD[{state.dca_add_count + 1}/1] {dca['reason']} | "
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
