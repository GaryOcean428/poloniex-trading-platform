"""
executive.py — Monkey's arbitration kernel (v0.7.2 Python port).

Every function is a pure map from (state) → (derived param). When
Monkey asks "should I enter?", she doesn't consult a constant — she
asks her current Φ / κ / regime / NC / sovereignty what her threshold
is right now. §28 Autonomic Governance + Canonical Principles v2.1
P14 Variable Separation enforced structurally: no numeric threshold
survives as a frozen constant; formula constants come from UCP frozen
facts (κ* = 64).

Ports the TS executive.ts, using qig_core_local.geometry.fisher_rao
for the one Fisher-Rao call (drift distance). All other math is pure
scalar derivation — numpy-free where it can be.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional

import numpy as np


def upper_stack_executive_live() -> bool:
    """Default-off env flag (PR 4 #609). When true, upper-stack
    emotion signals modulate three executive formulas:

      current_entry_threshold *= (1 − 0.2*wonder + 0.2*anxiety)
      current_leverage        *= (1 − 0.3*anxiety + 0.2*confidence)
      current_position_size   *= (1 + 0.15*flow)

    Multipliers are applied AFTER the existing formula's clamp, then
    re-clipped to the same SAFETY_BOUNDS the formula uses. The bounds
    are NOT bypassed — only the value within them is modulated.
    """
    return os.environ.get("UPPER_STACK_EXECUTIVE_LIVE", "").strip().lower() == "true"

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .basin import max_mass, normalized_entropy
from .modes import MODE_PROFILES, MonkeyMode, effective_profile
from .parameters import get_registry
from .perception_scalars import basin_direction
from .state import KAPPA_STAR, LaneType, NeurochemicalState

Side = Literal["long", "short"]
Direction = Literal["long", "short", "flat"]


# Module-level registry handle. Per-call .get() hits the in-process cache
# after first load — no DB hit on the hot path. Refresh cadence is owned
# by the tick loop via ParameterRegistry.tick().
_registry = get_registry()


# Fallback defaults — used only when DATABASE_URL is unset (tests,
# staging) OR the named row is missing from monkey_parameters. These are
# the exact values v0.8.1 seeded, kept here so behavior is identical if
# the registry is unreachable. Per P25, these stay in code as the
# SAFETY_BOUND floor — changing them requires a governance event in the
# registry, never a code edit.
_DEFAULT_ENTRY_THR_CLAMP_LOW = 0.1
_DEFAULT_ENTRY_THR_CLAMP_HIGH = 0.9
_DEFAULT_SIZE_MAX_FRACTION = 0.5
_DEFAULT_SIZE_MIN_NOTIONAL_BUFFER = 1.05
_DEFAULT_LEVERAGE_MIN_BASELINE = 3.0
_DEFAULT_LEVERAGE_MAX_SLOPE = 30.0
_DEFAULT_LEVERAGE_KAPPA_SIGMA = 20.0
_DEFAULT_SCALP_TP_MIN_FLOOR = 0.003
_DEFAULT_EXIT_ENTROPY_COLLAPSE = 0.4  # (referenced by should_auto_flatten semantic)
_DEFAULT_DCA_MAX_ADDS = 1


# ═══════════════════════════════════════════════════════════════
#  BasinState — shape all executive functions consume
# ═══════════════════════════════════════════════════════════════


@dataclass
class ExecBasinState:
    """Executive-facing basin snapshot (not the full BasinState).

    Kept slim: only what executive decisions need. Serialised from
    the HTTP request each call.
    """

    basin: np.ndarray
    identity_basin: np.ndarray
    phi: float
    kappa: float
    regime_weights: dict[str, float]  # quantum/efficient/equilibrium
    sovereignty: float
    basin_velocity: float
    neurochemistry: NeurochemicalState


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ═══════════════════════════════════════════════════════════════
#  Agent K — geometry-only direction + entry conviction
# ═══════════════════════════════════════════════════════════════
#
# Agent-separation cut: the kernel's *decisions* no longer gate on
# ml-worker's BUY/SELL label or strength scalar. Direction is read
# from basin geometry plus the tape-trend scalar; entry conviction
# emerges from the kernel's own emotion stack. ml is now a sibling
# agent (Agent M) running its own decision loop in TS — see
# apps/api/src/services/ml_agent. Allocation between K and M flows
# through the Arbiter (apps/api/src/services/arbiter).
#
# Why no fallback to ml: under the previous design ml's label seeded
# `side_candidate` and ml's strength gated `current_entry_threshold`.
# That coupling made it impossible to read the kernel's standalone
# performance — every K trade was either confirming or overriding
# ml. To learn whether K survives on its own, we must let it choose
# entirely from its own state.


def kernel_direction(
    basin_state: ExecBasinState,
    tape_trend: float,
    emotions: Any,
) -> Direction:
    """Direction from basin geometry + tape + emotional conviction.

    Pure geometric read:
      basin_dir   ∈ [−1, +1] from momentum-spectrum simplex mass
      tape_trend  ∈ [−1, +1] from log-return + tanh squash
      geometric   = basin_dir + 0.5 * tape_trend

    The emotion stack vetoes weak signals: when the kernel's anxiety
    exceeds confidence, the geometric reading is too uncertain to act
    on regardless of sign — return "flat".

    `emotions` is duck-typed: any object exposing `.confidence` and
    `.anxiety` floats works. EmotionState from emotions.py is the
    canonical caller; tests pass simple namespaces.

    Returns one of: "long", "short", "flat".
    """
    basin_dir = basin_direction(basin_state.basin)
    geometric_signal = basin_dir + 0.5 * tape_trend
    if emotions.confidence < emotions.anxiety:
        return "flat"
    if geometric_signal > 0:
        return "long"
    if geometric_signal < 0:
        return "short"
    return "flat"


def kernel_should_enter(
    emotions: Any,
    motivators: Any = None,  # noqa: ARG001 — kept for API symmetry
) -> bool:
    """Entry conviction gate. Pure emotional read.

    Conviction widens with confidence and is amplified by wonder
    (curiosity-coupled). Hesitation is the union of anxiety
    (transcendence × instability) and confusion (surprise-coupled
    distance from identity).

    Enter when conviction strictly exceeds hesitation. The gate is
    intentionally aggressive — the kernel is one of two competing
    agents and should not under-trade. Risk kernel + arbiter floor
    bound the downside; the executive does not need to second-guess
    its own conviction with a hard scalar threshold.

    `motivators` parameter is preserved in the signature for
    symmetry with future signed-motivator gating; current formula
    operates on emotions only.
    """
    conviction = emotions.confidence * (1.0 + emotions.wonder)
    hesitation = emotions.anxiety + emotions.confusion
    return conviction > hesitation


# ═══════════════════════════════════════════════════════════════
#  currentEntryThreshold — Gary's §5.2 formula
# ═══════════════════════════════════════════════════════════════


def current_entry_threshold(
    s: ExecBasinState,
    *,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    self_obs_bias: float = 1.0,
    tape_trend: float = 0.0,
    side_candidate: Side = "long",
) -> dict[str, Any]:
    drift_distance = fisher_rao_distance(s.basin, s.identity_basin)
    t_base = drift_distance
    kappa_ratio = KAPPA_STAR / max(s.kappa, 1.0)
    phi_mult = 1.0 / (0.5 + s.phi)
    regime_scale = (
        s.regime_weights.get("efficient", 0.0) * 1.0
        + s.regime_weights.get("equilibrium", 0.0) * 0.7
        + s.regime_weights.get("quantum", 0.0) * 1.5
    )
    # v0.8.5 — use state-modulated effective profile (anchor-simplex).
    # DRIFT's entry-lockout (99) passes through as a SAFETY_BOUND; others
    # derive from norepinephrine (surprise eases entry threshold).
    mode_profile = effective_profile(
        mode,
        phi=s.phi,
        serotonin=s.neurochemistry.serotonin,
        norepinephrine=s.neurochemistry.norepinephrine,
        equilibrium_weight=s.regime_weights.get("equilibrium", 0.5),
    )
    mode_scale = mode_profile.entry_threshold_scale
    alignment = tape_trend if side_candidate == "long" else -tape_trend
    trend_mult = 1.0 - 0.3 * alignment

    raw_t = t_base * kappa_ratio * phi_mult * regime_scale * mode_scale * self_obs_bias * trend_mult
    # Entry-threshold clamps are SAFETY_BOUNDS per P25 (floor prevents
    # runaway entries on model hiccup; ceiling prevents permanent
    # no-entry from drift). Live-tunable via parameter registry.
    clamp_low = _registry.get(
        "executive.entry_threshold.clamp_low", default=_DEFAULT_ENTRY_THR_CLAMP_LOW,
    )
    clamp_high = _registry.get(
        "executive.entry_threshold.clamp_high", default=_DEFAULT_ENTRY_THR_CLAMP_HIGH,
    )
    t = _clamp(raw_t, clamp_low, clamp_high)

    return {
        "value": t,
        "reason": (
            f"T = drift({t_base:.3f}) x k*/k({kappa_ratio:.2f}) "
            f"x 1/(0.5+Phi)({phi_mult:.2f}) x regime({regime_scale:.2f}) "
            f"x mode({mode_scale:.2f}) x selfObs({self_obs_bias:.2f}) "
            f"x trend({trend_mult:.2f}, align={alignment:.2f})"
        ),
        "derivation": {
            "drift_distance": drift_distance,
            "kappa_ratio": kappa_ratio,
            "phi_multiplier": phi_mult,
            "regime_scale": regime_scale,
            "mode_scale": mode_scale,
            "self_obs_bias": self_obs_bias,
            "trend_proxy": tape_trend,
            "alignment": alignment,
            "trend_mult": trend_mult,
            "raw_t": raw_t,
            "clamped": t,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  currentPositionSize — Φ × sovereignty × maturity, + lift-to-min
# ═══════════════════════════════════════════════════════════════


def current_position_size(
    s: ExecBasinState,
    *,
    available_equity_usdt: float,
    min_notional_usdt: float,
    leverage: float,
    bank_size: int,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
) -> dict[str, Any]:
    nc = s.neurochemistry
    maturity = min(1.0, bank_size / 20.0)
    base_frac = s.phi * s.sovereignty * maturity
    reward_mult = 1.0 + (nc.dopamine - nc.gaba) * 0.5
    stability_mult = 0.5 + nc.serotonin * 0.5

    # v0.8.5 — size_floor derives from Φ (anchor × (0.5 + phi))
    mode_floor = effective_profile(
        mode,
        phi=s.phi,
        serotonin=nc.serotonin,
        norepinephrine=nc.norepinephrine,
        equilibrium_weight=s.regime_weights.get("equilibrium", 0.5),
    ).size_floor
    exploration_floor = mode_floor * (1.0 - maturity)

    # Size cap: max fraction of equity a single position can consume
    # (SAFETY_BOUND). Lift-to-min buffer: multiplier over exchange min
    # notional so lot rounding never drops us below (SAFETY_BOUND).
    max_fraction = _registry.get(
        "executive.size.max_fraction_of_equity", default=_DEFAULT_SIZE_MAX_FRACTION,
    )
    buffer_mult = _registry.get(
        "executive.size.min_notional_buffer", default=_DEFAULT_SIZE_MIN_NOTIONAL_BUFFER,
    )

    raw_frac = max(exploration_floor, base_frac * reward_mult * stability_mult)
    frac = _clamp(raw_frac, 0.0, max_fraction)
    margin = frac * available_equity_usdt
    notional = margin * max(1.0, leverage)

    # v0.6.6 lift-to-minimum: if we're below exchange min and a fraction
    # within the max_fraction safety clamp CAN clear it, auto-raise.
    lifted = False
    if notional < min_notional_usdt and available_equity_usdt > 0 and leverage > 0:
        required_frac = (min_notional_usdt * buffer_mult) / (leverage * available_equity_usdt)
        if required_frac <= max_fraction:
            frac = max(frac, required_frac)
            margin = frac * available_equity_usdt
            notional = margin * leverage
            lifted = True

    sized = margin if notional >= min_notional_usdt else 0.0

    return {
        "value": sized,
        "reason": (
            f"size = {'lifted-to-min ' if lifted else ''}"
            f"floor({exploration_floor:.3f}) or PhixSxM({base_frac:.3f}) "
            f"x reward({reward_mult:.2f}) x stab({stability_mult:.2f}) "
            f"x equity({available_equity_usdt:.2f}) @ {leverage:.0f}x "
            f"-> margin {margin:.2f}, notional {notional:.2f} vs min {min_notional_usdt:.2f} "
            f"= {sized:.2f}"
        ),
        "derivation": {
            "phi": s.phi,
            "sovereignty": s.sovereignty,
            "maturity": maturity,
            "bank_size": bank_size,
            "exploration_floor": exploration_floor,
            "raw_frac": raw_frac,
            "frac": frac,
            "margin": margin,
            "leverage": leverage,
            "notional": notional,
            "min_notional": min_notional_usdt,
            "sized": sized,
            "lifted_to_min": 1 if lifted else 0,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  currentLeverage — κ-prox × regimeStab × surpDisc × flatMult
# ═══════════════════════════════════════════════════════════════


def current_leverage(
    s: ExecBasinState,
    *,
    max_leverage_boundary: float,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    tape_trend: float = 0.0,
    stud_reading: Optional[Any] = None,
    stud_live: bool = False,
) -> dict[str, Any]:
    # κ-proximity bell width: narrower sigma penalises drift from κ* harder.
    # Baseline + slope: leverage floor + scaling span with sovereignty.
    # All three are SAFETY_BOUNDS — drastic changes would reshape the
    # whole leverage surface, so they're live-governed, not hardcoded.
    kappa_sigma = _registry.get(
        "executive.leverage.kappa_sigma", default=_DEFAULT_LEVERAGE_KAPPA_SIGMA,
    )
    lev_min_baseline = _registry.get(
        "executive.leverage.min_baseline", default=_DEFAULT_LEVERAGE_MIN_BASELINE,
    )
    lev_max_slope = _registry.get(
        "executive.leverage.max_sovereign_slope", default=_DEFAULT_LEVERAGE_MAX_SLOPE,
    )

    kappa_dist = abs(s.kappa - KAPPA_STAR)
    kappa_proxim = float(np.exp(-kappa_dist / kappa_sigma))
    regime_stability = (
        s.regime_weights.get("equilibrium", 0.0)
        + 0.5 * s.regime_weights.get("efficient", 0.0)
    )
    surprise_discount = 1.0 - 0.5 * s.neurochemistry.norepinephrine

    mode_floor = MODE_PROFILES[mode].sovereign_cap_floor
    sovereign_cap = max(mode_floor, lev_min_baseline + lev_max_slope * s.sovereignty)

    # v0.8.4b — FLATNESS_K and FLATNESS_BOOST now DERIVE from geometric
    # state per P25 ("operational thresholds should emerge from κ, Φ,
    # regime, basin velocity").
    #
    # FLATNESS_K — width of the "flat tape" band that activates the boost.
    #   When consciousness is coherent (κ near κ*, high kappa_proxim),
    #   commit to a narrower definition of "flat" — only boost when tape
    #   is genuinely quiet. When κ is off, be more forgiving (wider band).
    #   Anchored: K=10 at kappa_proxim=1 (matches pre-derivation live).
    #   Range [7, 10] — at κ far from κ*, floor keeps the semantic alive.
    # FLATNESS_BOOST — magnitude of the leverage bump when market is flat.
    #   Scales with Φ (integration strength): high Φ = strong conviction,
    #   use the extra leverage; low Φ = diffuse, be conservative.
    #   Anchored: BOOST=0.8 at Φ=0.5 (matches pre-derivation live).
    #   Range [0.5, 1.1] — Φ=0 → 0.5 (half boost); Φ=1 → 1.1 (max out).
    #
    # At "nominal" state (κ=κ*, Φ=0.5) both values equal the pre-derivation
    # constants exactly, so live behavior is preserved unless geometric
    # state is genuinely deviant. Only safety floors (0.15 and 0.30 below)
    # remain as hardcoded SAFETY_BOUNDs.
    flatness_k = 7.0 + 3.0 * kappa_proxim
    flatness_boost = 0.5 + 0.6 * max(0.0, min(1.0, s.phi))
    flatness = max(0.0, 1.0 - abs(tape_trend) * flatness_k)
    flat_mult_legacy = 1.0 + flatness_boost * flatness

    # Tier 9 Stage 2: stud-derived flat_mult uses the bell curve from
    # qig-verification — kappa_trade peaks at +10π in front-loop centre,
    # mirrors negative in back-loop. Scaled to [0.2, 1.8] via PEAK_NORM.
    # When stud_live=False, fall through to the legacy flatness formula
    # bit-identically.
    if stud_live and stud_reading is not None:
        # Import inside to avoid module-load cycle (tick.py imports both).
        from .topology_constants import PI_STRUCT_FRONT_PEAK_NORM
        # kappa_trade ∈ [-PI_STRUCT_FRONT_PEAK_NORM, +PI_STRUCT_FRONT_PEAK_NORM]
        # Map to multiplier ∈ [0.2, 1.8] linearly:
        flat_mult = 1.0 + 0.8 * (stud_reading.kappa_trade / PI_STRUCT_FRONT_PEAK_NORM)
        # Floor at 0.2 to keep leverage positive even in deep back-loop.
        flat_mult = max(0.2, min(1.8, flat_mult))
    else:
        flat_mult = flat_mult_legacy

    newborn = s.sovereignty < 0.1
    if newborn:
        raw_lev = sovereign_cap * 0.8
    else:
        raw_lev = sovereign_cap * kappa_proxim * regime_stability * surprise_discount * flat_mult

    lev = max(1, min(int(max_leverage_boundary), round(raw_lev)))

    return {
        "value": lev,
        "reason": (
            f"lev = sovcap({sovereign_cap:.1f}) x k-prox({kappa_proxim:.3f}) "
            f"x regstab({regime_stability:.2f}) x surp({surprise_discount:.2f}) "
            f"x flat({flat_mult:.2f}) -> {lev}x"
        ),
        "derivation": {
            "kappa": s.kappa,
            "kappa_dist": kappa_dist,
            "kappa_proxim": kappa_proxim,
            "regime_stability": regime_stability,
            "surprise_discount": surprise_discount,
            "sovereign_cap": sovereign_cap,
            "flat_mult": flat_mult,
            "raw_lev": raw_lev,
            "lev": lev,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldProfitHarvest — trailing + trend-flip (v0.6.1)
# ═══════════════════════════════════════════════════════════════


def should_profit_harvest(
    *,
    unrealized_pnl_usdt: float,
    peak_pnl_usdt: float,
    notional_usdt: float,
    tape_trend: float,
    held_side: Side,
    s: ExecBasinState,
) -> dict[str, Any]:
    if notional_usdt <= 0:
        return {"value": False, "reason": "no position", "derivation": {}}

    current_frac = unrealized_pnl_usdt / notional_usdt
    peak_frac = max(peak_pnl_usdt, 0.0) / notional_usdt

    # v0.8.4b — harvest activation and giveback now fully DERIVE per P25.
    # ACTIVATION: baseline, discounted by dopamine (recent wins → harvest
    #   sooner), amplified by Φ (high integration → let winners run).
    #   Anchored at 0.003 when dopamine=0.5 AND Φ=0.5 (pre-derivation live).
    #   0.002 floor stays as SAFETY_BOUND — must always clear 2×fee.
    # GIVEBACK: emerges from serotonin (stability). High serotonin (calm,
    #   coherent) → looser trailing stop, let winners run further. Low
    #   serotonin (unstable) → tighter trailing stop, lock the gain before
    #   chop eats it. Aligns with modes.py:184 sl_ratio doctrine — high
    #   stability minimises losses AND lets profits compound.
    # 2026-04-29: formula was inverted (high serotonin → 0.30 = tightest)
    #   so calm-market profits were harvested too early. Realized-PnL
    #   audit (28 closes, 11.5h) showed avg-win/avg-loss ratio of 1.06,
    #   barely above fees. Fix lifts EV/close from marginal to comfortable.
    # TREND_FLIP: derives from norepinephrine — surprise makes her more
    #   sensitive to trend reversal. Anchored at -0.25 when NE=0.5.
    nc = s.neurochemistry
    phi_clipped = max(0.0, min(1.0, s.phi))
    activation = max(
        0.002,
        0.004 - 0.002 * nc.dopamine + 0.002 * (phi_clipped - 0.5),
    )
    giveback = 0.30 + 0.20 * nc.serotonin
    trailing_floor = peak_frac * (1.0 - giveback)

    alignment_now = tape_trend if held_side == "long" else -tape_trend

    if peak_frac >= activation and current_frac < trailing_floor and current_frac > 0:
        return {
            "value": True,
            "reason": (
                f"trailing_harvest: peak {peak_frac*100:.3f}% -> "
                f"now {current_frac*100:.3f}% < {trailing_floor*100:.3f}% floor"
            ),
            "derivation": {
                "current_frac": current_frac,
                "peak_frac": peak_frac,
                "trailing_floor": trailing_floor,
                "activation": activation,
                "giveback": giveback,
                "exit_type_bit": 2,
            },
        }

    # TREND_FLIP_THRESHOLD derived from NE: at NE=0.5 → -0.25 (pre-derivation
    # live); NE=0 (calm) → -0.30; NE=1 (surprised) → -0.20. More surprised
    # = earlier flip detection.
    trend_flip_threshold = -(0.30 - 0.10 * nc.norepinephrine)
    if current_frac > 0 and alignment_now <= trend_flip_threshold and peak_frac >= activation:
        return {
            "value": True,
            "reason": (
                f"trend_flip_harvest: pnl +{current_frac*100:.3f}%, "
                f"tape flipped (align={alignment_now:.2f})"
            ),
            "derivation": {
                "current_frac": current_frac,
                "peak_frac": peak_frac,
                "alignment": alignment_now,
                "exit_type_bit": 3,
            },
        }

    return {
        "value": False,
        "reason": (
            f"profit_hold: current {current_frac*100:.3f}%, peak {peak_frac*100:.3f}%, "
            f"trail-floor {trailing_floor*100:.3f}%"
        ),
        "derivation": {
            "current_frac": current_frac,
            "peak_frac": peak_frac,
            "trailing_floor": trailing_floor,
            "activation": activation,
            "giveback": giveback,
            "alignment": alignment_now,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldScalpExit — Φ-derived TP / SL (v0.4)
# ═══════════════════════════════════════════════════════════════


def should_scalp_exit(
    *,
    unrealized_pnl_usdt: float,
    notional_usdt: float,
    s: ExecBasinState,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
) -> dict[str, Any]:
    if notional_usdt <= 0:
        return {"value": False, "reason": "no position notional", "derivation": {}}

    pnl_frac = unrealized_pnl_usdt / notional_usdt
    nc = s.neurochemistry
    # v0.8.5 — tp_base_frac and sl_ratio derive from regime + serotonin.
    # Quantum regime (low eq) widens TP; high serotonin (stable) tightens SL.
    profile = effective_profile(
        mode,
        phi=s.phi,
        serotonin=nc.serotonin,
        norepinephrine=nc.norepinephrine,
        equilibrium_weight=s.regime_weights.get("equilibrium", 0.5),
    )
    # Scalp TP floor: must clear exchange fees round-trip (2× taker
    # ~=0.0015 on Poloniex VIP0). 0.003 gives a ~15bp margin. SAFETY_BOUND;
    # the tp_base_frac + dopamine/Φ modulation sits on top of it.
    tp_min_floor = _registry.get(
        "executive.scalp.tp_min_floor", default=_DEFAULT_SCALP_TP_MIN_FLOOR,
    )
    tp_thr = max(tp_min_floor, profile.tp_base_frac - 0.003 * nc.dopamine + 0.005 * s.phi)
    sl_thr = tp_thr * profile.sl_ratio

    if pnl_frac >= tp_thr:
        return {
            "value": True,
            "reason": f"take_profit: {pnl_frac*100:.3f}% >= {tp_thr*100:.3f}%",
            "derivation": {
                "pnl_frac": pnl_frac, "tp_thr": tp_thr, "sl_thr": sl_thr,
                "exit_type_bit": 1,
            },
        }
    if pnl_frac <= -sl_thr:
        return {
            "value": True,
            "reason": f"stop_loss: {pnl_frac*100:.3f}% <= -{sl_thr*100:.3f}%",
            "derivation": {
                "pnl_frac": pnl_frac, "tp_thr": tp_thr, "sl_thr": sl_thr,
                "exit_type_bit": -1,
            },
        }
    return {
        "value": False,
        "reason": (
            f"scalp hold: pnl {pnl_frac*100:.3f}% in "
            f"[-{sl_thr*100:.3f}%, {tp_thr*100:.3f}%]"
        ),
        "derivation": {"pnl_frac": pnl_frac, "tp_thr": tp_thr, "sl_thr": sl_thr},
    }


# ═══════════════════════════════════════════════════════════════
#  shouldDCAAdd — five guard rails (v0.6.2)
# ═══════════════════════════════════════════════════════════════


# DCA PARAMETERs — mixed dispositions per P25:
# - max_adds_per_position is a hard SAFETY_BOUND (capacity risk
#   ceiling; live-governed via registry)
# - cooldown / better_price_frac / min_sovereignty are still literals
#   here but flagged for v0.8.4b DERIVE work (should emerge from
#   Φ/serotonin/basin-velocity). They'll move to _registry.get() +
#   derivation formulas in that pass. For v0.8.4a they stay hardcoded
#   so behavior is bit-identical to pre-merge live — zero decision
#   change in this PR.
DCA_COOLDOWN_MS = 15 * 60 * 1000
DCA_BETTER_PRICE_FRAC = 0.01
DCA_MIN_SOVEREIGNTY = 0.1


def should_dca_add(
    *,
    held_side: Side,
    side_candidate: Side,
    current_price: float,
    initial_entry_price: float,
    add_count: int,
    last_add_at_ms: float,
    now_ms: float,
    sovereignty: float,
    s: Optional[ExecBasinState] = None,
) -> dict[str, Any]:
    # v0.8.4b — when ExecBasinState is provided, DCA cooldown / better-price
    # / min-sovereignty DERIVE from geometric state per P25. When not
    # provided, fall back to the hardcoded pre-derivation values so older
    # callers stay byte-compatible. tick.py's _decide_with_position will
    # populate `s` after v0.8.4b; any other caller gets the legacy path.
    #
    # Cooldown: scales inversely with serotonin (stability). serotonin=0.5
    #   → 15 min (matches pre-derivation); serotonin=0 → 25 min (unstable,
    #   cautious); serotonin=1 → 5 min (stable, okay to add).
    # Better-price threshold: scales with basin velocity. Fast-moving basin
    #   → higher bar for calling it a "better" price. Anchored at 1% when
    #   bv=0.02 (nominal); drops to 0.5% when basin is still, rises to 2%+
    #   when basin is jumpy.
    # Min-sovereignty: still a hard floor (SAFETY_BOUND — no DCA for
    #   newborn kernels regardless of other state).
    if s is not None:
        ser = s.neurochemistry.serotonin
        bv = s.basin_velocity
        cooldown_ms = int((25.0 - 20.0 * ser) * 60_000)  # min → ms
        better_price_frac = max(0.005, min(0.03, 0.01 + (bv - 0.02) * 0.5))
    else:
        cooldown_ms = DCA_COOLDOWN_MS
        better_price_frac = DCA_BETTER_PRICE_FRAC

    if held_side != side_candidate:
        return {
            "value": False,
            "reason": f"side mismatch ({side_candidate} vs held {held_side})",
            "derivation": {"rule": 1},
        }
    # Live-governed SAFETY_BOUND — caps total risk exposure across
    # martingale-style averaging attempts on a single position.
    max_adds = int(_registry.get(
        "executive.dca.max_adds_per_position", default=_DEFAULT_DCA_MAX_ADDS,
    ))
    if add_count >= max_adds:
        return {
            "value": False,
            "reason": f"add cap reached ({add_count}/{max_adds})",
            "derivation": {"rule": 4, "add_count": add_count, "max_adds": max_adds},
        }
    if now_ms - last_add_at_ms < cooldown_ms:
        sec_remain = round((cooldown_ms - (now_ms - last_add_at_ms)) / 1000)
        return {
            "value": False,
            "reason": f"cooldown ({sec_remain}s remaining)",
            "derivation": {
                "rule": 3, "sec_remain": sec_remain,
                "cooldown_ms": cooldown_ms,
            },
        }
    if sovereignty < DCA_MIN_SOVEREIGNTY:
        return {
            "value": False,
            "reason": f"sovereignty too low ({sovereignty:.3f} < {DCA_MIN_SOVEREIGNTY})",
            "derivation": {"rule": 5, "sovereignty": sovereignty},
        }
    price_delta = (current_price - initial_entry_price) / initial_entry_price
    price_is_better = (
        price_delta < -better_price_frac
        if held_side == "long"
        else price_delta > better_price_frac
    )
    if not price_is_better:
        return {
            "value": False,
            "reason": (
                f"price not better ({price_delta*100:.3f}% from entry vs "
                f"±{better_price_frac*100:.2f}% required)"
            ),
            "derivation": {
                "rule": 2, "price_delta": price_delta,
                "better_price_frac": better_price_frac,
            },
        }
    return {
        "value": True,
        "reason": (
            f"DCA_OK: {price_delta*100:.2f}% from entry, "
            f"addCount={add_count}, sov={sovereignty:.2f}"
        ),
        "derivation": {
            "rule": 0,
            "price_delta": price_delta,
            "add_count": add_count,
            "sovereignty": sovereignty,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldExit — Loop 2: perception vs identity basin
# ═══════════════════════════════════════════════════════════════


def should_exit(
    *,
    perception: np.ndarray,
    strategy_forecast: np.ndarray,
    held_side: Optional[Side],
    s: ExecBasinState,
) -> dict[str, Any]:
    if held_side is None:
        return {"value": False, "reason": "no open position", "derivation": {}}

    # Pillar 1 SAFETY_BOUND guard — zombie basin collapse forces exit
    # regardless of disagreement. Mirrors shouldExit() in executive.ts:480-490.
    # These thresholds are catastrophic-collapse safety bounds (P25 permits
    # hardcoded constants for safety). Entropy floor and dominance ceiling
    # define the "basin has collapsed into a single mode" condition — holding
    # through that is always wrong regardless of kernel agreement.
    entropy = normalized_entropy(s.basin)
    dominance = max_mass(s.basin)
    if entropy < 0.4 or dominance > 0.5:
        return {
            "value": True,
            "reason": (
                f"Pillar 1 violated (entropy={entropy:.3f}, maxMass={dominance:.3f}) "
                "- zombie state, exit"
            ),
            "derivation": {"entropy": entropy, "dominance": dominance},
        }

    disagreement = fisher_rao_distance(perception, strategy_forecast)
    # v0.8.4b — disagreement threshold DERIVES fully from NE × regime
    # (previously: half-derived, only NE). High NE (surprised) raises
    # the bar — don't exit on noise. Low equilibrium-weight (regime
    # unstable) lowers the bar — regime will say exit on less.
    # Anchored at 0.6875 when NE=0.5 AND equilibrium=0.5 (matches
    # pre-derivation: 0.55 × (1+0.25) × 1.0 = 0.6875).
    eq_weight = s.regime_weights.get("equilibrium", 0.5)
    threshold = (
        0.55
        * (1.0 + 0.5 * s.neurochemistry.norepinephrine)
        * (0.7 + 0.6 * eq_weight)
    )
    if disagreement > threshold:
        return {
            "value": True,
            "reason": (
                f"kernel disagreement {disagreement:.3f} > {threshold:.3f} - exit"
            ),
            "derivation": {"disagreement": disagreement, "threshold": threshold},
        }
    return {
        "value": False,
        "reason": f"holding: disagreement {disagreement:.3f} < {threshold:.3f}",
        "derivation": {"disagreement": disagreement, "threshold": threshold},
    }


# ═══════════════════════════════════════════════════════════════
#  shouldAutoFlatten — Pillar 1 zombie-collapse catastrophic exit
# ═══════════════════════════════════════════════════════════════


def should_auto_flatten(
    *,
    s: ExecBasinState,
    recent_fhealths: list[float],
) -> dict[str, Any]:
    """When Monkey's own state goes zombie (entropy collapse across
    multiple ticks), flatten regardless of position P&L. Replaces the
    hardcoded −15% DD kill switch with a Pillar 1 derivation — the
    threshold emerges from basin entropy, not an external percentage.

    Ported from apps/api/src/services/monkey/executive.ts:shouldAutoFlatten.
    Thresholds `f_health mean < 0.3` and `trend < −0.1` stay as
    SAFETY_BOUND constants per P25 — they are catastrophic-collapse
    envelopes, not operational thresholds.
    """
    if len(recent_fhealths) < 5:
        return {
            "value": False,
            "reason": "insufficient history",
            "derivation": {},
        }
    recent = recent_fhealths[-10:]
    mean = sum(recent) / len(recent)
    trend = recent[-1] - recent[0]
    catastrophic = mean < 0.3 and trend < -0.1
    return {
        "value": catastrophic,
        "reason": (
            f"f_health mean {mean:.3f}, trend {trend:.3f} — basin dying, FLATTEN"
            if catastrophic
            else f"f_health OK (mean {mean:.3f})"
        ),
        "derivation": {"f_health_mean": mean, "f_health_trend": trend},
    }


# ═══════════════════════════════════════════════════════════════
#  choose_lane — lane selection via softmax over basin features
# ═══════════════════════════════════════════════════════════════


def choose_lane_stud(stud_reading: Any) -> dict[str, Any]:
    """Tier 9 Stage 2 stud-derived lane selection. Maps stud regime
    + h_trade position within front loop to a lane:

      DEAD_ZONE                   → observe   (sit out, no signal)
      BACK_LOOP                   → scalp     (mean-reversion regime)
      FRONT_LOOP, h < 0.6         → trend     (entry zone)
      FRONT_LOOP, 0.6 ≤ h < 1.5   → swing     (centre)
      FRONT_LOOP, h ≥ 1.5         → swing     (exit, continuation)

    Replaces the softmax over (phi, sovereignty, basin_velocity,
    tape_trend) when STUD_TOPOLOGY_LIVE=true. Pure regime → lane
    mapping; no temperature, no probability distribution.
    """
    from .stud import StudRegime  # local import: avoid cycle
    h = stud_reading.h_trade
    regime = stud_reading.regime
    if regime == StudRegime.DEAD_ZONE:
        lane: LaneType = "observe"
        reason = f"stud:DEAD_ZONE → observe (h={h:.4f})"
    elif regime == StudRegime.BACK_LOOP:
        lane = "scalp"
        reason = f"stud:BACK_LOOP → scalp (h={h:.3f})"
    elif h < 0.6:
        lane = "trend"
        reason = f"stud:FRONT_entry → trend (h={h:.3f})"
    else:
        lane = "swing"
        reason = f"stud:FRONT_centre/exit → swing (h={h:.3f})"
    return {
        "value": lane,
        "reason": reason,
        "derivation": {
            "stud_h_trade": h,
            "stud_regime": regime.value,
            "source": "stud",
        },
    }


def choose_lane(
    s: ExecBasinState,
    *,
    tape_trend: float = 0.0,
    stud_reading: Optional[Any] = None,
    stud_live: bool = False,
) -> dict[str, Any]:
    """Select execution lane.

    When stud_live=True with a stud_reading provided, delegates to
    choose_lane_stud (Tier 9 Stage 2 regime → lane mapping).
    Otherwise falls through to the legacy softmax over basin features.

    Legacy scoring invariants (per issue #588):
      - phi≈0, sovereignty≈0, bv≈0 → scalp (high reward density)
      - phi≈1, sovereignty≈1, tape≈1 → trend (directional conviction)
      - bv >> 0 → observe (chaos — sit out)
      - moderate state → swing (default / backward-compat)

    Temperature τ = 1/κ — high κ = exploitation (pick best lane),
    low κ = exploration (spread probability across lanes).
    """
    if stud_live and stud_reading is not None:
        return choose_lane_stud(stud_reading)
    # κ → 0 must yield τ → ∞ (exploration); only clamp away from div-by-zero.
    tau = 1.0 / max(s.kappa, 1e-6)

    # Raw scores: higher = more likely to be chosen
    scalp_score = (1.0 - s.phi) * (1.0 - s.sovereignty) * (1.0 - min(s.basin_velocity, 1.0))
    trend_score = s.phi * s.sovereignty * abs(tape_trend)
    observe_score = min(s.basin_velocity, 1.0) * 0.8
    swing_score = 0.3  # baseline — default lane

    scores: dict[LaneType, float] = {
        "scalp": scalp_score,
        "swing": swing_score,
        "trend": trend_score,
        "observe": observe_score,
    }

    # Softmax with temperature τ
    max_s = max(scores.values())
    exp_scores = {k: math.exp((v - max_s) / max(tau, 1e-6)) for k, v in scores.items()}
    total = sum(exp_scores.values())
    probs = {k: v / total for k, v in exp_scores.items()}

    # Pick lane with highest probability
    lane: LaneType = max(probs, key=lambda k: probs[k])  # type: ignore[arg-type]

    return {
        "value": lane,
        "reason": (
            f"lane={lane} (tau={tau:.4f}, "
            f"scalp={probs.get('scalp', 0):.3f} swing={probs.get('swing', 0):.3f} "
            f"trend={probs.get('trend', 0):.3f} observe={probs.get('observe', 0):.3f})"
        ),
        "derivation": {
            "tau": tau,
            "raw_scores": scores,
            "softmax_probs": probs,
            "phi": s.phi,
            "sovereignty": s.sovereignty,
            "basin_velocity": s.basin_velocity,
            "tape_trend": tape_trend,
        },
    }
