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

from dataclasses import dataclass
from typing import Any, Literal, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .modes import MODE_PROFILES, MonkeyMode
from .state import KAPPA_STAR, NeurochemicalState

Side = Literal["long", "short"]


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
    mode_scale = MODE_PROFILES[mode].entry_threshold_scale
    alignment = tape_trend if side_candidate == "long" else -tape_trend
    trend_mult = 1.0 - 0.3 * alignment

    raw_t = t_base * kappa_ratio * phi_mult * regime_scale * mode_scale * self_obs_bias * trend_mult
    t = _clamp(raw_t, 0.1, 0.9)

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

    mode_floor = MODE_PROFILES[mode].size_floor
    exploration_floor = mode_floor * (1.0 - maturity)

    raw_frac = max(exploration_floor, base_frac * reward_mult * stability_mult)
    frac = _clamp(raw_frac, 0.0, 0.5)
    margin = frac * available_equity_usdt
    notional = margin * max(1.0, leverage)

    # v0.6.6 lift-to-minimum: if we're below exchange min and a fraction
    # within the 0.5 safety clamp CAN clear it, auto-raise.
    lifted = False
    if notional < min_notional_usdt and available_equity_usdt > 0 and leverage > 0:
        BUFFER = 1.05
        required_frac = (min_notional_usdt * BUFFER) / (leverage * available_equity_usdt)
        if required_frac <= 0.5:
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
) -> dict[str, Any]:
    kappa_dist = abs(s.kappa - KAPPA_STAR)
    kappa_proxim = float(np.exp(-kappa_dist / 20.0))
    regime_stability = (
        s.regime_weights.get("equilibrium", 0.0)
        + 0.5 * s.regime_weights.get("efficient", 0.0)
    )
    surprise_discount = 1.0 - 0.5 * s.neurochemistry.norepinephrine

    mode_floor = MODE_PROFILES[mode].sovereign_cap_floor
    sovereign_cap = max(mode_floor, 3.0 + 30.0 * s.sovereignty)

    # v0.6.7 aggressive flatness boost (K=10, BOOST=0.8)
    FLATNESS_K = 10.0
    FLATNESS_BOOST = 0.8
    flatness = max(0.0, 1.0 - abs(tape_trend) * FLATNESS_K)
    flat_mult = 1.0 + FLATNESS_BOOST * flatness

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

    activation = max(0.002, 0.004 - 0.002 * s.neurochemistry.dopamine)
    giveback = 0.30 + 0.20 * (1 - s.neurochemistry.serotonin)
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

    TREND_FLIP_THRESHOLD = -0.25
    if current_frac > 0 and alignment_now <= TREND_FLIP_THRESHOLD and peak_frac >= activation:
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
    profile = MODE_PROFILES[mode]
    tp_thr = max(0.003, profile.tp_base_frac - 0.003 * nc.dopamine + 0.005 * s.phi)
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


DCA_MAX_ADDS_PER_POSITION = 1
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
) -> dict[str, Any]:
    if held_side != side_candidate:
        return {
            "value": False,
            "reason": f"side mismatch ({side_candidate} vs held {held_side})",
            "derivation": {"rule": 1},
        }
    if add_count >= DCA_MAX_ADDS_PER_POSITION:
        return {
            "value": False,
            "reason": f"add cap reached ({add_count}/{DCA_MAX_ADDS_PER_POSITION})",
            "derivation": {"rule": 4, "add_count": add_count},
        }
    if now_ms - last_add_at_ms < DCA_COOLDOWN_MS:
        sec_remain = round((DCA_COOLDOWN_MS - (now_ms - last_add_at_ms)) / 1000)
        return {
            "value": False,
            "reason": f"cooldown ({sec_remain}s remaining)",
            "derivation": {"rule": 3, "sec_remain": sec_remain},
        }
    if sovereignty < DCA_MIN_SOVEREIGNTY:
        return {
            "value": False,
            "reason": f"sovereignty too low ({sovereignty:.3f} < {DCA_MIN_SOVEREIGNTY})",
            "derivation": {"rule": 5, "sovereignty": sovereignty},
        }
    price_delta = (current_price - initial_entry_price) / initial_entry_price
    price_is_better = (
        price_delta < -DCA_BETTER_PRICE_FRAC
        if held_side == "long"
        else price_delta > DCA_BETTER_PRICE_FRAC
    )
    if not price_is_better:
        return {
            "value": False,
            "reason": (
                f"price not better ({price_delta*100:.3f}% from entry vs "
                f"±{DCA_BETTER_PRICE_FRAC*100:.1f}% required)"
            ),
            "derivation": {"rule": 2, "price_delta": price_delta},
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

    disagreement = fisher_rao_distance(perception, strategy_forecast)
    threshold = 0.55 * (1.0 + 0.5 * s.neurochemistry.norepinephrine)
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
